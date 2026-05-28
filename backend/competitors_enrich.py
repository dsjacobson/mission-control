"""Competitor enrichment — per-competitor data storage + comparison view.

Storage shape (extends the existing `client.competitors[]` entries):
{
  id, name, domain, notes,                  # existing
  metrics: {                                # NEW — DataForSEO bulk pull
    domain_rating, page_rating,
    backlinks, referring_domains,
    referring_domains_nofollow, referring_domains_dofollow,
    spam_score, refreshed_at,
  },
  ranked_keywords: {                        # NEW — DataForSEO ranked_keywords
    items: [{keyword, position, search_volume, url, etv, intent}, ...],
    total, refreshed_at,
  },
  semrush_uploads: {                        # NEW — per-competitor Semrush CSV
    organic_positions: {items, summary, ingested_at, filename},
    backlinks: {...}, ...
  },
  sf_crawl: {                               # NEW — uploaded SF crawl CSV
    page_index: [...],
    issues: [...],
    summary: {...},
    ingested_at, filename,
  },
}
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import dataforseo


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


# ---------- DataForSEO refreshes ----------

async def refresh_metrics(db, client_id: str, competitor_id: str) -> Dict[str, Any]:
    """Pull DR/backlinks/spam for the competitor's domain + homepage URL.
    One call (~$0.003)."""
    c = await _get_competitor(db, client_id, competitor_id)
    if not c:
        raise RuntimeError("Competitor not found")
    domain = (c.get("domain") or "").strip().rstrip("/")
    if not domain:
        raise RuntimeError("Competitor has no domain")
    # Normalize to URL + domain
    url = domain if domain.startswith(("http://", "https://")) else f"https://{domain}"
    domain_only = domain.replace("https://", "").replace("http://", "").lstrip("www.").split("/")[0]

    bl_map = await dataforseo.backlinks_bulk([url], [domain_only])
    profile = bl_map.get(url) or {}
    metrics = {
        "domain_rating": profile.get("domain_rating"),
        "page_rating": profile.get("page_rating"),
        "backlinks": profile.get("backlinks"),
        "spam_score": profile.get("spam_score"),
        "referring_domains": profile.get("referring_domains"),
        "referring_domains_nofollow": profile.get("referring_domains_nofollow"),
        "referring_domains_dofollow": profile.get("referring_domains_dofollow"),
        "refreshed_at": _now(),
    }
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
        if not m or m.get("domain_rating") is None:
            continue
        client_dr = client_metrics_data.get("domain_rating") or 0
        comp_dr = m.get("domain_rating") or 0
        if comp_dr > client_dr + 50:  # 5+ DR points on 0-100 scale (DR is 0-1000)
            deltas.append({
                "competitor": c.get("name"),
                "type": "domain_rating",
                "gap": round((comp_dr - client_dr) / 10, 1),
                "your_value": round(client_dr / 10, 1),
                "their_value": round(comp_dr / 10, 1),
            })
        client_rd = (client_metrics_data.get("referring_domains_dofollow") or 0)
        comp_rd = (m.get("referring_domains_dofollow") or 0)
        if comp_rd > client_rd * 1.5 and comp_rd - client_rd > 20:
            deltas.append({
                "competitor": c.get("name"),
                "type": "dofollow_domains",
                "gap": comp_rd - client_rd,
                "your_value": client_rd,
                "their_value": comp_rd,
            })

    return {
        "rows": rows,
        "deltas": deltas[:10],
        "built_at": _now(),
    }


async def refresh_client_metrics(db, client_id: str) -> Dict[str, Any]:
    """Pull DR/backlinks/spam for the CLIENT's own domain so the comparison view
    has both sides. Stores under `client.metrics`."""
    client = await db.clients.find_one({"id": client_id}, {"_id": 0, "domain": 1})
    if not client:
        raise RuntimeError("Client not found")
    domain = (client.get("domain") or "").strip()
    if not domain:
        raise RuntimeError("Client has no domain")
    url = domain if domain.startswith(("http://", "https://")) else f"https://{domain}"
    domain_only = domain.replace("https://", "").replace("http://", "").lstrip("www.").split("/")[0]

    bl_map = await dataforseo.backlinks_bulk([url], [domain_only])
    profile = bl_map.get(url) or {}
    metrics = {
        "domain_rating": profile.get("domain_rating"),
        "page_rating": profile.get("page_rating"),
        "backlinks": profile.get("backlinks"),
        "spam_score": profile.get("spam_score"),
        "referring_domains": profile.get("referring_domains"),
        "referring_domains_nofollow": profile.get("referring_domains_nofollow"),
        "referring_domains_dofollow": profile.get("referring_domains_dofollow"),
        "refreshed_at": _now(),
    }
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"metrics": metrics}},
    )
    return metrics
