import React, { useState } from "react";
import { AlertCircle, Sparkles, Loader2, ExternalLink, ArrowRight, Code2, ShieldCheck, Zap, FileEdit } from "lucide-react";
import PageOptimizationCard from "./PageOptimizationCard";
import { Button } from "./ui/button";
import { toast } from "sonner";
import api from "../lib/api";

export default function ArtifactView({ artifact, task, onChanged, readOnly = false }) {
  if (!artifact) return null;

  // 1) Metadata rewrites (existing OnPage flow)
  if (artifact.kind === "page_fixes" && Array.isArray(artifact.pages)) {
    return (
      <div className="space-y-3" data-testid={`artifact-page-fixes-${task?.id || "x"}`}>
        {artifact.pages.map((p, i) => (
          <PageOptimizationCard key={i} content={p} testIdPrefix={`artifact-${task?.id}-p${i}`} />
        ))}
      </div>
    );
  }

  if (artifact.kind === "no_pages") {
    return (
      <div className="text-xs text-amber-400 leading-relaxed" data-testid={`artifact-no-pages-${task?.id}`}>
        <AlertCircle size={11} className="inline mr-1 -mt-0.5" />
        {artifact.message}
      </div>
    );
  }

  // 2) Content remediation (new)
  if (artifact.kind === "content_remediation") {
    return <ContentRemediationView artifact={artifact} task={task} onChanged={onChanged} readOnly={readOnly} />;
  }

  // 3) Structural actions (new)
  if (artifact.kind === "structural_actions") {
    return <StructuralActionsView artifact={artifact} task={task} />;
  }

  // 4) Implementation brief (performance/security)
  if (artifact.kind === "implementation_brief") {
    return <ImplementationBriefView artifact={artifact} task={task} />;
  }

  // 5) Publisher draft (single-topic content brief)
  if (artifact.kind === "publisher_draft" && artifact.draft) {
    const d = artifact.draft;
    return (
      <div className="space-y-2 text-xs">
        {d.title && (
          <div>
            <span className="text-zinc-500 font-mono uppercase tracking-wider text-[10px]">Title</span> ·{" "}
            <span className="text-zinc-100">{d.title}</span>
          </div>
        )}
        {d.meta_description && (
          <div>
            <span className="text-zinc-500 font-mono uppercase tracking-wider text-[10px]">Meta</span> ·{" "}
            <span className="text-zinc-200">{d.meta_description}</span>
          </div>
        )}
        {Array.isArray(d.outline) && (
          <div>
            <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-1">Outline</div>
            <ul className="space-y-0.5">
              {d.outline.map((h, i) => (
                <li key={i} className="text-zinc-300">— {h.heading || h}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // 6) Strategy refresh
  if (artifact.kind === "strategy_refresh" && artifact.strategy) {
    return (
      <div className="text-xs space-y-2">
        {artifact.strategy.executive_summary && (
          <div className="text-zinc-300 leading-relaxed">{artifact.strategy.executive_summary}</div>
        )}
      </div>
    );
  }

  // 7) Fallback
  return (
    <pre className="text-xs font-mono text-zinc-300 bg-zinc-950 border border-zinc-800 rounded-sm p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
      {JSON.stringify(artifact, null, 2)}
    </pre>
  );
}

// ---------- Content remediation ----------

function ContentRemediationView({ artifact, task, onChanged, readOnly }) {
  const urls = artifact.urls || [];
  return (
    <div className="space-y-3" data-testid={`artifact-content-${task?.id}`}>
      {artifact.summary && (
        <div className="text-xs text-zinc-400 leading-relaxed border-l-2 border-emerald-400/40 pl-3">
          {artifact.summary}
        </div>
      )}
      {urls.length === 0 && (
        <div className="text-xs text-amber-400">
          <AlertCircle size={11} className="inline mr-1 -mt-0.5" />
          No URLs returned by the agent for this issue.
        </div>
      )}
      {urls.map((u, i) => (
        <ContentUrlCard
          key={u.url || i}
          directive={u}
          task={task}
          draft={(artifact.drafts || {})[u.url]?.draft}
          onChanged={onChanged}
          readOnly={readOnly}
        />
      ))}
    </div>
  );
}

function ContentUrlCard({ directive, task, draft, onChanged, readOnly }) {
  const [expanding, setExpanding] = useState(false);
  const [open, setOpen] = useState(!!draft);

  const onExpand = async () => {
    setExpanding(true);
    try {
      await api.expandDraft(task.id, directive.url);
      toast.success("Full draft generated");
      setOpen(true);
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to expand draft");
    } finally {
      setExpanding(false);
    }
  };

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-3.5 space-y-2.5" data-testid={`content-card-${directive.url}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <a
            href={directive.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 break-all"
          >
            {directive.url} <ExternalLink size={10} className="shrink-0" />
          </a>
          <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[11px]">
            <Pill label="Target" value={directive.target_keyword} tone="emerald" />
            {directive.recommended_word_count && (
              <Pill label="Words" value={directive.recommended_word_count} />
            )}
          </div>
        </div>
        {!readOnly && (
          <Button
            onClick={onExpand}
            disabled={expanding}
            className="shrink-0 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 rounded-sm h-7 px-2 text-[11px]"
            data-testid={`expand-draft-${directive.url}`}
          >
            {expanding ? <Loader2 size={11} className="animate-spin" /> : <FileEdit size={11} className="mr-1" />}
            {draft ? "Regenerate draft" : "Expand into draft"}
          </Button>
        )}
      </div>

      {directive.recommended_h1 && (
        <div className="text-xs">
          <span className="text-zinc-500 font-mono uppercase tracking-wider text-[10px]">Recommended H1</span>
          <div className="text-zinc-100 mt-0.5">{directive.recommended_h1}</div>
        </div>
      )}

      {Array.isArray(directive.outline) && directive.outline.length > 0 && (
        <div className="text-xs">
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-1">Outline</div>
          <ul className="space-y-1">
            {directive.outline.map((o, i) => (
              <li key={i} className="text-zinc-300 leading-relaxed">
                <span className="text-zinc-500 mr-2">{i + 1}.</span>
                <span className="text-zinc-100">{o.heading}</span>
                {o.intent && <span className="text-zinc-500"> — {o.intent}</span>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {Array.isArray(directive.talking_points) && directive.talking_points.length > 0 && (
        <div className="text-xs">
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-1">Must include</div>
          <ul className="space-y-0.5">
            {directive.talking_points.map((t, i) => (
              <li key={i} className="text-zinc-300">• {t}</li>
            ))}
          </ul>
        </div>
      )}

      {directive.why_this_matters && (
        <div className="text-[11px] text-zinc-500 italic">{directive.why_this_matters}</div>
      )}

      {draft && (
        <div className="mt-2 rounded-sm border border-emerald-400/20 bg-emerald-400/[0.03] p-3">
          <div className="flex items-center justify-between mb-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-300">
              <Sparkles size={10} className="inline mr-1" /> Generated draft
              {draft.word_count_estimate && <span className="text-zinc-500 ml-2">~{draft.word_count_estimate} words</span>}
            </div>
            <button
              className="text-[11px] text-zinc-400 hover:text-zinc-200"
              onClick={() => setOpen(!open)}
              data-testid={`toggle-draft-${directive.url}`}
            >
              {open ? "Collapse" : "Expand"}
            </button>
          </div>
          {open && (
            <div className="space-y-3 text-xs">
              {draft.h1 && <div className="font-heading text-base text-zinc-100">{draft.h1}</div>}
              {draft.intro && <div className="text-zinc-300 leading-relaxed">{draft.intro}</div>}
              {Array.isArray(draft.sections) && draft.sections.map((s, i) => (
                <div key={i} className="space-y-1">
                  <div className="font-heading text-sm text-zinc-100 mt-2">{s.h2}</div>
                  <div className="text-zinc-300 leading-relaxed whitespace-pre-wrap">{s.body}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- Structural actions ----------

function StructuralActionsView({ artifact, task }) {
  const actions = artifact.actions || [];
  return (
    <div className="space-y-3" data-testid={`artifact-structural-${task?.id}`}>
      {artifact.summary && (
        <div className="text-xs text-zinc-400 leading-relaxed border-l-2 border-sky-400/40 pl-3">
          {artifact.summary}
        </div>
      )}
      <div className="text-[11px] font-mono text-zinc-500">
        {artifact.affected_url_count} URL(s) flagged · {actions.length} action(s)
      </div>
      <div className="rounded-sm border border-zinc-800 overflow-hidden">
        <table className="w-full text-xs">
          <thead className="bg-zinc-950 border-b border-zinc-800">
            <tr>
              <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">URL</th>
              <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">Action</th>
              <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">Destination / value</th>
              <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">Where</th>
            </tr>
          </thead>
          <tbody>
            {actions.map((a, i) => (
              <tr key={i} className="border-b border-zinc-800 last:border-b-0 hover:bg-zinc-900/50">
                <td className="px-3 py-2 align-top">
                  <a href={a.url} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 font-mono text-[11px] break-all">
                    {a.url}
                  </a>
                </td>
                <td className="px-3 py-2 align-top">
                  <span className="inline-flex items-center px-1.5 py-0.5 rounded-sm border border-sky-400/30 bg-sky-400/10 text-sky-300 font-mono text-[10px] uppercase">
                    {a.action}
                  </span>
                </td>
                <td className="px-3 py-2 align-top text-zinc-200 font-mono text-[11px] break-words max-w-xs">
                  <span className="inline-flex items-center gap-1">
                    <ArrowRight size={10} className="text-zinc-500" /> {a.destination_or_value || "—"}
                  </span>
                  {a.notes && <div className="text-zinc-500 italic mt-0.5 font-sans">{a.notes}</div>}
                </td>
                <td className="px-3 py-2 align-top text-zinc-400 text-[11px]">{a.where_to_make_change || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------- Implementation brief (performance + security) ----------

function ImplementationBriefView({ artifact, task }) {
  const b = artifact.brief || {};
  const isSecurity = artifact.bucket === "security";
  const Icon = isSecurity ? ShieldCheck : Zap;
  const wrapClass = isSecurity
    ? "border-amber-400/20 bg-amber-400/[0.03]"
    : "border-violet-400/20 bg-violet-400/[0.03]";
  const labelClass = isSecurity ? "text-amber-300" : "text-violet-300";
  return (
    <div className={`rounded-sm border ${wrapClass} p-4 space-y-3`} data-testid={`artifact-brief-${task?.id}`}>
      <div className={`flex items-center gap-2 ${labelClass}`}>
        <Icon size={13} />
        <span className="font-mono uppercase tracking-wider text-[10px]">
          {isSecurity ? "Security implementation" : "Performance implementation"}
        </span>
        {artifact.affected_url_count > 0 && (
          <span className="ml-auto text-[10px] font-mono text-zinc-500">{artifact.affected_url_count} URLs affected</span>
        )}
      </div>

      {b.what_to_change && (
        <Block label="What to change" value={b.what_to_change} />
      )}
      {b.why_it_matters && (
        <Block label="Why it matters" value={b.why_it_matters} muted />
      )}
      {b.implementation && (
        <Block label="Where & how" value={b.implementation} />
      )}
      {b.snippet && (
        <div>
          <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-1.5 flex items-center gap-1.5">
            <Code2 size={10} /> Snippet
            {b.snippet_language && <span className="text-zinc-600">· {b.snippet_language}</span>}
          </div>
          <pre className="text-[11px] font-mono text-zinc-200 bg-zinc-950 border border-zinc-800 rounded-sm p-3 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
            {b.snippet}
          </pre>
        </div>
      )}
      {b.expected_impact && (
        <Block label="Expected impact" value={b.expected_impact} muted />
      )}
      {b.verification_step && (
        <Block label="How to verify" value={b.verification_step} muted />
      )}
    </div>
  );
}

function Block({ label, value, muted = false }) {
  return (
    <div className="text-xs">
      <div className="text-zinc-500 font-mono uppercase tracking-wider text-[10px] mb-0.5">{label}</div>
      <div className={muted ? "text-zinc-400 leading-relaxed" : "text-zinc-200 leading-relaxed"}>{value}</div>
    </div>
  );
}

function Pill({ label, value, tone = "zinc" }) {
  const toneClass =
    tone === "emerald" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
    : "border-zinc-700 bg-zinc-900 text-zinc-300";
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border ${toneClass} font-mono text-[10px]`}>
      <span className="opacity-60 mr-1 uppercase">{label}</span>
      {value || "—"}
    </span>
  );
}
