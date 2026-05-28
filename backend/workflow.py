"""Workflow orchestrator: runs a workflow as a background task, persists logs and
results to MongoDB, and creates Approvals when complete.
"""
from __future__ import annotations

import asyncio
import traceback
from typing import Any, Dict

from motor.motor_asyncio import AsyncIOMotorDatabase

from models import AgentLog, Approval, now_iso, new_id
import agents
import gsc
import ga
import semrush
import semrush_csv
import dataforseo
import screamingfrog


AGENT_FOR_TYPE = {
    "keyword_research": "keyword",
    "technical_audit": "audit",
    "competitor_analysis": "competitor",
    "strategy_sprint": "strategy",
}


async def _log(db, run_id: str, agent: str, message: str, level: str = "info") -> None:
    entry = AgentLog(agent=agent, message=message, level=level).model_dump()
    await db.runs.update_one(
        {"id": run_id},
        {"$push": {"logs": entry}},
    )


async def _set_run(db, run_id: str, **fields) -> None:
    await db.runs.update_one({"id": run_id}, {"$set": fields})


# ---------- Context builders (reusable across workflows) ----------

async def _build_gsc_block(db, client_id: str) -> str | None:
    cache = await gsc.get_performance_cache(db, client_id)
    if not cache or not (cache.get("by_query") or cache.get("by_page")):
        return None
    top_queries = (cache.get("by_query") or [])[:25]
    top_pages = (cache.get("by_page") or [])[:10]
    lines = [f"GSC · site={cache.get('site_url')} · {cache.get('start_date')}→{cache.get('end_date')}"]
    lines.append("Top queries (query | clicks | impressions | ctr% | position):")
    for q in top_queries:
        lines.append(f"  - {q['key']} | {q['clicks']} | {q['impressions']} | {q['ctr']} | {q['position']}")
    lines.append("Top pages (page | clicks | impressions | ctr% | position):")
    for p in top_pages:
        lines.append(f"  - {p['key']} | {p['clicks']} | {p['impressions']} | {p['ctr']} | {p['position']}")
    return "\n".join(lines)


async def _build_ga_block(db, client_id: str) -> str | None:
    cache = await ga.get_performance_cache(db, client_id)
    if not cache:
        return None
    totals = cache.get("totals") or {}
    lines = [f"GA4 · property={cache.get('property_id')} · last 28 days"]
    if totals:
        lines.append(f"Totals: sessions={totals.get('sessions')} users={totals.get('totalUsers')} pageviews={totals.get('screenPageViews')} engagement={totals.get('engagementRate')}")
    top_pages = (cache.get("top_pages") or [])[:10]
    if top_pages:
        lines.append("Top landing pages (page | sessions | engagement):")
        for p in top_pages:
            lines.append(f"  - {p.get('landingPagePlusQueryString')} | {p.get('sessions')} | {p.get('engagementRate')}")
    by_source = (cache.get("by_source") or [])[:8]
    if by_source:
        lines.append("Top traffic sources (channel/source | sessions):")
        for s in by_source:
            lines.append(f"  - {s.get('sessionDefaultChannelGroup')}/{s.get('sessionSource')} | {s.get('sessions')}")
    return "\n".join(lines)


def _build_sf_block(crawl: Dict[str, Any] | None) -> str | None:
    if not crawl:
        return None
    summary = crawl.get("summary") or {}
    lines = [f"Screaming Frog crawl · format={crawl.get('format')} · rows={crawl.get('rows')}"]
    by_priority = summary.get("by_priority")
    if by_priority:
        lines.append(f"Issues by priority: {by_priority}")
    if summary.get("total_urls_affected"):
        lines.append(f"Total URLs affected: {summary['total_urls_affected']}")
    if summary.get("status_codes"):
        lines.append(f"Status codes: {summary['status_codes']}")
    issues = (crawl.get("issues") or [])[:20]
    if issues:
        lines.append("Top issues (name | priority | urls_affected):")
        for it in issues:
            lines.append(f"  - {it.get('name')} | {it.get('priority')} | {it.get('urls_affected')}")
    return "\n".join(lines)


