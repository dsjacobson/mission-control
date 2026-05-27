import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ListTodo, Share2, Copy, RotateCcw, Filter, Pencil, Wrench, FileText, Telescope, Lightbulb,
  Circle, PlayCircle, CheckCircle2, Archive,
} from "lucide-react";
import api from "../lib/api";
import { useClients } from "../lib/ClientContext";
import { PageHeader, Section, StatTile, EmptyState, formatRelative } from "../components/Bits";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { toast } from "sonner";
import PageOptimizationCard from "../components/PageOptimizationCard";

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
  open: { label: "Open", icon: Circle, color: "text-zinc-400", dot: "bg-zinc-500" },
  in_progress: { label: "In progress", icon: PlayCircle, color: "text-amber-400", dot: "bg-amber-400" },
  done: { label: "Done", icon: CheckCircle2, color: "text-emerald-400", dot: "bg-emerald-400" },
  archived: { label: "Archived", icon: Archive, color: "text-zinc-500", dot: "bg-zinc-700" },
};

export default function Tasks() {
  const { clientId } = useParams();
  const { setActiveClientId, activeClient } = useClients();
  const [data, setData] = useState({ tasks: [], counters: {}, client: null });
  const [filter, setFilter] = useState("all");
  const [kindFilter, setKindFilter] = useState("all");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => setActiveClientId(clientId), [clientId, setActiveClientId]);

  const load = useCallback(async () => {
    try {
      const d = await api.listTasks(clientId);
      setData(d);
    } catch {}
  }, [clientId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const updateProgress = async (id, progress) => {
    setBusyId(id);
    try {
      await api.updateProgress(id, progress);
      toast.success(`Moved to ${PROGRESS[progress].label.toLowerCase()}`);
      load();
    } catch {
      toast.error("Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  const shareToken = data.client?.share_token;
  const shareUrl = shareToken ? api.publicShareUrl(shareToken) : "";

  const copyShare = () => {
    if (!shareUrl) return;
    navigator.clipboard.writeText(shareUrl);
    toast.success("Share link copied");
  };

  const rotateShare = async () => {
    if (!window.confirm("Rotate the share link? The old one will stop working.")) return;
    try {
      await api.rotateShareToken(clientId);
      toast.success("New share link generated");
      load();
    } catch {
      toast.error("Failed to rotate");
    }
  };

  const counters = data.counters || {};
  let tasks = data.tasks || [];
  if (filter !== "all") tasks = tasks.filter((t) => (t.progress || "open") === filter);
  if (kindFilter !== "all") tasks = tasks.filter((t) => t.kind === kindFilter);

  const allKinds = Array.from(new Set((data.tasks || []).map((t) => t.kind)));

  return (
    <div data-testid="tasks-page">
      <PageHeader
        kicker={activeClient?.name || "Workspace"}
        title="Tasks"
        description="Every approved action, as a checklist. Share this view with your client."
      >
        {shareUrl && (
          <div className="flex items-center gap-2">
            <Button
              data-testid="copy-share-link"
              onClick={copyShare}
              variant="ghost"
              className="text-zinc-300 hover:text-zinc-100 hover:bg-zinc-900 rounded-sm"
            >
              <Share2 size={13} className="mr-1.5" /> Copy share link
            </Button>
            <Button
              data-testid="rotate-share-link"
              onClick={rotateShare}
              variant="ghost"
              className="text-zinc-500 hover:text-zinc-100 hover:bg-zinc-900 rounded-sm h-9 w-9 p-0"
              title="Rotate share link"
            >
              <RotateCcw size={13} />
            </Button>
          </div>
        )}
      </PageHeader>

      <Section title="Backlog" testId="tasks-counters">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile testId="tasks-total" label="Total" value={counters.total || 0} />
          <StatTile testId="tasks-open" label="Open" value={counters.open || 0} />
          <StatTile testId="tasks-in-progress" label="In progress" value={counters.in_progress || 0} tone="warning" />
          <StatTile testId="tasks-done" label="Done" value={counters.done || 0} tone="success" />
          <StatTile testId="tasks-archived" label="Archived" value={counters.archived || 0} />
        </div>
      </Section>

      <Section
        title="Checklist"
        testId="tasks-checklist"
        action={
          <div className="flex items-center gap-2">
            <Tabs value={filter} onValueChange={setFilter}>
              <TabsList className="bg-zinc-900 border border-zinc-800 rounded-sm">
                {["all", "open", "in_progress", "done", "archived"].map((v) => (
                  <TabsTrigger
                    key={v}
                    value={v}
                    data-testid={`tasks-filter-${v}`}
                    className="data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 text-zinc-400 text-xs font-mono uppercase tracking-wider px-3 rounded-sm"
                  >
                    {v === "in_progress" ? "Doing" : v[0].toUpperCase() + v.slice(1)}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={filter} />
            </Tabs>
            {allKinds.length > 1 && (
              <div className="flex items-center gap-1 text-[10px] font-mono uppercase tracking-wider text-zinc-500 ml-1">
                <Filter size={11} />
                <select
                  value={kindFilter}
                  onChange={(e) => setKindFilter(e.target.value)}
                  data-testid="tasks-kind-filter"
                  className="bg-zinc-900 border border-zinc-800 text-zinc-300 rounded-sm px-2 py-1 text-xs"
                >
                  <option value="all">All types</option>
                  {allKinds.map((k) => (
                    <option key={k} value={k}>{KIND_LABEL[k] || k}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        }
      >
        {tasks.length === 0 ? (
          <EmptyState
            testId="empty-tasks"
            title="No tasks here"
            description={
              counters.total === 0
                ? "Approve items from the Approval queue to see them appear as tasks."
                : "No tasks match this filter."
            }
            action={
              counters.total === 0 && (
                <Link
                  to={`/clients/${clientId}/workflows`}
                  className="inline-flex items-center gap-1.5 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-9 px-3 text-sm font-medium"
                >
                  Launch a workflow
                </Link>
              )
            }
          />
        ) : (
          <div className="space-y-2">
            {tasks.map((t) => (
              <TaskRow key={t.id} task={t} busy={busyId === t.id} onProgress={updateProgress} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function TaskRow({ task, busy, onProgress }) {
  const progress = task.progress || "open";
  const KindIcon = KIND_ICON[task.kind] || ListTodo;
  const p = PROGRESS[progress] || PROGRESS.open;
  const PIcon = p.icon;
  const done = progress === "done";

  const toggleDone = () => onProgress(task.id, done ? "open" : "done");

  return (
    <div
      className={`rounded-sm border transition-colors duration-150 ${done ? "border-emerald-400/20 bg-emerald-400/5" : "border-zinc-800 bg-zinc-900"} p-4`}
      data-testid={`task-${task.id}`}
    >
      <div className="flex items-start gap-3">
        <button
          onClick={toggleDone}
          data-testid={`task-toggle-done-${task.id}`}
          disabled={busy}
          className={`mt-0.5 shrink-0 ${p.color} hover:text-emerald-400 transition-colors`}
          title={done ? "Mark open" : "Mark done"}
        >
          <PIcon size={18} />
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            <KindIcon size={11} className="text-zinc-500" />
            <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{KIND_LABEL[task.kind] || task.kind}</span>
            <span className="text-zinc-700">·</span>
            <span className={`text-[10px] font-mono uppercase tracking-wider ${p.color}`}>{p.label}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-[10px] font-mono text-zinc-500">approved {formatRelative(task.decided_at)}</span>
          </div>
          <div className={`font-heading text-sm font-medium ${done ? "text-zinc-400 line-through" : "text-zinc-50"}`}>
            {task.title}
          </div>
          {task.summary && (
            <div className="text-xs text-zinc-500 mt-1">{task.summary}</div>
          )}
          {/* type-specific previews */}
          {task.kind === "page_optimization" && (
            <div className="mt-3">
              <PageOptimizationCard content={task.content} testIdPrefix={`task-po-${task.id}`} />
            </div>
          )}
          {task.kind === "technical_action" && task.content?.recommended_fix && (
            <div className="mt-2 text-xs text-emerald-400 leading-relaxed">
              <span className="font-mono uppercase tracking-wider text-[10px] text-emerald-500/80">Fix · </span>
              {task.content.recommended_fix}
            </div>
          )}
          {task.kind === "content_brief" && task.content?.primary_keyword && (
            <div className="mt-2 text-xs text-zinc-400">
              Primary keyword: <span className="text-zinc-200 font-mono">{task.content.primary_keyword}</span>
            </div>
          )}

          {/* progress controls */}
          <div className="mt-3 flex items-center gap-1 text-[11px]">
            <span className="text-zinc-500 font-mono uppercase tracking-wider mr-1">Move to:</span>
            {["open", "in_progress", "done", "archived"].map((state) => (
              <button
                key={state}
                disabled={busy || progress === state}
                onClick={() => onProgress(task.id, state)}
                data-testid={`task-progress-${state}-${task.id}`}
                className={[
                  "px-2 py-0.5 rounded-sm border transition-colors duration-150 font-mono",
                  progress === state
                    ? "border-zinc-700 bg-zinc-800 text-zinc-100 cursor-default"
                    : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
                ].join(" ")}
              >
                {PROGRESS[state].label}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
