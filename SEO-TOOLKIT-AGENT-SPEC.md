# SEO-Toolkit — Autonomous-Agent API Spec

**For pasting into the SEO-Toolkit Emergent workspace.** This document is
self-contained; the SEO-Toolkit agent should be able to implement it end-to-end
without further context.

The goal: expose SEO-Toolkit's core workflows over a REST API that a remote
MCP connector (running on Render, hosted separately) can call on behalf of
Claude Desktop. A companion app called **Mission Control** already uses this
exact pattern successfully — this spec is derived from what worked there.

## Success criteria

When done, from any machine with the `AGENT_API_KEY` value:

```bash
KEY=<the key from backend/.env>
BASE=<your-toolkit-prod-url>   # e.g. https://seo-toolkit.emerald.consulting

# 1. Public manifest — no key needed
curl $BASE/api/agent/manifest | head -20

# 2. Session snapshot — key required
curl -H "X-API-Key: $KEY" $BASE/api/agent/session-start

# 3. Any tool endpoint — key required
curl -H "X-API-Key: $KEY" -X POST $BASE/api/tools/content-brief \
  -H "Content-Type: application/json" \
  -d '{"target_keyword":"best chef knives 2026","target_url":"https://example.com/knives"}'
```

All three must return 200 with valid JSON. That's the finish line for the
in-app work. Everything else (MCP connector, Render deploy, Claude Desktop
wiring) happens outside this workspace and doesn't concern the toolkit agent.

---

## Step 1 — API-key middleware

Add to the end of `backend/server.py` (or wherever the FastAPI app is
composed):

```python
# ---- API key middleware (opt-in) --------------------------------------------
# If AGENT_API_KEY is set in .env, every /api/* request except the explicitly
# exempt paths must include header `X-API-Key: <that value>`. If unset, the
# API stays fully open (dev/single-user desktop mode). This is the same
# pattern used by Mission Control.

import os

AGENT_API_KEY = os.environ.get("AGENT_API_KEY", "").strip()
_AUTH_EXEMPT_EXACT = {
    "/", "/api", "/api/", "/api/health", "/api/agent/manifest",
    "/openapi.json", "/docs", "/redoc",
}
_AUTH_EXEMPT_PREFIXES = ("/api/share/", "/docs/", "/redoc/")


@app.middleware("http")
async def api_key_gate(request, call_next):
    if not AGENT_API_KEY:
        return await call_next(request)
    path = request.url.path
    if not path.startswith("/api"):
        return await call_next(request)
    if request.method == "OPTIONS":
        return await call_next(request)
    if path in _AUTH_EXEMPT_EXACT or any(path.startswith(p) for p in _AUTH_EXEMPT_PREFIXES):
        return await call_next(request)
    key = request.headers.get("x-api-key") or request.query_params.get("api_key")
    if key != AGENT_API_KEY:
        from starlette.responses import JSONResponse
        return JSONResponse(
            {"detail": "Missing or invalid X-API-Key header"},
            status_code=401,
        )
    return await call_next(request)
```

Then in `backend/.env`, add:

```
AGENT_API_KEY=<generate a strong random string>
```

Generate with: `python3 -c "import secrets; print('sk-toolkit-' + secrets.token_urlsafe(32))"`

**Also update `frontend/.env`** so the existing UI keeps working:

```
REACT_APP_AGENT_API_KEY=<same value as backend AGENT_API_KEY>
```

Then update the Axios client (`frontend/src/lib/api.js` or equivalent) to
inject the header if the env var is present:

```javascript
const AGENT_API_KEY = process.env.REACT_APP_AGENT_API_KEY;
if (AGENT_API_KEY) {
  api.defaults.headers.common['X-API-Key'] = AGENT_API_KEY;
}
```

Restart both services: `sudo supervisorctl restart backend frontend`.

**Sanity check** before moving on:

```bash
curl -o /dev/null -s -w "no-key: %{http_code}\n" $BASE/api/<any-existing-endpoint>
# should return 401

curl -o /dev/null -s -w "with-key: %{http_code}\n" -H "X-API-Key: $KEY" $BASE/api/<any-existing-endpoint>
# should return 200
```

---

## Step 2 — Manifest endpoint

Create `backend/agent_manifest.py`:

