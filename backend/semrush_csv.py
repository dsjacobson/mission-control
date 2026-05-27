"""Manual Semrush CSV export ingestion.

Lets the user upload Semrush exports (CSV) so we don't have to spend API
credits. Semrush exports are typically semicolon-separated with a header row.
We auto-detect the export type by inspecting column headers.

Supported export types (auto-detected):
  - domain_overview     (Domain | Database | Rank | Organic Keywords | ...)
  - organic_positions   (Keyword | Position | Search Volume | URL | ...)
  - competitors         (Domain | Competitor Relevance | Common Keywords | ...)
  - backlinks           (Source url | Target url | Anchor | ...)
  - keyword_gap         (Keyword | Search Volume | Competitor URL | Position | ...)

Storage: `clients.semrush_uploads.{type}` = {filename, rows, uploaded_at, items, summary}
"""
from __future__ import annotations

import csv
import io
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


SUPPORTED_TYPES = ("domain_overview", "organic_positions", "competitors", "backlinks", "keyword_gap")


def _sniff_delimiter(sample: str) -> str:
    """Semrush usually exports semicolon-delimited; some users get comma."""
    if not sample:
        return ","
    semi = sample.count(";")
    comma = sample.count(",")
    tab = sample.count("\t")
    return max([(";", semi), (",", comma), ("\t", tab)], key=lambda x: x[1])[0]


def _norm(h: str) -> str:
    return (h or "").strip().lower()


def _detect_type(headers: List[str]) -> str:
    h = {_norm(x) for x in headers}

    # Keyword Gap export: has both "competitor url" + "position" + "keyword"
    if {"keyword", "competitor url", "position"}.issubset(h):
        return "keyword_gap"
    # Some keyword-gap variants put position columns per competitor
    if "keyword" in h and any("position" in c for c in h) and "search volume" in h and \
       any("traffic" not in c for c in h) and len(h & {"trends", "kd"}) >= 0 and \
       "competitor url" in " ".join(h):
        return "keyword_gap"

    # Organic positions (a domain's ranked keywords)
    if {"keyword", "position", "search volume", "url"}.issubset(h):
        return "organic_positions"

    # Domain Competitors (domain_organic_organic)
    if "domain" in h and "competitor relevance" in h:
        return "competitors"
    if "domain" in h and "common keywords" in h and "organic keywords" in h:
        return "competitors"

    # Backlinks (Source url + Target url + Anchor)
    if {"source url", "target url", "anchor"}.issubset(h):
        return "backlinks"

    # Domain Overview (summary row)
    if "domain" in h and "organic keywords" in h and "organic traffic" in h and "rank" in h:
        return "domain_overview"

    return "unknown"


def _to_int(v):
    if v in (None, ""):
        return None
    try:
        return int(str(v).replace(",", "").replace(" ", "").strip())
    except Exception:
        return None


def _to_float(v):
    if v in (None, ""):
        return None
    try:
        return float(str(v).replace(",", "").replace(" ", "").strip())
    except Exception:
        return None


def _get(row: Dict[str, str], *names: str, default=None):
    norm = {_norm(k): v for k, v in row.items()}
    for n in names:
        v = norm.get(_norm(n))
        if v not in (None, ""):
            return v
    return default


def parse_csv(text: str) -> Dict[str, Any]:
    """Parse a Semrush CSV export into a normalized snapshot."""
    if not text or not text.strip():
        return {"type": "empty", "rows": 0, "items": [], "summary": {}}

    # Sniff delimiter from the first non-empty line
    first_line = next((ln for ln in text.splitlines() if ln.strip()), "")
    delim = _sniff_delimiter(first_line)

    reader = csv.reader(io.StringIO(text), delimiter=delim)
    rows = [r for r in reader if any(c.strip() for c in r)]
    if len(rows) < 1:
        return {"type": "empty", "rows": 0, "items": [], "summary": {}}

    headers = [h.strip() for h in rows[0]]
    data_rows = [dict(zip(headers, r)) for r in rows[1:]]

    export_type = _detect_type(headers)
    if export_type == "unknown":
        return {
            "type": "unknown",
            "rows": len(data_rows),
            "items": [],
            "summary": {},
            "headers": headers[:20],
            "note": "Unrecognised Semrush export. Supported: Domain Overview, Organic Positions, Competitors, Backlinks, Keyword Gap.",
        }

    parser = {
        "domain_overview": _parse_domain_overview,
        "organic_positions": _parse_organic_positions,
        "competitors": _parse_competitors,
        "backlinks": _parse_backlinks,
        "keyword_gap": _parse_keyword_gap,
    }[export_type]

    parsed = parser(data_rows)
    parsed["type"] = export_type
    parsed["rows"] = len(data_rows)
    parsed["ingested_at"] = datetime.now(timezone.utc).isoformat()
    return parsed


# ---------- Parsers ----------

def _parse_domain_overview(rows: List[Dict[str, str]]) -> Dict[str, Any]:
    items = []
    for r in rows[:50]:
        items.append({
            "domain": _get(r, "Domain"),
            "database": _get(r, "Database"),
            "rank": _to_int(_get(r, "Rank")),
            "organic_keywords": _to_int(_get(r, "Organic Keywords")),
            "organic_traffic": _to_int(_get(r, "Organic Traffic")),
            "organic_cost": _to_float(_get(r, "Organic Cost")),
            "adwords_keywords": _to_int(_get(r, "Adwords Keywords")),
            "adwords_traffic": _to_int(_get(r, "Adwords Traffic")),
        })
    primary = items[0] if items else {}
    return {
        "items": items,
        "summary": {
            "domain": primary.get("domain"),
            "database": primary.get("database"),
            "organic_keywords": primary.get("organic_keywords"),
            "organic_traffic": primary.get("organic_traffic"),
        },
    }


