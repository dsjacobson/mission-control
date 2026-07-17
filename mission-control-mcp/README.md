# Mission Control MCP Server

Wraps Mission Control's API as a remote MCP server, so Claude Cowork and Claude Code can
call it directly: list pending approvals, check workflow runs, move deliverables, launch
new workflows.

## Why this instead of pasting the key into Cowork's Global Instructions

Emergent's bootstrap doc suggests pasting the base URL and `X-API-Key` straight into
Cowork's Global Instructions (Settings → Cowork → Edit Global Instructions) and letting
Cowork curl the API itself. That works, Cowork can run shell commands, but it means the
key sits in plaintext in your settings indefinitely, and the "don't auto-approve
executable actions" rule is enforced only by Cowork reading and following text
instructions, not by anything technical.

This connector gets you the same access with two differences: the key lives only in this
server's `.env`, never in a Claude prompt or settings field, and you get Claude's actual
per-tool permission system (Always allow / Ask every time) as a real gate on the write
tools, on top of the instruction-level caution already built into their descriptions.

**Security note:** the API key you got from Emergent was pasted in plaintext into a chat
at some point in the process, treat it as seen. Once this is wired up and working, it's
worth regenerating `AGENT_API_KEY` on the Mission Control side so the one that's floating
around in chat history stops being valid.

## How the auth is split

Two separate auth layers, don't conflate them:

1. **Claude ↔ this server**: OAuth 2.1 with PKCE and Dynamic Client Registration, the
   standard Claude expects from any remote connector. This server acts as its own
   authorization server. The only gate is the `DASHBOARD_PASSWORD` you set below, shown
   on a consent screen the first time Claude connects.
2. **This server ↔ Mission Control**: a single stored API key (`MISSION_CONTROL_API_KEY`).
   Since this is a personal tool with one user, there's no need to map individual Claude
   sessions to individual Mission Control accounts, every authenticated request just uses
   your key.

Tokens and OAuth client registrations are stored in memory. That's fine for one
long-running process; see the comment in `src/auth/store.ts` if you ever need to run more
than one instance.

## The API this talks to

`src/missionControlClient.ts` is written against the real Mission Control API, as
documented by its own `GET /api/agent/manifest` (public, no key needed, worth re-reading
if the API ever changes). Auth is a single header: `X-API-Key: <MISSION_CONTROL_API_KEY>`.

Key things the manifest calls out that shaped the tool design:

- **Executable vs reference approvals.** `technical_action` and `page_optimization`
  auto-run their fix the moment they're approved (they edit live pages). Everything else
  (`competitive_deliverable`, `strategy_doc`, `competitor_insight`, `content_brief`,
  `wordpress_draft`) just files a document. `decide_approval` and `bulk_decide_approvals`
  carry an explicit warning about this in their tool descriptions.
- **Prefer high-level endpoints.** `run_competitive_analysis` wraps Mission Control's own
  one-click `POST /api/clients/{id}/competitive-analysis`, which refreshes Semrush data
  and kicks off the deliverable in one call. Use it instead of composing
  `launch_workflow` with `type: competitor_analysis` by hand.
- **Cost awareness.** Semrush and DataForSEO calls cost real money. Don't run
  `run_competitive_analysis` for the same client more than once a day.
- **Some flows can't be scripted at all**: Google OAuth for Search Console/Analytics,
  the Screaming Frog local bridge, and first-time Semrush MCP key entry all need an
  interactive browser session. This connector doesn't attempt them.

Full endpoint reference, including request/response shapes: `GET /openapi.json` on the
same domain, or `/docs` for interactive Swagger UI.

## Local setup

```bash
npm install
cp .env.example .env   # fill in the values
npm run build
npm start
```

Visit `http://localhost:3300/health` to confirm it's up.

## Deploying

This needs to be reachable over the public internet with a real HTTPS certificate,
Claude's remote MCP client connects from Anthropic's cloud, not from your machine, so
`localhost` only works for local testing.

One more thing from Emergent's own notes: the current `seo-agent-hub-3.preview.emergentagent.com`
URL is tied to this preview session and will break if the workspace closes or restarts.
Before relying on this daily, use Emergent's Deploy button to get a stable production URL,
then update `MISSION_CONTROL_API_BASE_URL` (and `PUBLIC_URL`, if this ends up hosted at the
same domain) to match.

Given Mission Control is already live on Emergent, the simplest path is folding this in
as a route inside that same app (e.g. serve it at `/mcp-connector`) rather than standing
up a second deployment. That gets you HTTPS, a stable domain, and one thing to maintain
instead of two. Hand this whole folder to your Emergent connector in Cowork and ask it to
mount these routes inside the existing app. If you'd rather keep it standalone, any
Node host works (Render, Railway, Fly.io, etc.), just make sure `PUBLIC_URL` matches
wherever it actually ends up.

## Connecting it to Claude

1. In Claude, go to **Settings → Connectors → Add custom connector**.
2. Name: `Mission Control`. URL: your `PUBLIC_URL` + `/mcp` (e.g.
   `https://your-domain/mcp-connector/mcp`).
3. Leave OAuth Client ID/Secret blank, this server handles Dynamic Client Registration
   itself.
4. Click **Connect**. Your browser opens the consent screen, enter your
   `DASHBOARD_PASSWORD`, and you're in.
5. In the connector's tool permissions, set the read tools (`list_clients`,
   `list_approvals`, `list_deliverables`, `list_runs`) to **Always allow**. Leave the
   write tools (`launch_workflow`, `update_approval`, `update_deliverable`) on **Ask
   every time** to start, given you want an approval gate before anything publishes.
   You can loosen that later once you trust the flow.

## Tools this exposes

Read (safe to set to **Always allow**):
- `list_clients`, `get_client` — client workspaces
- `list_runs`, `get_run` — workflow run status
- `list_approvals` — the approval queue

Write (leave on **Ask every time** until you trust the flow):
- `create_client`, `add_competitor`
- `run_competitive_analysis`, `launch_workflow`
- `decide_approval`, `bulk_decide_approvals` — the two that matter most: approving a
  `technical_action` or `page_optimization` item auto-executes it on the live page
- `archive_decided_approvals`
- `get_approval_export_link` — hands back a `/downloads/{id}/{format}` link on this
  server (proxied, so your Mission Control key never leaves this process)

## Extending this

To add a new tool, add a method to `missionControlClient.ts` (or wire it to whatever the
real endpoint ends up being) and register a matching tool in `src/mcp/tools.ts`. Nothing
in the auth layer needs to change.
