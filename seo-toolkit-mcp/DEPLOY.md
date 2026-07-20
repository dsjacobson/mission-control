# Deploying seo-toolkit-mcp on Render

Same host, same pattern as `mission-control-mcp`. If you got Mission Control
working, this is a 5-minute repeat.

## Prerequisites

1. **SEO Toolkit has a stable production URL** with the autonomous-agent API
   layer deployed (`/api/agent/manifest`, `/api/agent/session-start`,
   `/api/tools/*`). Verify:
   ```bash
   curl https://seo-toolkit.emerald.consulting/api/agent/manifest | head -20
   ```
   Should return JSON starting with `"product": "SEO-Toolkit …"`.

2. **You know the `AGENT_API_KEY`** from SEO Toolkit's `backend/.env`.
   Don't paste it in chat.

3. **Same GitHub repo** you used for `mission-control-mcp`. This folder
   (`seo-toolkit-mcp`) will live alongside it at the repo root.

## Steps

### 1. Push /app to GitHub
Click **Save to GitHub** in Emergent. The `seo-toolkit-mcp/` folder pushes
alongside `mission-control-mcp/`.

### 2. Deploy on Render via Blueprint

1. https://dashboard.render.com/blueprints → **New Blueprint Instance**
2. Pick the same repo. Render will detect **two** service configs (Mission
   Control + SEO Toolkit) — since Mission Control is already running, Render
   will offer to add only the new `seo-toolkit-mcp` service. Confirm.
3. Fill env vars:

| Variable | Value |
|---|---|
| `PUBLIC_URL` | Placeholder for first deploy (e.g. `https://placeholder.example.com`). Update after Render assigns the real URL, then redeploy. |
| `DASHBOARD_PASSWORD` | A **different** password from Mission Control. Solo-user security best practice — one connector compromise doesn't compromise the other. |
| `SEO_TOOLKIT_API_BASE_URL` | `https://seo-toolkit.emerald.consulting` (or your prod URL) |
| `SEO_TOOLKIT_API_KEY` | The `AGENT_API_KEY` from SEO Toolkit's `backend/.env` |

4. Click **Apply**. Wait ~2 min for first deploy. It will fail on missing
   `PUBLIC_URL` if you didn't paste a placeholder — that's fine, just go to
   step 3.

### 3. Set the real PUBLIC_URL

1. After first deploy, Render assigns your service a URL like
   `https://seo-toolkit-mcp-xxxx.onrender.com`. Copy it (top of the service
   dashboard page).
2. Service → **Environment** → edit `PUBLIC_URL` to that value (no trailing
   slash, no `/mcp` suffix).
3. Save Changes → triggers auto-redeploy.

### 4. Verify it's alive

```bash
curl https://seo-toolkit-mcp-xxxx.onrender.com/health
# → {"ok":true}

curl https://seo-toolkit-mcp-xxxx.onrender.com/.well-known/oauth-authorization-server
# → OAuth metadata JSON
```

### 5. Connect it to Claude Desktop

1. Claude Desktop → **Settings → Connectors → Add custom connector**
2. Name: `SEO Toolkit`
3. URL: `https://seo-toolkit-mcp-xxxx.onrender.com/mcp` (note the `/mcp` suffix)
4. Leave OAuth Client ID/Secret blank
5. Click **Connect** → browser opens consent screen → enter your
   `DASHBOARD_PASSWORD` → Authorize

### 6. Recommended tool permissions

**Always allow** (read + billed-but-trusted):
- `session_start`, `list_projects`, `get_project`, `get_job_status`
- `generate_content_brief`, `page_optimizer`, `run_recipe_pipeline`,
  `create_optimized_article`, `gsc_cluster_topics`

**Ask every time** (billed + risky):
- `competitor_content_gap`, `page_seo_analysis`, `keyword_url_map`

### 7. Smoke test

Ask Claude:
> Give me a session-start snapshot of SEO Toolkit.

Should return in 1-3s with your projects + integration health.

Then try a real workflow:
> Run a page SEO analysis on https://example.com for the keyword "example".

Claude will prompt for permission (ask-every-time), then call
`page_seo_analysis`, get back a `job_id`, and start polling `get_job_status`
every 10-20s until the analysis completes.

## Gotchas — same as Mission Control

- **Redeploy invalidates in-memory OAuth**: after any redeploy, remove the
  connector in Claude Desktop, fully quit Claude, re-add. Same recovery flow.
- **Stateless-per-request transport with JSON responses**: don't change
  `sessionIdGenerator: undefined` in `src/index.ts` — required for Render
  reverse-proxy compatibility.
- **`app.set('trust proxy', 1)` is required** for Render — do not remove.
- **Async tools timeout in Claude if held for 60s**: this is why all
  long-running SEO Toolkit tools return `{job_id, status, poll}` immediately
  and Claude polls. Don't try to make them synchronous — they'll time out.

## Cost

Render Starter is $7/mo for no cold starts. Free tier idles after 15 min and
cold-starts in ~30s — fine for interactive use, one small delay on the first
call of a session.
