"""Screaming Frog crawl-export ingestion.

Spike approach: SF v24 MCP runs locally on the desktop and is not reachable
from a hosted backend. So we accept the user's exported crawl CSV (issues
overview is most useful) and parse it into normalized JSON for the Technical
Audit agent.

Supported uploads (auto-detected by header):
  - issues_overview.csv  (SF "Issues" report export)
  - internal_all.csv     (SF Internal -> All export — fallback, big)
"""
from __future__ import annotations

import csv
import io
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional


def _detect_format(headers: List[str]) -> str:
    lower = [h.lower() for h in headers]
    if "issue name" in lower or "issue priority" in lower or "issue type" in lower:
        return "issues_overview"
    if "address" in lower and "status code" in lower:
        return "internal_all"
    return "unknown"


def parse_csv(text: str) -> Dict[str, Any]:
    """Parse a Screaming Frog CSV export into a structured summary."""
    # Strip UTF-8 BOM if present (SF v24 issues_overview_report.csv emits one)
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return {"format": "empty", "rows": 0, "summary": {}, "issues": []}

    headers = [h.strip().lstrip("\ufeff") for h in rows[0]]
    fmt = _detect_format(headers)
    data_rows = [dict(zip(headers, r)) for r in rows[1:] if any(r)]

    if fmt == "issues_overview":
        return _parse_issues(headers, data_rows)
    if fmt == "internal_all":
        return _parse_internal(headers, data_rows)
    return {"format": fmt, "rows": len(data_rows), "summary": {}, "issues": [],
            "note": "Unknown SF export format — upload Issues Overview (Reports → Issues → Export)."}


def _parse_issues(headers: List[str], data_rows: List[Dict[str, str]]) -> Dict[str, Any]:
    def _int(v):
        try:
            return int(str(v).replace(",", "").strip() or 0)
        except Exception:
            return 0

    def _g(row, *names, default=""):
        for n in names:
            for h in row:
                if h.lower() == n.lower():
                    return row[h]
        return default

    issues = []
    by_priority = {"High": 0, "Medium": 0, "Low": 0}
    by_type = {}
    total_urls_affected = 0

    for row in data_rows:
        name = _g(row, "Issue Name", "Issue")
        priority = (_g(row, "Issue Priority", "Priority") or "").strip().title() or "Low"
        itype = _g(row, "Issue Type", "Type")
        urls_affected = _int(_g(row, "URLs", "% of Total", "Number of URLs"))
        pct = _g(row, "% of Total", "Percentage")
        if not name:
            continue
        issues.append({
            "name": name,
            "priority": priority,
            "type": itype,
            "urls_affected": urls_affected,
            "pct_of_total": pct,
        })
        if priority in by_priority:
            by_priority[priority] += 1
        else:
            by_priority[priority] = by_priority.get(priority, 0) + 1
        by_type[itype] = by_type.get(itype, 0) + 1
        total_urls_affected += urls_affected

    # Sort: High > Medium > Low, then by urls_affected desc
    pri_rank = {"High": 0, "Medium": 1, "Low": 2}
    issues.sort(key=lambda x: (pri_rank.get(x["priority"], 3), -x["urls_affected"]))

    return {
        "format": "issues_overview",
        "rows": len(data_rows),
        "summary": {
            "total_issues": len(issues),
            "by_priority": by_priority,
            "by_type": by_type,
            "total_urls_affected": total_urls_affected,
        },
        "issues": issues[:50],
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


def _parse_internal(headers: List[str], data_rows: List[Dict[str, str]]) -> Dict[str, Any]:
    """For internal_all.csv we build a per-URL page index used by the executor."""
    def _g(row, name, default=""):
        for h in row:
            if h.lower() == name.lower():
                return row[h]
        return default

    def _int(v):
        try:
            return int(str(v).replace(",", "").strip() or 0)
        except Exception:
            return None

    status_codes: Dict[str, int] = {}
    indexable_yes = 0
    indexable_no = 0
    missing_titles = 0
    missing_meta = 0
    h1_missing = 0
    total = len(data_rows)

    # Sort by Inlinks desc so we keep the highest-value pages first
    def _inlinks(r):
        return _int(_g(r, "Inlinks")) or 0
    sorted_rows = sorted(data_rows, key=_inlinks, reverse=True)

    PAGE_CAP = 2000  # User chose option b — keep up to 2000 URLs in the page index
    page_index: List[Dict[str, Any]] = []
    seen_urls = set()

    for row in sorted_rows:
        sc = _g(row, "Status Code")
        if sc:
            status_codes[sc] = status_codes.get(sc, 0) + 1
        idx = (_g(row, "Indexability") or "").strip().lower()
        if idx == "indexable":
            indexable_yes += 1
        elif idx:
            indexable_no += 1
        title = _g(row, "Title 1")
        meta = _g(row, "Meta Description 1")
        h1 = _g(row, "H1-1")
        if not title:
            missing_titles += 1
        if not meta:
            missing_meta += 1
        if not h1:
            h1_missing += 1

        url = _g(row, "Address")
        if url and url not in seen_urls and len(page_index) < PAGE_CAP:
            seen_urls.add(url)
            page_index.append({
                "url": url,
                "status_code": _int(sc),
                "indexability": _g(row, "Indexability"),
                "content_type": _g(row, "Content Type"),
                "title": title,
                "title_length": _int(_g(row, "Title 1 Length")),
                "meta_description": meta,
                "meta_length": _int(_g(row, "Meta Description 1 Length")),
                "h1": h1,
                "h1_length": _int(_g(row, "H1-1 Length")),
                "h2": _g(row, "H2-1"),
                "canonical": _g(row, "Canonical Link Element 1") or _g(row, "Canonical"),
                "word_count": _int(_g(row, "Word Count")),
                "inlinks": _int(_g(row, "Inlinks")),
                "outlinks": _int(_g(row, "Outlinks")),
                "crawl_depth": _int(_g(row, "Crawl Depth")),
            })

    return {
        "format": "internal_all",
        "rows": total,
        "summary": {
            "status_codes": status_codes,
            "indexable": indexable_yes,
            "non_indexable": indexable_no,
            "missing_titles": missing_titles,
            "missing_meta_descriptions": missing_meta,
            "missing_h1": h1_missing,
            "page_index_size": len(page_index),
        },
        "issues": [],
        "page_index": page_index,
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


async def save_crawl(db, client_id: str, parsed: Dict[str, Any], filename: Optional[str] = None) -> None:
    parsed["filename"] = filename
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"screaming_frog.crawl": parsed, "screaming_frog.last_uploaded_at": parsed["ingested_at"]}},
    )


