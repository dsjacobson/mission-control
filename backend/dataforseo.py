"""DataForSEO Labs API client (Basic Auth, async via httpx).

Wraps the endpoints we need for competitor + keyword analysis:
- bulk_keyword_difficulty/live
- competitors_domain/live
- domain_intersection/live (with intersections=false for keyword gaps)
- ranked_keywords/live
"""
from __future__ import annotations

import os
from typing import Any, Dict, List

import httpx
from dotenv import load_dotenv

load_dotenv()

DATAFORSEO_LOGIN = os.environ.get("DATAFORSEO_LOGIN", "")
DATAFORSEO_PASSWORD = os.environ.get("DATAFORSEO_PASSWORD", "")
BASE_URL = "https://api.dataforseo.com/v3"

# Location and language defaults (US English)
DEFAULT_LOCATION_CODE = 2840
DEFAULT_LANGUAGE_CODE = "en"


def is_configured() -> bool:
    return bool(DATAFORSEO_LOGIN and DATAFORSEO_PASSWORD)


async def _post(path: str, payload: List[Dict[str, Any]]) -> Dict[str, Any]:
    if not is_configured():
        raise RuntimeError("DataForSEO not configured")
    async with httpx.AsyncClient(
        base_url=BASE_URL,
        auth=(DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD),
        timeout=60.0,
        headers={"Content-Type": "application/json"},
    ) as client:
        resp = await client.post(path, json=payload)
        resp.raise_for_status()
        return resp.json()


def _first_result(body: Dict[str, Any]) -> List[Dict[str, Any]]:
    """DataForSEO returns tasks[0].result; flatten safely."""
    tasks = body.get("tasks") or []
    if not tasks:
        return []
    result = tasks[0].get("result") or []
    return result


async def bulk_keyword_difficulty(
    keywords: List[str],
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> List[Dict[str, Any]]:
    keywords = list(dict.fromkeys([k for k in (kw.strip() for kw in keywords) if k]))[:1000]
    if not keywords:
        return []
    payload = [{
        "keywords": keywords,
        "location_code": location_code,
        "language_code": language_code,
    }]
    body = await _post("/dataforseo_labs/google/bulk_keyword_difficulty/live", payload)
    items = _first_result(body)
    if items and isinstance(items[0], dict) and "items" in items[0]:
        items = items[0].get("items") or []
    out = []
    for it in items:
        out.append({
            "keyword": it.get("keyword"),
            "difficulty": it.get("keyword_difficulty"),
        })
    return out


async def competitors_domain(
    target: str,
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    limit: int = 20,
) -> List[Dict[str, Any]]:
    payload = [{
        "target": target,
        "location_code": location_code,
        "language_code": language_code,
        "limit": limit,
        "max_rank_group": 100,
    }]
    body = await _post("/dataforseo_labs/google/competitors_domain/live", payload)
    items = _first_result(body)
    if items and isinstance(items[0], dict) and "items" in items[0]:
        items = items[0].get("items") or []
    out = []
    for it in items:
        m = it.get("metrics") or {}
        org = m.get("organic") or {}
        out.append({
            "domain": it.get("domain"),
            "intersections": it.get("intersections"),  # shared keywords count
            "avg_position": it.get("avg_position"),
            "etv": org.get("etv"),
            "organic_keywords": org.get("count"),
        })
    return out


async def domain_intersection_gaps(
    stronger_domain: str,
    weaker_domain: str,
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    """Keywords where stronger_domain ranks but weaker_domain does not."""
    payload = [{
        "target1": stronger_domain,
        "target2": weaker_domain,
        "location_code": location_code,
        "language_code": language_code,
        "intersections": False,
        "limit": limit,
    }]
    body = await _post("/dataforseo_labs/google/domain_intersection/live", payload)
    items = _first_result(body)
    if items and isinstance(items[0], dict) and "items" in items[0]:
        items = items[0].get("items") or []
    out = []
    for it in items:
        kw_data = it.get("keyword_data") or {}
        kw_info = kw_data.get("keyword_info") or {}
        out.append({
            "keyword": kw_data.get("keyword"),
            "search_volume": kw_info.get("search_volume"),
            "cpc": kw_info.get("cpc"),
            "competition": kw_info.get("competition"),
        })
    return out


async def ranked_keywords(
    target: str,
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    limit: int = 50,
) -> List[Dict[str, Any]]:
    payload = [{
        "target": target,
        "location_code": location_code,
        "language_code": language_code,
        "limit": limit,
        "load_rank_absolute": True,
    }]
    body = await _post("/dataforseo_labs/google/ranked_keywords/live", payload)
    items = _first_result(body)
    if items and isinstance(items[0], dict) and "items" in items[0]:
        items = items[0].get("items") or []
    out = []
    for it in items:
        kw_data = it.get("keyword_data") or {}
        kw_info = kw_data.get("keyword_info") or {}
        ranked = it.get("ranked_serp_element") or {}
        serp = ranked.get("serp_item") or {}
        out.append({
            "keyword": kw_data.get("keyword"),
            "rank": serp.get("rank_group"),
            "search_volume": kw_info.get("search_volume"),
            "url": serp.get("url"),
        })
    return out


async def test_connection() -> Dict[str, Any]:
    if not is_configured():
        return {"ok": False, "error": "not configured"}
    try:
        # Cheapest sanity check: 1 keyword
        res = await bulk_keyword_difficulty(["test"])
        return {"ok": True, "sample_count": len(res)}
    except httpx.HTTPStatusError as e:
        return {"ok": False, "error": f"HTTP {e.response.status_code}: {e.response.text[:200]}"}
    except Exception as e:
        return {"ok": False, "error": str(e)}