```python
"""Machine-readable operator's guide for autonomous agents.

This module produces a static description of the API surface that Claude /
Cowork ingests at session start. Keep it flat, keep the language literal —
LLMs read it as instructions, not as marketing copy.
"""

from typing import Dict, Any


def build_manifest(backend_base_url: str = "") -> Dict[str, Any]:
    base = backend_base_url.rstrip("/") or ""
    return {
        "product": "SEO-Toolkit · Autonomous SEO Workflow Runner",
        "version": "1.0",
        "primer": (
            "You are operating a solo SEO agency's toolkit. The user owns the "
            "data. Tools with `execution.taskSupport: 'forbidden'` are one-shot "
            "invocations. Tools tagged `cost: 'billed'` invoke LLMs or external "
            "APIs that spend real money — ALWAYS ask the user for explicit "
            "approval before calling these. Read tools are free to run. "
            "TIP: call GET /api/agent/session-start once right after reading "
            "this manifest — it returns projects, integrations health, and "
            "recent activity in one shot."
        ),
        "base_url": base,
        "auth": {
            "type": "api_key",
            "header": "X-API-Key",
            "note": "Supplied via the MCP connector — you do not need to set it manually.",
        },
        "resources": {
            "session_start": {
                "endpoint": "GET /api/agent/session-start",
                "description": "One-shot orientation snapshot.",
            },
            "openapi_spec": "GET /openapi.json",
        },
        "tools": [
            # Read
            {"name": "list_projects", "cost": "free", "endpoint": "GET /api/projects"},
            {"name": "get_project", "cost": "free", "endpoint": "GET /api/projects/{id}"},

            # Write / billed  — mark ALL of these as cost:"billed" so Claude asks first
            {"name": "generate_content_brief", "cost": "billed", "endpoint": "POST /api/tools/content-brief"},
            {"name": "competitor_content_gap", "cost": "billed", "endpoint": "POST /api/tools/content-gap"},
            {"name": "page_seo_analysis", "cost": "billed", "endpoint": "POST /api/tools/page-analysis"},
            {"name": "page_optimizer", "cost": "billed", "endpoint": "POST /api/tools/page-optimizer"},
            {"name": "run_recipe_pipeline", "cost": "billed", "endpoint": "POST /api/tools/recipe-pipeline"},
            {"name": "gsc_cluster_topics", "cost": "billed", "endpoint": "POST /api/tools/gsc-clusters"},
            {"name": "keyword_url_map", "cost": "billed", "endpoint": "POST /api/tools/keyword-url-map"},
            {"name": "create_optimized_article", "cost": "billed", "endpoint": "POST /api/tools/optimized-article"},
        ],
        "safety_rules": [
            "Never call `cost: 'billed'` tools without explicit user permission this session.",
            "Read tools are safe to always allow.",
            "Don't run the same billed tool twice for the same target within one session unless explicitly asked to retry.",
        ],
    }
```

Register in `backend/server.py`:

```python
import agent_manifest

@api.get("/agent/manifest")
async def agent_manifest_endpoint():
    """Operator's guide for autonomous agents. Public — no API key required."""
    base = os.environ.get("REACT_APP_BACKEND_URL", "").strip()
    return agent_manifest.build_manifest(backend_base_url=base)
```

---

## Step 3 — Session-start endpoint

```python
@api.get("/agent/session-start")
async def agent_session_start():
    """One-shot orientation call. Requires API key."""
    from datetime import datetime, timezone

    # Adjust these queries to match SEO-Toolkit's actual collections. The shape
    # below is what a caller expects; substitute your project/run/analysis
    # models. Missing fields default to empty/zero.
    projects = await db.projects.find(
        {}, {"_id": 0, "id": 1, "name": 1, "domain": 1}
    ).to_list(100)

    recent_analyses = await db.analyses.find(
        {}, {"_id": 0, "id": 1, "project_id": 1, "type": 1, "status": 1, "created_at": 1}
    ).sort("created_at", -1).to_list(10)

    return {
        "server_time": datetime.now(timezone.utc).isoformat(),
        "integrations": {
            # Report whatever integrations SEO-Toolkit has (GSC, GA, Semrush, etc.)
            # as {"configured": bool}. Don't make live API calls here — cheap.
            "gsc": {"configured": bool(os.environ.get("GOOGLE_CLIENT_ID"))},
            # ... etc
        },
        "totals": {
            "projects": len(projects),
            "recent_analyses": len(recent_analyses),
        },
        "projects": projects,
        "recent_analyses": recent_analyses,
        "hint": (
            "Read /api/agent/manifest for the full operator's guide. All tool "
            "endpoints under /api/tools/* cost money — ask the user before calling."
        ),
    }
```

---

## Step 4 — Tool endpoints

For each capability the user listed, expose a POST endpoint under
`/api/tools/*`. Each should be a **thin wrapper around the existing internal
logic** — don't reimplement anything. If the current UI has a button that
runs the workflow, find the handler behind that button and wire it to a REST
endpoint.

### Tool 1 — `POST /api/tools/content-brief`
Generates a content brief for a target keyword + URL.

**Request body:**
```json
{
  "target_keyword": "best chef knives 2026",
  "target_url": "https://example.com/knives",
  "project_id": "optional-existing-project-id"
}
```

**Response:**
```json
{
  "brief_id": "brief_abc123",
  "title_suggestions": [...],
  "outline": [...],
  "target_intent": "commercial",
  "internal_link_suggestions": [...],
  "created_at": "2026-02-15T10:00:00Z"
}
```

### Tool 2 — `POST /api/tools/content-gap`
Builds competitor content gap analysis.

