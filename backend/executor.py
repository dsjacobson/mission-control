"""Task executor: runs the appropriate specialist agent to PRODUCE the actual
work product for an approved task, and persists it as the task's `artifact`.

Dispatch logic by approval.kind:
  - technical_action: OnPage Optimizer agent runs against the client's top GSC
    pages with the issue text as focus, producing concrete title/meta/H1/schema.
  - page_optimization: re-runs the OnPage agent for the single page in question
    to refresh the rewrite.
  - content_brief: Publisher Assistant expands the brief into a draft outline.
  - strategy_doc: Strategy agent re-synthesizes with latest data.
  - competitor_insight: no-op (already a finished output).
"""
from __future__ import annotations

import asyncio
import traceback
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from motor.motor_asyncio import AsyncIOMotorDatabase

import agents
import gsc


async def _set(db, approval_id: str, **fields) -> None:
    await db.approvals.update_one({"id": approval_id}, {"$set": fields})


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


async def _top_gsc_pages(db, client_id: str, limit: int = 8) -> List[Dict[str, Any]]:
    cache = await gsc.get_performance_cache(db, client_id)
    if not cache or not cache.get("by_page"):
        return []
    rows = sorted(cache["by_page"], key=lambda r: r.get("impressions") or 0, reverse=True)[:limit]
    top_queries = [q.get("key") for q in (cache.get("by_query") or [])[:10] if q.get("key")]
    return [{
        "url": r.get("key"),
        "gsc_queries": top_queries[:6],
        "clicks": r.get("clicks"),
        "impressions": r.get("impressions"),
    } for r in rows]


async def _execute_technical_action(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """For a technical_action approval, generate concrete on-page fixes for top pages."""
    content = approval.get("content") or {}
    issue_title = content.get("title") or approval.get("title") or ""
    issue_desc = content.get("description") or ""
    recommended = content.get("recommended_fix") or ""
    issue_context = f"{issue_title}\n{issue_desc}\nDesired fix: {recommended}".strip()

    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")

    pages = await _top_gsc_pages(db, approval["client_id"], limit=8)
    if not pages:
        return {
            "kind": "no_pages",
            "message": "No GSC page data available for this client. Connect Google Search Console and refresh to enable agent execution.",
        }

    optimizations = await agents.optimize_pages(
        approval["id"], client, pages, issue_context=issue_context
    )
    return {
        "kind": "page_fixes",
        "issue": issue_title,
        "pages": optimizations,
        "generated_at": _now(),
    }


async def _execute_page_optimization(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """For a page_optimization approval, re-run the OnPage agent for just this URL."""
    content = approval.get("content") or {}
    url = content.get("url")
    if not url:
        raise RuntimeError("Approval missing URL")
    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")
    cache = await gsc.get_performance_cache(db, approval["client_id"])
    top_queries = [q.get("key") for q in ((cache or {}).get("by_query") or [])[:10] if q.get("key")]
    page = {
        "url": url,
        "current_title": content.get("current_title", "") or content.get("proposed_title", ""),
        "current_meta": content.get("current_meta", "") or content.get("proposed_meta", ""),
        "current_h1": content.get("current_h1", "") or content.get("proposed_h1", ""),
        "gsc_queries": top_queries,
        "clicks": content.get("gsc_clicks"),
        "impressions": content.get("gsc_impressions"),
    }
    optimizations = await agents.optimize_pages(approval["id"], client, [page])
    return {"kind": "page_fixes", "pages": optimizations, "generated_at": _now()}


async def _execute_content_brief(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    content = approval.get("content") or {}
    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    topic = content.get("title") or approval.get("title") or "untitled"
    draft = await agents.publisher_draft(approval["id"], client, topic)
    return {"kind": "publisher_draft", "draft": draft, "generated_at": _now()}


async def _execute_strategy_doc(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    content = approval.get("content") or {}
    objective = f"refresh strategy synthesis for: {approval.get('title', '')}"
    result = await agents.strategy_synthesis(
        approval["id"], client, objective, prior={"previous": content}
    )
    return {"kind": "strategy_refresh", "strategy": result, "generated_at": _now()}


KIND_EXECUTORS = {
    "technical_action": _execute_technical_action,
    "page_optimization": _execute_page_optimization,
    "content_brief": _execute_content_brief,
    "strategy_doc": _execute_strategy_doc,
}


def is_executable(kind: str) -> bool:
    return kind in KIND_EXECUTORS


async def execute_task(db: AsyncIOMotorDatabase, approval_id: str) -> None:
    """Run the right agent for an approval and persist the artifact."""
    approval = await db.approvals.find_one({"id": approval_id}, {"_id": 0})
    if not approval:
        return
    kind = approval.get("kind")
    handler = KIND_EXECUTORS.get(kind)
    if not handler:
        await _set(db, approval_id, artifact_status="error", artifact_error=f"No executor for kind '{kind}'")
        return
    try:
        await _set(db, approval_id, artifact_status="generating", artifact_error=None)
        artifact = await handler(db, approval)
        await _set(
            db,
            approval_id,
            artifact=artifact,
            artifact_status="ready",
            artifact_generated_at=_now(),
            artifact_error=None,
        )
    except Exception as e:  # noqa: BLE001
        tb = traceback.format_exc()
        print(f"[executor error] {tb}")
        await _set(db, approval_id, artifact_status="error", artifact_error=str(e))


def launch_execute(db, approval_id: str) -> None:
    asyncio.create_task(execute_task(db, approval_id))
