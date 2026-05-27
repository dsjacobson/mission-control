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

### 2026-02-27 — Manual Semrush CSV uploads + Screaming Frog HTTP bridge + Issue routing + Keyword Map
- **Semrush manual CSV ingestion** — `backend/semrush_csv.py`. Auto-detects 5
  export types from headers: domain_overview, organic_positions, competitors,
  backlinks, keyword_gap. Handles semicolon/comma/tab delimiters and
  UTF-8/BOM. Stored per-client under `clients.semrush_uploads.{type}`.
  Endpoints: `POST/GET/DELETE /api/clients/{id}/integrations/semrush/upload[s]`.
- **Workflow grounding prefers uploads over API** — Keyword Research uses
  uploaded organic_positions + keyword_gap when present; Competitor Analysis
  uses uploaded competitors + keyword_gap; Strategy Sprint adds backlinks +
  domain_overview as extra context. Saves Semrush API credits.
- **Screaming Frog HTTP bridge** — `backend/sf_bridge.py` + downloadable
  `bridge/sf_bridge.py` that the user runs locally on Windows. Wraps
  `ScreamingFrogSEOSpiderCli.exe` and exposes a small REST API (`/crawl`,
  `/crawl/{id}`, `/crawl/{id}/files`, `/crawl/{id}/file/{filename}`). User
  tunnels via ngrok, pastes URL+token. Resilient cloud poller handles
  transient ngrok blips. Surfaces SF stdout/stderr on failure.
- **Bridge ingest pulls three datasets** — issues_overview (audit signals),
  internal_all (per-URL page index w/ real title/meta/H1 for ~2000 URLs),
  and every bulk-issue CSV (issue → affected URLs map for routing).
- **Issue routing for technical_action approvals** — `backend/issue_router.py`
  categorizes each audit issue (metadata / content / structural / performance
  / security). Each bucket has a dedicated agent prompt + artifact shape:
  metadata → page_fixes with real current values; content → per-URL
  remediation directive + on-demand draft expansion; structural → action
  table; performance/security → implementation brief with code snippet.
- **Workflow OnPage path** now pulls real current title/meta/H1 from SF page
  index when rewriting top GSC pages.
- **URL normalization** — strips protocol/www/trailing-slash/fragment for
  SF↔GSC↔Semrush URL matching. Token-overlap matcher allows short tokens
  like "h1"/"4xx" through after stop-word filtering.
- **Keyword Map** — new top-level client page (`pages/KeywordMap.jsx`,
  `backend/keyword_map.py`). Aggregates target keywords from 3 sources:
  GSC by_query_page (new joint dimension pull), Semrush organic positions
  CSV, Semrush keyword gap CSV. Classifies each keyword as aligned /
  cannibalized / wrong_page / missing_page / under_optimized / low_position.
  Per-keyword drawer shows position, volume, cannibal URLs, competitor URLs,
  and live SERP top-10 (DataForSEO Google Organic Live Regular) with
  backlink metrics for each ranked URL (DR, PR, total backlinks, referring
  domains, derived dofollow domains, spam score via bulk endpoints —
  ~$0.003 per fetch).
- **Status classifier fixes** — `aligned` now requires pos ≤ 5 (not just
  any current_url). pos 6-20 → `under_optimized`, pos > 20 → `low_position`
  (new). Cannibalization now detected from Semrush positions too (multiple
  client URLs ranking for same keyword), not GSC-only. Major bug fix where
  every keyword previously fell through to "aligned".
- **AI refinement (relevance-first)** — `agents.refine_url_keywords` +
  `keyword_map.start_refinement`. For each URL (top N by inlinks), fetches
  the page, gathers currently-mapped keywords, pulls DataForSEO related
  variants, and asks the AI to pick the most CONTENT-RELEVANT primary
  keyword (specificity > volume). Outputs supporting keywords + per-mapped
  keyword verdicts (matches / better_alternative / not_relevant) + rationale.
  Background job with progress polling; modal lets user pick N (presets
  25/100/250/500/all) with live cost/time estimates.
- **Page-first sparse analyzer** — `backend/page_analyzer.py` fetches a
  URL, strips HTML to title/headings/body, AI agent identifies primary
  keyword, DataForSEO returns related variants with volume/intent,
  recommends optimal mapped keyword. Surfaced via "Sparse pages" panel
  for URLs with weak keyword signal.
