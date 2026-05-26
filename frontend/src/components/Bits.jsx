import React from "react";

export function PageHeader({ kicker, title, description, children, testId = "page-header" }) {
  return (
    <div className="border-b border-zinc-800 px-8 py-6 flex items-end justify-between gap-6" data-testid={testId}>
      <div className="min-w-0">
        {kicker && (
          <div className="text-[10px] font-mono tracking-[0.2em] uppercase text-zinc-500 mb-2">
            {kicker}
          </div>
        )}
        <h1 className="font-heading text-2xl md:text-3xl font-semibold tracking-tight text-zinc-50 truncate">
          {title}
        </h1>
        {description && (
          <p className="text-sm text-zinc-400 mt-1.5 max-w-2xl">{description}</p>
        )}
      </div>
      {children && <div className="flex items-center gap-2 shrink-0">{children}</div>}
    </div>
  );
}

export function Section({ title, description, action, children, testId }) {
  return (
    <section className="px-8 py-6 border-b border-zinc-800" data-testid={testId}>
      <div className="flex items-end justify-between gap-4 mb-4">
        <div>
          <h2 className="font-heading text-lg font-medium text-zinc-100">{title}</h2>
          {description && <p className="text-sm text-zinc-500 mt-0.5">{description}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

export function StatTile({ label, value, hint, tone = "neutral", testId }) {
  const toneClass =
    tone === "success" ? "text-emerald-400"
    : tone === "warning" ? "text-amber-400"
    : tone === "danger" ? "text-rose-400"
    : "text-zinc-50";
  return (
    <div
      className="rounded-sm border border-zinc-800 bg-zinc-900 px-4 py-4 hover:bg-zinc-800/40 transition-colors duration-150"
      data-testid={testId}
    >
      <div className="text-[10px] font-mono tracking-wider uppercase text-zinc-500 mb-2">{label}</div>
      <div className={`font-heading text-3xl font-semibold ${toneClass}`}>{value}</div>
      {hint && <div className="text-xs text-zinc-500 mt-1">{hint}</div>}
    </div>
  );
}

export function StatusBadge({ status }) {
  const map = {
    queued: "text-zinc-400 bg-zinc-400/10 border-zinc-400/20",
    running: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    completed: "text-sky-400 bg-sky-400/10 border-sky-400/20",
    failed: "text-rose-400 bg-rose-400/10 border-rose-400/20",
    pending: "text-amber-400 bg-amber-400/10 border-amber-400/20",
    approved: "text-emerald-400 bg-emerald-400/10 border-emerald-400/20",
    rejected: "text-rose-400 bg-rose-400/10 border-rose-400/20",
  };
  const cls = map[status] || "text-zinc-400 bg-zinc-400/10 border-zinc-400/20";
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-sm border font-mono text-[10px] uppercase tracking-wider ${cls}`}>
      {status}
    </span>
  );
}

export function EmptyState({ title, description, action, testId }) {
  return (
    <div
      className="rounded-sm border border-dashed border-zinc-800 bg-grid bg-zinc-950 py-16 px-6 text-center"
      data-testid={testId}
    >
      <div className="font-heading text-lg text-zinc-200">{title}</div>
      {description && <div className="text-sm text-zinc-500 mt-2 max-w-md mx-auto">{description}</div>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function formatRelative(iso) {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return `${Math.floor(diff)}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    return d.toLocaleDateString();
  } catch {
    return iso;
  }
}

export function WorkflowTypeLabel({ type }) {
  const map = {
    keyword_research: "Keyword Research",
    technical_audit: "Technical Audit",
    competitor_analysis: "Competitor Analysis",
    strategy_sprint: "Strategy Sprint",
  };
  return <span>{map[type] || type}</span>;
}
