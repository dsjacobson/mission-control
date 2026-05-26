import React from "react";

export default function CompetitorResults({ results }) {
  const competitors = results.competitors || [];
  return (
    <div className="space-y-5" data-testid="competitor-results">
      {results.summary && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Summary</div>
          <p className="text-sm text-zinc-300 leading-relaxed">{results.summary}</p>
        </div>
      )}

      {competitors.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {competitors.map((c, i) => (
            <div key={i} className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="font-heading text-base text-zinc-50">{c.domain}</div>
                {typeof c.estimated_keyword_overlap_pct === "number" && (
                  <span className="text-[10px] font-mono text-zinc-500">{c.estimated_keyword_overlap_pct}% overlap</span>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 mb-1">Strengths</div>
                  <ul className="space-y-0.5 text-xs text-zinc-300">
                    {(c.strengths || []).map((s, j) => <li key={j}>— {s}</li>)}
                  </ul>
                </div>
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-wider text-rose-400 mb-1">Weaknesses</div>
                  <ul className="space-y-0.5 text-xs text-zinc-300">
                    {(c.weaknesses || []).map((s, j) => <li key={j}>— {s}</li>)}
                  </ul>
                </div>
              </div>
              {c.content_focus && c.content_focus.length > 0 && (
                <div className="mt-3">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Content focus</div>
                  <div className="flex flex-wrap gap-1.5">
                    {c.content_focus.map((cf, j) => (
                      <span key={j} className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm border border-zinc-800 bg-zinc-950 text-zinc-300">{cf}</span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <ListPanel title="Keyword gaps" items={results.keyword_gaps} tone="text-emerald-400" />
        <ListPanel title="Opportunities" items={results.opportunities} tone="text-sky-400" />
        <ListPanel title="Threats" items={results.threats} tone="text-rose-400" />
      </div>

      <ListPanel title="Strategic moves" items={results.strategic_moves} tone="text-amber-400" />
    </div>
  );
}

function ListPanel({ title, items, tone }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
      <div className={`text-[10px] font-mono uppercase tracking-wider ${tone} mb-2`}>{title}</div>
      <ul className="space-y-1 text-sm text-zinc-300">
        {(items || []).map((s, i) => <li key={i}>— {s}</li>)}
        {(!items || items.length === 0) && <li className="text-zinc-500 text-xs">none</li>}
      </ul>
    </div>
  );
}