async def _build_semrush_competitors_block(domain: str, db=None, client_id: str | None = None) -> str | None:
    # Prefer uploaded CSV when present (saves API quota)
    if db is not None and client_id:
        try:
            up = await semrush_csv.get_upload(db, client_id, "competitors")
        except Exception:
            up = None
        if up and up.get("items"):
            lines = [f"Semrush top organic competitors (from uploaded CSV · {up.get('filename')}):"]
            for c in up["items"][:10]:
                lines.append(
                    f"  - {c.get('domain')} | rel={c.get('competitor_relevance')} | common_kw={c.get('common_keywords')} | organic_traffic={c.get('organic_traffic')}"
                )
            return "\n".join(lines)
    if not semrush.is_configured() or not domain:
        return None
    try:
        comps = await semrush.domain_competitors(domain, "us", limit=10)
    except Exception:
        return None
    if not comps:
        return None
    lines = ["Semrush top organic competitors (Domain | Relevance | Common Keywords | Organic Traffic):"]
    for c in comps[:10]:
        lines.append(f"  - {c.get('Domain')} | {c.get('Competitor Relevance')} | {c.get('Common Keywords')} | {c.get('Organic Traffic')}")
    return "\n".join(lines)


async def _build_semrush_keywords_block(domain: str, db=None, client_id: str | None = None) -> str | None:
    """Prefer uploaded Organic Positions CSV; fall back to Semrush API."""
    if db is not None and client_id:
        try:
            up = await semrush_csv.get_upload(db, client_id, "organic_positions")
        except Exception:
            up = None
        if up and up.get("items"):
            top = up["items"][:30]
            lines = [f"Semrush organic keywords (from uploaded CSV · {up.get('filename')}):"]
            for k in top:
                lines.append(
                    f"  - {k.get('keyword')} | pos={k.get('position')} | vol={k.get('search_volume')} | traffic={k.get('traffic')} | url={k.get('url')}"
                )
            return "\n".join(lines)
    if not semrush.is_configured() or not domain:
        return None
    try:
        sem_kws = await semrush.domain_organic_keywords(domain, "us", limit=25)
    except Exception:
        return None
    if not sem_kws:
        return None
    block = ["Semrush organic keywords (top 25 — Keyword | Position | Search Volume | CPC | URL):"]
    for k in sem_kws[:25]:
        block.append(f"  - {k.get('Keyword')} | {k.get('Position')} | {k.get('Search Volume')} | {k.get('CPC')} | {k.get('Url')}")
    return "\n".join(block)


async def _build_semrush_gap_block(db, client_id: str) -> str | None:
    """Pull uploaded Keyword Gap CSV if any."""
    try:
        up = await semrush_csv.get_upload(db, client_id, "keyword_gap")
    except Exception:
        return None
    if not up or not up.get("items"):
        return None
    top = up["items"][:25]
    lines = [f"Semrush keyword gap (from uploaded CSV · {up.get('filename')}):"]
    for k in top:
        lines.append(
            f"  - {k.get('keyword')} | vol={k.get('search_volume')} | cpc={k.get('cpc')} | competitor={k.get('competitor_url')} (pos {k.get('competitor_position')})"
        )
    return "\n".join(lines)


async def _build_semrush_backlinks_block(db, client_id: str) -> str | None:
    try:
        up = await semrush_csv.get_upload(db, client_id, "backlinks")
    except Exception:
        return None
    if not up or not up.get("summary"):
        return None
    s = up["summary"]
    top = (up.get("items") or [])[:8]
    lines = [
        f"Semrush backlinks profile (uploaded CSV · {up.get('filename')}):",
        f"  total={s.get('total_backlinks')} unique_domains≈{s.get('unique_referring_domains_approx')} follow={s.get('follow_links')} nofollow={s.get('nofollow_links')}",
    ]
    if top:
        lines.append("Top referring pages (page_score | source | target | anchor):")
        for b in top:
            lines.append(
                f"  - {b.get('page_score')} | {b.get('source_url')} | {b.get('target_url')} | {b.get('anchor')}"
            )
    return "\n".join(lines)


