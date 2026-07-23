"""Agent manifest — machine-readable operator's guide for autonomous agents
(e.g. Claude Cowork / Claude Computer Use) that drive this SEO Operator API.

Returned by GET /api/agent/manifest. Cowork ingests this at the start of a
session to know what verbs it can call and what typical workflows look like.
"""
from __future__ import annotations

from typing import Any, Dict


def build_manifest(backend_base_url: str = "") -> Dict[str, Any]:
    """Return the operator manifest as a plain dict (JSON-serializable)."""
    return {
        "product": "SEO Operator · Autonomous SEO Agency Command Center",
        "version": "1.0",
        "backend_base_url": backend_base_url.rstrip("/"),
        "auth": {
            "type": "api_key",
            "header": "X-API-Key",
            "note": "Include this header on every /api/* request. Set via AGENT_API_KEY env var on the server.",
        },
        "primer": (
            "You are operating a solo SEO agency's command center. Each 'client' is one SEO "
            "client site. You run workflows (competitive analysis, keyword research, technical "
            "audits) via POST /api/runs, which kicks off async LLM agents. Every result lands "
            "in an 'approval queue' — you MUST approve items before they are considered "
            "actionable. Executable approvals (technical_action, page_optimization, "
            "content_brief) auto-execute their fixes when approved. Deliverable-style "
            "approvals (competitive_deliverable, strategy_doc, competitor_insight) are "
            "reference documents that go into the client's Deliverables backlog when approved. "
            "Always prefer the high-level workflow endpoints over composing low-level ones. "
            "TIP: call GET /api/agent/session-start once right after reading this manifest — "
            "it returns integrations health, per-client pending-approval counts, active runs, "
            "and last-run summaries in one shot, saving 3-4 exploratory calls."
        ),
        "resources": {
            "client": {
                "description": "One SEO client with domain, integrations, keyword_map, competitors[]",
                "id_type": "uuid",
                "endpoints": {
                    "list": "GET /api/clients",
                    "get": "GET /api/clients/{client_id}",
                    "create": "POST /api/clients",
                },
                "example": {
                    "id": "3ac4ea8b-...",
                    "name": "Bet Fine 24",
                    "domain": "betfine24.com",
                    "industry": "iGaming",
                    "goals": "Grow US organic traffic",
                    "target_markets": ["US"],
                    "competitors": [
                        {"id": "…", "name": "Bet365", "domain": "bet365.com", "metrics": {"authority_score": 46, "organic_traffic": 41250}}
                    ],
                },
            },
            "workflow_run": {
                "description": "Async LLM agent invocation. Status: queued → running → completed | failed. "
                               "A completed run may still have `approvals_pending > 0` — treat those as 'awaiting review'.",
                "endpoints": {
                    "create": "POST /api/runs",
                    "get": "GET /api/runs/{run_id}",
                    "list_for_client": "GET /api/runs?client_id={id}",
                },
                "types": [
                    "keyword_research",
                    "technical_audit",
                    "competitor_analysis",
                    "strategy_sprint",
                    "competitive_deliverable",
                ],
            },
            "approval": {
                "description": "Every workflow output is held in the approval queue. "
                               "status: pending | approved | rejected. progress: open | in_progress | done | archived. "
                               "Approving an executable kind auto-runs its remediation task.",
                "endpoints": {
                    "list": "GET /api/approvals?client_id={id}&status={pending|approved|rejected}",
                    "decide": "POST /api/approvals/{id}/decision  body: {status, note?, edited_content?}",
                    "bulk_decide": "POST /api/approvals/bulk-decision  body: {ids[], status, note?}",
                    "delete": "DELETE /api/approvals/{id}",
                    "bulk_delete": "POST /api/approvals/bulk-delete  body: {ids[]}",
                    "archive_decided": "POST /api/clients/{client_id}/approvals/archive-decided",
                    "export_docx": "GET /api/approvals/{id}/export/docx",
                    "export_xlsx": "GET /api/approvals/{id}/export/xlsx",
                },
                "kinds": {
                    "content_brief": "Reference — content brief for a writer.",
                    "technical_action": "Executable — auto-runs the fix (meta rewrites, etc.) on approval.",
                    "page_optimization": "Executable — auto-rewrites title/meta/H1 on approval.",
                    "strategy_doc": "Reference — monthly SEO strategy narrative.",
                    "competitor_insight": "Reference — single insight card.",
                    "competitive_deliverable": "Reference — full client-facing competitive analysis report.",
                    "wordpress_draft": "Reference — content draft for WP push.",
                },
            },
            "worker": {
                "description": "A person or agent who can be assigned tasks. type=agent for Claude Cowork, "
                               "type=human for the operator or hired help. Seeded row: id='claude-cowork'.",
                "endpoints": {
                    "list": "GET /api/workers?active=true",
                    "create": "POST /api/workers  body: {name, type: 'human'|'agent', email?}",
                    "update": "PATCH /api/workers/{worker_id}  body: {name?, type?, email?}",
                },
            },
            "task": {
                "description": "A work item with instructions, an assignee, and optionally a recurrence. "
                               "This is HOW work gets picked up — completing a task that produces mutating "
                               "output still requires the resulting change to go through the approval queue. "
                               "Tasks do NOT bypass approvals.",
                "endpoints": {
                    "list": "GET /api/tasks?client_id={id}&assignee_id={id}&status={open|in_progress|done|blocked}&due_before={iso}",
                    "get": "GET /api/tasks/{task_id}",
                    "create": "POST /api/tasks  body: {client_id, title, instructions, assignee_id?, recurrence?: 'none'|'daily'|'weekly', due_at?}",
                    "update": "PATCH /api/tasks/{task_id}  body: {status?, assignee_id?, title?, instructions?, recurrence?, due_at?, notes_append?}",
                    "complete": "POST /api/tasks/{task_id}/complete  body: {notes?} — for recurring tasks, advances due_at",
                    "delete": "DELETE /api/tasks/{task_id}",
                },
                "status_flow": "open → in_progress → done (or blocked). Recurring tasks stay open after complete.",
                "hint": "For a session-start snapshot of what's due today for a specific assignee, call "
                        "GET /api/tasks?assignee_id={id}&status=open&due_before={now}.",
            },
        },
        "workflows": {
            "monthly_competitive_analysis": {
                "description": "For every client: pull fresh Semrush metrics for the client + all competitors, "
                               "then generate a full competitive-analysis deliverable, then wait for the user to approve.",
                "steps": [
                    {"call": "GET /api/clients", "note": "Get client list."},
                    {"for_each": "client", "call": "POST /api/clients/{id}/competitive-analysis",
                     "note": "One-click endpoint: refreshes metrics + ranked keywords + kicks off the deliverable workflow. Returns {run_id}."},
                    {"for_each": "run", "poll": "GET /api/runs/{run_id}",
                     "until": "status in ['completed','failed']",
                     "note": "Poll every 5s. Typical completion ~90s."},
                    {"for_each": "completed run", "call": "GET /api/approvals?client_id={id}&status=pending",
                     "note": "Find the competitive_deliverable approval matching this run_id."},
                    {"optional": True, "call": "GET /api/approvals/{id}/export/docx",
                     "note": "Download for client hand-off (or /export/xlsx)."},
                ],
            },
            "onboard_new_client": {
                "description": "Set up a new client from scratch: create record, add competitors, connect integrations, run initial analysis.",
                "steps": [
                    {"call": "POST /api/clients", "body_example": {"name": "Acme", "domain": "acme.com", "industry": "SaaS", "goals": "…"}},
                    {"repeat": True, "call": "POST /api/clients/{id}/competitors",
                     "body_example": {"name": "Rival Inc", "domain": "rival.com"}},
                    {"call": "POST /api/clients/{id}/competitive-analysis",
                     "note": "Runs first pass. NOTE: OAuth-based integrations (GSC/GA) require a browser session and cannot be scripted headlessly."},
                ],
            },
            "process_approval_queue": {
                "description": "Review and approve outputs. Executable ones auto-run.",
                "steps": [
                    {"call": "GET /api/approvals?client_id={id}&status=pending"},
                    {"for_each": "approval",
                     "note": "Inspect .content. Approve if quality is good; otherwise reject with a note explaining why."},
                    {"call": "POST /api/approvals/{id}/decision  body: {status: 'approved'}",
                     "note": "Approved executable kinds (technical_action, page_optimization) will auto-execute; poll .artifact_status on the approval until 'ready'."},
                ],
            },
            "generate_client_report_pack": {
                "description": "For a client, download all approved deliverables of the current month as .docx + .xlsx.",
                "steps": [
                    {"call": "GET /api/approvals?client_id={id}&status=approved"},
                    {"for_each": "approval",
                     "call": "GET /api/approvals/{id}/export/docx"},
                    {"for_each": "approval",
                     "call": "GET /api/approvals/{id}/export/xlsx"},
                ],
            },
        },
        "conventions": {
            "id_type": "All resource ids are UUID v4 strings.",
            "timestamps": "ISO 8601 with timezone, e.g. '2026-02-15T10:00:00+00:00'.",
            "pagination": "None; endpoints return whole lists (list sizes are small — dozens per client).",
            "errors": "FastAPI standard: {detail: string}. 4xx are recoverable, 5xx are server bugs — report them.",
            "concurrency": "It's safe to run multiple competitive analyses in parallel across clients. Do NOT trigger two runs of the same type for the same client concurrently — you'll double-charge Semrush.",
        },
        "browser_required_flows": [
            "Google OAuth for Search Console / Analytics: requires interactive consent screen.",
            "Screaming Frog local bridge setup: requires the user to run a script on their Windows machine.",
            "Semrush MCP first-time key entry: interactive.",
        ],
        "safety": {
            "human_in_the_loop": "This system is approval-first by design. You may generate, but you may not approve executable actions (technical_action, page_optimization) without either (a) explicit user permission for this session or (b) a clear rule the user gave you (e.g. 'auto-approve meta-rewrites with impact <=3'). When in doubt, leave items pending and summarize what you produced.",
            "budget_awareness": "Semrush API calls cost real money. Do not loop refresh-all more than daily per client. DataForSEO Labs costs ~$0.04 per ranked_keywords call.",
        },
        "openapi_spec": "GET /openapi.json  (full OpenAPI 3 schema — use this for exact param/response shapes)",
        "interactive_docs": "GET /docs  (Swagger UI) · GET /redoc  (ReDoc)",
        "session_start": {
            "endpoint": "GET /api/agent/session-start",
            "description": "One-shot orientation call: integrations health, per-client pending-approval counts, active runs, and last-run summaries. Call once right after reading this manifest to skip 3-4 exploratory API calls.",
        },
    }



