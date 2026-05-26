import React from "react";

const PRI_TONE = {
  P0: "text-rose-400 border-rose-400/20 bg-rose-400/10",
  P1: "text-amber-400 border-amber-400/20 bg-amber-400/10",
  P2: "text-sky-400 border-sky-400/20 bg-sky-400/10",
};

export default function AuditResults({ results }) {
  const issues = results.issues || [];
  return (
    <div className="space-y-5" data-testid="audit-results">
      {results.summary && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-2">Executive summary</div>
          <p className="text-sm text-zinc-300 leading-relaxed">{results.summary}</p>
        </div>
      )}

      <div className="rounded-sm border border-zinc-800 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-zinc-900 border-b border-zinc-800">
            <tr className="text-left">
              <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Pri</th>
              <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Category</th>
              <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Issue</th>
              <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Impact</th>
              <th className="px-4 py-2.5 text-[10px] font-mono uppercase tracking-wider text-zinc-500">Effort</th>
            </tr>
          </thead>
          <tbody className="bg-zinc-950">
            {issues.map((it, i) => (
              <tr key={it.id || i} className="border-b border-zinc-800/50 last:border-0 align-top">
                <td className="px-4 py-3">
                  <span className={`text-[10px] font-mono px-2 py-0.5 rounded-sm border ${PRI_TONE[it.priority] || "border-zinc-700 text-zinc-300"}`}>
                    {it.priority || "P2"}
                  </span>
                </td>
                <td className="px-4 py-3 text-zinc-400 text-xs font-mono">{it.category}</td>
                <td className="px-4 py-3">
                  <div className="text-zinc-100 font-medium">{it.title}</div>
                  <div className="text-xs text-zinc-500 mt-1 leading-relaxed">{it.description}</div>
                  {it.recommended_fix && (
                    <div className="text-xs text-emerald-400 mt-2">
                      <span className="font-mono uppercase tracking-wider text-[10px] text-emerald-500/80">fix · </span>
                      {it.recommended_fix}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{it.impact}/5</td>
                <td className="px-4 py-3 text-zinc-300 font-mono text-xs">{it.effort}/5</td>
              </tr>
            ))}
            {issues.length === 0 && (
              <tr>
                <td colSpan="5" className="px-4 py-6 text-center text-zinc-500 text-sm">No issues produced.</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
