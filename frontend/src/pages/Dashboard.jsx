import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Clock, Sparkles, Workflow as WorkflowIcon, ListChecks, PackageCheck, ArrowRight } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, StatTile, EmptyState, StatusBadge, formatRelative, WorkflowTypeLabel } from "../components/Bits";
import ClientCreateDialog from "../components/ClientCreateDialog";
import { useClients } from "../lib/ClientContext";

export default function Dashboard() {
  const [summary, setSummary] = useState(null);
  const { clients } = useClients();

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const s = await api.dashboardSummary();
        if (mounted) setSummary(s);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  const s = summary || { total_clients: 0, active_runs: 0, completed_runs: 0, pending_approvals: 0, recent_runs: [] };

  return (
    <div data-testid="dashboard-page">
      <PageHeader
        kicker="Operator overview"
        title="Mission control"
        description="A semi-autonomous SEO team working across your client roster. You stay in command."
      >
        <ClientCreateDialog />
      </PageHeader>

      <Section title="Today" description="Live counters across all workspaces" testId="dashboard-stats">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatTile testId="stat-clients" label="Clients" value={s.total_clients} hint="active workspaces" />
          <StatTile testId="stat-active" label="Active runs" value={s.active_runs} tone={s.active_runs > 0 ? "success" : "neutral"} hint="in progress now" />
          <StatTile testId="stat-pending" label="Pending approvals" value={s.pending_approvals} tone={s.pending_approvals > 0 ? "warning" : "neutral"} hint="awaiting your review" />
          <StatTile testId="stat-completed" label="Completed runs" value={s.completed_runs} hint="all-time" />
        </div>
      </Section>

      <Section title="How this works" description="The loop, end-to-end" testId="dashboard-flow">
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5">
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr_auto_1fr] gap-3 items-stretch">
            <FlowStep n={1} icon={WorkflowIcon} title="Launch a workflow" body="Pick keyword research, technical audit, competitor analysis, or strategy sprint." color="text-sky-400" />
            <FlowArrow />
            <FlowStep n={2} icon={Sparkles} title="Agents work" body="Coordinator plans subtasks; specialists run grounded in your GSC, GA, Semrush, DataForSEO, Screaming Frog data." color="text-emerald-400" />
            <FlowArrow />
            <FlowStep n={3} icon={ListChecks} title="Review approvals" body="Each output becomes an item in the approval queue. Approve, edit, or reject." color="text-amber-400" />
            <FlowArrow />
            <FlowStep n={4} icon={PackageCheck} title="Work the deliverables" body="Approved items land in the Deliverables backlog. Move them Open → In progress → Done." color="text-violet-300" />
          </div>
        </div>
      </Section>

      <Section title="Recent runs" description="Latest workflow activity" testId="dashboard-recent-runs">
        {(s.recent_runs || []).length === 0 ? (
          <EmptyState
            testId="empty-runs"
            title="No runs yet"
            description="Create a client workspace and launch your first workflow."
            action={clients.length === 0 ? <ClientCreateDialog triggerLabel="Create first client" /> : null}
          />
        ) : (
          <div className="rounded-sm border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 border-b border-zinc-800">
                <tr className="text-left">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Workflow</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Client</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Created</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody>
                {s.recent_runs.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/60 transition-colors duration-150">
                    <td className="px-4 py-3 text-zinc-200 font-medium"><WorkflowTypeLabel type={r.type} /></td>
                    <td className="px-4 py-3 text-zinc-300">{r.client_name || "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{formatRelative(r.created_at)}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/runs/${r.id}`}
                        data-testid={`open-run-${r.id}`}
                        className="inline-flex items-center gap-1 text-xs text-zinc-400 hover:text-zinc-100"
                      >
                        Open <ArrowUpRight size={12} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      <Section title="Workspaces" description="Switch into any client to launch workflows" testId="dashboard-workspaces">
        {clients.length === 0 ? (
          <EmptyState
            testId="empty-clients"
            title="No clients yet"
            description="Start by creating a workspace for your first client."
            action={<ClientCreateDialog />}
          />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {clients.map((c) => (
              <Link
                key={c.id}
                to={`/clients/${c.id}`}
                data-testid={`workspace-card-${c.id}`}
                className="block rounded-sm border border-zinc-800 bg-zinc-900 p-4 hover:bg-zinc-800/60 transition-colors duration-150"
              >
                <div className="flex items-start justify-between">
                  <div className="min-w-0">
                    <div className="font-heading text-base font-medium text-zinc-50 truncate">{c.name}</div>
                    <div className="font-mono text-xs text-zinc-500 truncate">{c.domain}</div>
                  </div>
                  <ArrowUpRight size={14} className="text-zinc-500 shrink-0" />
                </div>
                <div className="mt-3 flex items-center gap-3 text-[11px] font-mono text-zinc-500">
                  <span className="flex items-center gap-1"><Sparkles size={11} /> {c.industry || "general"}</span>
                  <span className="flex items-center gap-1"><Clock size={11} /> {formatRelative(c.updated_at)}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function FlowStep({ n, icon: Icon, title, body, color }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-4 flex flex-col">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Step 0{n}</span>
        <Icon size={13} className={color} />
      </div>
      <div className="font-heading text-sm font-medium text-zinc-50 mb-1">{title}</div>
      <div className="text-xs text-zinc-400 leading-relaxed">{body}</div>
    </div>
  );
}

function FlowArrow() {
  return (
    <div className="hidden md:flex items-center justify-center text-zinc-700">
      <ArrowRight size={18} />
    </div>
  );
}
