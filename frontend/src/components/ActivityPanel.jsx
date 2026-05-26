import React, { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Activity, ArrowUpRight } from "lucide-react";
import api from "../lib/api";

const AGENT_COLORS = {
  coordinator: "text-sky-400",
  keyword: "text-emerald-400",
  audit: "text-amber-400",
  competitor: "text-rose-400",
  strategy: "text-violet-300", // soft accent only on text
  publisher: "text-zinc-300",
};

const LEVEL_DOT = {
  info: "bg-zinc-500",
  success: "bg-emerald-400",
  warning: "bg-amber-400",
  error: "bg-rose-400",
};

function formatTime(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

export default function ActivityPanel() {
  const [activeRuns, setActiveRuns] = useState([]);
  const [recentLogs, setRecentLogs] = useState([]);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const runs = await api.listActiveRuns();
        if (!mounted) return;
        setActiveRuns(runs);

        // Collect last logs across active runs (or last completed if no active)
        let logs = [];
        if (runs.length > 0) {
          runs.forEach((r) => {
            (r.logs || []).forEach((l) => logs.push({ ...l, run_id: r.id, client_name: r.client_name, run_type: r.type }));
          });
        } else {
          const recent = await api.listRuns();
          recent.slice(0, 3).forEach((r) => {
            (r.logs || []).slice(-5).forEach((l) =>
              logs.push({ ...l, run_id: r.id, client_name: r.client_name, run_type: r.type })
            );
          });
        }
        logs.sort((a, b) => (a.timestamp > b.timestamp ? -1 : 1));
        setRecentLogs(logs.slice(0, 30));
      } catch (e) {
        // silent
      }
    };
    tick();
    const id = setInterval(tick, 2500);
    return () => {
      mounted = false;
      clearInterval(id);
    };
  }, []);

  return (
    <aside
      className="w-80 shrink-0 h-full bg-zinc-950 border-l border-zinc-800 flex flex-col"
      data-testid="activity-panel"
    >
      <div className="px-4 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-emerald-400" />
          <span className="font-heading text-sm font-medium text-zinc-100">Live activity</span>
        </div>
        <span className="text-[10px] font-mono tracking-wider uppercase text-zinc-500">
          {activeRuns.length} active
        </span>
      </div>

      {/* Active runs */}
      <div className="px-4 py-3 border-b border-zinc-800 space-y-2 max-h-64 overflow-y-auto">
        {activeRuns.length === 0 && (
          <div className="text-xs text-zinc-500 py-2">No active runs.</div>
        )}
        {activeRuns.map((r) => (
          <Link
            to={`/runs/${r.id}`}
            key={r.id}
            data-testid={`active-run-${r.id}`}
            className="block px-3 py-2 rounded-sm border border-emerald-400/20 bg-emerald-400/5 hover:bg-emerald-400/10 transition-colors duration-150 trace-active"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono text-emerald-400 uppercase tracking-wider">{r.type.replace("_", " ")}</span>
              <ArrowUpRight size={12} className="text-emerald-400" />
            </div>
            <div className="text-sm text-zinc-100 truncate mt-0.5">{r.client_name || "—"}</div>
            <div className="text-[11px] font-mono text-zinc-500 mt-0.5">status: {r.status}</div>
          </Link>
        ))}
      </div>

      {/* Logs stream */}
      <div className="flex-1 overflow-y-auto px-3 py-3 space-y-1">
        <div className="text-[10px] font-mono tracking-wider uppercase text-zinc-500 px-1 mb-2">Agent log</div>
        {recentLogs.length === 0 && (
          <div className="text-xs text-zinc-500 px-1 py-2">Quiet. Launch a workflow to see agents in action.</div>
        )}
        {recentLogs.map((l) => (
          <div key={l.id} className="flex gap-2 items-start px-1 py-1 text-xs font-mono leading-relaxed">
            <span className={`mt-1.5 h-1.5 w-1.5 rounded-full ${LEVEL_DOT[l.level] || "bg-zinc-500"}`} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-zinc-500">
                <span className={`${AGENT_COLORS[l.agent] || "text-zinc-300"} font-medium`}>{l.agent}</span>
                <span className="text-zinc-600">{formatTime(l.timestamp)}</span>
              </div>
              <div className="text-zinc-300 break-words">{l.message}</div>
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}
