"""Competitor enrichment — per-competitor data storage + comparison view.

Storage shape (extends the existing `client.competitors[]` entries):
{
  id, name, domain, notes,                  # existing
  metrics: {                                # NEW — Semrush primary, DataForSEO fallback
    authority_score, trust_score,           # Semrush backlinks_overview
    backlinks, referring_domains,
    referring_domains_nofollow, referring_domains_dofollow,
    organic_keywords, organic_traffic,      # Semrush domain_rank
    # DataForSEO-only (if Backlinks API subscription present):
    domain_rating, page_rating, spam_score,
    refreshed_at, source: 'semrush' | 'dataforseo' | 'mixed',
  },
  ...
}
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import dataforseo
import semrush


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _get_competitor(db, client_id: str, competitor_id: str) -> Optional[Dict[str, Any]]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "competitors": 1})
    for c in (doc or {}).get("competitors") or []:
        if c.get("id") == competitor_id:
            return c
    return None


async def _update_competitor(db, client_id: str, competitor_id: str, fields: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Update one competitor in the embedded array using positional operator."""
    update_doc = {f"competitors.$.{k}": v for k, v in fields.items()}
    await db.clients.update_one(
        {"id": client_id, "competitors.id": competitor_id},
        {"$set": update_doc},
    )
    return await _get_competitor(db, client_id, competitor_id)


def _normalize_domain(domain: str) -> str:
    return (
        (domain or "").strip()
        .replace("https://", "")
        .replace("http://", "")
        .lstrip("www.")
        .rstrip("/")
        .split("/")[0]
    )


async def _pull_metrics_for_domain(domain: str) -> Dict[str, Any]:
    """Aggregate metrics from Semrush (primary) and DataForSEO (fallback)
    into the canonical metrics shape. Tracks which source(s) succeeded."""
    if not domain:
        raise RuntimeError("No domain provided")
    domain_only = _normalize_domain(domain)
    if not domain_only:
        raise RuntimeError("Invalid domain")

    metrics: Dict[str, Any] = {"refreshed_at": _now()}
    sources: list[str] = []
    errors: list[str] = []

    # 1) Semrush backlinks_overview — high-level backlink metrics
    if semrush.is_configured():
        try:
            sm = await semrush.backlinks_overview(domain_only, target_type="root_domain")
            if sm:
                metrics.update({
                    "backlinks": sm.get("backlinks"),
                    "referring_domains": sm.get("referring_domains"),
                    "referring_domains_dofollow": sm.get("referring_domains_dofollow"),
                    "referring_domains_nofollow": sm.get("referring_domains_nofollow"),
                    "authority_score": sm.get("authority_score"),
                    "trust_score": sm.get("trust_score"),
                    "urls_with_backlinks": sm.get("urls_with_backlinks"),
                })
                sources.append("semrush_backlinks")
        except Exception as e:  # noqa: BLE001
            errors.append(f"semrush_backlinks: {str(e)[:120]}")

        # 2) Semrush domain_rank — organic keywords + traffic
        try:
            dr = await semrush.domain_rank(domain_only, database="us")
            if dr:
                metrics.update({
                    "organic_keywords": dr.get("organic_keywords"),
                    "organic_traffic": dr.get("organic_traffic"),
                    "organic_cost": dr.get("organic_cost"),
                    "semrush_rank": dr.get("rank"),
                })
                sources.append("semrush_overview")
        except Exception as e:  # noqa: BLE001
            errors.append(f"semrush_overview: {str(e)[:120]}")

    # 3) DataForSEO bulk backlinks — DR/PR/spam (only present on paid Backlinks API sub)
    if dataforseo.is_configured():
        try:
            url = domain if domain.startswith(("http://", "https://")) else f"https://{domain_only}"
            bl_map = await dataforseo.backlinks_bulk([url], [domain_only])
            profile = bl_map.get(url) or {}
            # Only overwrite when DFS returned real numbers (it returns nulls on failure)
            if profile.get("domain_rating") is not None or profile.get("backlinks") is not None:
                if profile.get("domain_rating") is not None:
                    metrics["domain_rating"] = profile.get("domain_rating")
                if profile.get("page_rating") is not None:
                    metrics["page_rating"] = profile.get("page_rating")
                if profile.get("spam_score") is not None:
                    metrics["spam_score"] = profile.get("spam_score")
                # If Semrush didn't fill these, DFS can
                metrics.setdefault("backlinks", profile.get("backlinks"))
                metrics.setdefault("referring_domains", profile.get("referring_domains"))
                metrics.setdefault("referring_domains_dofollow", profile.get("referring_domains_dofollow"))
                metrics.setdefault("referring_domains_nofollow", profile.get("referring_domains_nofollow"))
                sources.append("dataforseo_backlinks")
        except dataforseo.AccessDeniedError:
            errors.append("dataforseo_backlinks_access_denied")
        except Exception as e:  # noqa: BLE001
            errors.append(f"dataforseo_backlinks: {str(e)[:120]}")

    metrics["source"] = "+".join(sources) if sources else "none"
    if errors:
        metrics["errors"] = errors
    if not sources:
        raise RuntimeError(
            "No metrics provider returned data. "
            + ("; ".join(errors) if errors else "Configure Semrush or DataForSEO Backlinks API.")
        )
    return metrics


