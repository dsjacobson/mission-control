import React from "react";
import { Printer, Sparkles, Target, TrendingUp, Link2, FileText, Calendar, BarChart3, ChevronRight, ExternalLink, FileType, Sheet, Download } from "lucide-react";
import api from "../lib/api";

/**
 * Renders a Competitive Analysis deliverable.
 * Dark editorial palette in app; warm print/PDF palette via Tailwind print:.
 * Exports: DOCX (Google Docs / Word) + XLSX (Google Sheets / Excel) + PDF.
 */
export default function CompetitiveDeliverableView({ content, onPrint, approvalId }) {
  if (!content || typeof content !== "object") {
    return <div className="p-6 text-sm text-zinc-500">No deliverable content yet.</div>;
  }
  const c = content;
  const docxUrl = approvalId ? api.deliverableDocxUrl(approvalId) : null;
  const xlsxUrl = approvalId ? api.deliverableXlsxUrl(approvalId) : null;

  return (
    <div className="competitive-deliverable bg-zinc-950 text-zinc-100 print:bg-white print:text-zinc-900" data-testid="competitive-deliverable">
      {/* Header / cover */}
      <div className="px-10 py-12 border-b border-zinc-800 print:border-zinc-300 print:px-0 print:py-6">
        <div className="flex items-start justify-between gap-8 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-amber-400 print:text-amber-700 mb-4">
              ◆ Competitive Analysis · Deliverable
            </div>
            <h1 className="font-serif text-4xl md:text-5xl font-semibold tracking-tight text-zinc-50 print:text-slate-900 leading-[1.05]">
              {c.title || "Competitive Analysis"}
            </h1>
            {c.subtitle && (
              <p className="font-serif text-lg italic text-zinc-300 print:text-slate-700 mt-4 max-w-2xl leading-snug">
                {c.subtitle}
              </p>
            )}
            <div className="text-[11px] font-mono uppercase tracking-wider text-zinc-500 print:text-slate-500 mt-5">
              Prepared for · <span className="text-zinc-200 print:text-slate-800">{c.prepared_for || "client"}</span>
            </div>
          </div>
          <div className="no-print flex flex-col gap-2 shrink-0">
            {docxUrl && (
              <a
                href={docxUrl}
                className="inline-flex items-center gap-2 text-xs px-3 py-2 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm font-medium transition-colors min-w-[180px]"
                data-testid="export-docx-btn"
                download
              >
                <FileType size={13} />
                <span className="flex-1">Google Docs / Word</span>
                <Download size={11} />
              </a>
            )}
            {xlsxUrl && (
              <a
                href={xlsxUrl}
                className="inline-flex items-center gap-2 text-xs px-3 py-2 bg-zinc-900 border border-zinc-800 text-zinc-100 hover:bg-zinc-800 rounded-sm font-medium min-w-[180px]"
                data-testid="export-xlsx-btn"
                download
              >
                <Sheet size={13} />
                <span className="flex-1">Google Sheets / Excel</span>
                <Download size={11} />
              </a>
            )}
            {onPrint && (
              <button
                onClick={onPrint}
                className="inline-flex items-center gap-2 text-xs px-3 py-2 bg-zinc-900 border border-zinc-800 text-zinc-100 hover:bg-zinc-800 rounded-sm font-medium min-w-[180px]"
                data-testid="print-deliverable-btn"
              >
                <Printer size={13} />
                <span className="flex-1">Print / save PDF</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Executive summary */}
      {c.executive_summary && (
        <Section icon={Sparkles} title="Executive Summary">
          <p className="font-serif text-base md:text-[17px] leading-relaxed text-zinc-100 print:text-slate-800 max-w-3xl">
            {c.executive_summary}
          </p>
        </Section>
      )}

      {/* Current position */}
      {c.current_position && (
        <Section icon={BarChart3} title="Where You Stand Today">
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Authority Score" value={c.current_position.authority_score} />
            <Stat label="Backlinks" value={fmt(c.current_position.backlinks)} />
            <Stat label="Ref. domains" value={fmt(c.current_position.referring_domains)} />
            <Stat label="Organic KWs" value={fmt(c.current_position.organic_keywords)} />
            <Stat label="Org. traffic" value={fmt(c.current_position.organic_traffic)} />
          </div>
          {c.current_position.narrative && (
            <p className="mt-4 text-sm text-zinc-300 print:text-zinc-700 max-w-3xl">{c.current_position.narrative}</p>
          )}
        </Section>
      )}

      {/* Competitor landscape */}
      {Array.isArray(c.competitor_landscape) && c.competitor_landscape.length > 0 && (
        <Section icon={Target} title="Competitor Landscape">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {c.competitor_landscape.map((comp, i) => (
              <div key={i} className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white p-4">
                <div className="flex items-baseline justify-between gap-2">
                  <h3 className="font-heading text-base text-zinc-50 print:text-zinc-900">{comp.name}</h3>
                  <TierBadge tier={comp.tier} />
                </div>
                <div className="text-[11px] font-mono text-zinc-500 mt-0.5">{comp.domain}</div>
                <div className="grid grid-cols-2 gap-2 mt-3">
                  <MiniStat label="Authority" value={comp.authority_score ?? "—"} />
                  <MiniStat label="Org. traffic" value={fmt(comp.organic_traffic)} />
                </div>
                {comp.key_strengths?.length > 0 && (
                  <Block label="Strengths" items={comp.key_strengths} tone="emerald" />
                )}
                {comp.key_weaknesses?.length > 0 && (
                  <Block label="Weaknesses" items={comp.key_weaknesses} tone="amber" />
                )}
                {comp.how_to_beat_them && (
                  <div className="mt-3 pt-3 border-t border-zinc-800 print:border-zinc-200">
                    <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">How to beat them</div>
                    <p className="text-sm text-zinc-200 print:text-zinc-800 mt-1">{comp.how_to_beat_them}</p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Gap analysis */}
      {c.gap_analysis && (
        <Section icon={TrendingUp} title="Gap Analysis">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {Object.values(c.gap_analysis).filter(Boolean).map((g, i) => (
              <GapCard key={i} gap={g} />
            ))}
          </div>
        </Section>
      )}

      {/* Top opportunities */}
      {Array.isArray(c.top_opportunities) && c.top_opportunities.length > 0 && (
        <Section icon={Target} title="Top Opportunities" subtitle="Ranked by impact vs effort — start at the top.">
          <div className="space-y-3">
            {c.top_opportunities.map((o, i) => (
              <OpportunityRow key={i} opp={o} />
            ))}
          </div>
        </Section>
      )}

      {/* Content strategy */}
      {c.content_strategy && (
        <Section icon={FileText} title="Content Strategy">
          {c.content_strategy.positioning && (
            <p className="text-sm text-zinc-200 print:text-zinc-800 max-w-3xl mb-4">{c.content_strategy.positioning}</p>
          )}
          {Array.isArray(c.content_strategy.pillars) && c.content_strategy.pillars.length > 0 && (
            <div className="space-y-2 mb-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Content pillars</div>
              {c.content_strategy.pillars.map((p, i) => (
                <div key={i} className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white p-3">
                  <div className="text-sm text-zinc-100 print:text-zinc-900 font-medium">{p.name}</div>
                  <div className="text-xs text-zinc-400 print:text-zinc-600 mt-0.5">{p.rationale}</div>
                  {p.example_targets?.length > 0 && (
                    <div className="text-[11px] font-mono text-emerald-300 print:text-emerald-700 mt-1.5">
                      e.g. {p.example_targets.join(" · ")}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
          {Array.isArray(c.content_strategy.format_priorities) && (
            <Block label="Format priorities" items={c.content_strategy.format_priorities} />
          )}
          {c.content_strategy.voice_and_eeat && (
            <div className="mt-3">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Voice & E-E-A-T</div>
              <p className="text-sm text-zinc-200 print:text-zinc-800 mt-1">{c.content_strategy.voice_and_eeat}</p>
            </div>
          )}
        </Section>
      )}

      {/* Link-building strategy */}
      {c.link_building_strategy && (
        <Section icon={Link2} title="Link-Building Strategy">
          {c.link_building_strategy.current_gap_summary && (
            <p className="text-sm text-zinc-200 print:text-zinc-800 max-w-3xl mb-4">{c.link_building_strategy.current_gap_summary}</p>
          )}
          {Array.isArray(c.link_building_strategy.tactics) && (
            <div className="space-y-2">
              {c.link_building_strategy.tactics.map((t, i) => (
                <div key={i} className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white p-3">
                  <div className="flex items-baseline justify-between gap-3">
                    <div className="text-sm text-zinc-100 print:text-zinc-900 font-medium">{t.name}</div>
                    {t.target_links_per_month != null && (
                      <div className="text-[10px] font-mono text-emerald-300 print:text-emerald-700">
                        target {t.target_links_per_month}/mo
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-zinc-400 print:text-zinc-600 mt-0.5">{t.rationale}</div>
                  {t.first_step && (
                    <div className="text-[11px] mt-1.5">
                      <span className="font-mono text-zinc-500">First step → </span>
                      <span className="text-zinc-200 print:text-zinc-800">{t.first_step}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </Section>
      )}

      {/* Technical priorities */}
      {Array.isArray(c.technical_priorities) && c.technical_priorities.length > 0 && (
        <Section icon={Sparkles} title="Technical Priorities">
          <div className="space-y-2">
            {c.technical_priorities.map((t, i) => (
              <div key={i} className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white p-3">
                <div className="text-sm text-zinc-100 print:text-zinc-900 font-medium">{t.title}</div>
                <div className="text-xs text-zinc-400 print:text-zinc-600 mt-0.5">{t.rationale}</div>
                {t.first_step && (
                  <div className="text-[11px] mt-1.5">
                    <span className="font-mono text-zinc-500">First step → </span>
                    <span className="text-zinc-200 print:text-zinc-800">{t.first_step}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Action plan */}
      {c.action_plan && (
        <Section icon={Calendar} title="30 · 60 · 90 Day Action Plan">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 print:grid-cols-3">
            {["30_days", "60_days", "90_days"].map((bucket) => {
              const items = c.action_plan?.[bucket] || [];
              const label = bucket.replace("_days", " days");
              return (
                <div key={bucket} className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white p-4">
                  <div className="text-[10px] font-mono uppercase tracking-wider text-emerald-400 print:text-emerald-700 mb-3">{label}</div>
                  <div className="space-y-3">
                    {items.map((it, i) => (
                      <div key={i} className="text-sm">
                        <div className="text-zinc-100 print:text-zinc-900">{it.task}</div>
                        <div className="text-[11px] font-mono text-zinc-500 mt-0.5">
                          {it.owner ? `${it.owner} · ` : ""}{it.deliverable}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      {/* Success metrics */}
      {Array.isArray(c.success_metrics) && c.success_metrics.length > 0 && (
        <Section icon={BarChart3} title="Success Metrics">
          <div className="rounded-sm border border-zinc-800 print:border-zinc-300 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-zinc-900 print:bg-zinc-100 border-b border-zinc-800 print:border-zinc-300">
                <tr>
                  <Th>Metric</Th>
                  <Th className="text-right">Current</Th>
                  <Th className="text-right">90-day target</Th>
                  <Th className="text-right">180-day target</Th>
                </tr>
              </thead>
              <tbody>
                {c.success_metrics.map((m, i) => (
                  <tr key={i} className="border-b border-zinc-800 print:border-zinc-200 last:border-b-0">
                    <td className="px-3 py-2 text-zinc-100 print:text-zinc-900">{m.metric}</td>
                    <td className="px-3 py-2 text-right font-mono text-zinc-300 print:text-zinc-700">{fmt(m.current)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-300 print:text-emerald-700">{fmt(m.target_90d)}</td>
                    <td className="px-3 py-2 text-right font-mono text-emerald-300 print:text-emerald-700">{fmt(m.target_180d)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Closing */}
      {c.closing_statement && (
        <div className="px-10 py-10 border-t border-zinc-800 print:border-slate-300 bg-zinc-900/60 print:bg-amber-50/40 print:px-0 print:py-6">
          <div className="text-[10px] font-mono uppercase tracking-[0.3em] text-amber-400 print:text-amber-700 mb-4">
            ◆ Start this week
          </div>
          <p className="font-serif text-xl text-zinc-100 print:text-slate-900 max-w-3xl leading-snug italic">
            {c.closing_statement}
          </p>
        </div>
      )}
    </div>
  );
}

function Section({ icon: Icon, title, subtitle, children }) {
  return (
    <section className="px-10 py-9 border-b border-zinc-800 print:border-zinc-300 print:break-inside-avoid print:px-0 print:py-5">
      <div className="flex items-center gap-3 mb-6">
        {Icon && <Icon size={16} className="text-amber-400 print:text-amber-700" />}
        <h2 className="font-serif text-2xl md:text-[28px] font-semibold tracking-tight text-zinc-50 print:text-slate-900">{title}</h2>
      </div>
      {subtitle && <p className="text-xs italic text-zinc-500 print:text-slate-600 -mt-4 mb-5 font-serif">{subtitle}</p>}
      {children}
    </section>
  );
}

function Stat({ label, value }) {
  return (
    <div className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white px-3 py-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600">{label}</div>
      <div className="font-heading text-xl text-zinc-50 print:text-zinc-900 mt-1">{value ?? "—"}</div>
    </div>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-950 print:bg-zinc-50 px-2.5 py-2">
      <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600">{label}</div>
      <div className="text-sm font-medium text-zinc-100 print:text-zinc-900 mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

function TierBadge({ tier }) {
  const map = {
    market_leader: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300 print:bg-emerald-50 print:text-emerald-700 print:border-emerald-300",
    direct_rival: "border-amber-400/40 bg-amber-400/10 text-amber-300 print:bg-amber-50 print:text-amber-700 print:border-amber-300",
    aspirational: "border-sky-400/40 bg-sky-400/10 text-sky-300 print:bg-sky-50 print:text-sky-700 print:border-sky-300",
  };
  const cls = map[tier] || "border-zinc-700 bg-zinc-900 text-zinc-400";
  if (!tier) return null;
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border font-mono text-[9px] uppercase tracking-wider ${cls}`}>
      {tier.replace(/_/g, " ")}
    </span>
  );
}

function Block({ label, items, tone = "zinc" }) {
  const dot =
    tone === "emerald" ? "bg-emerald-400" :
    tone === "amber" ? "bg-amber-400" : "bg-zinc-500";
  return (
    <div className="mt-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600 mb-1.5">{label}</div>
      <ul className="space-y-1">
        {items.map((it, i) => (
          <li key={i} className="text-xs text-zinc-300 print:text-zinc-700 flex gap-2">
            <span className={`mt-1.5 h-1 w-1 rounded-full shrink-0 ${dot}`} />
            <span>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function GapCard({ gap }) {
  if (!gap) return null;
  const your = gap.your_value;
  const their = gap.their_value;
  const leader = gap.leader;
  return (
    <div className="rounded-sm border border-amber-400/30 bg-amber-400/[0.04] print:bg-amber-50 print:border-amber-300 p-3">
      <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 print:text-amber-700">{gap.label}</div>
      <div className="flex items-baseline gap-3 mt-2">
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600">You</div>
          <div className="font-heading text-2xl text-zinc-100 print:text-zinc-900">{fmt(your)}</div>
        </div>
        <ChevronRight size={14} className="text-zinc-600 print:text-zinc-400 mt-3" />
        <div>
          <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 print:text-zinc-600">
            {leader || "Leader"}
          </div>
          <div className="font-heading text-2xl text-amber-300 print:text-amber-700">{fmt(their) ?? fmt(gap.count)}</div>
        </div>
      </div>
      {gap.implication && (
        <p className="text-xs text-zinc-300 print:text-zinc-700 mt-3">{gap.implication}</p>
      )}
    </div>
  );
}

function OpportunityRow({ opp }) {
  const effortDot = opp.effort === "low" ? "bg-emerald-400" : opp.effort === "medium" ? "bg-amber-400" : "bg-rose-400";
  const impactDot = opp.expected_impact === "high" ? "bg-emerald-400" : opp.expected_impact === "medium" ? "bg-amber-400" : "bg-zinc-500";
  return (
    <div className="rounded-sm border border-zinc-800 print:border-zinc-300 bg-zinc-900 print:bg-white p-4 print:break-inside-avoid">
      <div className="flex items-start gap-3">
        <div className="font-heading text-2xl text-emerald-400 print:text-emerald-700 shrink-0 w-8 text-right">{opp.rank}</div>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-3">
            <h3 className="text-sm font-medium text-zinc-100 print:text-zinc-900">{opp.title}</h3>
            <div className="flex items-center gap-2 text-[10px] font-mono text-zinc-500 shrink-0">
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${effortDot}`} /> effort {opp.effort}
              </span>
              <span className="inline-flex items-center gap-1">
                <span className={`h-1.5 w-1.5 rounded-full ${impactDot}`} /> impact {opp.expected_impact}
              </span>
            </div>
          </div>
          {opp.primary_keyword && (
            <div className="text-[11px] font-mono text-emerald-300 print:text-emerald-700 mt-1">
              {opp.primary_keyword}
              {opp.search_volume != null && <span className="text-zinc-500 print:text-zinc-600"> · vol {fmt(opp.search_volume)}</span>}
              {opp.competitor_position != null && <span className="text-zinc-500 print:text-zinc-600"> · they rank #{opp.competitor_position}</span>}
            </div>
          )}
          {Array.isArray(opp.supporting_keywords) && opp.supporting_keywords.length > 0 && (
            <div className="text-[11px] text-zinc-400 print:text-zinc-600 mt-1">
              Supporting: {opp.supporting_keywords.slice(0, 6).join(" · ")}
            </div>
          )}
          {opp.why_winnable && (
            <p className="text-xs text-zinc-300 print:text-zinc-700 mt-2">{opp.why_winnable}</p>
          )}
          <div className="flex flex-wrap items-center gap-3 text-[11px] mt-2">
            {opp.recommended_format && (
              <span className="text-zinc-500 print:text-zinc-600">
                Format: <span className="text-zinc-300 print:text-zinc-800">{opp.recommended_format}</span>
              </span>
            )}
            {opp.competitor_url_to_outrank && (
              <a
                href={opp.competitor_url_to_outrank}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-zinc-400 hover:text-emerald-300 print:text-zinc-700 truncate max-w-[60%]"
                onClick={(e) => e.stopPropagation()}
              >
                <span className="truncate">{opp.competitor_url_to_outrank.replace(/^https?:\/\//, "")}</span>
                <ExternalLink size={10} className="shrink-0" />
              </a>
            )}
          </div>
          {opp.first_step && (
            <div className="text-[11px] mt-2 pt-2 border-t border-zinc-800 print:border-zinc-200">
              <span className="font-mono text-zinc-500">First step → </span>
              <span className="text-zinc-100 print:text-zinc-900">{opp.first_step}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500 print:text-zinc-600 ${className}`}>
      {children}
    </th>
  );
}

function fmt(n) {
  if (n == null) return "—";
  if (typeof n !== "number") return n;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toLocaleString();
}