async def _build_semrush_overview_block(db, client_id: str) -> str | None:
    try:
        up = await semrush_csv.get_upload(db, client_id, "domain_overview")
    except Exception:
        return None
    if not up or not up.get("summary"):
        return None
    s = up["summary"]
    return (
        f"Semrush Domain Overview (uploaded CSV · {up.get('filename')}): "
        f"domain={s.get('domain')} db={s.get('database')} "
        f"organic_keywords={s.get('organic_keywords')} organic_traffic={s.get('organic_traffic')}"
    )


async def _build_dfs_gaps_block(client: Dict[str, Any]) -> str | None:
    if not dataforseo.is_configured() or not client.get("domain") or not client.get("competitors"):
        return None
    blocks = []
    for comp in (client.get("competitors") or [])[:3]:
        comp_domain = comp.get("domain")
        if not comp_domain:
            continue
        try:
            gaps = await dataforseo.domain_intersection_gaps(comp_domain, client["domain"], limit=10)
        except Exception:
            continue
        if not gaps:
            continue
        lines = [f"Keyword gaps · {comp_domain} ranks, {client['domain']} does not:"]
        for g in gaps[:10]:
            lines.append(f"  - {g.get('keyword')} | vol={g.get('search_volume')} | cpc={g.get('cpc')}")
        blocks.append("\n".join(lines))
    return "\n\n".join(blocks) if blocks else None


def _client_known_keywords(client: Dict[str, Any]) -> set[str]:
    """Collect every keyword the client is already known to target/rank for —
    pulled from the keyword_map plus any cached Semrush positions upload."""
    kws: set[str] = set()
    for k in ((client.get("keyword_map") or {}).get("keywords") or {}).keys():
        if k:
            kws.add(k.lower().strip())
    sem = (client.get("semrush_uploads") or {}).get("organic_positions") or {}
    for item in (sem.get("items") or []):
        kw = (item.get("keyword") or "").lower().strip()
        if kw:
            kws.add(kw)
    return kws