**Request body:**
```json
{
  "project_id": "proj_abc",
  "competitor_domains": ["competitor1.com", "competitor2.com"],
  "topic_focus": "chef knives"
}
```

**Response:** Gap analysis result (whatever structure your current impl returns).

### Tool 3 — `POST /api/tools/page-analysis`
Runs page-level SEO analysis on a URL.

**Request body:**
```json
{ "url": "https://example.com/some-page", "project_id": "optional" }
```

**Response:** Analysis result (title/meta/H1/schema/word-count/issues/etc.).

### Tool 4 — `POST /api/tools/page-optimizer`
Suggests optimizations for a specific page.

**Request body:**
```json
{ "url": "https://example.com/some-page", "target_keyword": "..." }
```

**Response:** Ordered list of optimization suggestions with priority + rationale.

### Tool 5 — `POST /api/tools/recipe-pipeline`
Initiates the Recipe Pipeline workflow.

**Request body:**
```json
{ "project_id": "proj_abc", "recipe_topic": "creamy chicken pasta" }
```

**Response:** Pipeline run ID + initial status. Long-running — return async.

### Tool 6 — `POST /api/tools/gsc-clusters`
Generates GSC cluster query topics for a project.

**Request body:**
```json
{ "project_id": "proj_abc", "date_range_days": 90 }
```

**Response:** Cluster topics with representative queries + volumes.

### Tool 7 — `POST /api/tools/keyword-url-map`
Creates primary keyword→URL map.

**Request body:**
```json
{ "project_id": "proj_abc" }
```

**Response:** Map of primary keywords to their canonical URLs.

### Tool 8 — `POST /api/tools/optimized-article`
Creates a fully optimized article (LLM-generated).

**Request body:**
```json
{
  "target_keyword": "best chef knives 2026",
  "brief_id": "brief_abc123",
  "word_count_target": 2500
}
```

**Response:** Article ID + draft content.

### Implementation notes for the toolkit agent

- **Reuse existing logic.** If these workflows already exist as internal
  Python functions, expose them; don't rewrite.
- **All 8 tool endpoints are `cost: "billed"`** in the manifest. Add clear
  input validation + short-circuit if a required upstream (LLM key, GSC token)
  is missing — return 400 with a helpful error, don't just crash.
- **Return within 30s or return async.** MCP tool calls have a client-side
  timeout. Long jobs (Recipe Pipeline, optimized article generation) should
  return a job ID immediately, with a companion `GET /api/tools/status/{job_id}`
  endpoint the connector can poll.
- **Never accept credentials or API keys in tool request bodies.** They come
  from the app's env and existing user auth. Tools are executed AS the app,
  on behalf of the user who owns the API key.

---

## Step 5 — Testing checklist

Before handing back, verify all of these:

```bash
KEY=$(grep AGENT_API_KEY backend/.env | cut -d= -f2)
BASE=https://seo-toolkit.emerald.consulting   # or preview URL for dev

# 1. Public manifest
curl -s $BASE/api/agent/manifest | jq '.product, .tools | length'
# → "SEO-Toolkit · Autonomous SEO Workflow Runner"  and  10

# 2. Session start (requires key)
curl -s -H "X-API-Key: $KEY" $BASE/api/agent/session-start | jq '.totals'
# → { "projects": N, "recent_analyses": M }

# 3. Auth enforcement
curl -o /dev/null -s -w "%{http_code}\n" $BASE/api/projects
# → 401

curl -o /dev/null -s -w "%{http_code}\n" -H "X-API-Key: $KEY" $BASE/api/projects
# → 200

# 4. One tool endpoint (billed - dry-run friendly if possible)
curl -s -H "X-API-Key: $KEY" -X POST $BASE/api/tools/page-analysis \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com"}' | jq '.'
# → analysis JSON

# 5. Frontend still works
# Open $BASE in a browser, verify the UI loads and existing features function
# (this catches Axios/X-API-Key wiring bugs)
```

If all 5 pass, you're done with in-app work. Report back to the operator with:
- The `AGENT_API_KEY` value (they'll need it for the MCP connector env)
- Any tool endpoints that diverged from this spec (renamed, split, or omitted)
- Any tools that turned out to be async — flag which ones and their status
  endpoint patterns

---

## Reference — What Mission Control looks like

If you want to see this exact pattern already in production, the Mission
Control repo has:
- Middleware at end of `backend/server.py` (see the "API key middleware" section)
- Manifest in `backend/agent_manifest.py`
- Session-start endpoint at `backend/server.py` `/agent/session-start`
- Deployed remote MCP connector at `https://mission-control-mcp-r04q.onrender.com`

The MCP connector side is being handled by another agent in a separate
workspace — you don't need to build a connector here. You only need to make
the API side of SEO-Toolkit look like Mission Control's does.

**Timing estimate:** 2-4 hours of implementation + testing, largely
depending on how much internal refactoring is needed to expose the 8 tool
endpoints without duplicating logic.