# ---------- DataForSEO refreshes ----------

async def refresh_metrics(db, client_id: str, competitor_id: str) -> Dict[str, Any]:
    """Pull backlinks + authority + traffic metrics from Semrush (primary) and
    DataForSEO (fallback, if subscribed). One call to each (~$0.04 Semrush + ~$0.003 DFS)."""
    c = await _get_competitor(db, client_id, competitor_id)
    if not c:
        raise RuntimeError("Competitor not found")
    domain = (c.get("domain") or "").strip().rstrip("/")
    if not domain:
        raise RuntimeError("Competitor has no domain")
    metrics = await _pull_metrics_for_domain(domain)
    return await _update_competitor(db, client_id, competitor_id, {"metrics": metrics})



async def refresh_ranked_keywords(db, client_id: str, competitor_id: str, limit: int = 200) -> Dict[str, Any]:
    """Pull the competitor's organic ranking keywords from DataForSEO Labs.
    ~$0.02 per call."""
    c = await _get_competitor(db, client_id, competitor_id)
    if not c:
        raise RuntimeError("Competitor not found")
    domain = (c.get("domain") or "").strip()
    if not domain:
        raise RuntimeError("Competitor has no domain")
    target = domain.replace("https://", "").replace("http://", "").lstrip("www.").rstrip("/").split("/")[0]

    items = await dataforseo.ranked_keywords(target, limit=limit)
    ranked = {
        "items": items[:limit],
        "total": len(items),
        "refreshed_at": _now(),
        "limit_used": limit,
    }
    return await _update_competitor(db, client_id, competitor_id, {"ranked_keywords": ranked})


# ---------- CSV uploads (per competitor) ----------

async def save_semrush_upload(db, client_id: str, competitor_id: str, parsed: Dict[str, Any], filename: Optional[str] = None) -> Dict[str, Any]:
    c = await _get_competitor(db, client_id, competitor_id)
    if not c:
        raise RuntimeError("Competitor not found")
    parsed["filename"] = filename
    etype = parsed["type"]
    existing = (c.get("semrush_uploads") or {})
    existing[etype] = parsed
    existing["last_uploaded_at"] = parsed["ingested_at"]
    return await _update_competitor(db, client_id, competitor_id, {"semrush_uploads": existing})


async def save_sf_crawl(db, client_id: str, competitor_id: str, parsed: Dict[str, Any], filename: Optional[str] = None) -> Dict[str, Any]:
    """Save an uploaded SF crawl CSV. Handles both issues_overview and internal_all."""
    c = await _get_competitor(db, client_id, competitor_id)
    if not c:
        raise RuntimeError("Competitor not found")
    parsed["filename"] = filename
    sf_data = c.get("sf_crawl") or {}
    fmt = parsed.get("format")
    if fmt == "issues_overview":
        sf_data["issues"] = parsed.get("issues", [])
        sf_data["issues_summary"] = parsed.get("summary", {})
        sf_data["issues_filename"] = filename
        sf_data["issues_ingested_at"] = parsed.get("ingested_at")
    elif fmt == "internal_all":
        sf_data["page_index"] = parsed.get("page_index", [])
        sf_data["internal_summary"] = parsed.get("summary", {})
        sf_data["page_index_filename"] = filename
        sf_data["page_index_ingested_at"] = parsed.get("ingested_at")
    else:
        # Unknown format — store raw
        sf_data["other"] = sf_data.get("other") or []
        sf_data["other"].append({"filename": filename, "summary": parsed.get("summary"), "ingested_at": parsed.get("ingested_at")})
    sf_data["last_uploaded_at"] = parsed.get("ingested_at")
    return await _update_competitor(db, client_id, competitor_id, {"sf_crawl": sf_data})


# ---------- Comparison view ----------

