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
            "Always prefer the high-level workflow endpoints over composing low-level ones."
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
    }
