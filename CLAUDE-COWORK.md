# SEO Operator — Claude Cowork Operator's Guide

> This document is written **for an autonomous agent** (Claude Cowork / Claude
> Computer Use) that will drive this application on the user's behalf.
> Read `GET /api/agent/manifest` first, then this document, then start work.

## What this app is

A single-operator SEO agency command center. Each **client** is one SEO client
site (like `betfine24.com`, `cookingitalians.com`). For each client you can:

- Track **competitors** with cached Semrush + DataForSEO metrics
- Manage a **Keyword Map** (which URLs target which queries)
- Run **workflows** (competitive analysis, keyword research, technical audit)
  that produce artifacts held in an **approval queue**
- **Approve** artifacts to publish them (or execute the underlying task)
- Export any approved artifact as `.docx` or `.xlsx` for client hand-off

## Golden rules

1. **Prefer high-level workflow endpoints over composing low-level ones.**
   `POST /api/clients/{id}/competitive-analysis` does in one call what would
   otherwise be 6-8 separate API calls.

2. **The system is approval-first by default.** Every workflow output is a
   *pending approval* until a human (or you, with permission) approves it.
   Approving an *executable* kind (`technical_action`, `page_optimization`,
   `content_brief`) triggers the executor to run the fix. Approving a
   *reference* kind (`competitive_deliverable`, `strategy_doc`,
   `competitor_insight`) just publishes it to the Deliverables backlog.

3. **You may generate freely; you may not approve executable actions without
   explicit user permission.** When in doubt, leave items `pending` and give
   the user a one-line summary of what you produced.

4. **Real money is spent per API call.** Semrush + DataForSEO cost the user
   real cents per refresh. Do not loop refreshes. Once per day per client
   at most.

5. **Some flows require a browser session (which you have via Cowork).**
   Google OAuth for Search Console / Analytics, first-time Semrush key entry,
   and the Screaming Frog local bridge setup all need the UI. For those,
   navigate to the app in the browser and follow the on-screen flow.

## Authentication

If the server has `AGENT_API_KEY` set in its env, every `/api/*` request
must include header `X-API-Key: <that value>`.

- Public exceptions: `/`, `/health`, `/openapi.json`, `/docs`, `/redoc`,
  `/agent/manifest`, `/share/*`
- Ask the user for the key. Store it in your session.

If `AGENT_API_KEY` is unset, the API is open (dev mode).

## Standard session workflow

```
1. GET /api/agent/manifest           → learn what you can do
2. GET /api/health                   → confirm auth + integrations status
3. GET /api/clients                  → list clients you can operate on
4. For each client task, use the appropriate high-level workflow endpoint.
5. Poll GET /api/runs/{run_id} until status='completed'.
6. GET /api/approvals?client_id=... &status=pending → find what needs review.
7. Present results to the user. Optionally export via /export/docx or /xlsx.
```

## Recipes

### 🎯 "Run the monthly competitive analysis for all clients"

```
clients = GET /api/clients
for client in clients:
    r = POST /api/clients/{client.id}/competitive-analysis
    # returns { run_id, metrics_refreshed, metrics_failed, ranked_keywords_topped_up }

# Poll all runs in parallel
while any_still_running:
    for run_id in active_runs:
        run = GET /api/runs/{run_id}
        if run.status in ['completed', 'failed']:
            active_runs.remove(run_id)
    sleep 5

# Collect deliverables (still pending — waiting for human approval)
for client in clients:
    approvals = GET /api/approvals?client_id={client.id}&status=pending
    deliverable = first approval where kind='competitive_deliverable' and run_id matches
    docx_url = /api/approvals/{deliverable.id}/export/docx
    # Send docx_url to the user for review
```

### ✏️ "Onboard a new client"

```
c = POST /api/clients                { name, domain, industry, goals }
POST /api/clients/{c.id}/competitors { name, domain }   # repeat for each
# Interactive: point user to /clients/{c.id}/integrations to connect
#              GSC / GA / Semrush / DataForSEO / SF bridge.
# Then:
POST /api/clients/{c.id}/competitive-analysis   → first-pass baseline
```

### 📋 "Review approval queue for a client"

```
pending = GET /api/approvals?client_id={id}&status=pending
for a in pending:
    inspect a.content
    if quality is good and user has authorized auto-approve:
        POST /api/approvals/{a.id}/decision { status: 'approved' }
    else:
        # summarize + ask user
        pass
```

To bulk-approve a filtered batch:

```
POST /api/approvals/bulk-decision { ids: [...], status: 'approved' }
```

### 📦 "Send this month's report pack to a client"

```
approvals = GET /api/approvals?client_id={id}&status=approved
for a in approvals:
    docx = GET /api/approvals/{a.id}/export/docx
    xlsx = GET /api/approvals/{a.id}/export/xlsx
    # Attach both to your email / drop in shared folder
```

## Resource cheat sheet

| Resource       | Where                                               | Key fields                                                              |
|----------------|-----------------------------------------------------|-------------------------------------------------------------------------|
| Client         | `/api/clients/{id}`                                 | `name`, `domain`, `industry`, `goals`, `target_markets`, `competitors`  |
| Competitor     | Nested under `client.competitors[]`                 | `name`, `domain`, `metrics`, `ranked_keywords`, `sf_crawl`              |
| Workflow run   | `/api/runs/{id}`                                    | `type`, `status`, `results`, `approvals_pending`, `approvals_total`     |
| Approval       | `/api/approvals/{id}`                               | `kind`, `status`, `progress`, `content`, `artifact_status`              |
| Keyword map    | `/api/clients/{id}/keyword-map/*`                   | `keywords{}`, `refined_urls[]`, `cannibalization[]`                     |

## Common approval kinds

| Kind                        | Content shape                                                                   | On approve                                          |
|-----------------------------|---------------------------------------------------------------------------------|-----------------------------------------------------|
| `content_brief`             | `{title, primary_keyword, outline, internal_links, ...}`                        | Executor produces a full draft                      |
| `technical_action`          | `{title, url, recommended_fix, expected_outcome, category}`                     | **Auto-executes** the fix (meta rewrites, etc.)     |
| `page_optimization`         | `{url, current_title, proposed_title, current_meta, proposed_meta, ...}`        | **Auto-rewrites** on-page elements                  |
| `strategy_doc`              | `{executive_summary, recommendations, weekly_plan, campaign_ideas}`             | Published to Deliverables backlog                   |
| `competitor_insight`        | `{title, opportunity, key_findings, next_steps}`                                | Published to Deliverables backlog                   |
| `competitive_deliverable`   | Full multi-section report (see manifest)                                         | Published + downloadable as branded docx/xlsx       |

## Errors + retries

- 4xx: recoverable — read `detail` and adjust the request
- 5xx: server bug — capture context and report to the user
- Rate limits: DataForSEO returns `40204` when a sub-API isn't on the user's
  subscription plan; back off and use Semrush instead
- Timeouts on runs: default poll cap is 5 minutes. If not done, alert the user.

## Safety / budget

- Never call refresh-all more than once per day per client
- Never trigger two runs of the same type for the same client in parallel
- Never approve `technical_action` or `page_optimization` items without user
  permission (they mutate real pages via the executor)
- Log every action you take in a session summary you present at the end

## When you're stuck

- Fetch `GET /openapi.json` for exact schemas
- The interactive Swagger UI is at `/docs` (also open in the browser)
- Escalate to the user with: (1) what you tried, (2) exact error, (3) proposed fix