def _parse_organic_positions(rows: List[Dict[str, str]]) -> Dict[str, Any]:
    items = []
    for r in rows:
        items.append({
            "keyword": _get(r, "Keyword"),
            "position": _to_int(_get(r, "Position")),
            "previous_position": _to_int(_get(r, "Previous position", "Previous Position")),
            "search_volume": _to_int(_get(r, "Search Volume")),
            "cpc": _to_float(_get(r, "CPC")),
            "url": _get(r, "URL", "Url"),
            "traffic": _to_int(_get(r, "Traffic")),
            "traffic_pct": _to_float(_get(r, "Traffic (%)", "Traffic %")),
            "kd": _to_float(_get(r, "Keyword Difficulty", "KD", "KD %")),
            "intent": _get(r, "Keyword Intents", "Intent"),
            "serp_features": _get(r, "SERP Features by Keyword", "SERP Features"),
        })
    items = [i for i in items if i["keyword"]]
    # Sort by traffic desc
    items.sort(key=lambda x: x.get("traffic") or 0, reverse=True)
    top1_3 = sum(1 for i in items if (i.get("position") or 999) <= 3)
    top4_10 = sum(1 for i in items if 4 <= (i.get("position") or 0) <= 10)
    top11_20 = sum(1 for i in items if 11 <= (i.get("position") or 0) <= 20)
    return {
        "items": items[:500],
        "summary": {
            "total_keywords": len(items),
            "top_1_3": top1_3,
            "top_4_10": top4_10,
            "top_11_20": top11_20,
            "total_traffic": sum((i.get("traffic") or 0) for i in items),
        },
    }


def _parse_competitors(rows: List[Dict[str, str]]) -> Dict[str, Any]:
    items = []
    for r in rows[:50]:
        items.append({
            "domain": _get(r, "Domain"),
            "competitor_relevance": _to_float(_get(r, "Competitor Relevance")),
            "common_keywords": _to_int(_get(r, "Common Keywords")),
            "organic_keywords": _to_int(_get(r, "Organic Keywords", "SE Keywords")),
            "organic_traffic": _to_int(_get(r, "Organic Traffic", "SE Traffic")),
        })
    items = [i for i in items if i["domain"]]
    return {
        "items": items,
        "summary": {"total_competitors": len(items)},
    }


def _parse_backlinks(rows: List[Dict[str, str]]) -> Dict[str, Any]:
    items = []
    for r in rows[:500]:
        items.append({
            "page_score": _to_int(_get(r, "Page ascore", "Page AScore", "Authority Score")),
            "source_url": _get(r, "Source url", "Source URL"),
            "source_title": _get(r, "Source title", "Source Title"),
            "target_url": _get(r, "Target url", "Target URL"),
            "anchor": _get(r, "Anchor"),
            "nofollow": (_get(r, "Nofollow") or "").lower() in ("true", "yes", "1"),
            "first_seen": _get(r, "First seen", "First Seen"),
        })
    items = [i for i in items if i["source_url"]]
    unique_domains = len({(i.get("source_url") or "").split("/")[2] for i in items if (i.get("source_url") or "").startswith("http")})
    follow = sum(1 for i in items if not i.get("nofollow"))
    return {
        "items": items[:200],
        "summary": {
            "total_backlinks": len(items),
            "unique_referring_domains_approx": unique_domains,
            "follow_links": follow,
            "nofollow_links": len(items) - follow,
        },
    }


def _parse_keyword_gap(rows: List[Dict[str, str]]) -> Dict[str, Any]:
    items = []
    for r in rows:
        items.append({
            "keyword": _get(r, "Keyword"),
            "search_volume": _to_int(_get(r, "Search Volume")),
            "cpc": _to_float(_get(r, "CPC")),
            "kd": _to_float(_get(r, "KD", "Keyword Difficulty")),
            "competition": _to_float(_get(r, "Competition")),
            "competitor_url": _get(r, "Competitor URL", "URL"),
            "competitor_position": _to_int(_get(r, "Position")),
            "intent": _get(r, "Keyword Intents", "Intent"),
        })
    items = [i for i in items if i["keyword"]]
    items.sort(key=lambda x: x.get("search_volume") or 0, reverse=True)
    return {
        "items": items[:500],
        "summary": {
            "total_gaps": len(items),
            "total_volume": sum((i.get("search_volume") or 0) for i in items),
        },
    }


# ---------- Storage helpers ----------

async def save_upload(db, client_id: str, parsed: Dict[str, Any], filename: Optional[str] = None) -> None:
    parsed["filename"] = filename
    etype = parsed["type"]
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {
            f"semrush_uploads.{etype}": parsed,
            "semrush_uploads.last_uploaded_at": parsed["ingested_at"],
        }},
    )


async def get_uploads(db, client_id: str) -> Dict[str, Any]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "semrush_uploads": 1})
    return (doc or {}).get("semrush_uploads") or {}


async def get_upload(db, client_id: str, etype: str) -> Optional[Dict[str, Any]]:
    uploads = await get_uploads(db, client_id)
    return uploads.get(etype)


async def clear_upload(db, client_id: str, etype: str) -> None:
    await db.clients.update_one(
        {"id": client_id},
        {"$unset": {f"semrush_uploads.{etype}": ""}},
    )


async def clear_all(db, client_id: str) -> None:
    await db.clients.update_one({"id": client_id}, {"$unset": {"semrush_uploads": ""}})