def _build_competitor_enrichment_block(client: Dict[str, Any]) -> tuple[str | None, set[str]]:
    """Build a single grounding block from the *cached* per-competitor enrichment
    (metrics, ranked_keywords, semrush_uploads, sf_crawl). Also returns the set
    of competitor IDs that had ranked-keyword cache (so we can skip live API
    calls for them).

    Pure cache — zero API cost."""
    competitors = client.get("competitors") or []
    if not competitors:
        return None, set()

    client_kws = _client_known_keywords(client)
    blocks: list[str] = []
    cached_kw_comp_ids: set[str] = set()

    # Top-line metrics comparison (one row per competitor that has metrics)
    metric_rows: list[str] = []
    client_metrics = client.get("metrics") or {}
    if client_metrics.get("refreshed_at"):
        metric_rows.append(
            f"  - {client['domain']} (YOU) | DR={_dr(client_metrics.get('domain_rating'))} | "
            f"backlinks={client_metrics.get('backlinks')} | ref_domains={client_metrics.get('referring_domains')} | "
            f"dofollow={client_metrics.get('referring_domains_dofollow')} | spam={client_metrics.get('spam_score')}"
        )
    for c in competitors:
        m = c.get("metrics") or {}
        if not m.get("refreshed_at"):
            continue
        metric_rows.append(
            f"  - {c.get('domain')} | DR={_dr(m.get('domain_rating'))} | "
            f"backlinks={m.get('backlinks')} | ref_domains={m.get('referring_domains')} | "
            f"dofollow={m.get('referring_domains_dofollow')} | spam={m.get('spam_score')}"
        )
    if metric_rows:
        blocks.append("Domain authority comparison (cached DataForSEO bulk backlinks):\n" + "\n".join(metric_rows))

    # Per-competitor ranked keywords + local gap calc + SF + Semrush
    for c in competitors[:5]:
        comp_lines: list[str] = []
        cd = c.get("domain", "?")

        # Ranked keywords (cached)
        ranked = c.get("ranked_keywords") or {}
        items = ranked.get("items") or []
        if items:
            cached_kw_comp_ids.add(c.get("id"))
            top = sorted(
                [k for k in items if k.get("search_volume") is not None],
                key=lambda k: (k.get("search_volume") or 0),
                reverse=True,
            )[:15]
            comp_lines.append(f"Top ranked keywords for {cd} (cached · pos | volume | url):")
            for k in top:
                u = (k.get("url") or "").replace("https://", "").replace("http://", "")
                comp_lines.append(f"  - {k.get('keyword')} | pos={k.get('position')} | vol={k.get('search_volume')} | {u[:80]}")

            # Local gap: competitor keywords the client does NOT have in their map
            if client_kws:
                gap = []
                for k in items:
                    kw = (k.get("keyword") or "").lower().strip()
                    if not kw or kw in client_kws:
                        continue
                    if (k.get("search_volume") or 0) < 50:
                        continue
                    gap.append(k)
                gap = sorted(gap, key=lambda k: (k.get("search_volume") or 0), reverse=True)[:12]
                if gap:
                    comp_lines.append(f"Cached keyword gaps · {cd} ranks, {client.get('domain')} doesn't (vol | pos):")
                    for k in gap:
                        comp_lines.append(f"  - {k.get('keyword')} | vol={k.get('search_volume')} | pos={k.get('position')}")

        # Semrush organic positions (per-competitor upload)
        sem = (c.get("semrush_uploads") or {}).get("organic_positions") or {}
        sem_items = sem.get("items") or []
        if sem_items and not items:
            top = sorted(sem_items, key=lambda k: (k.get("search_volume") or 0), reverse=True)[:10]
            comp_lines.append(f"Top Semrush positions for {cd} (uploaded CSV):")
            for k in top:
                comp_lines.append(f"  - {k.get('keyword')} | pos={k.get('position')} | vol={k.get('search_volume')}")

        # SF crawl summary
        sf = c.get("sf_crawl") or {}
        if sf.get("page_index") or sf.get("issues"):
            pi = sf.get("page_index") or []
            iss = sf.get("issues") or []
            isum = sf.get("issues_summary") or {}
            line = f"SF crawl of {cd}: {len(pi)} pages indexed, {len(iss)} issues"
            if isum.get("high_priority") is not None:
                line += f" ({isum.get('high_priority')} high priority)"
            comp_lines.append(line)

        if comp_lines:
            blocks.append("\n".join(comp_lines))

    if not blocks:
        return None, cached_kw_comp_ids
    return "\n\n".join(blocks), cached_kw_comp_ids


def _dr(scaled: Any) -> str:
    """DataForSEO domain_rating is 0-1000; render as 0-100."""
    if scaled is None:
        return "?"
    try:
        return str(round(float(scaled) / 10, 1))
    except (TypeError, ValueError):
        return str(scaled)


async def _latest_run_results(db, client_id: str, rtype: str) -> Dict[str, Any] | None:
    doc = await db.runs.find_one(
        {"client_id": client_id, "type": rtype, "status": "completed"},
        {"_id": 0, "results": 1},
        sort=[("completed_at", -1)],
    )
    return (doc or {}).get("results")


