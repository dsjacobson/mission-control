import React from "react";

const INTENT_TONE = {
  informational: "border-sky-400/20 text-sky-400 bg-sky-400/10",
  commercial: "border-emerald-400/20 text-emerald-400 bg-emerald-400/10",
  transactional: "border-amber-400/20 text-amber-400 bg-amber-400/10",
  navigational: "border-zinc-400/20 text-zinc-300 bg-zinc-400/10",
};

const DIFF_TONE = {
  low: "text-emerald-400",
  medium: "text-amber-400",
  high: "text-rose-400",
};

export default function KeywordResults({ results }) {
  const clusters = results.clusters || [];
  return (
    <div className="space-y-5" data-testid="keyword-results">
      {(results.quick_wins?.length > 0 || results.content_gaps?.length > 0) && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-sm border border-emerald-400/20 bg-emerald-400/5 p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 mb-2">Quick wins</div>
            <ul className="space-y-1 text-sm text-zinc-200">
              {(results.quick_wins || []).map((q, i) => (
                <li key={i} className="font-mono">— {q}</li>
              ))}
              {(!results.quick_wins || results.quick_wins.length === 0) && <li className="text-zinc-500">none</li>}
            </ul>
          </div>
          <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Content gaps</div>
            <ul className="space-y-1 text-sm text-zinc-200">
              {(results.content_gaps || []).map((q, i) => (
                <li key={i}>— {q}</li>
              ))}
              {(!results.content_gaps || results.content_gaps.length === 0) && <li className="text-zinc-500">none</li>}
            </ul>
          </div>
        </div>
      )}

      <div className="space-y-4">
        {clusters.map((c, idx) => (
          <div key={idx} className="rounded-sm border border-zinc-800 bg-zinc-900 overflow-hidden">
            <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
              <div>
                <div className="font-heading text-base text-zinc-50">{c.topic || "Cluster"}</div>
              </div>
              {c.intent && (
                <span className={`text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-sm border ${INTENT_TONE[c.intent] || "border-zinc-700 text-zinc-300"}`}>
                  {c.intent}
                </span>
              )}
            </div>
            <table className="w-full text-sm">
              <thead className="bg-zinc-950 border-b border-zinc-800">
                <tr className="text-left">
                  <th className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Keyword</th>
                  <th className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Volume</th>
                  <th className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Difficulty</th>
                  <th className="px-4 py-2 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Quick win</th>
                </tr>
              </thead>
              <tbody>
                {(c.keywords || []).map((k, i) => (
                  <tr key={i} className="border-b border-zinc-800/40 last:border-0">
                    <td className="px-4 py-2 text-zinc-200">{k.keyword}</td>
                    <td className="px-4 py-2 text-zinc-300 font-mono text-xs">{k.volume_estimate || "—"}</td>
                    <td className={`px-4 py-2 font-mono text-xs ${DIFF_TONE[k.difficulty] || "text-zinc-300"}`}>{k.difficulty || "—"}</td>
                    <td className="px-4 py-2 text-zinc-300">{k.quick_win ? "yes" : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {(results.draft_briefs || []).length > 0 && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-3">Draft content briefs</div>
          <div className="space-y-3">
            {results.draft_briefs.map((b, i) => (
              <div key={i} className="border border-zinc-800 rounded-sm p-3 bg-zinc-950">
                <div className="font-heading text-sm text-zinc-100">{b.title}</div>
                <div className="text-[11px] font-mono text-zinc-500 mt-0.5">primary: {b.primary_keyword}</div>
                {b.outline && (
                  <ul className="mt-2 space-y-0.5">
                    {b.outline.map((o, idx) => <li key={idx} className="text-xs text-zinc-400">— {o}</li>)}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
