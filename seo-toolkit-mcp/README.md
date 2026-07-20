# seo-toolkit-mcp

Remote MCP server that exposes **SEO Toolkit** to Claude Desktop / Claude Code
via OAuth 2.1. Same pattern as `mission-control-mcp` in the sibling folder —
this is essentially the same connector with different tools and a different
upstream base URL.

## Tools this exposes

Read (safe to set to **Always allow**):
- `session_start` — one-shot orientation: integrations health, projects, recent analyses
- `list_projects`, `get_project` — Page Optimizer projects and Recipe Pipeline batches
- `get_job_status` — polls async job status

Billed but user-opted-into always-allow:
- `generate_content_brief`, `page_optimizer`, `run_recipe_pipeline`,
  `create_optimized_article`, `gsc_cluster_topics`

Ask every time (billed + destructive/expensive):
- `competitor_content_gap` — needs a curated keyword export, don't run twice by mistake
- `page_seo_analysis` — expensive multi-step audit
- `keyword_url_map` — requires two large CSV pastes, easy to double-charge

You can loosen or tighten these in Claude Desktop's connector settings after
connecting.

## Architecture

Same as `mission-control-mcp`:
- Express server on port 3300
- OAuth 2.1 + PKCE + dynamic client registration
- Password-gated consent (`DASHBOARD_PASSWORD`)
- Stateless-per-request MCP transport with JSON responses (proxy-friendly)
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
| `PUBLIC_URL` | External HTTPS URL of this server (e.g. Render URL) |
| `DASHBOARD_PASSWORD` | Password shown on the consent page when Claude connects |
| `SEO_TOOLKIT_API_BASE_URL` | Base URL of the SEO Toolkit app (e.g. `https://seo-toolkit.emerald.consulting`) |
| `SEO_TOOLKIT_API_KEY` | The `AGENT_API_KEY` from SEO Toolkit's `backend/.env` |

## Deployment

See `DEPLOY.md` for the Render Blueprint walkthrough. The pattern is identical
to `mission-control-mcp`.
