"""Task executor: routes an approved task to the right specialist agent and
persists the produced work as the task's `artifact`.

Routing by approval.kind:
  - technical_action: bucket the issue (metadata / content / structural /
    performance / security) and dispatch to the right agent. Uses the real
    Screaming Frog page index + affected-URL list when present.
  - page_optimization: refresh the OnPage rewrite for one URL, grounded in
    SF current_title/meta/H1 if available.
  - content_brief: Publisher Assistant expands the brief.
  - strategy_doc: Strategy agent re-synthesizes.
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
import screamingfrog
import issue_router


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


async def _gsc_top_queries(db, client_id: str, limit: int = 10) -> List[str]:
    cache = await gsc.get_performance_cache(db, client_id)
    if not cache:
        return []
    return [q.get("key") for q in (cache.get("by_query") or [])[:limit] if q.get("key")]


async def _affected_urls(db, client_id: str, issue_title: str) -> List[str]:
    """Try to find URLs SF flagged for this specific issue. Returns [] if no
    crawl is available or no match."""
    urls = await screamingfrog.get_urls_for_issue(db, client_id, issue_title, limit=30)
    return urls


async def _resolve_pages_for_issue(
    db,
    client_id: str,
    issue_title: str,
    fallback_to_gsc: bool = True,
    limit: int = 8,
) -> List[Dict[str, Any]]:
    """Build a page list for an issue, preferring SF-affected URLs (with full
    page detail from internal_all) and falling back to GSC top pages."""
    urls = await _affected_urls(db, client_id, issue_title)
    pages: List[Dict[str, Any]] = []
    top_queries = await _gsc_top_queries(db, client_id)
    if urls:
        sf_by_url = await screamingfrog.get_pages_by_url(db, client_id, urls[:limit])
        for u in urls[:limit]:
            sf = sf_by_url.get(u) or {}
            pages.append({
                "url": u,
                "current_title": sf.get("title") or "",
                "current_meta": sf.get("meta_description") or "",
                "current_h1": sf.get("h1") or "",
                "current_h2": sf.get("h2") or "",
                "title_length": sf.get("title_length"),
                "meta_length": sf.get("meta_length"),
                "h1_length": sf.get("h1_length"),
                "word_count": sf.get("word_count"),
                "status_code": sf.get("status_code"),
                "indexability": sf.get("indexability"),
                "canonical": sf.get("canonical"),
                "inlinks": sf.get("inlinks"),
                "gsc_queries": top_queries[:6],
            })
    if not pages and fallback_to_gsc:
        gsc_pages = await _top_gsc_pages(db, client_id, limit=limit)
        urls = [p["url"] for p in gsc_pages]
        sf_by_url = await screamingfrog.get_pages_by_url(db, client_id, urls)
        for p in gsc_pages:
            sf = sf_by_url.get(p["url"]) or {}
            pages.append({
                "url": p["url"],
                "current_title": sf.get("title") or "",
                "current_meta": sf.get("meta_description") or "",
                "current_h1": sf.get("h1") or "",
                "current_h2": sf.get("h2") or "",
                "word_count": sf.get("word_count"),
                "gsc_queries": p.get("gsc_queries") or top_queries[:6],
                "clicks": p.get("clicks"),
                "impressions": p.get("impressions"),
            })
    return pages


# ---------- Bucket executors ----------

async def _exec_metadata(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """Metadata issues: rewrite title/meta/H1 with real current values."""
    content = approval.get("content") or {}
    issue_title = content.get("title") or approval.get("title") or ""
    issue_desc = content.get("description") or ""
    recommended = content.get("recommended_fix") or ""
    issue_context = f"{issue_title}\n{issue_desc}\nDesired fix: {recommended}".strip()

    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")

    pages = await _resolve_pages_for_issue(db, approval["client_id"], issue_title, limit=8)
    if not pages:
        return {
            "kind": "no_pages",
            "message": "No affected URLs from Screaming Frog and no GSC pages available. Run a crawl or connect GSC.",
        }

    optimizations = await agents.optimize_pages(
        approval["id"], client, pages, issue_context=issue_context
    )
    return {
        "kind": "page_fixes",
        "issue": issue_title,
        "bucket": "metadata",
        "pages": optimizations,
        "generated_at": _now(),
    }


async def _exec_content(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """Content issues: per-URL remediation directive (not metadata rewrite)."""
    content = approval.get("content") or {}
    issue_title = content.get("title") or approval.get("title") or ""

    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")

    pages = await _resolve_pages_for_issue(db, approval["client_id"], issue_title, limit=12)
    # Repackage page dicts for the content agent (it expects 'title','h1' not 'current_title')
    norm_pages = []
    for p in pages:
        norm_pages.append({
            "url": p.get("url"),
            "title": p.get("current_title"),
            "h1": p.get("current_h1"),
            "h2": p.get("current_h2"),
            "word_count": p.get("word_count"),
            "gsc_queries": p.get("gsc_queries") or [],
        })
    if not norm_pages:
        return {
            "kind": "no_pages",
            "message": "No affected URLs found for this content issue. Run a Screaming Frog crawl with bulk issue exports.",
        }

    result = await agents.content_remediation(approval["id"], client, content or {"title": issue_title}, norm_pages)
    return {
        "kind": "content_remediation",
        "issue": issue_title,
        "bucket": "content",
        "urls": result.get("urls") or [],
        "summary": result.get("summary") or "",
        "generated_at": _now(),
    }


async def _exec_structural(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """Structural issues: per-URL action plan (redirect / canonical / remove / etc.)."""
    content = approval.get("content") or {}
    issue_title = content.get("title") or approval.get("title") or ""

    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")

    pages = await _resolve_pages_for_issue(db, approval["client_id"], issue_title,
                                           fallback_to_gsc=False, limit=20)
    norm_pages = []
    for p in pages:
        norm_pages.append({
            "url": p.get("url"),
            "status_code": p.get("status_code"),
            "indexability": p.get("indexability"),
            "canonical": p.get("canonical"),
            "inlinks": p.get("inlinks"),
        })

    result = await agents.structural_fix(approval["id"], client, content or {"title": issue_title}, norm_pages)
    return {
        "kind": "structural_actions",
        "issue": issue_title,
        "bucket": "structural",
        "actions": result.get("actions") or [],
        "summary": result.get("summary") or "",
        "affected_url_count": len(norm_pages),
        "generated_at": _now(),
    }


async def _exec_implementation_brief(db, approval: Dict[str, Any], bucket: str) -> Dict[str, Any]:
    """Performance / security issues: implementation brief with snippet."""
    content = approval.get("content") or {}
    issue_title = content.get("title") or approval.get("title") or ""

    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")

    affected_count = 0
    urls = await _affected_urls(db, approval["client_id"], issue_title)
    affected_count = len(urls)

    brief = await agents.implementation_brief(
        approval["id"], client, content or {"title": issue_title}, affected_url_count=affected_count
    )
    return {
        "kind": "implementation_brief",
        "issue": issue_title,
        "bucket": bucket,
        "brief": brief,
        "affected_url_count": affected_count,
        "affected_urls_sample": urls[:10],
        "generated_at": _now(),
    }


async def _execute_technical_action(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """Categorize the issue and dispatch to the right bucket executor."""
    content = approval.get("content") or {}
    issue_title = content.get("title") or approval.get("title") or ""
    category = content.get("category") or ""
    bucket, _conf = issue_router.categorize_issue(issue_title, category)

    if bucket == "metadata":
        return await _exec_metadata(db, approval)
    if bucket == "content":
        return await _exec_content(db, approval)
    if bucket == "structural":
        return await _exec_structural(db, approval)
    if bucket in ("performance", "security"):
        return await _exec_implementation_brief(db, approval, bucket)

    # Default fallback — treat as metadata
    return await _exec_metadata(db, approval)


async def _execute_page_optimization(db, approval: Dict[str, Any]) -> Dict[str, Any]:
    """Refresh OnPage rewrite for the single URL on this approval."""
    content = approval.get("content") or {}
    url = content.get("url")
    if not url:
        raise RuntimeError("Approval missing URL")
    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    if not client:
        raise RuntimeError("Client not found")
    top_queries = await _gsc_top_queries(db, approval["client_id"])
    sf_page = await screamingfrog.get_page_for_url(db, approval["client_id"], url) or {}
    page = {
        "url": url,
        "current_title": sf_page.get("title") or content.get("current_title") or content.get("proposed_title") or "",
        "current_meta": sf_page.get("meta_description") or content.get("current_meta") or content.get("proposed_meta") or "",
        "current_h1": sf_page.get("h1") or content.get("current_h1") or content.get("proposed_h1") or "",
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


# ---------- Optional draft expansion (per-URL, on-demand) ----------

async def expand_content_draft(
    db: AsyncIOMotorDatabase,
    approval_id: str,
    url: str,
) -> Dict[str, Any]:
    """Take the existing content_remediation artifact, find the URL's directive,
    and ask the publisher agent to generate full draft copy. Appends to the
    artifact under `drafts[url]`. Returns the produced draft."""
    approval = await db.approvals.find_one({"id": approval_id}, {"_id": 0})
    if not approval:
        raise RuntimeError("Approval not found")
    artifact = approval.get("artifact") or {}
    if artifact.get("kind") != "content_remediation":
        raise RuntimeError("Approval has no content_remediation artifact")
    urls = artifact.get("urls") or []
    directive = next((u for u in urls if u.get("url") == url), None)
    if not directive:
        raise RuntimeError(f"URL '{url}' not in this artifact")

    client = await db.clients.find_one({"id": approval["client_id"]}, {"_id": 0})
    draft = await agents.content_draft_for_url(approval_id, client, directive)
    drafts = artifact.get("drafts") or {}
    drafts[url] = {
        "draft": draft,
        "generated_at": _now(),
    }
    artifact["drafts"] = drafts
    await db.approvals.update_one(
        {"id": approval_id},
        {"$set": {"artifact": artifact, "artifact_generated_at": _now()}},
    )
    return draft
