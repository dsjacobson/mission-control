import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  CheckCircle2, Circle, PlayCircle, Pencil, Wrench, FileText, Telescope, Lightbulb, ListTodo,
} from "lucide-react";
import axios from "axios";
import { API } from "../lib/api";
import PageOptimizationCard from "../components/PageOptimizationCard";
import { Toaster } from "../components/ui/sonner";

const ax = axios.create({ baseURL: API });

const KIND_ICON = {
  content_brief: FileText,
  technical_action: Wrench,
  page_optimization: Pencil,
  strategy_doc: Lightbulb,
  competitor_insight: Telescope,
};
const KIND_LABEL = {
  content_brief: "Content brief",
  technical_action: "Technical fix",
  page_optimization: "Page optimization",
  strategy_doc: "Strategy",
  competitor_insight: "Competitor insight",
};
const PROGRESS = {
  open: { label: "Open", icon: Circle, color: "text-zinc-400" },
  in_progress: { label: "In progress", icon: PlayCircle, color: "text-amber-400" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-400" },
};

function formatDate(iso) {
  if (!iso) return "";
  try { return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" }); } catch { return ""; }
}

export default function SharePage() {
  const { token } = useParams();
  const [state, setState] = useState({ loading: true, error: null, data: null });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await ax.get(`/share/${token}/tasks`);
        if (mounted) setState({ loading: false, error: null, data: r.data });
      } catch (e) {
        if (mounted) setState({ loading: false, error: e?.response?.status === 404 ? "Share link invalid or expired" : "Failed to load tasks", data: null });
      }
    };
    load();
    return () => { mounted = false; };
  }, [token]);

  if (state.loading) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center">
        <div className="text-zinc-500 text-sm font-mono">Loading…</div>
      </div>
    );
  }

  if (state.error) {
    return (
      <div className="min-h-screen bg-zinc-950 text-zinc-100 grid place-items-center px-6">
        <div className="text-center max-w-md">
          <div className="font-heading text-xl text-zinc-100 mb-2">Link not available</div>
          <div className="text-sm text-zinc-500">{state.error}</div>
        </div>
      </div>
    );
  }

  const { client, counters, tasks } = state.data;
  const grouped = {};
  for (const t of tasks) {
    const k = t.kind || "other";
    (grouped[k] ||= []).push(t);
  }

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100">
      {/* Header */}
      <header className="border-b border-zinc-800 bg-zinc-950">
        <div className="max-w-4xl mx-auto px-6 py-8">
          <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-500 mb-2">SEO Action plan</div>
          <h1 className="font-heading text-3xl md:text-4xl font-semibold tracking-tight text-zinc-50">
            {client?.name}
          </h1>
          <div className="font-mono text-sm text-zinc-500 mt-1">{client?.domain}</div>
        </div>
      </header>

      {/* Counters */}
      <section className="border-b border-zinc-800">
        <div className="max-w-4xl mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-3">
          <Stat label="Total" value={counters.total || 0} />
          <Stat label="Open" value={counters.open || 0} />
          <Stat label="In progress" value={counters.in_progress || 0} tone="text-amber-400" />
          <Stat label="Done" value={counters.done || 0} tone="text-emerald-400" />
        </div>
      </section>

      {/* Tasks */}
      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        {tasks.length === 0 && (
          <div className="rounded-sm border border-dashed border-zinc-800 bg-zinc-950 py-16 text-center">
            <ListTodo size={28} className="text-zinc-700 mx-auto mb-3" />
            <div className="font-heading text-lg text-zinc-300">Nothing here yet</div>
            <div className="text-sm text-zinc-500 mt-1">Your SEO team is preparing your action plan.</div>
          </div>
        )}

        {Object.entries(grouped).map(([kind, items]) => {
          const Icon = KIND_ICON[kind] || ListTodo;
          return (
            <section key={kind}>
              <div className="flex items-center gap-2 mb-3">
                <Icon size={14} className="text-zinc-400" />
                <h2 className="font-heading text-base font-medium text-zinc-100">
                  {KIND_LABEL[kind] || kind}
                </h2>
                <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
                  {items.length}
                </span>
              </div>
              <div className="space-y-2">
                {items.map((t) => (
                  <ShareTask key={t.id} task={t} />
                ))}
              </div>
            </section>
          );
        })}

        <footer className="pt-6 mt-12 border-t border-zinc-800 text-center">
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-zinc-600">
            Read-only · prepared by your SEO team
          </div>
        </footer>
      </main>
      <Toaster position="top-right" theme="dark" />
    </div>
  );
}

function Stat({ label, value, tone = "text-zinc-50" }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 px-4 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-heading text-2xl font-semibold ${tone}`}>{value}</div>
    </div>
  );
}

function ShareTask({ task }) {
  const progress = task.progress || "open";
  const p = PROGRESS[progress] || PROGRESS.open;
  const PIcon = p.icon;
  const done = progress === "done";
  return (
    <div className={`rounded-sm border ${done ? "border-emerald-400/20 bg-emerald-400/5" : "border-zinc-800 bg-zinc-900"} p-4`}>
      <div className="flex items-start gap-3">
        <PIcon size={18} className={`${p.color} shrink-0 mt-0.5`} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <span className={`text-[10px] font-mono uppercase tracking-wider ${p.color}`}>{p.label}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-[10px] font-mono text-zinc-500">{formatDate(task.decided_at)}</span>
          </div>
          <div className={`font-heading text-sm font-medium ${done ? "text-zinc-400 line-through" : "text-zinc-50"}`}>
            {task.title}
          </div>
          {task.summary && <div className="text-xs text-zinc-500 mt-1">{task.summary}</div>}
      {/* Agent artifact (the actual work product) takes priority when present */}
      {task.artifact?.kind === "page_fixes" && Array.isArray(task.artifact.pages) && (
        <div className="mt-3 space-y-3">
          {task.artifact.pages.map((p, i) => (
            <PageOptimizationCard key={i} content={p} />
          ))}
        </div>
      )}
      {!task.artifact && task.kind === "page_optimization" && (
        <div className="mt-3">
          <PageOptimizationCard content={task.content} />
        </div>
      )}
          {task.kind === "technical_action" && task.content?.recommended_fix && (
            <div className="mt-2 text-xs text-emerald-400 leading-relaxed">
              <span className="font-mono uppercase tracking-wider text-[10px] text-emerald-500/80">Fix · </span>
              {task.content.recommended_fix}
            </div>
          )}
          {task.kind === "content_brief" && task.content && (
            <div className="mt-2 text-xs space-y-1">
              {task.content.primary_keyword && (
                <div className="text-zinc-400">
                  Primary keyword: <span className="text-zinc-100 font-mono">{task.content.primary_keyword}</span>
                </div>
              )}
              {Array.isArray(task.content.outline) && task.content.outline.length > 0 && (
                <ul className="mt-1 space-y-0.5">
                  {task.content.outline.map((o, i) => (
                    <li key={i} className="text-zinc-300">— {o}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
          {task.kind === "strategy_doc" && task.content?.executive_summary && (
            <div className="mt-2 text-xs text-zinc-300 leading-relaxed">
              {task.content.executive_summary}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
