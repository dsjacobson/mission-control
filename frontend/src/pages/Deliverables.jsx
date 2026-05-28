import React, { useEffect, useState, useCallback } from "react";
import { useParams, Link } from "react-router-dom";
import {
  FileText,
  Wrench,
  Lightbulb,
  Telescope,
  CheckCircle2,
  Circle,
  PlayCircle,
  Archive,
  Download,
  Copy,
  ChevronRight,
  Pencil,
} from "lucide-react";
import api from "../lib/api";
import { useClients } from "../lib/ClientContext";
import { PageHeader, Section, StatTile, EmptyState, formatRelative } from "../components/Bits";
import { Button } from "../components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "../components/ui/tabs";
import { toast } from "sonner";
import PageOptimizationCard from "../components/PageOptimizationCard";

const KIND_META = {
  content_brief: { label: "Content briefs", icon: FileText, tone: "text-emerald-400" },
  technical_action: { label: "Technical actions", icon: Wrench, tone: "text-amber-400" },
  page_optimization: { label: "Page optimizations", icon: Pencil, tone: "text-sky-400" },
  strategy_doc: { label: "Strategy docs", icon: Lightbulb, tone: "text-sky-400" },
  competitor_insight: { label: "Competitor insights", icon: Telescope, tone: "text-rose-400" },
  competitive_deliverable: { label: "Competitive deliverables", icon: Telescope, tone: "text-emerald-400" },
  wordpress_draft: { label: "WordPress drafts", icon: FileText, tone: "text-violet-300" },
};

const PROGRESS_TONES = {
  open: { dot: "bg-zinc-500", label: "Open", icon: Circle, color: "text-zinc-400" },
  in_progress: { dot: "bg-amber-400", label: "In progress", icon: PlayCircle, color: "text-amber-400" },
  done: { dot: "bg-emerald-400", label: "Done", icon: CheckCircle2, color: "text-emerald-400" },
  archived: { dot: "bg-zinc-700", label: "Archived", icon: Archive, color: "text-zinc-500" },
};

