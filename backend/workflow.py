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
import semrush
import dataforseo


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

            # Semrush organic keywords for the client domain
            try:
                if semrush.is_configured() and client.get("domain"):
                    sem_kws = await semrush.domain_organic_keywords(client["domain"], "us", limit=25)
                    if sem_kws:
                        block = ["Semrush organic keywords (top 25 — Keyword | Position | Search Volume | CPC | URL):"]
                        for k in sem_kws[:25]:
                            block.append(f"  - {k.get('Keyword')} | {k.get('Position')} | {k.get('Search Volume')} | {k.get('CPC')} | {k.get('Url')}")
                        gsc_context = (gsc_context or "") + "\n\n" + "\n".join(block)
                        await _log(db, run_id, "keyword", f"Grounded with Semrush · {len(sem_kws)} ranked keywords", "info")
            except Exception as e:
                await _log(db, run_id, "keyword", f"Semrush unavailable: {e}", "warning")

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
            results = await agents.technical_audit(run_id, client, objective)
        elif rtype == "competitor_analysis":
            comp_context = None
            try:
                if semrush.is_configured() and client.get("domain"):
                    sem_comps = await semrush.domain_competitors(client["domain"], "us", limit=10)
                    if sem_comps:
                        block = ["Semrush top organic competitors (Domain | Competitor Relevance | Common Keywords | Organic Traffic):"]
                        for c in sem_comps[:10]:
                            block.append(f"  - {c.get('Domain')} | {c.get('Competitor Relevance')} | {c.get('Common Keywords')} | {c.get('Organic Traffic')}")
                        comp_context = "\n".join(block)
                        await _log(db, run_id, "competitor", f"Grounded with Semrush · {len(sem_comps)} competitors", "info")
            except Exception as e:
                await _log(db, run_id, "competitor", f"Semrush unavailable: {e}", "warning")

            # DataForSEO keyword gaps for each user-tracked competitor
            try:
                if dataforseo.is_configured() and client.get("domain") and client.get("competitors"):
                    gap_blocks = []
                    for comp in (client.get("competitors") or [])[:3]:
                        comp_domain = comp.get("domain")
                        if not comp_domain:
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
                        await _log(db, run_id, "competitor", f"Grounded with DataForSEO keyword gaps · {len(gap_blocks)} competitors", "success")
            except Exception as e:
                await _log(db, run_id, "competitor", f"DataForSEO gap data unavailable: {e}", "warning")

            results = await agents.competitor_analysis(run_id, client, objective, seo_context=comp_context)
        elif rtype == "strategy_sprint":
            results = await agents.strategy_synthesis(run_id, client, objective)
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