async def _create_approvals_for_run(db, run: Dict[str, Any]) -> None:
    """Translate workflow results into Approval items."""
    rtype = run["type"]
    client_id = run["client_id"]
    client_name = run.get("client_name", "")
    run_id = run["id"]
    results = run.get("results", {}) or {}

    approvals: list[Approval] = []

    if rtype == "keyword_research":
        for brief in (results.get("draft_briefs") or [])[:5]:
            approvals.append(Approval(
                run_id=run_id, client_id=client_id, client_name=client_name,
                kind="content_brief",
                title=brief.get("title", "Untitled brief"),
                summary=f"Primary keyword: {brief.get('primary_keyword', '-')}",
                content=brief,
            ))
    elif rtype == "technical_audit":
        for issue in (results.get("issues") or [])[:8]:
            approvals.append(Approval(
                run_id=run_id, client_id=client_id, client_name=client_name,
                kind="technical_action",
                title=issue.get("title", "Technical action"),
                summary=f"{issue.get('priority', 'P2')} · impact {issue.get('impact', '-')}/5 · effort {issue.get('effort', '-')}/5",
                content=issue,
            ))
        for opt in (results.get("page_optimizations") or [])[:10]:
            url = opt.get("url") or ""
            short_url = url.replace("https://", "").replace("http://", "")[:50]
            approvals.append(Approval(
                run_id=run_id, client_id=client_id, client_name=client_name,
                kind="page_optimization",
                title=f"Optimize: {short_url}",
                summary=f"Target: {opt.get('target_keyword') or '—'} · title {opt.get('title_char_count', 0)}/60ch · meta {opt.get('meta_char_count', 0)}/155ch",
                content=opt,
            ))
    elif rtype == "competitor_analysis":
        for opp in (results.get("opportunities") or [])[:5]:
            approvals.append(Approval(
                run_id=run_id, client_id=client_id, client_name=client_name,
                kind="competitor_insight",
                title=str(opp)[:120],
                summary="Competitor-driven opportunity",
                content={"opportunity": opp, "summary": results.get("summary", "")},
            ))
    elif rtype == "strategy_sprint":
        approvals.append(Approval(
            run_id=run_id, client_id=client_id, client_name=client_name,
            kind="strategy_doc",
            title="Monthly SEO Strategy",
            summary=(results.get("executive_summary") or "")[:200],
            content=results,
        ))

    if approvals:
        await db.approvals.insert_many([a.model_dump() for a in approvals])


