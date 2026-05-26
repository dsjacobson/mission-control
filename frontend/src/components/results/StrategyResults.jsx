import React from "react";

const IMPACT_TONE = {
  high: "text-emerald-400 border-emerald-400/20 bg-emerald-400/10",
  medium: "text-amber-400 border-amber-400/20 bg-amber-400/10",
  low: "text-zinc-300 border-zinc-700 bg-zinc-900",
};

export default function StrategyResults({ results }) {
  return (
    <div className="space-y-5" data-testid="strategy-results">
      {results.executive_summary && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Executive summary</div>
          <p className="text-sm text-zinc-300 leading-relaxed">{results.executive_summary}</p>
        </div>
      )}

      {(results.weekly_plan || []).length > 0 && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Weekly plan</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {results.weekly_plan.map((w, i) => (
              <div key={i} className="rounded-sm border border-zinc-800 bg-zinc-950 p-3">
                <div className="font-heading text-sm text-zinc-50">Week {w.week || i + 1} · {w.focus}</div>
                <ul className="mt-2 space-y-1 text-xs text-zinc-300">
                  {(w.actions || []).map((a, j) => <li key={j}>— {a}</li>)}
                </ul>
              </div>
            ))}
          </div>
        </div>
      )}

      {(results.recommendations || []).length > 0 && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Recommendations</div>
          <div className="space-y-3">
            {results.recommendations.map((r, i) => (
              <div key={i} className="border border-zinc-800 rounded-sm p-3 bg-zinc-950">
                <div className="flex items-center justify-between">
                  <div className="font-heading text-sm text-zinc-100">{r.title}</div>
                  {r.expected_impact && (
                    <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${IMPACT_TONE[r.expected_impact] || IMPACT_TONE.low}`}>
                      {r.expected_impact}
                    </span>
                  )}
                </div>
                {r.rationale && <p className="text-xs text-zinc-400 mt-1.5 leading-relaxed">{r.rationale}</p>}
              </div>
            ))}
          </div>
        </div>
      )}

      {(results.campaign_ideas || []).length > 0 && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Campaign ideas</div>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {results.campaign_ideas.map((c, i) => (
              <div key={i} className="border border-zinc-800 rounded-sm p-3 bg-zinc-950">
                <div className="font-heading text-sm text-zinc-100">{c.title}</div>
                <div className="text-xs text-zinc-400 mt-1.5">{c.description}</div>
                {c.channels && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {c.channels.map((ch, j) => (
                      <span key={j} className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-300">{ch}</span>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {(results.monthly_themes || []).length > 0 && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Monthly themes</div>
          <div className="flex flex-wrap gap-2">
            {results.monthly_themes.map((t, i) => (
              <span key={i} className="text-xs font-mono px-2 py-0.5 rounded-sm border border-zinc-800 bg-zinc-950 text-zinc-300">{t}</span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
