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
    reader = csv.reader(io.StringIO(text))
    rows = list(reader)
    if not rows:
        return {"format": "empty", "rows": 0, "summary": {}, "issues": []}

    headers = [h.strip() for h in rows[0]]
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
    """For internal_all.csv we extract very high-level signals."""
    def _g(row, name, default=""):
        for h in row:
            if h.lower() == name.lower():
                return row[h]
        return default

    status_codes: Dict[str, int] = {}
    indexable_yes = 0
    indexable_no = 0
    missing_titles = 0
    missing_meta = 0
    h1_missing = 0
    total = len(data_rows)

    for row in data_rows:
        sc = _g(row, "Status Code")
        if sc:
            status_codes[sc] = status_codes.get(sc, 0) + 1
        idx = (_g(row, "Indexability") or "").strip().lower()
        if idx == "indexable":
            indexable_yes += 1
        elif idx:
            indexable_no += 1
        if not _g(row, "Title 1"):
            missing_titles += 1
        if not _g(row, "Meta Description 1"):
            missing_meta += 1
        if not _g(row, "H1-1"):
            h1_missing += 1

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
        },
        "issues": [],
        "ingested_at": datetime.now(timezone.utc).isoformat(),
    }


async def save_crawl(db, client_id: str, parsed: Dict[str, Any], filename: Optional[str] = None) -> None:
    parsed["filename"] = filename
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"screaming_frog.crawl": parsed, "screaming_frog.last_uploaded_at": parsed["ingested_at"]}},
    )


async def get_crawl(db, client_id: str) -> Optional[Dict[str, Any]]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "screaming_frog": 1})
    if not doc:
        return None
    sf = doc.get("screaming_frog") or {}
    return sf.get("crawl")


async def clear_crawl(db, client_id: str) -> None:
    await db.clients.update_one({"id": client_id}, {"$unset": {"screaming_frog": ""}})