async def save_page_index(db, client_id: str, parsed: Dict[str, Any], filename: Optional[str] = None) -> None:
    """Persist the internal_all-derived page index separately so the executor can
    look up real current titles/meta/H1 per URL."""
    page_index = parsed.get("page_index") or []
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {
            "screaming_frog.page_index": page_index,
            "screaming_frog.page_index_filename": filename,
            "screaming_frog.page_index_ingested_at": parsed.get("ingested_at"),
            "screaming_frog.internal_summary": parsed.get("summary") or {},
        }},
    )


async def get_page_for_url(db, client_id: str, url: str) -> Optional[Dict[str, Any]]:
    """Look up one URL in the stored page index."""
    if not url:
        return None
    doc = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "screaming_frog.page_index": 1},
    )
    pages = ((doc or {}).get("screaming_frog") or {}).get("page_index") or []
    # exact match first, then normalized (trailing slash / scheme tolerance)
    by_url = {p.get("url"): p for p in pages if p.get("url")}
    if url in by_url:
        return by_url[url]
    norm = url.rstrip("/").lower()
    for u, p in by_url.items():
        if u and u.rstrip("/").lower() == norm:
            return p
    return None


async def get_pages_for_urls(db, client_id: str, urls: List[str]) -> List[Dict[str, Any]]:
    """Bulk lookup. Returns pages in the same order as urls (missing → None entries skipped)."""
    if not urls:
        return []
    doc = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "screaming_frog.page_index": 1},
    )
    pages = ((doc or {}).get("screaming_frog") or {}).get("page_index") or []
    by_url = {p.get("url"): p for p in pages if p.get("url")}
    norm_map = {u.rstrip("/").lower(): u for u in by_url}
    out: List[Dict[str, Any]] = []
    for url in urls:
        if not url:
            continue
        if url in by_url:
            out.append(by_url[url])
            continue
        k = url.rstrip("/").lower()
        if k in norm_map:
            out.append(by_url[norm_map[k]])
    return out


async def save_issue_urls(db, client_id: str, issue_url_map: Dict[str, List[str]]) -> None:
    """Persist a map of issue-name → list of affected URLs (from bulk issue CSVs)."""
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"screaming_frog.issue_urls": issue_url_map}},
    )


async def get_urls_for_issue(db, client_id: str, issue_name: str, limit: int = 50) -> List[str]:
    """Best-effort lookup of affected URLs for a given issue name."""
    if not issue_name:
        return []
    doc = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "screaming_frog.issue_urls": 1},
    )
    issue_urls = ((doc or {}).get("screaming_frog") or {}).get("issue_urls") or {}
    target = issue_name.lower().strip()
    # exact
    if issue_name in issue_urls:
        return issue_urls[issue_name][:limit]
    # case-insensitive
    for k, v in issue_urls.items():
        if k.lower() == target:
            return v[:limit]
    # token overlap (e.g., "Missing H1" ↔ "h1_missing")
    target_tokens = {t for t in re.split(r"[^a-z0-9]+", target) if len(t) > 2}
    if not target_tokens:
        return []
    best: tuple = (0, [])
    for k, v in issue_urls.items():
        ktokens = {t for t in re.split(r"[^a-z0-9]+", k.lower()) if len(t) > 2}
        overlap = len(target_tokens & ktokens)
        if overlap > best[0]:
            best = (overlap, v)
    return (best[1] or [])[:limit] if best[0] >= 2 else []


def parse_issue_urls_csv(text: str) -> List[str]:
    """Generic parser for SF bulk issue exports — pulls the Address column."""
    if not text:
        return []
    if text.startswith("\ufeff"):
        text = text.lstrip("\ufeff")
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if len(rows) < 2:
        return []
    headers = [h.strip().lstrip("\ufeff") for h in rows[0]]
    # find Address (or URL) column
    addr_idx = None
    for i, h in enumerate(headers):
        if h.lower() in ("address", "url", "source"):
            addr_idx = i
            break
    if addr_idx is None:
        return []
    urls = []
    seen = set()
    for r in rows[1:]:
        if len(r) <= addr_idx:
            continue
        u = (r[addr_idx] or "").strip()
        if u and u not in seen:
            seen.add(u)
            urls.append(u)
    return urls



async def get_crawl(db, client_id: str) -> Optional[Dict[str, Any]]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "screaming_frog": 1})
    if not doc:
        return None
    sf = doc.get("screaming_frog") or {}
    return sf.get("crawl")


async def clear_crawl(db, client_id: str) -> None:
    await db.clients.update_one({"id": client_id}, {"$unset": {"screaming_frog": ""}})
