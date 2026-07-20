import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { seoToolkit } from '../seoToolkitClient.js';

function jsonResult(data: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }]
  };
}

function errorResult(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    content: [{ type: 'text' as const, text: `Error: ${message}` }],
    isError: true
  };
}

export function registerSeoToolkitTools(server: McpServer): void {
  // --- Orientation ---------------------------------------------------------

  server.registerTool(
    'session_start',
    {
      title: 'Session orientation snapshot',
      description:
        'One-shot orientation call for SEO Toolkit: integrations health, ' +
        'recent projects, recent analyses. Call at the start of every session ' +
        'so you know what exists before doing anything. Safe to Always allow.',
      inputSchema: {}
    },
    async () => {
      try {
        return jsonResult(await seoToolkit.sessionStart());
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Projects (read) -----------------------------------------------------

  server.registerTool(
    'list_projects',
    {
      title: 'List projects',
      description:
        'Unified list of Page Optimizer projects and Recipe Pipeline batches. ' +
        'Read-only, free.',
      inputSchema: {}
    },
    async () => {
      try {
        return jsonResult(await seoToolkit.listProjects());
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'get_project',
    {
      title: 'Get project detail',
      description: 'Fetch a single Page Optimizer project or Recipe Pipeline batch by id. Free.',
      inputSchema: {
        project_id: z.string().describe('Project or batch id.')
      }
    },
    async ({ project_id }) => {
      try {
        return jsonResult(await seoToolkit.getProject(project_id));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Async job polling ---------------------------------------------------

  server.registerTool(
    'get_job_status',
    {
      title: 'Poll async job status',
      description:
        'Fetch the status of an async tool job (returned by billed tools as ' +
        '{job_id, status, poll}). Status is one of queued|running|completed|failed. ' +
        'When completed, the `result` field contains the full output. Cheap and free. ' +
        'Recommended cadence: 10–20s between polls.',
      inputSchema: {
        job_id: z.string().describe('The job_id returned by a billed tool.')
      }
    },
    async ({ job_id }) => {
      try {
        return jsonResult(await seoToolkit.getJobStatus(job_id));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  // --- Billed workflows ----------------------------------------------------
  // All of these kick off async jobs and return {job_id, status, poll}.
  // Follow up with get_job_status to fetch the result.

  server.registerTool(
    'generate_content_brief',
    {
      title: 'Generate content brief (billed)',
      description:
        'Generates an SEO content brief for a target keyword. Set target_url to ' +
        'audit/refresh an existing page. Returns {job_id, status, poll} — use ' +
        'get_job_status to fetch the final brief (title suggestions, outline, ' +
        'entities, internal links). BILLED — costs LLM credits on the workspace ' +
        'owner\'s account.',
      inputSchema: {
        target_keyword: z.string().describe('Primary keyword the brief will target.'),
        target_url: z
          .string()
          .optional()
          .describe('Optional existing page URL to audit/refresh instead of green-fielding.'),
        deep_research: z
          .boolean()
          .optional()
          .describe('If true, runs the slower/richer research pipeline. Default false.'),
        content_category: z
          .enum(['recipe', 'marketing', 'technical', 'product', 'informational'])
          .optional()
          .describe('Content category hint that steers the outline shape.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.generateContentBrief(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'competitor_content_gap',
    {
      title: 'Competitor content gap analysis (billed)',
      description:
        'Pillar/cluster gap analysis from a competitor keyword export. Provide at ' +
        'least ~10 rows of {keyword, volume?, competitor_url?}. Returns ' +
        '{job_id, status, poll} — poll with get_job_status. BILLED.',
      inputSchema: {
        keywords: z
          .array(
            z.object({
              keyword: z.string(),
              volume: z.number().optional(),
              competitor_url: z.string().optional()
            })
          )
          .describe('Rows from a competitor keyword export (SEMrush/Ahrefs). ≥10 rows recommended.'),
        client_name: z.string().optional().describe('Client/project label for the report.'),
        competitor: z.string().optional().describe('Competitor domain label (e.g. competitor.com).')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.competitorContentGap(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'page_seo_analysis',
    {
      title: 'Page-level SEO analysis (billed)',
      description:
        'Runs a full SEO audit on a URL (title/meta/H1/schema/word-count/issues). ' +
        'Returns {job_id, status, poll} — poll with get_job_status. BILLED.',
      inputSchema: {
        url: z.string().describe('Absolute URL of the page to analyze.'),
        target_keyword: z.string().optional().describe('Primary keyword to score the page against.'),
        page_type: z
          .string()
          .optional()
          .describe('Page type hint (default "homepage"). E.g. blog_post, product, category.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.pageSeoAnalysis(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'page_optimizer',
    {
      title: 'Page optimizer — chained (billed, 2–6 min)',
      description:
        'Runs the full optimizer chain (analyze → project → intelligence → optimize) ' +
        'for a URL against a target keyword. Returns {job_id, status, poll}. ' +
        'This is a long-running job (2–6 minutes) — poll every 15–20s. Final ' +
        'result is a prioritized list of field-level optimization suggestions. BILLED.',
      inputSchema: {
        url: z.string().describe('Absolute URL of the page to optimize.'),
        target_keyword: z.string().describe('Primary keyword the page should rank for.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.pageOptimizer(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'run_recipe_pipeline',
    {
      title: 'Run recipe pipeline (billed)',
      description:
        'Creates a 1-recipe production batch. Requires an existing scraped ' +
        'recipe_id and target site_name. Returns {job_id, status, poll}. ' +
        'Downstream steps (keywords → brief → article → images → publish) are ' +
        'triggered from the UI or per-step endpoints, not this tool. BILLED.',
      inputSchema: {
        recipe_id: z.string().describe('An existing scraped recipe id.'),
        site_name: z.string().describe('The target site to publish to.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.runRecipePipeline(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'gsc_cluster_topics',
    {
      title: 'GSC cluster query topics (billed, synchronous)',
      description:
        'Groups Google Search Console queries into topic clusters with ' +
        'clicks/impressions deltas. Requires the workspace owner\'s GSC connection. ' +
        'SYNCHRONOUS — returns the full analysis directly (no polling needed). BILLED.',
      inputSchema: {
        site_url: z
          .string()
          .describe('GSC property, e.g. "sc-domain:example.com" or "https://example.com/".'),
        period: z
          .enum(['28d', '3mo', '6mo', '1y'])
          .optional()
          .describe('Time window. Default 28d.'),
        url_filter: z.string().optional().describe('Optional path filter (e.g. "/blog/").'),
        row_limit: z.number().int().optional().describe('Max rows to fetch. Default 5000.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.gscClusterTopics(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'keyword_url_map',
    {
      title: 'Primary keyword → URL map (billed)',
      description:
        'Maps primary/supporting/semantic keywords to canonical URLs by joining ' +
        'a rankings export (SEMrush/Ahrefs CSV) with a Screaming Frog crawl CSV. ' +
        'Both CSVs must be raw text — paste the full file content. Returns ' +
        '{job_id, status, poll}. BILLED.',
      inputSchema: {
        ranked_keywords_csv: z
          .string()
          .describe('Raw CSV text from a SEMrush or Ahrefs ranking export.'),
        crawl_csv: z.string().describe('Raw CSV text from a Screaming Frog crawl export.'),
        fetch_live: z
          .boolean()
          .optional()
          .describe('If true, re-fetches pages live instead of trusting the crawl. Default false.'),
        max_pages: z.number().int().optional().describe('Max pages to consider. Default 50.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await seoToolkit.keywordUrlMap(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'create_optimized_article',
    {
      title: 'Create optimized article from brief (billed)',
      description:
        'Rewrites/creates a brief-aligned article from a completed content brief. ' +
        'The brief must have been generated with target_url set (i.e. it already ' +
        'has a page to rewrite). Returns {job_id, status, poll}. BILLED.',
      inputSchema: {
        brief_id: z
          .string()
          .describe('A completed content brief id (from generate_content_brief with target_url).')
      }
    },
    async ({ brief_id }) => {
      try {
        return jsonResult(await seoToolkit.createOptimizedArticle({ brief_id }));
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
