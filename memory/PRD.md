# Autonomous SEO Agency Operator — PRD

## Original Problem Statement
Windows desktop-style app for a solo SEO agency owner. Coordinates a semi-autonomous
team of AI agents across multiple clients for keyword research, technical SEO audits,
competitor analysis, strategy drafting, and WordPress draft preparation. Human stays
in command via an approval-first workflow. Tech: React (Electron later) + FastAPI +
MongoDB + OpenAI. Integrations target GSC, GA, Semrush, DataForSEO, WordPress (draft
only), Screaming Frog MCP.

## User Personas
- **Solo SEO agency owner** (single internal user). Manages multiple clients, wants
  faster execution, better consistency, less manual research/admin.

## User Choices (locked)
- Scope: full app shell + AI agents (Coordinator + Specialists) using OpenAI, with
  integrations stubbed as UI-ready placeholders.
- AI model: **OpenAI GPT-5.2** via **Emergent Universal LLM Key**
  (`emergentintegrations.llm.chat.LlmChat`).
- Integrations: UI-ready, no live keys wired yet.
- Auth: none (single internal user).
- Design: dark operator console (Swiss/high-contrast), zinc palette, Outfit + IBM
  Plex Sans + JetBrains Mono.

## Architecture
- **Frontend**: React 19, react-router 7, Tailwind, shadcn/ui, sonner, lucide-react.
- **Backend**: FastAPI, motor (Mongo), pydantic v2, emergentintegrations.
- **Workflow engine**: `asyncio.create_task` background runner persists logs +
  results to Mongo; UI polls every 2-4s.
- **Routes**: all `/api/*`.

### Backend modules
- `backend/models.py` — Client, Competitor, IntegrationConfig, WorkflowRun, AgentLog,
  Approval (pydantic v2; UUIDs; ISO datetimes).
- `backend/agents.py` — per-agent system prompts + JSON-strict parsing. Agents:
  coordinator, keyword, audit, competitor, strategy, publisher. Uses
  `LlmChat(api_key=EMERGENT_LLM_KEY, ...).with_model("openai", "gpt-5.2")`.
- `backend/workflow.py` — orchestrator: coordinator plans → specialist agent runs →
  approvals auto-created → status transitions.
- `backend/server.py` — REST endpoints for clients, competitors, integrations, runs,
  approvals, dashboard summary.

### Frontend layout
- Left sidebar (16rem) + main content + right live activity panel (20rem).
- Routes: `/`, `/clients`, `/clients/:id`, `/clients/:id/workflows`,
  `/clients/:id/competitors`, `/clients/:id/integrations`, `/clients/:id/approvals`,
  `/approvals`, `/history`, `/runs/:runId`.

## What's Been Implemented (2026-02-XX)
- Multi-client workspace CRUD + cascade delete of runs/approvals.
- Competitor management per client.
- Per-client integration settings.
- 4 AI workflows running end-to-end with GPT-5.2:
  keyword_research, technical_audit, competitor_analysis, strategy_sprint.
- Coordinator agent plans subtasks before specialists run.
- Live activity panel (active runs + streaming agent log).
- Run details page with results renderers per workflow type + sticky log.
- Approval queue (pending / approved / rejected) with approve/reject + decision notes.
- Run history (audit trail across all workspaces).
- Dashboard overview with live counters.
- 100% backend test pass (25/25). 100% frontend test pass (15/15).

### 2026-02-XX — GSC OAuth integration (real)
- `backend/gsc.py` — full OAuth 2.0 flow (authorization code), per-client token storage with Fernet
  encryption at rest, automatic access-token refresh via stored refresh_token.
- New endpoints: `GET /api/integrations/gsc/connect`, `GET /api/integrations/gsc/callback`,
  `GET /api/clients/{id}/integrations/gsc/status|sites`, `POST .../select-site|refresh|disconnect`.
- Scope: `webmasters.readonly` + `userinfo.email` (least privilege).
- 28-day data pull (sliced by query + page, with 3-day GSC lag) cached on the client document.
- Keyword Research agent prompt now grounds analysis in real GSC top queries/pages when present.
- Frontend: `GscConnect` component on the Integrations page (Connect → site picker → Refresh data).
- Env vars added: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI, FRONTEND_BASE_URL, FERNET_KEY.

## Backlog
### P0 — next session
- Frontend e2e test pass (testing_agent_v3 — pending; was skipped per scope).
- Inline result editing inside the approval dialog (currently shows JSON only).

### P1
- Wire real GSC/GA OAuth + token storage (encrypted).
- Wire Semrush + DataForSEO connectors and feed signals into prompts.
- WordPress draft publisher (REST API, draft-only).
- Screaming Frog MCP spike — feed crawl JSON into Technical Audit agent.
- Per-agent prompt/version tracking + diff view.
- Pagination + filters on runs/approvals lists.

### P2
- Recurring/scheduled monitoring jobs.
- Multi-client parallel job queue with concurrency cap.
- Browser automation layer (Playwright service) for non-API workflows.
- Electron packaging + Windows installer.
- Local model fallback for selected tasks.

## Notes
- `EMERGENT_LLM_KEY` lives in `/app/backend/.env`.
- Frontend backend URL: `REACT_APP_BACKEND_URL` (do not hardcode).
- Restart on env change: `sudo supervisorctl restart backend`.