export default function Deliverables() {
  const { clientId } = useParams();
  const { setActiveClientId, activeClient } = useClients();
  const [data, setData] = useState({ groups: {}, counters: {} });
  const [tab, setTab] = useState("all");
  const [busyId, setBusyId] = useState(null);

  useEffect(() => setActiveClientId(clientId), [clientId, setActiveClientId]);

  const load = useCallback(async () => {
    try {
      const d = await api.listDeliverables(clientId);
      setData(d);
    } catch {}
  }, [clientId]);

  useEffect(() => {
    load();
    const id = setInterval(load, 5000);
    return () => clearInterval(id);
  }, [load]);

  const counters = data.counters || {};
  const allKinds = Object.keys(data.groups || {});
  const visibleKinds = tab === "all" ? allKinds : [tab];

  const updateProgress = async (id, progress) => {
    setBusyId(id);
    try {
      await api.updateProgress(id, progress);
      toast.success(`Moved to ${PROGRESS_TONES[progress].label.toLowerCase()}`);
      load();
    } catch {
      toast.error("Failed to update");
    } finally {
      setBusyId(null);
    }
  };

  const copyJson = (item) => {
    navigator.clipboard.writeText(JSON.stringify(item.content, null, 2));
    toast.success("Copied to clipboard");
  };

  const downloadMd = (item) => {
    const md = renderMarkdown(item);
    const blob = new Blob([md], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${slugify(item.title || "deliverable")}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalDeliverables = counters.total || 0;

  return (
    <div data-testid="deliverables-page">
      <PageHeader
        kicker={activeClient?.name || "Workspace"}
        title="Deliverables"
        description="Approved items, organized by type and tracked through to done."
      />

      <Section title="Backlog" testId="deliverables-counters">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatTile testId="del-total" label="Total approved" value={totalDeliverables} />
          <StatTile testId="del-open" label="Open" value={counters.open || 0} tone={counters.open > 0 ? "neutral" : "neutral"} />
          <StatTile testId="del-in-progress" label="In progress" value={counters.in_progress || 0} tone="warning" />
          <StatTile testId="del-done" label="Done" value={counters.done || 0} tone="success" />
          <StatTile testId="del-archived" label="Archived" value={counters.archived || 0} />
        </div>
      </Section>

      {totalDeliverables === 0 ? (
        <Section title="Nothing here yet" testId="deliverables-empty">
          <EmptyState
            testId="empty-deliverables"
            title="No approved items"
            description="Launch a workflow, then approve items from the Approval queue. They land here as actionable deliverables."
            action={
              <Link
                to={`/clients/${clientId}/workflows`}
                className="inline-flex items-center gap-1.5 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-9 px-3 text-sm font-medium"
                data-testid="empty-deliverables-launch"
              >
                Launch a workflow
              </Link>
            }
          />
        </Section>
      ) : (
        <Section
          title="By type"
          testId="deliverables-groups"
          action={
            <Tabs value={tab} onValueChange={setTab}>
              <TabsList className="bg-zinc-900 border border-zinc-800 rounded-sm">
                <TabsTrigger value="all" data-testid="del-tab-all" className="data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 text-zinc-400 text-xs font-mono uppercase tracking-wider px-3 rounded-sm">All</TabsTrigger>
                {allKinds.map((k) => (
                  <TabsTrigger key={k} value={k} data-testid={`del-tab-${k}`} className="data-[state=active]:bg-zinc-50 data-[state=active]:text-zinc-950 text-zinc-400 text-xs font-mono uppercase tracking-wider px-3 rounded-sm">
                    {(KIND_META[k]?.label || k).split(" ")[0]}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value={tab} />
            </Tabs>
          }
        >
          <div className="space-y-6">
            {visibleKinds.map((kind) => {
              const items = data.groups[kind] || [];
              if (items.length === 0) return null;
              const meta = KIND_META[kind] || { label: kind, icon: FileText, tone: "text-zinc-300" };
              return (
                <div key={kind}>
                  <div className="flex items-center gap-2 mb-3">
                    <meta.icon size={14} className={meta.tone} />
                    <h3 className="font-heading text-sm font-medium text-zinc-100">{meta.label}</h3>
                    <span className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{items.length}</span>
                  </div>
                  <div className="space-y-2">
                    {items.map((it) => (
                      <DeliverableCard
                        key={it.id}
                        item={it}
                        kind={kind}
                        busy={busyId === it.id}
                        onProgress={updateProgress}
                        onCopy={copyJson}
                        onDownload={downloadMd}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}
    </div>
  );
}

function DeliverableCard({ item, kind, busy, onProgress, onCopy, onDownload }) {
  const progress = item.progress || "open";
  const p = PROGRESS_TONES[progress];
  const PIcon = p.icon;

  return (
    <div
      className={`rounded-sm border ${progress === "done" ? "border-emerald-400/20 bg-emerald-400/5" : "border-zinc-800 bg-zinc-900"} p-4 transition-colors`}
      data-testid={`deliverable-${item.id}`}
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 mb-1">
            <PIcon size={12} className={p.color} />
            <span className={`text-[10px] font-mono uppercase tracking-wider ${p.color}`}>{p.label}</span>
            <span className="text-zinc-700">·</span>
            <span className="text-[10px] font-mono text-zinc-500">approved {formatRelative(item.decided_at)}</span>
          </div>
          <div className={`font-heading text-sm font-medium ${progress === "done" ? "text-zinc-400 line-through" : "text-zinc-50"}`}>
            {item.title}
          </div>
          {item.summary && (
            <div className="text-xs text-zinc-500 mt-1">{item.summary}</div>
          )}
          {kind === "content_brief" && <ContentBriefPreview content={item.content} />}
          {kind === "technical_action" && <TechActionPreview content={item.content} />}
          {kind === "strategy_doc" && <StrategyPreview content={item.content} />}
          {kind === "competitive_deliverable" && <CompetitiveDeliverablePreview content={item.content} clientId={item.client_id} approvalId={item.id} />}
          {kind === "page_optimization" && (
            <div className="mt-3">
              <PageOptimizationCard content={item.content} testIdPrefix={`po-${item.id}`} />
            </div>
          )}
          {item.progress_note && (
            <div className="mt-2 text-xs text-zinc-400 italic">Note: {item.progress_note}</div>
          )}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button
            data-testid={`copy-${item.id}`}
            variant="ghost"
            onClick={() => onCopy(item)}
            className="text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded-sm h-8 w-8 p-0"
            title="Copy JSON"
          >
            <Copy size={13} />
          </Button>
          <Button
            data-testid={`download-${item.id}`}
            variant="ghost"
            onClick={() => onDownload(item)}
            className="text-zinc-500 hover:text-zinc-100 hover:bg-zinc-800 rounded-sm h-8 w-8 p-0"
            title="Download Markdown"
          >
            <Download size={13} />
          </Button>
        </div>
      </div>

      <div className="mt-3 flex items-center gap-1 text-[11px]">
        <span className="text-zinc-500 font-mono uppercase tracking-wider mr-1">Move to:</span>
        {["open", "in_progress", "done", "archived"].map((state) => (
          <button
            key={state}
            disabled={busy || progress === state}
            onClick={() => onProgress(item.id, state)}
            data-testid={`progress-${state}-${item.id}`}
            className={[
              "px-2 py-0.5 rounded-sm border transition-colors duration-150 font-mono",
              progress === state
                ? "border-zinc-700 bg-zinc-800 text-zinc-100 cursor-default"
                : "border-zinc-800 bg-zinc-950 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-100",
            ].join(" ")}
          >
            {PROGRESS_TONES[state].label}
          </button>
        ))}
      </div>
    </div>
  );
}

function ContentBriefPreview({ content }) {
  if (!content) return null;
  return (
    <div className="mt-3 grid grid-cols-1 md:grid-cols-[140px_1fr] gap-x-3 gap-y-1 text-xs">
      {content.primary_keyword && (
        <>
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px]">Primary keyword</div>
          <div className="text-zinc-200">{content.primary_keyword}</div>
        </>
      )}
      {Array.isArray(content.outline) && content.outline.length > 0 && (
        <>
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px]">Outline</div>
          <ul className="space-y-0.5">
            {content.outline.map((o, i) => (
              <li key={i} className="text-zinc-300">— {o}</li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function TechActionPreview({ content }) {
  if (!content) return null;
  return (
    <div className="mt-2 text-xs space-y-1">
      {content.description && <div className="text-zinc-400 leading-relaxed">{content.description}</div>}
      {content.recommended_fix && (
        <div className="text-emerald-400 leading-relaxed mt-2">
          <span className="font-mono uppercase tracking-wider text-[10px] text-emerald-500/80">Fix · </span>
          {content.recommended_fix}
        </div>
      )}
    </div>
  );
}

function StrategyPreview({ content }) {
  if (!content) return null;
  return (
    <div className="mt-2 text-xs">
      {content.executive_summary && (
        <div className="text-zinc-300 leading-relaxed">{content.executive_summary}</div>
      )}
      {Array.isArray(content.recommendations) && content.recommendations.length > 0 && (
        <div className="mt-2">
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-1">Recommendations</div>
          <ul className="space-y-0.5">
            {content.recommendations.slice(0, 5).map((r, i) => (
              <li key={i} className="text-zinc-300 flex items-start gap-1">
                <ChevronRight size={11} className="text-zinc-500 mt-0.5 shrink-0" />
                <span>{r.title}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function CompetitiveDeliverablePreview({ content, clientId, approvalId }) {
  if (!content) return null;
  const opps = (content.top_opportunities || []).slice(0, 3);
  return (
    <div className="mt-3 text-xs">
      {content.executive_summary && (
        <div className="text-zinc-300 leading-relaxed">{content.executive_summary}</div>
      )}
      {opps.length > 0 && (
        <div className="mt-3">
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-1.5">Top opportunities</div>
          <ul className="space-y-1">
            {opps.map((o, i) => (
              <li key={i} className="text-zinc-300 flex items-start gap-1.5">
                <span className="text-emerald-400 font-mono">{o.rank ?? i + 1}.</span>
                <span>
                  <span className="text-zinc-100">{o.title}</span>
                  {o.primary_keyword && <span className="text-emerald-300 font-mono ml-1.5">{o.primary_keyword}</span>}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-3">
        <Link
          to={`/clients/${clientId}/deliverables/competitive/${approvalId}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm text-xs font-medium"
          data-testid={`open-deliverable-${approvalId}`}
        >
          Open full report <ChevronRight size={11} />
        </Link>
      </div>
    </div>
  );
}

function renderMarkdown(item) {
  const c = item.content || {};
  const lines = [
    `# ${item.title}`,
    "",
    `_${item.summary || ""}_`,
    "",
    `**Approved**: ${item.decided_at || ""}  `,
    `**Progress**: ${item.progress || "open"}  `,
    `**Client**: ${item.client_name || ""}`,
    "",
    "---",
    "",
  ];
  if (item.kind === "content_brief") {
    if (c.primary_keyword) lines.push(`**Primary keyword**: ${c.primary_keyword}`, "");
    if (c.outline) {
      lines.push("## Outline", "");
      c.outline.forEach((h) => lines.push(`- ${h}`));
      lines.push("");
    }
  } else if (item.kind === "technical_action") {
    if (c.description) lines.push("## Issue", "", c.description, "");
    if (c.recommended_fix) lines.push("## Recommended fix", "", c.recommended_fix, "");
    lines.push(`**Impact**: ${c.impact}/5 · **Effort**: ${c.effort}/5 · **Priority**: ${c.priority}`, "");
  } else if (item.kind === "strategy_doc") {
    if (c.executive_summary) lines.push("## Executive summary", "", c.executive_summary, "");
    if (Array.isArray(c.recommendations)) {
      lines.push("## Recommendations", "");
      c.recommendations.forEach((r) => lines.push(`- **${r.title}** — ${r.rationale || ""} (impact: ${r.expected_impact || "—"})`));
      lines.push("");
    }
  } else if (item.kind === "page_optimization") {
    if (c.url) lines.push(`**Page**: ${c.url}`, "");
    if (c.target_keyword) lines.push(`**Target keyword**: ${c.target_keyword}`, "");
    lines.push("## Proposed title", "", `${c.proposed_title || ""} (${c.title_char_count || 0}/60)`, "");
    lines.push("## Proposed meta description", "", `${c.proposed_meta || ""} (${c.meta_char_count || 0}/155)`, "");
    lines.push("## Proposed H1", "", c.proposed_h1 || "", "");
    if (Array.isArray(c.schema_notes) && c.schema_notes.length > 0) {
      lines.push("## Schema notes", "");
      c.schema_notes.forEach((s) => lines.push(`- ${s}`));
      lines.push("");
    }
    if (c.rationale) lines.push("## Rationale", "", c.rationale, "");
  }
  lines.push("```json", JSON.stringify(c, null, 2), "```");
  return lines.join("\n");
}

function slugify(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "deliverable";
}
