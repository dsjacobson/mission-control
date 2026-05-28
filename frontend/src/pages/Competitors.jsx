import React, { useEffect, useRef, useState } from "react";
import { useParams, Link, useNavigate } from "react-router-dom";
import { Plus, Trash2, RefreshCw, ChevronRight, Loader2, Sparkles, FileText } from "lucide-react";
import api from "../lib/api";
import { PageHeader, Section, EmptyState } from "../components/Bits";
import { useClients } from "../lib/ClientContext";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { Textarea } from "../components/ui/textarea";
import { toast } from "sonner";

export default function Competitors() {
  const { clientId } = useParams();
  const navigate = useNavigate();
  const { activeClient, setActiveClientId, refresh } = useClients();
  const [client, setClient] = useState(null);
  const [comparison, setComparison] = useState(null);
  const [form, setForm] = useState({ name: "", domain: "", notes: "" });
  const [busy, setBusy] = useState(false);
  const [refreshingClient, setRefreshingClient] = useState(false);
  const [refreshingAll, setRefreshingAll] = useState(false);
  const [generatingDeliverable, setGeneratingDeliverable] = useState(false);
  const [pendingDeliverables, setPendingDeliverables] = useState([]);
  const deliverablePollRef = useRef(null);

  useEffect(() => {
    setActiveClientId(clientId);
  }, [clientId, setActiveClientId]);

  useEffect(() => {
    let mounted = true;
    api.getClient(clientId).then((c) => { if (mounted) setClient(c); }).catch(() => {});
    return () => { mounted = false; };
  }, [clientId, activeClient]);

  const loadComparison = async () => {
    try {
      const r = await api.competitorsComparison(clientId);
      setComparison(r);
    } catch {}
  };

  useEffect(() => { loadComparison(); }, [clientId, client?.competitors?.length]);

  const refreshClientMetrics = async () => {
    setRefreshingClient(true);
    try {
      await api.refreshClientMetrics(clientId);
      toast.success("Refreshed client metrics");
      await loadComparison();
      const c = await api.getClient(clientId);
      setClient(c);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refresh failed");
    } finally {
      setRefreshingClient(false);
    }
  };

  const refreshAll = async () => {
    setRefreshingAll(true);
    try {
      const r = await api.refreshAllCompetitorMetrics(clientId);
      if (r.failed?.length) {
        toast.warning(`Refreshed ${r.refreshed} · ${r.failed.length} failed: ${r.failed.map((f) => f.name).join(", ")}`);
      } else {
        toast.success(`Refreshed ${r.refreshed} target${r.refreshed === 1 ? "" : "s"}`);
      }
      await loadComparison();
      if (r.client) setClient(r.client);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Bulk refresh failed");
    } finally {
      setRefreshingAll(false);
    }
  };

  const loadPendingDeliverables = async () => {
    try {
      const rows = await api.listApprovals({ client_id: clientId, status: "pending" });
      setPendingDeliverables((rows || []).filter((a) => a.kind === "competitive_deliverable"));
    } catch {}
  };

  // cleanup
  useEffect(() => () => {
    if (deliverablePollRef.current) clearInterval(deliverablePollRef.current);
  }, []);

  useEffect(() => {
    loadPendingDeliverables();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  const generateDeliverable = async () => {
    if (!client?.competitors?.length) {
      toast.error("Add at least one competitor first");
      return;
    }
    const hasMetrics = client.competitors.some((c) => c.metrics?.refreshed_at);
    if (!hasMetrics) {
      toast.error("Refresh competitor metrics first ('Refresh all' button)");
      return;
    }
    setGeneratingDeliverable(true);
    try {
      const run = await api.createRun({
        client_id: clientId,
        type: "competitive_deliverable",
        objective: "Generate full client-facing competitive analysis deliverable",
      });
      toast.success("Generating deliverable… this takes ~30s");

      // Poll the run until completion, then find the new approval
      const startedAt = Date.now();
      deliverablePollRef.current = setInterval(async () => {
        try {
          const r = await api.getRun(run.id);
          if (r.status === "completed") {
            clearInterval(deliverablePollRef.current);
            deliverablePollRef.current = null;
            // Find the matching approval
            const approvals = await api.listApprovals({ client_id: clientId });
            const match = (approvals || []).find(
              (a) => a.run_id === run.id && a.kind === "competitive_deliverable",
            );
            setGeneratingDeliverable(false);
            if (match) {
              toast.success("Deliverable ready — review & approve below");
              // Go straight to the full deliverable view; user can approve from there
              navigate(`/clients/${clientId}/deliverables/competitive/${match.id}`);
            } else {
              toast.error("Run completed but no deliverable approval found");
            }
          } else if (r.status === "failed") {
            clearInterval(deliverablePollRef.current);
            deliverablePollRef.current = null;
            setGeneratingDeliverable(false);
            toast.error(`Generation failed: ${r.error || "unknown error"}`);
          } else if (Date.now() - startedAt > 5 * 60 * 1000) {
            clearInterval(deliverablePollRef.current);
            deliverablePollRef.current = null;
            setGeneratingDeliverable(false);
            toast.error("Generation timed out after 5 minutes");
          }
        } catch (e) { /* keep polling */ }
      }, 3000);
    } catch (e) {
      setGeneratingDeliverable(false);
      toast.error(e?.response?.data?.detail || "Failed to start generation");
    }
  };

  // cleanup
  useEffect(() => () => {
    if (deliverablePollRef.current) clearInterval(deliverablePollRef.current);
  }, []);

  const add = async () => {
    if (!form.name.trim() || !form.domain.trim()) {
      toast.error("Name and domain required");
      return;
    }
    setBusy(true);
    try {
      const c = await api.addCompetitor(clientId, form);
      setClient(c);
      refresh();
      setForm({ name: "", domain: "", notes: "" });
      toast.success("Competitor added");
    } catch {
      toast.error("Failed to add competitor");
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    try {
      const c = await api.removeCompetitor(clientId, id);
      setClient(c);
      refresh();
      toast.success("Competitor removed");
    } catch {
      toast.error("Failed to remove");
    }
  };

  return (
    <div data-testid="competitors-page">
      <PageHeader
        kicker={client?.name || "Workspace"}
        title="Competitors"
        description="Tracked competitors are used by the Competitor Analysis Agent."
      >
        <Button
          onClick={generateDeliverable}
          disabled={generatingDeliverable || !client?.competitors?.length}
          className="bg-emerald-400/90 text-zinc-950 hover:bg-emerald-300 rounded-sm"
          data-testid="generate-deliverable-btn"
          title="Synthesize a client-ready competitive analysis report from your cached data"
        >
          {generatingDeliverable ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Sparkles size={13} className="mr-1.5" />}
          {generatingDeliverable ? "Generating…" : "Generate Client Deliverable"}
        </Button>
      </PageHeader>

      {pendingDeliverables.length > 0 && (
        <div className="px-8 py-3 border-b border-zinc-800 bg-amber-400/[0.04]" data-testid="pending-deliverables-banner">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="text-xs text-zinc-300 flex items-center gap-2">
              <Sparkles size={12} className="text-amber-400" />
              <span>
                {pendingDeliverables.length} pending deliverable{pendingDeliverables.length === 1 ? "" : "s"} awaiting your approval — they won't appear in the Deliverables tab until you approve.
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {pendingDeliverables.slice(0, 3).map((a) => (
                <Link
                  key={a.id}
                  to={`/clients/${clientId}/deliverables/competitive/${a.id}`}
                  className="inline-flex items-center gap-1.5 text-[11px] px-2 py-1 bg-zinc-900 border border-zinc-700 hover:border-amber-400/40 rounded-sm text-zinc-200"
                  data-testid={`open-pending-${a.id}`}
                >
                  <FileText size={10} />
                  Review
                  <ChevronRight size={10} />
                </Link>
              ))}
            </div>
          </div>
        </div>
      )}

      <Section title="Add a competitor" testId="add-competitor-section">
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-4 grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Name</Label>
            <Input
              data-testid="competitor-name-input"
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100"
              placeholder="Acme Rival"
            />
          </div>
          <div className="grid gap-1.5">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Domain</Label>
            <Input
              data-testid="competitor-domain-input"
              value={form.domain}
              onChange={(e) => setForm({ ...form, domain: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100"
              placeholder="rival.com"
            />
          </div>
          <div className="grid gap-1.5 md:row-span-2">
            <Label className="text-zinc-300 text-xs font-mono uppercase tracking-wider">Notes</Label>
            <Textarea
              data-testid="competitor-notes-input"
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 min-h-[88px]"
              placeholder="Why we track them."
            />
          </div>
          <div className="md:col-span-2 flex items-end">
            <Button
              onClick={add}
              disabled={busy}
              data-testid="add-competitor-btn"
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
            >
              <Plus size={14} className="mr-1.5" /> Add competitor
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Competitor comparison"
        description="Side-by-side metrics. Pulls authority + backlinks + organic traffic from Semrush (your Semrush MCP key)."
        testId="comparison-section"
        action={
          <Button
            onClick={refreshAll}
            disabled={refreshingAll || !client?.competitors?.length}
            className="bg-emerald-400/90 text-zinc-950 hover:bg-emerald-300 rounded-sm h-8 text-xs"
            data-testid="refresh-all-competitors-btn"
            title="Refresh metrics for the client + every tracked competitor in parallel"
          >
            {refreshingAll ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <RefreshCw size={12} className="mr-1.5" />}
            Refresh all
          </Button>
        }
      >
        <ComparisonOverview comparison={comparison} onRefreshClient={refreshClientMetrics} refreshingClient={refreshingClient} />
      </Section>

      <Section title="Tracked competitors" testId="competitors-list">
        {!client || (client.competitors || []).length === 0 ? (
          <EmptyState testId="empty-competitors" title="No competitors yet" description="Add at least one to enable competitor analysis." />
        ) : (
          <div className="space-y-2">
            {client.competitors.map((c) => (
              <CompetitorRow
                key={c.id}
                clientId={clientId}
                competitor={c}
                onRemove={() => remove(c.id)}
              />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function ComparisonOverview({ comparison, onRefreshClient, refreshingClient }) {
  if (!comparison || !comparison.rows || comparison.rows.length === 0) {
    return (
      <div className="rounded-sm border border-dashed border-zinc-800 bg-zinc-950 p-6 text-center text-xs text-zinc-500">
        Add competitors and refresh their metrics to see comparison data.
      </div>
    );
  }
  const fmt = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n.toLocaleString());
  const scaled = (n) => (n == null ? "—" : Math.round(n / 10));

  return (
    <div className="space-y-3">
      <div className="rounded-sm border border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-950 border-b border-zinc-800">
              <tr>
                <Th>Site</Th>
                <Th className="text-right">Authority</Th>
                <Th className="text-right">Backlinks</Th>
                <Th className="text-right">Ref. domains</Th>
                <Th className="text-right">Dofollow</Th>
                <Th className="text-right">Org. KWs</Th>
                <Th className="text-right">Org. Traffic</Th>
                <Th className="text-right">Ranked KWs</Th>
                <Th className="text-right">SF pages</Th>
                <Th></Th>
              </tr>
            </thead>
            <tbody>
              {comparison.rows.map((r, i) => {
                const m = r.metrics || {};
                return (
                  <tr
                    key={r.id || "client"}
                    className={`border-b border-zinc-800 last:border-b-0 ${r.is_client ? "bg-emerald-400/[0.04]" : "hover:bg-zinc-900/40"}`}
                    data-testid={`comparison-row-${r.is_client ? "client" : r.id}`}
                  >
                    <td className="px-3 py-2.5">
                      <div className="text-zinc-100">
                        {r.name} {r.is_client && <span className="ml-1 text-[9px] font-mono uppercase tracking-wider text-emerald-400">you</span>}
                      </div>
                      <div className="text-[10px] text-zinc-500 font-mono">{r.domain}</div>
                    </td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{m.authority_score ?? "—"}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(m.backlinks)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(m.referring_domains)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(m.referring_domains_dofollow)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(m.organic_keywords)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(m.organic_traffic)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(r.ranked_keywords_total)}</td>
                    <td className="px-3 py-2.5 text-right font-mono text-zinc-200">{fmt(r.sf_pages)}</td>
                    <td className="px-3 py-2.5 text-right">
                      {r.is_client ? (
                        <button
                          onClick={onRefreshClient}
                          disabled={refreshingClient}
                          className="text-zinc-400 hover:text-zinc-100 disabled:opacity-50"
                          data-testid="refresh-client-metrics"
                          title="Refresh client metrics from Semrush"
                        >
                          {refreshingClient ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                        </button>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {comparison.deltas && comparison.deltas.length > 0 && (
        <div className="rounded-sm border border-amber-400/20 bg-amber-400/[0.04] p-3 space-y-1.5" data-testid="deltas-callout">
          <div className="text-[10px] font-mono uppercase tracking-wider text-amber-300 mb-1">Where you lag</div>
          {comparison.deltas.map((d, i) => (
            <div key={i} className="text-[11px] text-zinc-300">
              <span className="text-zinc-100 font-medium">{d.competitor}</span>
              {" leads on "}<span className="text-amber-300">{d.label || d.type}</span>
              {": "}
              <span className="font-mono text-amber-300">{Number(d.their_value).toLocaleString()}</span>
              {" vs your "}
              <span className="font-mono">{Number(d.your_value).toLocaleString()}</span>
              {" (gap "}
              <span className="font-mono text-amber-300">{Number(d.gap).toLocaleString()}</span>
              {")"}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function Th({ children, className = "" }) {
  return (
    <th className={`text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500 ${className}`}>
      {children}
    </th>
  );
}

function CompetitorRow({ clientId, competitor, onRemove }) {
  const m = competitor.metrics || {};
  const hasMetrics = m.domain_rating != null;
  const hasKws = (competitor.ranked_keywords?.total || 0) > 0;
  const hasSemrush = Object.keys(competitor.semrush_uploads || {}).length > 0;
  const hasSf = (competitor.sf_crawl?.page_index?.length || 0) > 0 || (competitor.sf_crawl?.issues?.length || 0) > 0;

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-4 flex items-start justify-between gap-4" data-testid={`competitor-card-${competitor.id}`}>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <Link
            to={`/clients/${clientId}/competitors/${competitor.id}`}
            className="text-zinc-100 hover:text-emerald-300 font-heading text-base font-medium"
          >
            {competitor.name}
          </Link>
          <span className="text-[11px] text-zinc-500 font-mono">{competitor.domain}</span>
        </div>
        {competitor.notes && <div className="text-[11px] text-zinc-400 mt-1">{competitor.notes}</div>}
        <div className="flex flex-wrap items-center gap-1.5 mt-2">
          <DataPill on={hasMetrics} label={hasMetrics ? `DR ${Math.round((m.domain_rating || 0) / 10)}` : "No metrics"} />
          <DataPill on={hasKws} label={hasKws ? `${competitor.ranked_keywords.total} keywords` : "No keywords"} />
          <DataPill on={hasSemrush} label={hasSemrush ? `${Object.keys(competitor.semrush_uploads).filter((k) => k !== "last_uploaded_at").length} Semrush uploads` : "No Semrush data"} />
          <DataPill on={hasSf} label={hasSf ? `SF crawl loaded` : "No SF crawl"} />
        </div>
      </div>
      <div className="shrink-0 flex items-center gap-1.5">
        <Link
          to={`/clients/${clientId}/competitors/${competitor.id}`}
          className="inline-flex items-center gap-1 px-3 py-1.5 rounded-sm bg-zinc-50 text-zinc-950 hover:bg-zinc-200 text-xs font-medium"
          data-testid={`view-competitor-${competitor.id}`}
        >
          View <ChevronRight size={12} />
        </Link>
        <button
          data-testid={`remove-competitor-${competitor.id}`}
          onClick={onRemove}
          className="text-zinc-500 hover:text-rose-400 p-1.5 rounded-sm"
        >
          <Trash2 size={13} />
        </button>
      </div>
    </div>
  );
}

function DataPill({ on, label }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded-sm border font-mono text-[10px] ${
      on ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300" : "border-zinc-800 bg-zinc-900 text-zinc-500"
    }`}>
      {label}
    </span>
  );
}
