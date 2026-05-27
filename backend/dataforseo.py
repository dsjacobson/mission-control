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


async def keyword_suggestions(
    seed: str,
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    limit: int = 30,
) -> List[Dict[str, Any]]:
    """Related keyword variations for a seed phrase, with volume + intent."""
    if not seed:
        return []
    payload = [{
        "keyword": seed,
        "location_code": location_code,
        "language_code": language_code,
        "limit": limit,
        "include_seed_keyword": True,
        "include_serp_info": False,
    }]
    body = await _post("/dataforseo_labs/google/keyword_suggestions/live", payload)
    items = _first_result(body)
    if items and isinstance(items[0], dict) and "items" in items[0]:
        items = items[0].get("items") or []
    out = []
    for it in items:
        kw_data = it.get("keyword_data") or it
        kw_info = kw_data.get("keyword_info") or {}
        out.append({
            "keyword": kw_data.get("keyword"),
            "search_volume": kw_info.get("search_volume"),
            "cpc": kw_info.get("cpc"),
            "competition": kw_info.get("competition"),
            "keyword_difficulty": (kw_data.get("keyword_properties") or {}).get("keyword_difficulty"),
            "intent": ((kw_data.get("search_intent_info") or {}).get("main_intent")),
        })
    return out


async def serp_top10(
    keyword: str,
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> Dict[str, Any]:
    """Live SERP top-10 + SERP features for a keyword via Google Organic Live Regular."""
    if not keyword:
        return {}
    payload = [{
        "keyword": keyword,
        "location_code": location_code,
        "language_code": language_code,
        "depth": 10,
    }]
    body = await _post("/serp/google/organic/live/regular", payload)
    items = _first_result(body)
    if not items:
        return {}
    head = items[0] if isinstance(items, list) else items
    raw_items = head.get("items") or []
    organic = []
    features = []
    for it in raw_items:
        t = it.get("type")
        if t == "organic":
            organic.append({
                "rank": it.get("rank_absolute"),
                "url": it.get("url"),
                "title": it.get("title"),
                "snippet": (it.get("description") or "")[:240],
                "domain": it.get("domain"),
            })
        elif t in ("featured_snippet", "people_also_ask", "video", "images", "ai_overview", "knowledge_graph"):
            features.append(t)
    return {
        "keyword": keyword,
        "se_results_count": head.get("se_results_count"),
        "spell": head.get("spell"),
        "organic": organic[:10],
        "features": sorted(set(features)),
        "fetched_at": __import__("datetime").datetime.now(__import__("datetime").timezone.utc).isoformat(),
    }


async def _bulk_post(path: str, targets: List[str]) -> List[Dict[str, Any]]:
    """Generic helper for /backlinks/bulk_*_live endpoints.
    Targets can be domains or URLs depending on the endpoint."""
    if not targets:
        return []
    payload = [{"targets": targets}]
    body = await _post(path, payload)
    items = _first_result(body)
    if items and isinstance(items[0], dict) and "items" in items[0]:
        items = items[0].get("items") or []
    return items or []


async def backlinks_bulk(urls: List[str], domains: List[str]) -> Dict[str, Dict[str, Any]]:
    """For each URL: return DR (domain rank), PR (page rank), total backlinks,
    referring domains, referring nofollow domains, and derived dofollow domains.

    Returns dict keyed by URL → {dr, pr, backlinks, referring_domains,
    referring_domains_nofollow, referring_domains_dofollow}.

    Three bulk calls total regardless of URL count (~$0.003/SERP).
    """
    if not urls:
        return {}

    # Run all three bulk calls in parallel for efficiency
    import asyncio
    url_ranks_task = _bulk_post("/backlinks/bulk_ranks/live", urls)
    backlinks_task = _bulk_post("/backlinks/bulk_backlinks/live", urls)
    refdoms_task = _bulk_post("/backlinks/bulk_referring_domains/live", urls)

    # Domain ranks only need unique domains
    unique_domains = list(dict.fromkeys([d for d in (domains or []) if d]))
    domain_ranks_task = _bulk_post("/backlinks/bulk_ranks/live", unique_domains) if unique_domains else asyncio.sleep(0, result=[])

    url_ranks, backlinks_data, refdoms, dom_ranks = await asyncio.gather(
        url_ranks_task, backlinks_task, refdoms_task, domain_ranks_task,
        return_exceptions=True,
    )

    def _index_by_target(items):
        if isinstance(items, Exception):
            return {}
        return {it.get("target"): it for it in (items or []) if it.get("target")}

    url_rank_by = _index_by_target(url_ranks)
    bl_by = _index_by_target(backlinks_data)
    rd_by = _index_by_target(refdoms)
    dr_by = _index_by_target(dom_ranks)

    out: Dict[str, Dict[str, Any]] = {}
    for url, domain in zip(urls, domains or [None] * len(urls)):
        ur = url_rank_by.get(url) or {}
        bl = bl_by.get(url) or {}
        rd = rd_by.get(url) or {}
        dr = (dr_by.get(domain) or {}) if domain else {}

        total_refdoms = rd.get("referring_domains")
        nofollow_refdoms = rd.get("referring_domains_nofollow")
        dofollow_refdoms = None
        if total_refdoms is not None and nofollow_refdoms is not None:
            dofollow_refdoms = max(0, total_refdoms - nofollow_refdoms)

        out[url] = {
            "domain_rating": dr.get("rank"),
            "page_rating": ur.get("rank"),
            "backlinks": bl.get("backlinks"),
            "referring_domains": total_refdoms,
            "referring_domains_nofollow": nofollow_refdoms,
            "referring_domains_dofollow": dofollow_refdoms,
            "referring_main_domains": rd.get("referring_main_domains"),
        }
    return out


async def serp_with_backlinks(
    keyword: str,
    location_code: int = DEFAULT_LOCATION_CODE,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> Dict[str, Any]:
    """SERP top-10 with per-URL backlink metrics merged in."""
    serp = await serp_top10(keyword, location_code, language_code)
    if not serp.get("organic"):
        return serp
    urls = [o.get("url") for o in serp["organic"] if o.get("url")]
    domains = [o.get("domain") for o in serp["organic"] if o.get("url")]
    try:
        bl = await backlinks_bulk(urls, domains)
    except Exception as e:
        serp["backlinks_error"] = str(e)[:200]
        return serp
    for o in serp["organic"]:
        u = o.get("url")
        if u and u in bl:
            o["backlinks_profile"] = bl[u]
    return serp



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