# ============================================================================
# MCP-format manifest — a flat list of tools with JSON Schema + x_endpoint
# metadata, mirroring the shape the SEO Toolkit publishes. Consumed by
# `mission-control-mcp` so adding a tool here immediately makes it visible in
# Claude Desktop after a connector restart, with zero connector code changes.
# ============================================================================
#
# Shape (per tool):
#   {
#     "name": "list_clients",
#     "description": "...",
#     "inputSchema": { "type": "object", "properties": {...}, "required": [] },
#     "x_endpoint": { "method": "GET", "path": "/api/clients" },
#     "x_cost": "free"   # or "billed"
#   }
#
# Path params use `{name}` syntax. The connector's dispatcher substitutes them
# from the tool args, then sends any remaining args as query string (GET) or
# JSON body (POST/PATCH/PUT). `x_cost: "billed"` prefixes the description with
# "[BILLED — get approval]" for the Claude Desktop permission UI.


def _tool(
    name: str,
    description: str,
    method: str,
    path: str,
    properties: Dict[str, Any] | None = None,
    required: list[str] | None = None,
    cost: str = "free",
) -> Dict[str, Any]:
    """Build a single MCP tool spec. Keeps the manifest below terse and readable."""
    desc = ("[BILLED — get approval] " + description) if cost == "billed" else description
    return {
        "name": name,
        "description": desc,
        "inputSchema": {
            "type": "object",
            "properties": properties or {},
            "required": required or [],
        },
        "x_endpoint": {"method": method.upper(), "path": path},
        "x_cost": cost,
    }


