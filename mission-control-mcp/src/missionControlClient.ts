import { config } from './config.js';

/**
 * Matches the real API, as documented by Mission Control's own GET /api/agent/manifest
 * (public, no auth required). If the manifest ever changes shape, re-fetch it and diff
 * against this file, it's the source of truth, not this comment.
 */

export type ApprovalKind =
  | 'content_brief'
  | 'technical_action'
  | 'page_optimization'
  | 'strategy_doc'
  | 'competitor_insight'
  | 'competitive_deliverable'
  | 'wordpress_draft';

export const EXECUTABLE_APPROVAL_KINDS: ReadonlySet<ApprovalKind> = new Set([
  'technical_action',
  'page_optimization'
]);

export type WorkflowType =
  | 'keyword_research'
  | 'technical_audit'
  | 'competitor_analysis'
  | 'strategy_sprint'
  | 'competitive_deliverable';

export interface Competitor {
  id: string;
  name: string;
  domain: string;
  metrics?: Record<string, unknown>;
}

export interface Client {
  id: string;
  name: string;
  domain: string;
  industry?: string;
  goals?: string;
  target_markets?: string[];
  competitors?: Competitor[];
}

export interface WorkflowRun {
  id: string;
  client_id: string;
  type: WorkflowType;
  status: 'queued' | 'running' | 'completed' | 'failed';
  approvals_pending?: number;
  created_at: string;
}

export interface ApprovalItem {
  id: string;
  client_id: string;
  run_id?: string;
  kind: ApprovalKind;
  status: 'pending' | 'approved' | 'rejected';
  progress?: 'open' | 'in_progress' | 'done' | 'archived';
  content?: unknown;
  artifact_status?: string;
  created_at: string;
}

class MissionControlClient {
  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = new URL(path, config.missionControl.baseUrl);
    const res = await fetch(url, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': config.missionControl.apiKey,
        ...init.headers
      }
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Mission Control API ${res.status} on ${path}: ${body}`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  private query(params: Record<string, string | undefined>): string {
    const qs = new URLSearchParams(
      Object.entries(params).filter(([, v]) => v !== undefined) as [string, string][]
    );
    const s = qs.toString();
    return s ? `?${s}` : '';
  }

  // --- Clients -------------------------------------------------------------

  listClients(): Promise<Client[]> {
    return this.request('/api/clients');
  }

  getClient(clientId: string): Promise<Client> {
    return this.request(`/api/clients/${clientId}`);
  }

  createClient(input: {
    name: string;
    domain: string;
    industry?: string;
    goals?: string;
    target_markets?: string[];
  }): Promise<Client> {
    return this.request('/api/clients', { method: 'POST', body: JSON.stringify(input) });
  }

  addCompetitor(clientId: string, input: { name: string; domain: string }): Promise<Competitor> {
    return this.request(`/api/clients/${clientId}/competitors`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  /**
   * The manifest's recommended one-click path: refreshes Semrush metrics for the client
   * and all competitors, then kicks off the competitive_deliverable workflow. Prefer
   * this over composing launchWorkflow('competitor_analysis') by hand.
   */
  runCompetitiveAnalysis(clientId: string): Promise<{ run_id: string }> {
    return this.request(`/api/clients/${clientId}/competitive-analysis`, { method: 'POST' });
  }

  // --- Workflow runs ---------------------------------------------------------

  launchWorkflow(input: {
    client_id: string;
    type: WorkflowType;
    config?: Record<string, unknown>;
  }): Promise<WorkflowRun> {
    return this.request('/api/runs', { method: 'POST', body: JSON.stringify(input) });
  }

  getRun(runId: string): Promise<WorkflowRun> {
    return this.request(`/api/runs/${runId}`);
  }

  listRuns(params: { client_id?: string } = {}): Promise<WorkflowRun[]> {
    return this.request(`/api/runs${this.query(params)}`);
  }

  // --- Approvals ---------------------------------------------------------

  listApprovals(
    params: { client_id?: string; status?: 'pending' | 'approved' | 'rejected' } = {
      status: 'pending'
    }
  ): Promise<ApprovalItem[]> {
    return this.request(`/api/approvals${this.query(params)}`);
  }

  decideApproval(
    id: string,
    input: { status: 'approved' | 'rejected'; note?: string; edited_content?: string }
  ): Promise<ApprovalItem> {
    return this.request(`/api/approvals/${id}/decision`, {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  bulkDecideApprovals(input: {
    ids: string[];
    status: 'approved' | 'rejected';
    note?: string;
  }): Promise<{ updated: number }> {
    return this.request('/api/approvals/bulk-decision', {
      method: 'POST',
      body: JSON.stringify(input)
    });
  }

  archiveDecidedApprovals(clientId: string): Promise<{ archived: number }> {
    return this.request(`/api/clients/${clientId}/approvals/archive-decided`, {
      method: 'POST'
    });
  }

  // --- Agent orientation ----------------------------------------------------

  /**
   * One-shot orientation call. Returns integrations health, global totals,
   * per-client workload snapshot (pending_approvals, active_runs, last_run),
   * and 10 most recent runs. Replaces 3-4 separate exploratory calls at the
   * start of every session.
   */
  sessionStart(): Promise<{
    server_time: string;
    integrations: Record<string, { configured: boolean }>;
    totals: {
      clients: number;
      pending_approvals: number;
      active_runs: number;
      completed_runs: number;
    };
    clients: Array<{
      id: string;
      name: string;
      domain: string;
      competitors_count: number;
      pending_approvals: number;
      active_runs: number;
      last_run: WorkflowRun | null;
    }>;
    recent_runs: WorkflowRun[];
    hint: string;
  }> {
    return this.request('/api/agent/session-start');
  }

  /** Streams the export directly (used by the /downloads proxy route in index.ts). */
  async fetchApprovalExport(
    id: string,
    format: 'docx' | 'xlsx'
  ): Promise<{ body: ReadableStream<Uint8Array> | null; contentType: string | null }> {
    const url = new URL(`/api/approvals/${id}/export/${format}`, config.missionControl.baseUrl);
    const res = await fetch(url, { headers: { 'X-API-Key': config.missionControl.apiKey } });
    if (!res.ok) {
      throw new Error(`Mission Control API ${res.status} exporting approval ${id} as ${format}`);
    }
    return { body: res.body, contentType: res.headers.get('content-type') };
  }
}

export const missionControl = new MissionControlClient();
