import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, StatusBadge, EmptyState, formatRelative, WorkflowTypeLabel } from "../components/Bits";

export default function History() {
  const [runs, setRuns] = useState([]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const data = await api.listRuns();
        if (mounted) setRuns(data);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 4000);
    return () => { mounted = false; clearInterval(id); };
  }, []);

  return (
    <div data-testid="history-page">
      <PageHeader kicker="Audit trail" title="Run history" description="Every workflow ever launched, across all workspaces." />

      <Section title="All runs" testId="history-section">
        {runs.length === 0 ? (
          <EmptyState testId="empty-history" title="No history yet" description="Launch your first workflow to start the audit log." />
        ) : (
          <div className="rounded-sm border border-zinc-800 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 border-b border-zinc-800">
                <tr className="text-left">
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Workflow</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Client</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Status</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Created</th>
                  <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Completed</th>
                  <th className="px-4 py-2.5"></th>
                </tr>
              </thead>
              <tbody className="bg-zinc-950">
                {runs.map((r) => (
                  <tr key={r.id} className="border-b border-zinc-800/50 last:border-0 hover:bg-zinc-900/60 transition-colors duration-150">
                    <td className="px-4 py-3 text-zinc-100 font-medium"><WorkflowTypeLabel type={r.type} /></td>
                    <td className="px-4 py-3 text-zinc-300">{r.client_name || "—"}</td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{formatRelative(r.created_at)}</td>
                    <td className="px-4 py-3 text-zinc-500 font-mono text-xs">{r.completed_at ? formatRelative(r.completed_at) : "—"}</td>
                    <td className="px-4 py-3 text-right">
                      <Link
                        to={`/runs/${r.id}`}
                        data-testid={`history-open-${r.id}`}
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
    </div>
  );
}
