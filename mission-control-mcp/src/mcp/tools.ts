import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { config } from '../config.js';
import { missionControl, EXECUTABLE_APPROVAL_KINDS } from '../missionControlClient.js';

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

const workflowTypeSchema = z.enum([
  'keyword_research',
  'technical_audit',
  'competitor_analysis',
  'strategy_sprint',
  'competitive_deliverable'
]);

export function registerMissionControlTools(server: McpServer): void {
  // --- Session start ---------------------------------------------------------

  server.registerTool(
    'session_start',
    {
      title: 'Session orientation snapshot',
      description:
        'One-shot orientation call: returns integrations health, per-client workload (pending approvals, active runs, last run), and 10 most recent runs across all clients. Call this once at the start of a session to skip 3-4 exploratory list_* calls. Safe to Always allow.',
      inputSchema: {}
    },
    async () => {
      try {
        return jsonResult(await missionControl.sessionStart());
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Read tools ------------------------------------------------------------

  server.registerTool(
    'list_clients',
    {
      title: 'List clients',
      description: 'List every client workspace in Mission Control.',
      inputSchema: {}
    },
    async () => {
      try {
        return jsonResult(await missionControl.listClients());
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_client',
    {
      title: 'Get client detail',
      description: 'Get one client, including its competitors and current keyword map.',
      inputSchema: { client_id: z.string().describe('Client UUID') }
    },
    async ({ client_id }) => {
      try {
        return jsonResult(await missionControl.getClient(client_id));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'list_runs',
    {
      title: 'List workflow runs',
      description:
        'List workflow runs, optionally filtered by client. A completed run can still have approvals_pending > 0, treat those as awaiting review, not done.',
      inputSchema: { client_id: z.string().optional() }
    },
    async ({ client_id }) => {
      try {
        return jsonResult(await missionControl.listRuns({ client_id }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_run',
    {
      title: 'Get a workflow run',
      description: 'Get the status of a single workflow run.',
      inputSchema: { run_id: z.string() }
    },
    async ({ run_id }) => {
      try {
        return jsonResult(await missionControl.getRun(run_id));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'list_approvals',
    {
      title: 'List approval queue items',
      description:
        'List items in the approval queue. Defaults to pending. "technical_action" and "page_optimization" are executable kinds, approving them auto-runs the fix. Everything else is a reference document.',
      inputSchema: {
        client_id: z.string().optional(),
        status: z.enum(['pending', 'approved', 'rejected']).optional().default('pending')
      }
    },
    async ({ client_id, status }) => {
      try {
        return jsonResult(await missionControl.listApprovals({ client_id, status }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Write tools: clients ------------------------------------------------

  server.registerTool(
    'create_client',
    {
      title: 'Create a client',
      description: 'Add a new client workspace to Mission Control.',
      inputSchema: {
        name: z.string(),
        domain: z.string(),
        industry: z.string().optional(),
        goals: z.string().optional(),
        target_markets: z.array(z.string()).optional()
      }
    },
    async (input) => {
      try {
        return jsonResult(await missionControl.createClient(input));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'add_competitor',
    {
      title: 'Add a competitor',
      description: "Add a competitor to a client's competitor list.",
      inputSchema: { client_id: z.string(), name: z.string(), domain: z.string() }
    },
    async ({ client_id, name, domain }) => {
      try {
        return jsonResult(await missionControl.addCompetitor(client_id, { name, domain }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Write tools: workflows ------------------------------------------------

  server.registerTool(
    'run_competitive_analysis',
    {
      title: 'Run competitive analysis',
      description:
        'The recommended one-click path for competitive analysis: refreshes Semrush metrics for the client and its competitors, then produces a competitive_deliverable approval. Prefer this over launch_workflow for competitor_analysis. Semrush calls cost real money, do not run this more than once a day per client.',
      inputSchema: { client_id: z.string() }
    },
    async ({ client_id }) => {
      try {
        return jsonResult(await missionControl.runCompetitiveAnalysis(client_id));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'launch_workflow',
    {
      title: 'Launch a workflow',
      description:
        'Launch a workflow run for a client: keyword_research, technical_audit, strategy_sprint, or competitive_deliverable. For competitor_analysis specifically, use run_competitive_analysis instead, it is the endpoint Mission Control recommends.',
      inputSchema: {
        client_id: z.string(),
        type: workflowTypeSchema,
        config: z.record(z.string(), z.unknown()).optional()
      }
    },
    async ({ client_id, type, config: workflowConfig }) => {
      try {
        return jsonResult(
          await missionControl.launchWorkflow({ client_id, type, config: workflowConfig })
        );
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  // --- Write tools: approvals ------------------------------------------------

  server.registerTool(
    'decide_approval',
    {
      title: 'Approve or reject an approval item',
      description:
        'Decide a single approval item. Approving "technical_action" or "page_optimization" auto-executes the fix on the live page, everything else just files the document. Never approve an executable kind unless the user has explicitly said to for this item, or given a standing rule that covers it (e.g. "auto-approve meta rewrites with impact <= 3"). When unsure, leave it pending and summarize it instead.',
      inputSchema: {
        id: z.string().describe('Approval item id'),
        status: z.enum(['approved', 'rejected']),
        note: z.string().optional().describe('Reason, especially useful on reject'),
        edited_content: z
          .string()
          .optional()
          .describe('Replacement content, if editing before approving')
      }
    },
    async ({ id, status, note, edited_content }) => {
      try {
        const result = await missionControl.decideApproval(id, { status, note, edited_content });
        const warning =
          status === 'approved' && EXECUTABLE_APPROVAL_KINDS.has(result.kind)
            ? ` This kind (${result.kind}) auto-executes on approval, poll get_run or list_approvals to confirm artifact_status reaches "ready".`
            : '';
        return jsonResult({ ...result, note: warning || undefined });
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'bulk_decide_approvals',
    {
      title: 'Approve or reject several approval items at once',
      description:
        'Batch version of decide_approval. Same executable-kind caution applies, do not use this to bulk-approve technical_action or page_optimization items without explicit user sign-off on that batch.',
      inputSchema: {
        ids: z.array(z.string()),
        status: z.enum(['approved', 'rejected']),
        note: z.string().optional()
      }
    },
    async ({ ids, status, note }) => {
      try {
        return jsonResult(await missionControl.bulkDecideApprovals({ ids, status, note }));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'archive_decided_approvals',
    {
      title: 'Archive decided approvals',
      description: 'Archive all already-decided (approved or rejected) approvals for a client, tidying the queue.',
      inputSchema: { client_id: z.string() }
    },
    async ({ client_id }) => {
      try {
        return jsonResult(await missionControl.archiveDecidedApprovals(client_id));
      } catch (error) {
        return errorResult(error);
      }
    }
  );

  server.registerTool(
    'get_approval_export_link',
    {
      title: 'Get a download link for an approved deliverable',
      description:
        'Returns a link to download an approved item as .docx or .xlsx, for client hand-off. The link is served by this connector (not Mission Control directly) and only works with a valid session.',
      inputSchema: { id: z.string(), format: z.enum(['docx', 'xlsx']) }
    },
    async ({ id, format }) => {
      const url = new URL(`/downloads/${id}/${format}`, config.publicUrl);
      return jsonResult({ url: url.href });
    }
  );

  // --- Workers & Tasks ------------------------------------------------------

  server.registerTool(
    'list_workers',
    {
      title: 'List workers (humans + agents)',
      description:
        'Returns the roster of people and agents who can be assigned tasks. Includes id, name, type (human|agent), email, active. The seeded "Claude Cowork" worker (id: "claude-cowork") is always present. Safe to Always allow.',
      inputSchema: { active_only: z.boolean().optional().describe('Default true; set false to include deactivated workers.') }
    },
    async ({ active_only }) => {
      try {
        return jsonResult(await missionControl.listWorkers(active_only ?? true));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'create_worker',
    {
      title: 'Add a worker (human or agent)',
      description:
        'Registers a new worker who can be assigned tasks. For humans, include email so future notification digests can reach them. Safe to always allow — worker rows are cheap and reversible.',
      inputSchema: {
        name: z.string(),
        type: z.enum(['human', 'agent']),
        email: z.string().optional().describe('Required for humans if you want them to receive email digests.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await missionControl.createWorker(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'list_tasks',
    {
      title: 'List tasks — the assignee queue',
      description:
        'The primary way an assignee finds their work. Filter by any combination of client_id, assignee_id, status, and due_before (ISO datetime). Common queries: get everything due today for a specific assignee, or all in-progress work across a client. Read-only; safe to always allow.',
      inputSchema: {
        client_id: z.string().optional(),
        assignee_id: z.string().optional().describe('Worker id (e.g. "claude-cowork" for yourself).'),
        status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
        due_before: z
          .string()
          .optional()
          .describe('ISO datetime. Returns tasks with due_at <= this. Use `new Date().toISOString()` for "due now".')
      }
    },
    async (args) => {
      try {
        return jsonResult(await missionControl.listTasks(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'get_task',
    {
      title: 'Get one task',
      description: 'Fetch full detail (including notes history) for a single task. Read-only.',
      inputSchema: { task_id: z.string() }
    },
    async ({ task_id }) => {
      try {
        return jsonResult(await missionControl.getTask(task_id));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'create_task',
    {
      title: 'Create a task with instructions + optional recurrence',
      description:
        'Creates a work item under a client, optionally assigned to a worker and optionally recurring (daily|weekly). For recurring tasks with no due_at set, defaults to "today". Tasks do NOT bypass the approval queue — if the resulting work produces something that would need approval (page edits, published deliverables), that still lands in approvals.',
      inputSchema: {
        client_id: z.string(),
        title: z.string(),
        instructions: z.string().optional().describe('The brief for whoever picks it up.'),
        assignee_id: z.string().optional().describe('Worker id from list_workers.'),
        recurrence: z.enum(['none', 'daily', 'weekly']).optional().describe('Default none.'),
        due_at: z
          .string()
          .optional()
          .describe('ISO datetime. Optional; recurring tasks default to today if omitted.')
      }
    },
    async (args) => {
      try {
        return jsonResult(await missionControl.createTask(args));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'update_task',
    {
      title: 'Update task status / assignee / notes',
      description:
        'For status changes (in_progress, blocked), reassignment, or appending a note. Use complete_task instead for finishing work. notes_append is timestamped and appended to existing notes (never overwrites).',
      inputSchema: {
        task_id: z.string(),
        status: z.enum(['open', 'in_progress', 'done', 'blocked']).optional(),
        assignee_id: z.string().optional(),
        title: z.string().optional(),
        instructions: z.string().optional(),
        recurrence: z.enum(['none', 'daily', 'weekly']).optional(),
        due_at: z.string().optional(),
        notes_append: z.string().optional().describe('Timestamped and appended to task.notes.')
      }
    },
    async ({ task_id, ...rest }) => {
      try {
        return jsonResult(await missionControl.updateTask(task_id, rest));
      } catch (e) {
        return errorResult(e);
      }
    }
  );

  server.registerTool(
    'complete_task',
    {
      title: 'Mark task complete (advances recurrence)',
      description:
        'For non-recurring tasks: sets status="done". For recurring tasks: keeps status="open" and advances due_at by +1 day (daily) or +7 days (weekly), so you don\'t need to create a new row every day. Optional notes are timestamped and appended.',
      inputSchema: {
        task_id: z.string(),
        notes: z.string().optional().describe('Wrap-up note appended to the task.')
      }
    },
    async ({ task_id, notes }) => {
      try {
        return jsonResult(await missionControl.completeTask(task_id, notes));
      } catch (e) {
        return errorResult(e);
      }
    }
  );
}