async def run_workflow(db: AsyncIOMotorDatabase, run_id: str) -> None:
    """Execute the workflow run identified by run_id."""
    run = await db.runs.find_one({"id": run_id}, {"_id": 0})
    if not run:
        return

    client = await db.clients.find_one({"id": run["client_id"]}, {"_id": 0})
    if not client:
        await _set_run(db, run_id, status="failed", error="Client not found", completed_at=now_iso())
        return

    rtype = run["type"]
    objective = run.get("objective", "")

    try:
        await _set_run(db, run_id, status="running", started_at=now_iso(), client_name=client.get("name", ""))
        await _log(db, run_id, "coordinator", f"Starting {rtype} for {client.get('name')}", "info")

        # 1. Coordinator plans subtasks
        subtasks = await agents.coordinator_plan(run_id, rtype, client, objective)
        await _set_run(db, run_id, plan=subtasks)
        await _log(db, run_id, "coordinator", f"Plan ready · {len(subtasks)} subtasks", "success")
        for i, s in enumerate(subtasks, 1):
            await _log(db, run_id, "coordinator", f"Subtask {i}: {s}", "info")

        # 2. Specialist agent
        agent_key = AGENT_FOR_TYPE.get(rtype, "strategy")
        await _log(db, run_id, agent_key, f"{agents.AGENT_LABELS[agent_key]} engaged", "info")

        if rtype == "keyword_research":
            gsc_context = None
            try:
                cache = await gsc.get_performance_cache(db, client["id"])
                if cache and (cache.get("by_query") or cache.get("by_page")):
                    top_queries = (cache.get("by_query") or [])[:40]
                    top_pages = (cache.get("by_page") or [])[:15]
                    lines = [f"Site: {cache.get('site_url')} · range: {cache.get('start_date')} to {cache.get('end_date')}"]
                    lines.append("Top queries (query | clicks | impressions | ctr% | position):")
                    for q in top_queries:
                        lines.append(f"  - {q['key']} | {q['clicks']} | {q['impressions']} | {q['ctr']} | {q['position']}")
                    lines.append("Top pages (page | clicks | impressions | ctr% | position):")
                    for p in top_pages:
                        lines.append(f"  - {p['key']} | {p['clicks']} | {p['impressions']} | {p['ctr']} | {p['position']}")
                    gsc_context = "\n".join(lines)
                    await _log(db, run_id, "keyword", f"Grounded with GSC data · {len(top_queries)} queries, {len(top_pages)} pages", "info")
            except Exception as e:
                await _log(db, run_id, "keyword", f"GSC context unavailable: {e}", "warning")

            # Semrush organic keywords for the client domain (CSV upload preferred)
            try:
                sem_block = await _build_semrush_keywords_block(client.get("domain", ""), db, client["id"])
                if sem_block:
                    gsc_context = (gsc_context or "") + "\n\n" + sem_block
                    source = "uploaded CSV" if "uploaded CSV" in sem_block else "API"
                    await _log(db, run_id, "keyword", f"Grounded with Semrush organic positions ({source})", "info")
            except Exception as e:
                await _log(db, run_id, "keyword", f"Semrush unavailable: {e}", "warning")

            # Optional uploaded keyword gap CSV is also useful here
            try:
                gap_block = await _build_semrush_gap_block(db, client["id"])
                if gap_block:
                    gsc_context = (gsc_context or "") + "\n\n" + gap_block
                    await _log(db, run_id, "keyword", "Grounded with Semrush keyword gap (uploaded CSV)", "info")
            except Exception:
                pass

            results = await agents.keyword_research(run_id, client, objective, gsc_context=gsc_context)

            # Enrich draft brief keywords with DataForSEO difficulty
            try:
                if dataforseo.is_configured():
                    seeds = []
                    for cluster in (results.get("clusters") or [])[:6]:
                        for kw in (cluster.get("keywords") or [])[:3]:
                            seeds.append(kw.get("keyword"))
                    seeds = list(dict.fromkeys([s for s in seeds if s]))[:50]
                    if seeds:
                        diffs = await dataforseo.bulk_keyword_difficulty(seeds)
                        diff_map = {d["keyword"]: d.get("difficulty") for d in diffs if d.get("keyword")}
                        for cluster in results.get("clusters") or []:
                            for kw in cluster.get("keywords") or []:
                                d = diff_map.get(kw.get("keyword"))
                                if d is not None:
                                    kw["difficulty_score"] = d
                        results["dfs_difficulty_scored"] = len([k for k in seeds if diff_map.get(k) is not None])
                        await _log(db, run_id, "keyword", f"Enriched {len(diff_map)} keywords with DataForSEO difficulty", "success")
            except Exception as e:
                await _log(db, run_id, "keyword", f"DataForSEO enrichment failed: {e}", "warning")

        elif rtype == "technical_audit":
            sf_block = None
            ga_block = None
            gsc_block_for_audit = None
            try:
                crawl = await screamingfrog.get_crawl(db, client["id"])
                sf_block = _build_sf_block(crawl)
                if sf_block:
                    await _log(db, run_id, "audit", f"Grounded with Screaming Frog · {(crawl or {}).get('rows', 0)} rows", "info")
            except Exception as e:
                await _log(db, run_id, "audit", f"SF crawl unavailable: {e}", "warning")
            try:
                ga_block = await _build_ga_block(db, client["id"])
                if ga_block:
                    await _log(db, run_id, "audit", "Grounded with GA4 traffic data", "info")
            except Exception as e:
                await _log(db, run_id, "audit", f"GA4 unavailable: {e}", "warning")
            try:
                gsc_block_for_audit = await _build_gsc_block(db, client["id"])
                if gsc_block_for_audit:
                    await _log(db, run_id, "audit", "Grounded with GSC performance data", "info")
            except Exception:
                pass
            results = await agents.technical_audit(run_id, client, objective,
                                                   sf_context=sf_block, ga_context=ga_block, gsc_context=gsc_block_for_audit)

            # Auto-generate concrete page-level optimizations for top pages
            try:
                pages_to_optimize = []
                gsc_cache = await gsc.get_performance_cache(db, client["id"])
                if gsc_cache and gsc_cache.get("by_page"):
                    # Top 8 pages by impressions
                    top = sorted(gsc_cache["by_page"], key=lambda x: x.get("impressions") or 0, reverse=True)[:8]
                    # Build query-by-page map (use overall top queries as proxy when per-page not available)
                    top_queries_overall = [q.get("key") for q in (gsc_cache.get("by_query") or [])[:15] if q.get("key")]
                    urls = [p.get("key") for p in top if p.get("key")]
                    # Look up real current title/meta/H1 from the SF page index when present
                    sf_by_url = await screamingfrog.get_pages_by_url(db, client["id"], urls)
                    sf_hits = 0
                    for p in top:
                        url = p.get("key")
                        sf = sf_by_url.get(url) or {}
                        if sf:
                            sf_hits += 1
                        pages_to_optimize.append({
                            "url": url,
                            "current_title": sf.get("title") or "",
                            "current_meta": sf.get("meta_description") or "",
                            "current_h1": sf.get("h1") or "",
                            "gsc_queries": top_queries_overall[:6],  # global signal
                            "clicks": p.get("clicks"),
                            "impressions": p.get("impressions"),
                        })
                    if sf_hits:
                        await _log(db, run_id, "onpage", f"Loaded current title/meta/H1 from Screaming Frog for {sf_hits}/{len(top)} pages", "info")

                if pages_to_optimize:
                    await _log(db, run_id, "onpage", f"On-Page Optimizer engaged · rewriting {len(pages_to_optimize)} top pages", "info")
                    optimizations = await agents.optimize_pages(run_id, client, pages_to_optimize)
                    if optimizations:
                        results["page_optimizations"] = optimizations
                        await _log(db, run_id, "onpage", f"Produced {len(optimizations)} page rewrites", "success")
                else:
                    await _log(db, run_id, "onpage", "No GSC pages available — skipping on-page rewrites (connect GSC to enable)", "warning")
            except Exception as e:
                await _log(db, run_id, "onpage", f"On-page optimization failed: {e}", "warning")

        elif rtype == "competitor_analysis":
            comp_context = None
            cached_kw_comp_ids: set[str] = set()

            # 1) Cached per-competitor enrichment (metrics, ranked_keywords, semrush, sf)
            try:
                eb, cached_kw_comp_ids = _build_competitor_enrichment_block(client)
                if eb:
                    comp_context = eb
                    await _log(db, run_id, "competitor", f"Grounded with cached enrichment ({len(cached_kw_comp_ids)} competitor(s) have ranked-keyword cache)", "success")
            except Exception as e:
                await _log(db, run_id, "competitor", f"Cached enrichment unavailable: {e}", "warning")

            try:
                cb = await _build_semrush_competitors_block(client.get("domain", ""), db, client["id"])
                if cb:
                    comp_context = (comp_context + "\n\n" + cb) if comp_context else cb
                    src = "uploaded CSV" if "uploaded CSV" in cb else "API"
                    await _log(db, run_id, "competitor", f"Grounded with Semrush competitors ({src})", "info")
            except Exception as e:
                await _log(db, run_id, "competitor", f"Semrush unavailable: {e}", "warning")

            # Uploaded keyword gap CSV (no API cost)
            try:
                gap_block = await _build_semrush_gap_block(db, client["id"])
                if gap_block:
                    comp_context = (comp_context or "") + "\n\n" + gap_block
                    await _log(db, run_id, "competitor", "Grounded with Semrush keyword gap (uploaded CSV)", "success")
            except Exception:
                pass

            # DataForSEO keyword gaps — ONLY for competitors WITHOUT cached ranked_keywords
            try:
                if dataforseo.is_configured() and client.get("domain") and client.get("competitors"):
                    gap_blocks = []
                    skipped = 0
                    for comp in (client.get("competitors") or [])[:3]:
                        comp_domain = comp.get("domain")
                        if not comp_domain:
                            continue
                        if comp.get("id") in cached_kw_comp_ids:
                            skipped += 1
                            continue
                        gaps = await dataforseo.domain_intersection_gaps(
                            stronger_domain=comp_domain,
                            weaker_domain=client["domain"],
                            limit=15,
                        )
                        if gaps:
                            lines = [f"Keyword gaps · {comp_domain} ranks, {client['domain']} does not (Keyword | Search Volume | CPC):"]
                            for g in gaps[:15]:
                                lines.append(f"  - {g.get('keyword')} | {g.get('search_volume')} | {g.get('cpc')}")
                            gap_blocks.append("\n".join(lines))
                    if gap_blocks:
                        comp_context = (comp_context or "") + "\n\n" + "\n\n".join(gap_blocks)
                        await _log(db, run_id, "competitor", f"Grounded with DataForSEO keyword gaps · {len(gap_blocks)} live, {skipped} from cache", "success")
                    elif skipped:
                        await _log(db, run_id, "competitor", f"Skipped {skipped} live DataForSEO calls (cached ranked-keywords available)", "info")
            except Exception as e:
                await _log(db, run_id, "competitor", f"DataForSEO gap data unavailable: {e}", "warning")

            results = await agents.competitor_analysis(run_id, client, objective, seo_context=comp_context)
        elif rtype == "strategy_sprint":
            # Build comprehensive context from every signal we have
            blocks = []
            try:
                b = await _build_gsc_block(db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_ga_block(db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_semrush_competitors_block(client.get("domain", ""), db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_semrush_keywords_block(client.get("domain", ""), db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_semrush_gap_block(db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_semrush_backlinks_block(db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_semrush_overview_block(db, client["id"])
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                b = await _build_dfs_gaps_block(client)
                if b:
                    blocks.append(b)
            except Exception:
                pass
            try:
                eb, _ = _build_competitor_enrichment_block(client)
                if eb:
                    blocks.append(eb)
            except Exception:
                pass
            try:
                crawl = await screamingfrog.get_crawl(db, client["id"])
                b = _build_sf_block(crawl)
                if b:
                    blocks.append(b)
            except Exception:
                pass

            # Latest completed runs (keyword + competitor + audit)
            prior_combined: Dict[str, Any] = {}
            for prev_type in ("keyword_research", "competitor_analysis", "technical_audit"):
                prev = await _latest_run_results(db, client["id"], prev_type)
                if prev:
                    prior_combined[prev_type] = prev

            seo_context = "\n\n".join(blocks) if blocks else None
            if blocks:
                await _log(db, run_id, "strategy", f"Grounded with {len(blocks)} live data block(s)", "info")
            if prior_combined:
                await _log(db, run_id, "strategy", f"Including prior findings from {len(prior_combined)} run(s)", "info")
            results = await agents.strategy_synthesis(run_id, client, objective, prior=prior_combined or None, seo_context=seo_context)
        else:
            results = {}

        await _set_run(db, run_id, results=results)
        await _log(db, run_id, agent_key, f"{agents.AGENT_LABELS[agent_key]} produced results", "success")

        # 3. Coordinator wraps up + creates approvals
        await _log(db, run_id, "coordinator", "Compiling approvals queue", "info")
        run_doc = await db.runs.find_one({"id": run_id}, {"_id": 0})
        await _create_approvals_for_run(db, run_doc)

        await _set_run(db, run_id, status="completed", completed_at=now_iso())
        await _log(db, run_id, "coordinator", "Run complete · awaiting your approval", "success")

    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        await _log(db, run_id, "coordinator", f"Run failed: {e}", "error")
        await _set_run(db, run_id, status="failed", error=str(e), completed_at=now_iso())
        print("[workflow error]", tb)


def launch_workflow_task(db: AsyncIOMotorDatabase, run_id: str) -> None:
    """Schedule workflow on the running event loop."""
    asyncio.create_task(run_workflow(db, run_id))
