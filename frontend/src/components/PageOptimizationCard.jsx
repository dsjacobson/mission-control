import React from "react";
import { Copy, ExternalLink } from "lucide-react";
import { toast } from "sonner";

/**
 * Renders a concrete page-level SEO optimization with side-by-side
 * before/after for title, meta, H1 + copy buttons + target keyword.
 */
export default function PageOptimizationCard({ content, testIdPrefix = "po" }) {
  if (!content) return null;
  const c = content;

  const copy = (label, value) => {
    if (!value) return;
    navigator.clipboard.writeText(value);
    toast.success(`${label} copied`);
  };

  return (
    <div className="space-y-3 text-xs">
      {/* URL + target */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        {c.url && (
          <a
            href={c.url.startsWith("http") ? c.url : `https://${c.url}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 font-mono text-zinc-300 hover:text-zinc-50 text-xs break-all"
            data-testid={`${testIdPrefix}-url`}
          >
            {c.url} <ExternalLink size={11} className="shrink-0" />
          </a>
        )}
        <div className="flex items-center gap-2">
          {c.target_keyword && (
            <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border border-emerald-400/30 bg-emerald-400/10 text-emerald-400">
              kw · {c.target_keyword}
            </span>
          )}
          {typeof c.gsc_clicks === "number" && (
            <span className="text-[10px] font-mono text-zinc-500">
              {c.gsc_clicks} clicks · {c.gsc_impressions} impr
            </span>
          )}
        </div>
      </div>

      <Row
        label="Title"
        limit={60}
        current={c.current_title}
        proposed={c.proposed_title}
        charCount={c.title_char_count}
        onCopy={() => copy("Title", c.proposed_title)}
        testId={`${testIdPrefix}-title`}
      />
      <Row
        label="Meta description"
        limit={155}
        current={c.current_meta}
        proposed={c.proposed_meta}
        charCount={c.meta_char_count}
        onCopy={() => copy("Meta description", c.proposed_meta)}
        testId={`${testIdPrefix}-meta`}
      />
      <Row
        label="H1"
        current={c.current_h1}
        proposed={c.proposed_h1}
        onCopy={() => copy("H1", c.proposed_h1)}
        testId={`${testIdPrefix}-h1`}
      />

      {Array.isArray(c.schema_notes) && c.schema_notes.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">
            Schema / markup notes
          </div>
          <ul className="space-y-0.5">
            {c.schema_notes.map((s, i) => (
              <li key={i} className="text-zinc-300">— {s}</li>
            ))}
          </ul>
        </div>
      )}

      {c.rationale && (
        <div className="text-[11px] text-zinc-500 italic leading-relaxed border-l-2 border-zinc-800 pl-2">
          {c.rationale}
        </div>
      )}
    </div>
  );
}

function Row({ label, limit, current, proposed, charCount, onCopy, testId }) {
  const overLimit = limit && charCount > limit;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 rounded-sm border border-zinc-800 bg-zinc-950 p-3" data-testid={testId}>
      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">
          Current {label}
        </div>
        <div className={`text-xs leading-relaxed ${current ? "text-zinc-300" : "text-zinc-600 italic"}`}>
          {current || "(missing or unknown)"}
        </div>
      </div>
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400">
            Proposed {label}
          </div>
          <div className="flex items-center gap-2">
            {limit && (
              <span className={`text-[10px] font-mono ${overLimit ? "text-rose-400" : "text-zinc-500"}`}>
                {charCount}/{limit}
              </span>
            )}
            <button
              onClick={onCopy}
              data-testid={`${testId}-copy`}
              className="text-zinc-500 hover:text-zinc-100 p-0.5"
              title={`Copy ${label}`}
            >
              <Copy size={11} />
            </button>
          </div>
        </div>
        <div className="text-xs text-zinc-100 leading-relaxed select-all">
          {proposed || <span className="text-zinc-600 italic">no proposal</span>}
        </div>
      </div>
    </div>
  );
}