- Tests: 31 unit tests across CSV parsing, issue routing, URL normalization,
  keyword map aggregation, status classification.

### 2026-02-XX — Phase 3 complete: GA OAuth + Screaming Frog + Strategy grounded
- **Google Analytics 4 OAuth** — `backend/ga.py`. Reuses Google client_id/secret from GSC
  setup, distinct `GA_REDIRECT_URI`, scope `analytics.readonly`. Endpoints under
  `/api/integrations/ga/{connect,callback}` and `/api/clients/{id}/integrations/ga/{status,properties,select-property,refresh,disconnect}`.
  28-day pull via GA Data API: totals + top landing pages + traffic sources + devices.
  Tokens encrypted with the shared Fernet key.
- **Screaming Frog upload** — `backend/screamingfrog.py`. Spike approach: parse SF
  CSV exports (Issues Overview or internal_all). SF v24 has a local Node MCP server
  that isn't reachable from a hosted backend; upload approach works today.
  Endpoint: `POST /api/clients/{id}/integrations/screamingfrog/upload`.
- **Strategy Agent grounded** — `workflow.py` now builds context for `strategy_sprint`
  from GSC + GA + Semrush competitors + DataForSEO gaps + Screaming Frog summary +
  latest completed `keyword_research`, `competitor_analysis`, `technical_audit` runs.
- **Technical Audit Agent grounded** — pulls Screaming Frog + GA4 + GSC blocks; prompt
  updated to anchor priorities to actual urls_affected counts and weight by traffic.
- Verified live: strategy_sprint on cookingitalians.com → exec summary cites real GSC
  pages (cacciucco, delizia al limone) AND real DataForSEO gap keywords (tiramisu,
  gnocchi, rigatoni, aperol spritz). Technical audit on same client with SF upload →
  10 grounded issues.
- Frontend: new `GaConnect` + `ScreamingFrogUpload` components on the Integrations page.
  Stub fields removed (GA toggle + SF endpoint + Semrush + DataForSEO removed in prior
  iteration). New env var: `GA_REDIRECT_URI`.

### 2026-02-XX — Semrush MCP + DataForSEO integrations
- `backend/semrush.py` — minimal Semrush MCP HTTP/JSON-RPC client (no full MCP SDK).
  Supports `tools/list`, `tools/call`, plus helpers: `domain_competitors`,
  `domain_organic_keywords`, `phrase_batch_metrics`, `execute_report`. Parses CSV responses.
- `backend/dataforseo.py` — async REST client (Basic Auth via httpx). Wraps
  `bulk_keyword_difficulty/live`, `competitors_domain/live`, `domain_intersection/live`
  (intersections=false for keyword gaps), `ranked_keywords/live`.
- New endpoints: `GET /api/integrations/{semrush,dataforseo}/status`.
- **Competitor Analysis agent**: grounded with Semrush top-10 organic competitors +
  DataForSEO keyword gaps per tracked competitor.
- **Keyword Research agent**: enriched with Semrush organic keywords for client domain
  + DataForSEO bulk keyword difficulty scores on AI-proposed clusters.
- Frontend: `IntegrationStatusCard` component with connection state + sample tools.
- Env vars added: SEMRUSH_API_KEY, SEMRUSH_MCP_ENDPOINT, DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD.
- Verified: full competitor_analysis run on `cookingitalians.com` produced grounded
  results citing real keyword gaps (tiramisu, gnocchi) vs giallozafferano.com.

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
- Inline result editing inside the approval dialog (currently shows JSON only).

### P1
- Browser automation / scraper for autonomous Semrush fetch (e.g. Openclaw)
  so the CSV uploads can be auto-refreshed nightly.
- Scheduled background jobs (nightly auto-refresh of GSC/GA, weekly strategy
  sprints, on-demand SF crawl via the local bridge).
- WordPress draft publisher (REST API, draft-only).
- Per-agent prompt/version tracking + diff view.
- Pagination + filters on runs/approvals lists.

### P2
- Branded client PDF report generator.
- Multi-client parallel job queue with concurrency cap.
- Electron packaging + Windows installer (would let the SF bridge ship inside
  the app instead of as a separate script).
- Local model fallback for selected tasks.

## Notes
- `EMERGENT_LLM_KEY` lives in `/app/backend/.env`.
- Frontend backend URL: `REACT_APP_BACKEND_URL` (do not hardcode).
- Restart on env change: `sudo supervisorctl restart backend`.
