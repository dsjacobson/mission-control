import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { ArrowLeft, CheckCircle2, Loader2, XCircle } from "lucide-react";
import api from "../lib/api";
import { PageHeader, StatusBadge, WorkflowTypeLabel, formatRelative, EmptyState } from "../components/Bits";
import KeywordResults from "../components/results/KeywordResults";
import AuditResults from "../components/results/AuditResults";
import CompetitorResults from "../components/results/CompetitorResults";
import StrategyResults from "../components/results/StrategyResults";

const AGENT_COLORS = {
  coordinator: "text-sky-400",
  keyword: "text-emerald-400",
  audit: "text-amber-400",
  competitor: "text-rose-400",
  strategy: "text-zinc-200",
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
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return "";
  }
}

function StatusIcon({ status }) {
  if (status === "running" || status === "queued") return <Loader2 size={14} className="text-emerald-400 animate-spin" />;
  if (status === "completed") return <CheckCircle2 size={14} className="text-sky-400" />;
  if (status === "failed") return <XCircle size={14} className="text-rose-400" />;
  return null;
}

export default function RunDetails() {
  const { runId } = useParams();
  const [run, setRun] = useState(null);

  useEffect(() => {
    let mounted = true;
    const tick = async () => {
      try {
        const r = await api.getRun(runId);
        if (mounted) setRun(r);
      } catch {}
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => { mounted = false; clearInterval(id); };
  }, [runId]);

  if (!run) {
    return (
      <div className="p-8">
        <EmptyState testId="run-loading" title="Loading run…" />
      </div>
    );
  }

  const renderResults = () => {
    if (!run.results || Object.keys(run.results).length === 0) {
      if (run.status === "running" || run.status === "queued") {
        return (
          <div className="rounded-sm border border-zinc-800 bg-zinc-900 px-5 py-8 text-center" data-testid="results-pending">
            <Loader2 size={20} className="text-emerald-400 animate-spin mx-auto mb-3" />
            <div className="font-heading text-base text-zinc-200">Agents at work</div>
            <div className="text-sm text-zinc-500 mt-1">Results will appear here as soon as they're ready.</div>
          </div>
        );
      }
      return <EmptyState testId="results-empty" title="No results" description="This run produced no results." />;
    }
    if (run.type === "keyword_research") return <KeywordResults results={run.results} />;
    if (run.type === "technical_audit") return <AuditResults results={run.results} />;
    if (run.type === "competitor_analysis") return <CompetitorResults results={run.results} />;
    if (run.type === "strategy_sprint") return <StrategyResults results={run.results} />;
    return null;
  };

  return (
    <div data-testid="run-details-page">
      <PageHeader
        kicker={
          <span className="inline-flex items-center gap-2">
            <Link to={`/clients/${run.client_id}`} className="text-zinc-400 hover:text-zinc-100 inline-flex items-center gap-1">
              <ArrowLeft size={12} /> {run.client_name || "client"}
            </Link>
            <span>·</span>
            <span><WorkflowTypeLabel type={run.type} /></span>
          </span>
        }
        title={`Run · ${run.id.slice(0, 8)}`}
        description={run.objective || "No additional objective."}
      >
        <div className="flex items-center gap-2">
          <StatusIcon status={run.status} />
          <StatusBadge status={run.status} />
        </div>
      </PageHeader>

      <div className="px-8 py-6 grid grid-cols-1 xl:grid-cols-[1fr_320px] gap-6">
        {/* Results */}
        <div className="space-y-6 min-w-0">
          <div className="rounded-sm border border-zinc-800 bg-zinc-900 px-5 py-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Coordinator plan</div>
            {run.plan && run.plan.length > 0 ? (
              <ol className="space-y-1.5">
                {run.plan.map((s, i) => (
                  <li key={i} className="flex gap-2 text-sm text-zinc-300">
                    <span className="text-zinc-500 font-mono w-5">{(i + 1).toString().padStart(2, "0")}</span>
                    <span>{s}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="text-sm text-zinc-500">No plan yet.</div>
            )}
          </div>

          <div className="min-w-0">{renderResults()}</div>
        </div>

        {/* Logs */}
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 self-start sticky top-4" data-testid="run-logs-panel">
          <div className="border-b border-zinc-800 px-4 py-3 flex items-center justify-between">
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Run log</span>
            <span className="text-[10px] font-mono text-zinc-500">{formatRelative(run.created_at)}</span>
          </div>
          <div className="max-h-[640px] overflow-y-auto px-3 py-3 space-y-1">
            {(run.logs || []).length === 0 && <div className="text-xs text-zinc-500 px-1 py-2">Waiting on first log…</div>}
            {(run.logs || []).map((l) => (
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
        </div>
      </div>
    </div>
  );
}
