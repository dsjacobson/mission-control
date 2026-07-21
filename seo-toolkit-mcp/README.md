# seo-toolkit-mcp

Remote MCP server that exposes **SEO Toolkit** to Claude Desktop / Claude Code
via OAuth 2.1. Same pattern as `mission-control-mcp` in the sibling folder —
this is essentially the same connector with a different upstream base URL.

## Tools this exposes

**Manifest-driven** — this connector no longer hardcodes a tool list. On every
`tools/list` request it fetches the live tool catalog from the SEO Toolkit at:

```
GET {SEO_TOOLKIT_API_BASE_URL}/api/agent/manifest?format=mcp
```

Whatever tools the toolkit publishes there (name, description, JSON Schema,
`x_endpoint` for dispatch, `x_cost` hint) are what Claude sees. Add a tool on
the toolkit side → it shows up in the next Claude session automatically. No
redeploy of this connector required.

Current inventory (19 tools as of the last check): `session_start`,
`list_projects`, `get_project`, `browse_recipes`, `list_project_items`,
`get_job_status`, `generate_content_brief`, `competitor_content_gap`,
`page_seo_analysis`, `page_optimizer`, `run_recipe_pipeline`,
`recipe_keyword_step`, `recipe_brief_step`, `recipe_article_step`,
`recipe_image_step`, `recipe_advance`, `gsc_cluster_topics`, `keyword_url_map`,
`create_optimized_article`.

Descriptions distinguish free vs billed tools with a `[BILLED — get approval]`
prefix; Claude Desktop's permission UI is the right place to pick which ones
are `Always allow` vs `Ask every time`.

## Architecture

Same as `mission-control-mcp`:
- Express server on port 3300
- OAuth 2.1 + PKCE + dynamic client registration
- Password-gated consent (`DASHBOARD_PASSWORD`)
- Stateless-per-request MCP transport with JSON responses (proxy-friendly)
- Uses the **low-level `Server` SDK** (not `McpServer`) so it can register
  tools straight from JSON Schema without a Zod round-trip.
- Manifest is cached in-process for 5 minutes with a **stale-if-error**
  fallback — a transient toolkit hiccup will never blank the tool list
  mid-Claude-session.
- All requests to SEO Toolkit's `/api/*` are authenticated with a single
  `X-API-Key` header. On the toolkit side that key impersonates the workspace
  owner and bills usage to that account.

## Async tool pattern

Most SEO Toolkit workflows are long-running (up to 6 minutes for
`page_optimizer`). Tools return `{job_id, status, poll}` immediately. Claude
then polls `get_job_status(job_id)` on its own schedule (recommended: every
10-20s) until `status === 'completed'`, then reads `result`.

`gsc_cluster_topics` is the only synchronous billed tool — it returns the
full analysis directly.

## Environment variables

| Variable | Value |
|---|---|
| `PORT` | 3300 (default) |
| `PUBLIC_URL` | External HTTPS URL of this server (e.g. Render URL). Falls back to `RENDER_EXTERNAL_URL` on Render. |
| `DASHBOARD_PASSWORD` | Password shown on the consent page when Claude connects |
| `SEO_TOOLKIT_API_BASE_URL` | Base URL of the SEO Toolkit app (e.g. `https://seo-toolkit.emerald.consulting`) |
| `SEO_TOOLKIT_API_KEY` | The `AGENT_API_KEY` from SEO Toolkit's `backend/.env` |

## Deployment

See `DEPLOY.md` for the Render walkthrough. The pattern is identical to
`mission-control-mcp` — commit + push, Render redeploys, restart Claude.
