"""Keyword → URL mapping.

Aggregates target-keyword candidates from every signal we have for a client:
  - GSC top queries (joint query+page dimension lets us see which URL ranks per query)
  - Semrush organic positions (uploaded CSV) — keyword + current ranking URL
  - Semrush keyword gap (uploaded CSV) — keyword + competitor URL (no client URL)

Computes per-keyword:
  - current_url        : best client URL ranking for this keyword today
  - current_position   : best known position
  - search_volume      : best volume estimate
  - traffic            : monthly clicks where known (GSC + Semrush)
  - intent             : informational | commercial | transactional | navigational (Semrush)
  - status             : aligned | cannibalized | wrong_page | missing_page | under_optimized
  - target_url         : human-approved URL (initially = current_url unless overridden)
  - sources            : which signals contributed
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import gsc
import semrush_csv
import screamingfrog


CANNIBAL_GSC_IMPR_THRESHOLD = 30      # Require this many impressions on a 2nd URL to count it
CANNIBAL_GSC_POS_THRESHOLD = 30.0     # Within first 30 positions
ALIGNED_POS_THRESHOLD = 5.0           # Position ≤ 5 = aligned (regardless of traffic data)
UNDER_OPT_POS_THRESHOLD = 5.0         # Position > 5 = opportunity to optimize
LOW_POSITION_THRESHOLD = 20.0         # Position > 20 = ranking poorly, needs real work
UNDER_OPT_IMPR = 100                  # Only flag if there's actual impression volume


def _norm_kw(kw: Optional[str]) -> str:
    return (kw or "").strip().lower()


def _normalize_url(u: Optional[str]) -> str:
    return screamingfrog._normalize_url(u or "")


def _build_from_gsc(gsc_cache: Dict[str, Any], domain: str) -> Tuple[Dict[str, Any], Dict[str, List[Dict[str, Any]]]]:
    """Returns (kw_map, per_kw_url_signals).
    per_kw_url_signals is the per-query-per-URL raw GSC rows for cannibalization detection.
    """
    kw_map: Dict[str, Any] = {}
    per_kw: Dict[str, List[Dict[str, Any]]] = {}
    rows = (gsc_cache or {}).get("by_query_page") or []
    for r in rows:
        kw = _norm_kw(r.get("query"))
        if not kw:
            continue
        per_kw.setdefault(kw, []).append({
            "page": r.get("page"),
            "clicks": r.get("clicks") or 0,
            "impressions": r.get("impressions") or 0,
            "position": r.get("position") or 0,
        })

    for kw, urls in per_kw.items():
        # Pick best URL by clicks then impressions
        best = max(urls, key=lambda x: (x.get("clicks") or 0, x.get("impressions") or 0))
        kw_map[kw] = {
            "keyword": kw,
            "current_url": best.get("page"),
            "current_position": best.get("position"),
            "traffic": sum(u.get("clicks") or 0 for u in urls),
            "impressions": sum(u.get("impressions") or 0 for u in urls),
            "sources": {"gsc": True},
        }
    return kw_map, per_kw


def _merge_from_semrush_positions(kw_map: Dict[str, Any], positions_upload: Optional[Dict[str, Any]]) -> None:
    if not positions_upload:
        return
    for item in (positions_upload.get("items") or []):
        kw = _norm_kw(item.get("keyword"))
        if not kw:
            continue
        slot = kw_map.setdefault(kw, {"keyword": kw, "sources": {}})
        slot["sources"]["semrush_pos"] = True
        # Track every Semrush ranking URL (needed for cannibalization detection)
        sem_urls = slot.setdefault("semrush_urls", [])
        url = item.get("url")
        if url:
            sem_urls.append({
                "url": url,
                "position": item.get("position"),
                "traffic": item.get("traffic"),
            })
        # Prefer Semrush position when GSC position missing or worse
        sem_pos = item.get("position")
        if sem_pos is not None and (slot.get("current_position") is None or (sem_pos and sem_pos < slot.get("current_position", 999))):
            slot["current_position"] = sem_pos
            slot["current_url"] = url or slot.get("current_url")
        if not slot.get("current_url"):
            slot["current_url"] = url
        if not slot.get("search_volume") and item.get("search_volume"):
            slot["search_volume"] = item.get("search_volume")
        if not slot.get("intent") and item.get("intent"):
            slot["intent"] = item.get("intent")
        if not slot.get("traffic") and item.get("traffic"):
            slot["traffic"] = item.get("traffic")


def _merge_from_semrush_gap(kw_map: Dict[str, Any], gap_upload: Optional[Dict[str, Any]]) -> None:
    if not gap_upload:
        return
    for item in (gap_upload.get("items") or []):
        kw = _norm_kw(item.get("keyword"))
        if not kw:
            continue
        slot = kw_map.setdefault(kw, {"keyword": kw, "sources": {}})
        slot["sources"]["semrush_gap"] = True
        if not slot.get("search_volume"):
            slot["search_volume"] = item.get("search_volume")
        slot.setdefault("competitor_urls", []).append({
            "url": item.get("competitor_url"),
            "position": item.get("competitor_position"),
        })
        if not slot.get("intent") and item.get("intent"):
            slot["intent"] = item.get("intent")


def _classify_status(slot: Dict[str, Any], per_kw_gsc: Dict[str, List[Dict[str, Any]]]) -> None:
    kw = slot["keyword"]
    has_current = bool(slot.get("current_url"))
    pos = slot.get("current_position")
    has_competitor_only = (
        slot.get("sources", {}).get("semrush_gap")
        and not slot.get("sources", {}).get("semrush_pos")
        and not slot.get("sources", {}).get("gsc")
    )

    # 1. Cannibalization from GSC (multiple client URLs ranking)
    competing_urls_gsc = [
        u for u in per_kw_gsc.get(kw, [])
        if (u.get("impressions") or 0) >= CANNIBAL_GSC_IMPR_THRESHOLD
        and (u.get("position") or 999) <= CANNIBAL_GSC_POS_THRESHOLD
    ]
    if len({u.get("page") for u in competing_urls_gsc if u.get("page")}) >= 2:
        slot["status"] = "cannibalized"
        slot["cannibal_urls"] = sorted(
            [{"url": u.get("page"), "clicks": u.get("clicks"), "impressions": u.get("impressions"), "position": u.get("position")} for u in competing_urls_gsc],
            key=lambda x: (x.get("clicks") or 0), reverse=True,
        )[:5]
        return

    # 1b. Cannibalization from Semrush positions (same keyword, multiple of our URLs ranking)
    sem_urls = slot.get("semrush_urls") or []
    unique_sem_urls = {u.get("url"): u for u in sem_urls if u.get("url")}
    if len(unique_sem_urls) >= 2:
        slot["status"] = "cannibalized"
        slot["cannibal_urls"] = sorted(
            [{"url": u.get("url"), "position": u.get("position"), "traffic": u.get("traffic")} for u in unique_sem_urls.values()],
            key=lambda x: (x.get("position") or 999),
        )[:5]
        return

    # 2. Missing page — competitor ranks, we don't
    if has_competitor_only or not has_current:
        slot["status"] = "missing_page"
        return

    # 3. Position-based classification (works with Semrush-only OR GSC data)
    if pos is not None:
        if pos <= ALIGNED_POS_THRESHOLD:
            slot["status"] = "aligned"
            return
        if pos <= LOW_POSITION_THRESHOLD:
            slot["status"] = "under_optimized"
            return
        slot["status"] = "low_position"
        return

    # 4. No position info → can't tell
    slot["status"] = "missing_page"


async def build_keyword_map(db, client: Dict[str, Any]) -> Dict[str, Any]:
    """Aggregate all sources into a keyword map and persist on the client doc."""
    client_id = client["id"]
    domain = client.get("domain", "")

    gsc_cache = await gsc.get_performance_cache(db, client_id) or {}
    sem_uploads = await semrush_csv.get_uploads(db, client_id)
    positions_upload = sem_uploads.get("organic_positions")
    gap_upload = sem_uploads.get("keyword_gap")

    kw_map, per_kw_gsc = _build_from_gsc(gsc_cache, domain)
    _merge_from_semrush_positions(kw_map, positions_upload)
    _merge_from_semrush_gap(kw_map, gap_upload)

    # Default target_url = current_url unless human has overridden in a previous build
    prev = await get_keyword_map(db, client_id)
    prev_targets = {k: v.get("target_url") for k, v in (prev.get("keywords") or {}).items() if v.get("target_url_user_set")}
    prev_priority = {k for k, v in (prev.get("keywords") or {}).items() if v.get("priority")}

    for kw, slot in kw_map.items():
        _classify_status(slot, per_kw_gsc)
        if kw in prev_targets:
            slot["target_url"] = prev_targets[kw]
            slot["target_url_user_set"] = True
        else:
            slot["target_url"] = slot.get("current_url")
            slot["target_url_user_set"] = False
        if kw in prev_priority:
            slot["priority"] = True

    # Stats
    by_status: Dict[str, int] = {}
    for slot in kw_map.values():
        by_status[slot.get("status", "unknown")] = by_status.get(slot.get("status", "unknown"), 0) + 1

    map_doc = {
        "keywords": kw_map,
        "stats": {
            "total_keywords": len(kw_map),
            "by_status": by_status,
            "sources": {
                "gsc": bool(gsc_cache.get("by_query_page")),
                "semrush_positions": bool(positions_upload),
                "semrush_gap": bool(gap_upload),
            },
        },
        "built_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {"keyword_map": map_doc}},
    )
    return map_doc


async def get_keyword_map(db, client_id: str) -> Dict[str, Any]:
    doc = await db.clients.find_one({"id": client_id}, {"_id": 0, "keyword_map": 1})
    return (doc or {}).get("keyword_map") or {}


async def update_keyword(
    db,
    client_id: str,
    keyword: str,
    *,
    target_url: Optional[str] = None,
    priority: Optional[bool] = None,
    status: Optional[str] = None,
) -> Dict[str, Any]:
    kw = _norm_kw(keyword)
    sets: Dict[str, Any] = {}
    if target_url is not None:
        sets[f"keyword_map.keywords.{kw}.target_url"] = target_url
        sets[f"keyword_map.keywords.{kw}.target_url_user_set"] = True
    if priority is not None:
        sets[f"keyword_map.keywords.{kw}.priority"] = priority
    if status is not None:
        sets[f"keyword_map.keywords.{kw}.status"] = status
        sets[f"keyword_map.keywords.{kw}.status_user_set"] = True
    if sets:
        await db.clients.update_one({"id": client_id}, {"$set": sets})
    doc = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, f"keyword_map.keywords.{kw}": 1},
    )
    return (((doc or {}).get("keyword_map") or {}).get("keywords") or {}).get(kw) or {}


async def attach_serp_landscape(db, client_id: str, keyword: str, serp: Dict[str, Any]) -> None:
    kw = _norm_kw(keyword)
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {f"keyword_map.keywords.{kw}.serp": serp}},
    )


async def attach_page_suggestion(
    db,
    client_id: str,
    url: str,
    *,
    primary_keyword: str,
    related_keywords: List[Dict[str, Any]],
    recommended_keyword: str,
) -> None:
    """Save the AI-analyzed primary keyword + DataForSEO related keywords for a URL."""
    suggestion = {
        "url": url,
        "primary_keyword_guess": primary_keyword,
        "related_keywords": related_keywords,
        "recommended_keyword": recommended_keyword,
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
    }
    await db.clients.update_one(
        {"id": client_id},
        {"$set": {f"keyword_map.page_suggestions.{_normalize_url(url)}": suggestion}},
    )


async def get_page_suggestion(db, client_id: str, url: str) -> Optional[Dict[str, Any]]:
    doc = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "keyword_map.page_suggestions": 1},
    )
    pages = (((doc or {}).get("keyword_map") or {}).get("page_suggestions") or {})
    return pages.get(_normalize_url(url))


async def sparse_urls(db, client_id: str, *, min_keywords: int = 3, min_impressions: int = 50, limit: int = 50) -> List[Dict[str, Any]]:
    """Identify URLs in the SF page index that have weak keyword signal in the map.
    Returns sparse URLs sorted by inlinks desc (most valuable first)."""
    doc = await db.clients.find_one(
        {"id": client_id},
        {"_id": 0, "screaming_frog.page_index": 1, "keyword_map.keywords": 1, "gsc.performance_cache.by_query_page": 1},
    )
    pages = ((doc or {}).get("screaming_frog") or {}).get("page_index") or []
    kw_map = ((doc or {}).get("keyword_map") or {}).get("keywords") or {}
    by_qp = ((doc or {}).get("gsc") or {}).get("performance_cache", {}).get("by_query_page") or []

    # Count GSC keywords + impressions per URL (normalized)
    url_signals: Dict[str, Dict[str, Any]] = {}
    for r in by_qp:
        u = _normalize_url(r.get("page"))
        s = url_signals.setdefault(u, {"keywords": 0, "impressions": 0})
        s["keywords"] += 1
        s["impressions"] += r.get("impressions") or 0
    # Add Semrush positions
    for kw, slot in kw_map.items():
        u = _normalize_url(slot.get("current_url"))
        if u:
            s = url_signals.setdefault(u, {"keywords": 0, "impressions": 0})
            s["keywords"] += 1

    sparse = []
    for p in pages:
        u = p.get("url")
        if not u:
            continue
        key = _normalize_url(u)
        sig = url_signals.get(key) or {"keywords": 0, "impressions": 0}
        if sig["keywords"] < min_keywords and sig["impressions"] < min_impressions:
            sparse.append({
                "url": u,
                "title": p.get("title"),
                "h1": p.get("h1"),
                "word_count": p.get("word_count"),
                "inlinks": p.get("inlinks"),
                "signal_keywords": sig["keywords"],
                "signal_impressions": sig["impressions"],
            })
    sparse.sort(key=lambda x: x.get("inlinks") or 0, reverse=True)
    return sparse[:limit]