async def build_comparison(db, client_id: str) -> Dict[str, Any]:
    """Side-by-side comparison of client vs each competitor across all metrics."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0})
    if not client:
        return {}
    competitors = client.get("competitors") or []

    # Client's own metrics (from the latest SERP fetch backlinks or refresh)
    # We'll use whatever's available — for the client, derive from SF + Semrush uploads
    sf = client.get("screaming_frog") or {}
    client_metrics = {
        "name": client.get("name"),
        "domain": client.get("domain"),
        "is_client": True,
        # We don't have DataForSEO metrics for the client itself by default.
        # User can trigger refresh via a similar endpoint if desired.
        "metrics": (client.get("metrics") or {}),
        "ranked_keywords_total": ((client.get("ranked_keywords") or {}).get("total")) or len(((sf.get("page_index") or []))),
        "sf_issues_count": len((sf.get("crawl") or {}).get("issues") or []),
        "sf_pages": len(sf.get("page_index") or []),
        "semrush_uploads": list((client.get("semrush_uploads") or {}).keys()),
    }
    rows = [client_metrics]

    # Build keyword-overlap signal: how many of client's GSC/Semrush keywords also rank for competitor
    client_kw_set = set()
    kw_map = (client.get("keyword_map") or {}).get("keywords") or {}
    for kw in kw_map.keys():
        client_kw_set.add(kw.lower())

    for c in competitors:
        comp_kws = (((c.get("ranked_keywords") or {}).get("items")) or []) + (((c.get("semrush_uploads") or {}).get("organic_positions", {}).get("items")) or [])
        comp_kw_set = {(k.get("keyword") or "").lower() for k in comp_kws if k.get("keyword")}
        overlap = len(client_kw_set & comp_kw_set) if client_kw_set else 0
        only_comp = len(comp_kw_set - client_kw_set)

        rows.append({
            "id": c.get("id"),
            "name": c.get("name"),
            "domain": c.get("domain"),
            "is_client": False,
            "metrics": c.get("metrics") or {},
            "ranked_keywords_total": (c.get("ranked_keywords") or {}).get("total") or len(comp_kw_set),
            "metrics_refreshed_at": (c.get("metrics") or {}).get("refreshed_at"),
            "ranked_keywords_refreshed_at": (c.get("ranked_keywords") or {}).get("refreshed_at"),
            "sf_pages": len((c.get("sf_crawl") or {}).get("page_index") or []),
            "sf_issues_count": len((c.get("sf_crawl") or {}).get("issues") or []),
            "semrush_uploads": list((c.get("semrush_uploads") or {}).keys()),
            "keyword_overlap": overlap,
            "keyword_gap_count": only_comp,
        })

    # Concrete deltas: where client lags (highest-impact callouts)
    deltas = []
    client_metrics_data = client_metrics.get("metrics") or {}
    for c in rows[1:]:
        m = c.get("metrics") or {}
        if not m:
            continue

        # Authority Score (Semrush, 0-100)
        client_as = client_metrics_data.get("authority_score")
        comp_as = m.get("authority_score")
        if client_as is not None and comp_as is not None and comp_as > client_as + 5:
            deltas.append({
                "competitor": c.get("name"),
                "type": "authority_score",
                "label": "Authority Score",
                "gap": comp_as - client_as,
                "your_value": client_as,
                "their_value": comp_as,
            })

        # Domain Rating (DataForSEO, 0-1000 → render /10)
        client_dr = client_metrics_data.get("domain_rating") or 0
        comp_dr = m.get("domain_rating") or 0
        if comp_dr and comp_dr > client_dr + 50:
            deltas.append({
                "competitor": c.get("name"),
                "type": "domain_rating",
                "label": "Domain Rating",
                "gap": round((comp_dr - client_dr) / 10, 1),
                "your_value": round(client_dr / 10, 1),
                "their_value": round(comp_dr / 10, 1),
            })

        # Referring domains (dofollow)
        client_rd = (client_metrics_data.get("referring_domains_dofollow") or 0)
        comp_rd = (m.get("referring_domains_dofollow") or 0)
        if comp_rd > client_rd * 1.5 and comp_rd - client_rd > 20:
            deltas.append({
                "competitor": c.get("name"),
                "type": "dofollow_domains",
                "label": "Dofollow referring domains",
                "gap": comp_rd - client_rd,
                "your_value": client_rd,
                "their_value": comp_rd,
            })

        # Organic traffic (Semrush)
        client_ot = client_metrics_data.get("organic_traffic") or 0
        comp_ot = m.get("organic_traffic") or 0
        if comp_ot > client_ot * 3 and comp_ot - client_ot > 1000:
            deltas.append({
                "competitor": c.get("name"),
                "type": "organic_traffic",
                "label": "Estimated organic traffic",
                "gap": comp_ot - client_ot,
                "your_value": client_ot,
                "their_value": comp_ot,
            })

    return {
        "rows": rows,
        "deltas": deltas[:10],
        "built_at": _now(),
    }


async def refresh_client_metrics(db, client_id: str) -> Dict[str, Any]:
    """Pull metrics for the CLIENT's own domain so the comparison view has both sides.
    Stores under `client.metrics`."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "domain": 1})
    if not client:
        raise RuntimeError("Client not found")
    domain = (client.get("domain") or "").strip()
    if not domain:
        raise RuntimeError("Client has no domain")
    metrics = await _pull_metrics_for_domain(domain)
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"metrics": metrics}},
    )
    return metrics
