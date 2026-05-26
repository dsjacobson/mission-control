import React, { useEffect, useState } from "react";
import { CheckCircle2, XCircle, Loader2 } from "lucide-react";
import api from "../lib/api";

/**
 * Generic global-integration status card.
 * Reads from /api/integrations/{key}/status — expects { configured, ok, ... }.
 */
export default function IntegrationStatusCard({ icon: Icon, title, subtitle, statusPath, hint, testId }) {
  const [s, setS] = useState({ loading: true });

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      try {
        const r = await api.integrationStatus(statusPath);
        if (mounted) setS({ ...r, loading: false });
      } catch (e) {
        if (mounted) setS({ ok: false, loading: false, error: "request failed" });
      }
    };
    load();
    return () => { mounted = false; };
  }, [statusPath]);

  const renderStatus = () => {
    if (s.loading) return <Loader2 size={14} className="text-zinc-500 animate-spin" />;
    if (s.ok) return <CheckCircle2 size={14} className="text-emerald-400" />;
    if (s.configured === false) return <XCircle size={14} className="text-zinc-600" />;
    return <XCircle size={14} className="text-rose-400" />;
  };

  const statusText = () => {
    if (s.loading) return "Checking…";
    if (s.ok) return "Connected";
    if (s.configured === false) return "Not configured";
    return s.error || "Error";
  };

  const statusTone = () => {
    if (s.loading) return "text-zinc-500";
    if (s.ok) return "text-emerald-400";
    if (s.configured === false) return "text-zinc-500";
    return "text-rose-400";
  };

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5" data-testid={testId}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 grid place-items-center rounded-sm border border-zinc-800 bg-zinc-950">
            <Icon size={16} className="text-zinc-300" />
          </div>
          <div>
            <div className="font-heading text-base font-medium text-zinc-50">{title}</div>
            <div className="text-xs text-zinc-500 mt-0.5">{subtitle}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {renderStatus()}
          <span className={`text-xs font-mono uppercase tracking-wider ${statusTone()}`} data-testid={`${testId}-state`}>
            {statusText()}
          </span>
        </div>
      </div>

      {s.ok && s.sample_tools && (
        <div className="mt-4">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">
            {s.tool_count} tools available · sample
          </div>
          <div className="flex flex-wrap gap-1.5">
            {s.sample_tools.map((t) => (
              <span key={t} className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm border border-zinc-800 bg-zinc-950 text-zinc-300">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {!s.loading && !s.ok && s.error && (
        <div className="mt-3 text-xs text-rose-400 font-mono break-words">{s.error}</div>
      )}

      {hint && (
        <div className="mt-3 text-xs text-zinc-500 leading-relaxed">{hint}</div>
      )}
    </div>
  );
}