# ---- Reusable schema fragments -----------------------------------------------
_S_STR = {"type": "string"}
_S_STR_OPT = {"type": "string", "description": "Optional."}
_S_BOOL_OPT = {"type": "boolean", "description": "Optional."}


def build_mcp_manifest() -> Dict[str, Any]:
    """List every REST endpoint the mission-control-mcp connector should expose
    as an MCP tool. Order here is the order Claude sees them."""
    tools = [
        # --- Orientation --------------------------------------------------
        _tool(
            "session_start",
            "One-shot orientation snapshot: integrations health, per-client workload (pending approvals, active runs, last run), and 10 most recent runs across all clients. Call once at session start to skip several exploratory list_* calls. Safe to Always allow.",
            "GET", "/api/agent/session-start",
        ),

        # --- Clients (read) ----------------------------------------------
        _tool(
            "list_clients",
            "List every client workspace in Mission Control. Read-only.",
            "GET", "/api/clients",
        ),
        _tool(
            "get_client",
            "Get one client, including its competitors and current keyword map. Read-only.",
            "GET", "/api/clients/{client_id}",
            properties={"client_id": {**_S_STR, "description": "Client UUID."}},
            required=["client_id"],
        ),

        # --- Workflow runs (read) ----------------------------------------
        _tool(
            "list_runs",
            "List workflow runs, optionally filtered by client. A completed run can still have approvals_pending > 0 — treat those as awaiting review, not done.",
            "GET", "/api/runs",
            properties={"client_id": _S_STR_OPT},
        ),
        _tool(
            "get_run",
            "Get the status and result of a single workflow run.",
            "GET", "/api/runs/{run_id}",
            properties={"run_id": _S_STR},
            required=["run_id"],
        ),

        # --- Approvals (read) --------------------------------------------
        _tool(
            "list_approvals",
            "List items in the approval queue. Defaults to pending. 'technical_action' and 'page_optimization' are executable kinds — approving them auto-runs the fix. Everything else is a reference document.",
            "GET", "/api/approvals",
            properties={
                "client_id": _S_STR_OPT,
                "status": {"type": "string", "enum": ["pending", "approved", "rejected"], "description": "Default 'pending'."},
            },
        ),

        # --- Clients (write) ---------------------------------------------
        _tool(
            "create_client",
            "Add a new client workspace to Mission Control.",
            "POST", "/api/clients",
            properties={
                "name": _S_STR,
                "domain": _S_STR,
                "industry": _S_STR_OPT,
                "goals": _S_STR_OPT,
                "target_markets": {"type": "array", "items": {"type": "string"}, "description": "Optional."},
            },
            required=["name", "domain"],
        ),
        _tool(
            "add_competitor",
            "Add a competitor to a client's competitor list.",
            "POST", "/api/clients/{client_id}/competitors",
            properties={
                "client_id": _S_STR,
                "name": _S_STR,
                "domain": _S_STR,
            },
            required=["client_id", "name", "domain"],
        ),

        # --- Workflows (write) -------------------------------------------
        _tool(
            "run_competitive_analysis",
            "The recommended one-click path for competitive analysis: refreshes Semrush metrics for the client and its competitors, then produces a competitive_deliverable approval. Prefer this over launch_workflow for competitor_analysis. Semrush calls cost real money — do not run this more than once a day per client.",
            "POST", "/api/clients/{client_id}/competitive-analysis",
            properties={"client_id": _S_STR},
            required=["client_id"],
            cost="billed",
        ),
        _tool(
            "launch_workflow",
            "Launch a workflow run for a client: keyword_research, technical_audit, strategy_sprint, or competitive_deliverable. For competitor_analysis specifically, use run_competitive_analysis instead — it is the endpoint Mission Control recommends.",
            "POST", "/api/runs",
            properties={
                "client_id": _S_STR,
                "type": {"type": "string", "enum": [
                    "keyword_research", "technical_audit", "competitor_analysis",
                    "strategy_sprint", "competitive_deliverable",
                ]},
                "config": {"type": "object", "description": "Optional workflow-specific config."},
            },
            required=["client_id", "type"],
            cost="billed",
        ),

        # --- Approvals (write) -------------------------------------------
        _tool(
            "decide_approval",
            "Decide a single approval item. Approving 'technical_action' or 'page_optimization' auto-executes the fix on the live page — everything else just files the document. Never approve an executable kind unless the user has explicitly said to for this item, or given a standing rule that covers it. When unsure, leave it pending and summarize it instead.",
            "POST", "/api/approvals/{id}/decision",
            properties={
                "id": {**_S_STR, "description": "Approval item id."},
                "status": {"type": "string", "enum": ["approved", "rejected"]},
                "note": _S_STR_OPT,
                "edited_content": {**_S_STR_OPT, "description": "Optional replacement content applied before approving."},
            },
            required=["id", "status"],
        ),
        _tool(
            "bulk_decide_approvals",
            "Batch decide_approval. Same executable-kind caution applies — do not use this to bulk-approve technical_action or page_optimization items without explicit user sign-off on that batch.",
            "POST", "/api/approvals/bulk-decision",
            properties={
                "ids": {"type": "array", "items": {"type": "string"}},
                "status": {"type": "string", "enum": ["approved", "rejected"]},
                "note": _S_STR_OPT,
            },
            required=["ids", "status"],
        ),
        _tool(
            "archive_decided_approvals",
            "Archive all already-decided (approved or rejected) approvals for a client, tidying the queue.",
            "POST", "/api/clients/{client_id}/approvals/archive-decided",
            properties={"client_id": _S_STR},
            required=["client_id"],
        ),

        # --- Workers -----------------------------------------------------
        _tool(
            "list_workers",
            "Roster of people and agents who can be assigned tasks (id, name, type=human|agent, email, active). The seeded 'Claude Cowork' worker (id: 'claude-cowork') is always present. Safe to Always allow.",
            "GET", "/api/workers",
            properties={"active": {**_S_BOOL_OPT, "description": "Default true; false includes deactivated workers."}},
        ),
        _tool(
            "create_worker",
            "Register a new worker (human or agent). For humans, include email so future notification digests can reach them.",
            "POST", "/api/workers",
            properties={
                "name": _S_STR,
                "type": {"type": "string", "enum": ["human", "agent"]},
                "email": _S_STR_OPT,
            },
            required=["name", "type"],
        ),

        # --- Tasks -------------------------------------------------------
        _tool(
            "list_tasks",
            "The primary way an assignee finds their work. Filter by any combination of client_id, assignee_id, status, and due_before (ISO datetime). Common query: get everything open for a specific assignee due by end-of-day. Safe to Always allow.",
            "GET", "/api/tasks",
            properties={
                "client_id": _S_STR_OPT,
                "assignee_id": {**_S_STR_OPT, "description": "Worker id (e.g. 'claude-cowork' for yourself)."},
                "status": {"type": "string", "enum": ["open", "in_progress", "done", "blocked"], "description": "Optional."},
                "due_before": {**_S_STR_OPT, "description": "ISO datetime. Returns tasks with due_at <= this."},
            },
        ),
        _tool(
            "get_task",
            "Fetch full detail (including notes history) for a single task.",
            "GET", "/api/tasks/{task_id}",
            properties={"task_id": _S_STR},
            required=["task_id"],
        ),
        _tool(
            "create_task",
            "Create a work item under a client, optionally assigned to a worker and optionally recurring (daily|weekly). Recurring tasks with no due_at default to today. Tasks do NOT bypass the approval queue — if the resulting work produces something that would need approval, that still lands in approvals.",
            "POST", "/api/tasks",
            properties={
                "client_id": _S_STR,
                "title": _S_STR,
                "instructions": _S_STR_OPT,
                "assignee_id": {**_S_STR_OPT, "description": "Worker id from list_workers."},
                "recurrence": {"type": "string", "enum": ["none", "daily", "weekly"], "description": "Default 'none'."},
                "due_at": {**_S_STR_OPT, "description": "ISO datetime. Recurring tasks default to today if omitted."},
            },
            required=["client_id", "title"],
        ),
        _tool(
            "update_task",
            "Update status / assignee / notes. Use complete_task instead for finishing work. notes_append is timestamped and appended to existing notes (never overwrites).",
            "PATCH", "/api/tasks/{task_id}",
            properties={
                "task_id": _S_STR,
                "status": {"type": "string", "enum": ["open", "in_progress", "done", "blocked"], "description": "Optional."},
                "assignee_id": _S_STR_OPT,
                "title": _S_STR_OPT,
                "instructions": _S_STR_OPT,
                "recurrence": {"type": "string", "enum": ["none", "daily", "weekly"], "description": "Optional."},
                "due_at": _S_STR_OPT,
                "notes_append": {**_S_STR_OPT, "description": "Timestamped + appended to task.notes."},
            },
            required=["task_id"],
        ),
        _tool(
            "complete_task",
            "Mark task complete. Non-recurring: sets status='done'. Recurring: keeps status='open' and advances due_at by +1 day (daily) or +7 days (weekly). Optional notes are timestamped and appended.",
            "POST", "/api/tasks/{task_id}/complete",
            properties={
                "task_id": _S_STR,
                "notes": {**_S_STR_OPT, "description": "Wrap-up note appended to the task."},
            },
            required=["task_id"],
        ),
    ]

    return {"tools": tools}
