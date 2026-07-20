import { config } from './config.js';

/**
 * Thin client for SEO Toolkit's autonomous-agent REST API.
 *
 * Source of truth for endpoint shapes: GET /api/agent/manifest on the deployed
 * toolkit (public, no auth). If the manifest changes, re-fetch it and diff
 * against this file.
 *
 * Every request is authenticated with a single `X-API-Key` header. On the
 * toolkit side that key impersonates the workspace owner and bills usage to
 * that account (AGENT_USER_EMAIL env override on the toolkit if needed).
 *
 * Most workflow tools return `{job_id, status, poll}` — the actual result is
 * fetched by polling `GET /api/tools/status/{job_id}` (exposed as the
 * `get_job_status` tool).
 */

export interface Project {
  id: string;
  name?: string;
  type?: 'page_optimizer' | 'recipe_batch' | string;
  [k: string]: unknown;
}

export interface JobKickoff {
  job_id: string;
  status: 'queued' | 'running' | 'completed' | 'failed';
  poll?: string;
  [k: string]: unknown;
}

export interface JobStatus {
  status: 'queued' | 'running' | 'completed' | 'failed';
  progress?: unknown;
  result?: unknown;
  error?: string;
  [k: string]: unknown;
}

class SeoToolkitClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path, config.seoToolkit.baseUrl);
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.seoToolkit.apiKey,
        ...init.headers
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`SEO Toolkit API ${res.status} on ${path}: ${body}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  // --- Orientation ---------------------------------------------------------

  sessionStart(): Promise<Record<string, unknown>> {
    return this.request('/api/agent/session-start');
  }

  // --- Projects (read-only) ------------------------------------------------

  listProjects(): Promise<Project[]> {
    return this.request('/api/projects');
  }

  getProject(projectId: string): Promise<Project> {
    return this.request(`/api/projects/${encodeURIComponent(projectId)}`);
  }

  // --- Job polling ---------------------------------------------------------

  getJobStatus(jobId: string): Promise<JobStatus> {
    return this.request(`/api/tools/status/${encodeURIComponent(jobId)}`);
  }

  // --- Billed workflows ----------------------------------------------------

  generateContentBrief(input: {
    target_keyword: string;
    target_url?: string;
    deep_research?: boolean;
    content_category?: 'recipe' | 'marketing' | 'technical' | 'product' | 'informational';
  }): Promise<JobKickoff> {
    return this.request('/api/tools/content-brief', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  competitorContentGap(input: {
    keywords: Array<{ keyword: string; volume?: number; competitor_url?: string }>;
    client_name?: string;
    competitor?: string;
  }): Promise<JobKickoff> {
    return this.request('/api/tools/content-gap', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  pageSeoAnalysis(input: {
    url: string;
    target_keyword?: string;
    page_type?: string;
  }): Promise<JobKickoff> {
    return this.request('/api/tools/page-analysis', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  pageOptimizer(input: {
    url: string;
    target_keyword: string;
  }): Promise<JobKickoff> {
    return this.request('/api/tools/page-optimizer', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  runRecipePipeline(input: {
    recipe_id: string;
    site_name: string;
  }): Promise<JobKickoff> {
    return this.request('/api/tools/recipe-pipeline', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  /** Synchronous — returns the full cluster analysis, not a job envelope. */
  gscClusterTopics(input: {
    site_url: string;
    period?: '28d' | '3mo' | '6mo' | '1y';
    url_filter?: string;
    row_limit?: number;
  }): Promise<Record<string, unknown>> {
    return this.request('/api/tools/gsc-clusters', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  keywordUrlMap(input: {
    ranked_keywords_csv: string;
    crawl_csv: string;
    fetch_live?: boolean;
    max_pages?: number;
  }): Promise<JobKickoff> {
    return this.request('/api/tools/keyword-url-map', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  createOptimizedArticle(input: { brief_id: string }): Promise<JobKickoff> {
    return this.request('/api/tools/optimized-article', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }
}

export const seoToolkit = new SeoToolkitClient();
