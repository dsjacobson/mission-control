"""Page-content analyzer for sparse-keyword pages.

For URLs with little/no GSC + Semrush ranking signal, we:
  1. Fetch the page HTML
  2. Strip nav/footer/scripts/styles → keep main content text
  3. Pull title/H1/H2/H3 + body text sample
  4. Ask an AI agent to identify the page's primary keyword
  5. Expand via DataForSEO keyword_suggestions for related variants
  6. Recommend the optimal mapped keyword (volume × intent fit)

Lightweight: uses httpx + a small HTML-tag regex (no full DOM lib).
Falls back gracefully if the page is JS-rendered or blocked.
"""
from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import httpx

import agents
import dataforseo


USER_AGENT = "SeoOperator/1.0 (+https://emerald.consulting/)"


def _strip_html(html: str) -> Dict[str, Any]:
    """Crude but effective: regex-based extraction. Returns title, headings, body sample."""
    # Drop scripts/styles entirely
    html = re.sub(r"<(script|style|noscript|svg)\b[^>]*>.*?</\1>", " ", html, flags=re.IGNORECASE | re.DOTALL)
    # Pull title
    title_m = re.search(r"<title[^>]*>(.*?)</title>", html, re.IGNORECASE | re.DOTALL)
    title = re.sub(r"\s+", " ", (title_m.group(1) if title_m else "")).strip()
    # Pull meta description
    meta_m = re.search(r'<meta[^>]+name=["\']description["\'][^>]+content=["\']([^"\']+)["\']', html, re.IGNORECASE)
    meta = (meta_m.group(1) if meta_m else "").strip()
    # Pull headings
    def _take(tag):
        return [re.sub(r"<[^>]+>", "", m).strip() for m in re.findall(rf"<{tag}[^>]*>(.*?)</{tag}>", html, re.IGNORECASE | re.DOTALL)]
    h1 = _take("h1")
    h2 = _take("h2")
    h3 = _take("h3")
    # Pull main/article/body fallback
    main_m = re.search(r"<(main|article)\b[^>]*>(.*?)</\1>", html, re.IGNORECASE | re.DOTALL)
    if main_m:
        body_html = main_m.group(2)
    else:
        body_m = re.search(r"<body\b[^>]*>(.*?)</body>", html, re.IGNORECASE | re.DOTALL)
        body_html = body_m.group(1) if body_m else html
    body_text = re.sub(r"<[^>]+>", " ", body_html)
    body_text = re.sub(r"\s+", " ", body_text).strip()
    return {
        "title": title,
        "meta": meta,
        "h1": h1[:5],
        "h2": h2[:15],
        "h3": h3[:20],
        "body_sample": body_text[:5000],  # cap to keep prompt size sane
        "word_count_estimate": len(body_text.split()),
    }


async def fetch_page(url: str, timeout_s: float = 20.0) -> Dict[str, Any]:
    """Fetch and parse a page. Returns {ok, status, content?, error?}."""
    if not url or not url.startswith(("http://", "https://")):
        return {"ok": False, "error": "Invalid URL"}
    try:
        timeouts = httpx.Timeout(connect=10.0, read=timeout_s, write=10.0, pool=10.0)
        async with httpx.AsyncClient(
            timeout=timeouts,
            follow_redirects=True,
            headers={"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml"},
        ) as c:
            r = await c.get(url)
            if r.status_code >= 400:
                return {"ok": False, "status": r.status_code, "error": f"HTTP {r.status_code}"}
            html = r.text
        content = _strip_html(html)
        return {"ok": True, "status": 200, "url": url, "content": content}
    except httpx.RequestError as e:
        return {"ok": False, "error": f"{type(e).__name__}: {str(e)[:120]}"}


async def analyze_page(
    db,
    client: Dict[str, Any],
    url: str,
) -> Dict[str, Any]:
    """Full pipeline for one URL:
    fetch → strip → AI primary keyword → DataForSEO suggestions → recommend.
    """
    # Step 1: fetch + strip
    fetched = await fetch_page(url)
    if not fetched.get("ok"):
        return {"url": url, "ok": False, "error": fetched.get("error", "fetch failed")}
    content = fetched["content"]

    # Step 2: ask the AI agent
    primary_kw = await agents.identify_primary_keyword(
        run_id=f"page-analyze-{client['id']}",
        client=client,
        page={
            "url": url,
            "title": content.get("title"),
            "meta": content.get("meta"),
            "h1": content.get("h1"),
            "h2": content.get("h2"),
            "body_sample": content.get("body_sample"),
        },
    )
    if not primary_kw:
        return {"url": url, "ok": False, "error": "AI could not identify a primary keyword"}

    # Step 3: DataForSEO suggestions (related variants with volume + intent)
    related = []
    if dataforseo.is_configured():
        try:
            related = await dataforseo.keyword_suggestions(primary_kw, limit=25)
        except Exception:
            related = []

    # Step 4: Recommend the optimal keyword (highest volume that's specific enough)
    recommended = primary_kw
    if related:
        # Prefer keywords with volume between 50 and ~5x the seed volume (avoid overly broad)
        seed_vol = next((r.get("search_volume") for r in related if r.get("keyword", "").lower() == primary_kw.lower()), None)
        cap = (seed_vol or 5000) * 5 if seed_vol else 10000
        scored = []
        for r in related:
            v = r.get("search_volume") or 0
            if v < 50:
                continue
            if v > cap:
                continue
            # Prefer commercial/transactional intent slightly, then volume
            intent_bonus = 1.2 if r.get("intent") in ("commercial", "transactional") else 1.0
            scored.append((v * intent_bonus, r.get("keyword")))
        scored.sort(reverse=True)
        if scored and scored[0][1]:
            recommended = scored[0][1]

    return {
        "url": url,
        "ok": True,
        "primary_keyword_guess": primary_kw,
        "recommended_keyword": recommended,
        "related_keywords": related[:25],
        "content_summary": {
            "title": content.get("title"),
            "h1": content.get("h1"),
            "word_count_estimate": content.get("word_count_estimate"),
        },
    }
