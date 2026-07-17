# Deploying mission-control-mcp on Render

Reasoning behind the choice: this service was written to be its own host
(`src/index.ts` strips any path prefix off `PUBLIC_URL` when computing the MCP
endpoint URL). Colocating it under `/mcp-connector/*` on the existing FastAPI
domain would require patching the Node code and risks silent OAuth-discovery
breakage. Render is Cowork's own fallback recommendation, matches the
`.env.example`, and needs zero code changes.

## Prerequisites

1. **Mission Control has a stable production URL.** Click the **Deploy** button
   in Emergent to get one (the current `seo-agent-hub-3.preview.emergentagent.com`
   is preview-only and will die if the workspace restarts). Note the resulting
   URL — you'll paste it as `MISSION_CONTROL_API_BASE_URL` below.

2. **A GitHub account** (Render deploys from git). Use Emergent's "Save to
   GitHub" button on `/app` to push this repo. `mission-control-mcp/` will
   land inside the repo as a subfolder.

3. **A Render account** — https://render.com/, free to create.

## Steps

### 1. Push /app to GitHub

Click Emergent's **Save to GitHub** in the chat input. Note the repo URL
(e.g. `https://github.com/<you>/seo-operator`).

### 2. Deploy on Render via Blueprint

Option A — Blueprint (uses `mission-control-mcp/render.yaml`):

1. Go to https://dashboard.render.com/blueprints
2. Click **New Blueprint Instance**
3. Connect your GitHub, pick the repo you pushed in step 1
4. Render will detect `mission-control-mcp/render.yaml` and pre-fill the
   service. Approve.
5. On the **Environment Variables** screen, fill these four:

| Variable | Value |
|---|---|
| `PUBLIC_URL` | Set to any placeholder for now (e.g. `https://placeholder.example.com`). The service refuses to start without it, so a placeholder gets you past the first deploy — you'll replace it with the real Render URL in step 3. |
| `DASHBOARD_PASSWORD` | Pick a strong password. This is the ONLY gate on who can connect Claude to your Mission Control. Don't reuse anything. |
| `MISSION_CONTROL_API_BASE_URL` | Your deployed Mission Control URL, e.g. `https://seo-agent-hub-3.emergent.host` |
| `MISSION_CONTROL_API_KEY` | The current `AGENT_API_KEY` value from `/app/backend/.env`. Copy from that file directly — do not paste it here in chat. |

6. Click **Apply** and wait for the first deploy (~2 min). If you left `PUBLIC_URL` truly blank instead of a placeholder, the deploy will fail with `Missing required environment variable: PUBLIC_URL` — that's expected; just move to step 3 and it'll self-heal on the next deploy.

Option B — Manual (if Blueprint fails for any reason):

1. New → **Web Service**
2. Connect the repo, set **Root Directory** = `mission-control-mcp`
3. Build command: `npm ci && npm run build`
4. Start command: `node dist/index.js`
5. Add the four env vars from the table above
6. Deploy

### 3. Set PUBLIC_URL and redeploy

After the first deploy, Render assigns your service a URL like
`https://mission-control-mcp-abcd.onrender.com`.

1. Go to the service → **Environment** → set:
   `PUBLIC_URL = https://mission-control-mcp-abcd.onrender.com`
   (no trailing slash, no `/mcp` suffix — the code appends `/mcp` itself)
2. Trigger a redeploy.

### 4. Verify it's alive

```bash
curl https://mission-control-mcp-abcd.onrender.com/health
# → {"ok":true}

curl https://mission-control-mcp-abcd.onrender.com/.well-known/oauth-authorization-server
# → JSON with authorization_endpoint / token_endpoint / etc.
```

### 5. Connect it to Claude

Follow the README's "Connecting it to Claude" section. The URL you paste into
Claude's connector settings is:

```
https://mission-control-mcp-abcd.onrender.com/mcp
```

On first connect, your browser opens a consent page asking for the
`DASHBOARD_PASSWORD` you set in step 2. Enter it. Done.

### 6. Recommended tool permissions in Claude

- Read tools (`list_clients`, `get_client`, `list_runs`, `get_run`,
  `list_approvals`) → **Always allow**
- Write tools (`create_client`, `add_competitor`, `run_competitive_analysis`,
  `launch_workflow`, `decide_approval`, `bulk_decide_approvals`,
  `archive_decided_approvals`, `get_approval_export_link`) → **Ask every time**

You can loosen write permissions later once you trust specific flows.

### Gotchas

- **After any Render redeploy, remove and re-add the connector in Claude.**
  This server keeps registered OAuth clients + tokens in memory (see
  `src/auth/store.ts`), so every redeploy invalidates whatever Claude cached.
  Claude Desktop in particular won't auto-recover from a stale client — it
  silently sits on the old state and refuses to initiate a fresh flow. Fix:
  Settings → Connectors → Mission Control → Remove → fully quit Claude →
  reopen → Add custom connector again.
- **First deploy will crash on missing PUBLIC_URL** if you leave it truly
  blank at Blueprint time. Set it to any placeholder (e.g.
  `https://placeholder.example.com`) so the first deploy boots, then update
  it to the real Render URL and Save Changes to redeploy.
- **`app.set('trust proxy', 1)` is required** for Render (and any PaaS that
  fronts you with a load balancer). Without it, the MCP SDK's rate limiter
  on `/token` crashes with `ERR_ERL_UNEXPECTED_X_FORWARDED_FOR` mid-request,
  which manifests as Claude's browser "Couldn't connect" page after you
  submit the consent password. Already baked into `src/index.ts` in this
  repo, but don't remove it.

## Cost note

Render's free web-service tier spins the container down after 15 min of idle
and takes ~30s to cold-start. That's fine for interactive Claude sessions
(you'll notice a small delay on the first call, everything else is instant).
If you use it heavily and want no cold starts, the Starter plan is $7/mo.

## Rotating credentials later

- **Dashboard password**: change `DASHBOARD_PASSWORD` in Render env, redeploy.
  All existing Claude sessions become invalid; reconnect once.
- **API key**: regenerate `AGENT_API_KEY` in `/app/backend/.env` on the
  Mission Control side, restart backend. Then update `MISSION_CONTROL_API_KEY`
  in Render env and redeploy.
