import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Loader2, Upload, FileSpreadsheet, Plug, ExternalLink,
  TrendingUp, BarChart3, Sparkles, PlayCircle, AlertCircle,
} from "lucide-react";
import api from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

export default function CompetitorDetail() {
  const { clientId, competitorId } = useParams();
  const [client, setClient] = useState(null);
  const [refreshing, setRefreshing] = useState({ metrics: false, keywords: false });
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [activeCrawl, setActiveCrawl] = useState(null);
  const [crawlMaxUrls, setCrawlMaxUrls] = useState(200);
  const [startingCrawl, setStartingCrawl] = useState(false);
  const semrushInput = useRef();
  const sfInput = useRef();
  const pollRef = useRef(null);

  const competitor = useMemo(
    () => (client?.competitors || []).find((c) => c.id === competitorId) || null,
    [client, competitorId],
  );

  const load = async () => {
    try {
      const c = await api.getClient(clientId);
      setClient(c);
    } catch {
      toast.error("Failed to load");
    }
  };

  useEffect(() => { load(); }, [clientId, competitorId]);

  useEffect(() => {
    api.sfBridgeConfigStatus(clientId).then(setBridgeStatus).catch(() => setBridgeStatus({ configured: false }));
  }, [clientId]);

  // Restore in-flight crawl from server state
  useEffect(() => {
    const active = client?.competitors?.find((c) => c.id === competitorId)?.sf_crawl?.active_job;
    if (active?.job_id && !activeCrawl) setActiveCrawl(active);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, competitorId]);

  // Poll active SF crawl
  useEffect(() => {
    if (!activeCrawl?.job_id) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      return;
    }
    const tick = async () => {
      try {
        const st = await api.sfBridgeStatus(clientId, activeCrawl.job_id);
        const status = (st.status || "").toLowerCase();
        setActiveCrawl((prev) => prev ? { ...prev, status: st.status, urls_crawled: st.urls_crawled } : prev);
        if (["done", "completed", "finished", "success"].includes(status)) {
          clearInterval(pollRef.current); pollRef.current = null;
          toast.success("Crawl complete — ingesting…");
          try {
            await api.competitorSfBridgeIngest(clientId, competitorId, activeCrawl.job_id);
            toast.success("Crawl ingested");
            setActiveCrawl(null);
            await load();
          } catch (e) {
            toast.error(e?.response?.data?.detail || "Ingest failed");
          }
        } else if (["failed", "error"].includes(status)) {
          clearInterval(pollRef.current); pollRef.current = null;
          toast.error("Crawl failed");
          setActiveCrawl(null);
        }
      } catch (e) { /* keep polling */ }
    };
    tick();
    pollRef.current = setInterval(tick, 5000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeCrawl?.job_id]);

  const startCrawl = async () => {
    setStartingCrawl(true);
    try {
      const r = await api.competitorSfBridgeCrawl(clientId, competitorId, Math.min(crawlMaxUrls, 200));
      toast.success(`Crawl started · ${r.job_id}`);
      setActiveCrawl({ job_id: r.job_id, url: competitor?.domain, status: r.status, started_at: new Date().toISOString() });
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start crawl");
    } finally {
      setStartingCrawl(false);
    }
  };

  const refreshMetrics = async () => {
    setRefreshing((r) => ({ ...r, metrics: true }));
    try {
      const updated = await api.refreshCompetitorMetrics(clientId, competitorId);
      setClient(updated);
      toast.success("Metrics refreshed");
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refresh failed");
    } finally {
      setRefreshing((r) => ({ ...r, metrics: false }));
    }
  };

  const refreshKeywords = async () => {
    setRefreshing((r) => ({ ...r, keywords: true }));
    try {
      const updated = await api.refreshCompetitorKeywords(clientId, competitorId, 200);
      setClient(updated);
      toast.success(`Pulled keywords (${updated.competitors.find((c) => c.id === competitorId)?.ranked_keywords?.total || 0})`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refresh failed");
    } finally {
      setRefreshing((r) => ({ ...r, keywords: false }));
    }
  };

  const uploadSemrush = async (file) => {
    if (!file) return;
    try {
      const r = await api.uploadCompetitorSemrush(clientId, competitorId, file);
      toast.success(`Ingested ${r.type} · ${r.rows} rows`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    }
  };

  const uploadSf = async (file) => {
    if (!file) return;
    try {
      const r = await api.uploadCompetitorSf(clientId, competitorId, file);
      toast.success(`SF ${r.format} · ${r.rows} rows`);
      load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Upload failed");
    }
  };

  if (!competitor) {
    return (
      <div className="p-8 text-zinc-400">
        <Link to={`/clients/${clientId}/competitors`} className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-sm">
          <ArrowLeft size={13} /> Back to competitors
        </Link>
        <div className="mt-4">Competitor not found.</div>
      </div>
    );
  }

  const m = competitor.metrics || {};
  const k = competitor.ranked_keywords || {};
  const sem = competitor.semrush_uploads || {};
  const sf = competitor.sf_crawl || {};

  return (
    <div className="space-y-6" data-testid="competitor-detail">
      <div>
        <Link
          to={`/clients/${clientId}/competitors`}
          className="text-emerald-300 hover:text-emerald-200 inline-flex items-center gap-1 text-xs"
          data-testid="back-to-competitors"
        >
          <ArrowLeft size={11} /> Back to all competitors
        </Link>
        <div className="flex items-center justify-between gap-4 mt-3">
          <div>
            <h1 className="font-heading text-2xl text-zinc-50">{competitor.name}</h1>
            <a
              href={competitor.domain.startsWith("http") ? competitor.domain : `https://${competitor.domain}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-emerald-300 hover:text-emerald-200 font-mono text-xs inline-flex items-center gap-1 mt-1"
            >
              {competitor.domain} <ExternalLink size={10} />
            </a>
            {competitor.notes && <div className="text-xs text-zinc-400 mt-2 max-w-xl">{competitor.notes}</div>}
          </div>
        </div>
      </div>

      {/* Metrics block */}
      <Section
        title="Domain metrics"
        icon={BarChart3}
        action={
          <Button
            onClick={refreshMetrics}
            disabled={refreshing.metrics}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-8 text-xs"
            data-testid="refresh-metrics"
          >
            {refreshing.metrics ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <RefreshCw size={12} className="mr-1.5" />}
            {m.refreshed_at ? "Refresh" : "Pull metrics (Semrush)"}
          </Button>
        }
      >
        {m.refreshed_at ? (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <MetricTile label="Authority Score" value={m.authority_score} tone="emerald" />
            <MetricTile label="Backlinks" value={fmt(m.backlinks)} />
            <MetricTile label="Ref. domains" value={fmt(m.referring_domains)} />
            <MetricTile label="Dofollow domains" value={fmt(m.referring_domains_dofollow)} tone="emerald" />
            <MetricTile label="Organic KWs" value={fmt(m.organic_keywords)} tone="sky" />
            <MetricTile label="Organic traffic" value={fmt(m.organic_traffic)} tone="sky" />
          </div>
        ) : (
          <Empty msg="No metrics yet — click Refresh to pull live backlinks + traffic from Semrush." />
        )}
        {m.refreshed_at && (
          <div className="text-[10px] font-mono text-zinc-600 mt-2">
            Refreshed {new Date(m.refreshed_at).toLocaleString()} · source: {m.source || "—"}
            {m.domain_rating != null && <> · DR {Math.round(m.domain_rating / 10)} (DataForSEO)</>}
            {m.spam_score != null && <> · spam {m.spam_score}</>}
          </div>
        )}
      </Section>

      {/* Ranked keywords */}
      <Section
        title="Ranked keywords (DataForSEO)"
        icon={TrendingUp}
        action={
          <Button
            onClick={refreshKeywords}
            disabled={refreshing.keywords}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-8 text-xs"
            data-testid="refresh-keywords"
          >
            {refreshing.keywords ? <Loader2 size={12} className="animate-spin mr-1.5" /> : <Sparkles size={12} className="mr-1.5" />}
            {k.refreshed_at ? "Refresh (~$0.02)" : "Pull keywords (~$0.02)"}
          </Button>
        }
      >
        {k.items?.length > 0 ? (
          <RankedKeywordsTable items={k.items} refreshedAt={k.refreshed_at} />
        ) : (
          <Empty msg="No ranked keyword data yet. Click Pull keywords to fetch the top 200 by Semrush volume." />
        )}
      </Section>

      {/* Semrush uploads */}
      <Section
        title="Semrush CSV uploads"
        icon={FileSpreadsheet}
        action={
          <>
            <input
              ref={semrushInput}
              type="file"
              accept=".csv"
              onChange={(e) => { uploadSemrush(e.target.files?.[0]); e.target.value = ""; }}
              className="hidden"
            />
            <Button
              onClick={() => semrushInput.current?.click()}
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-8 text-xs"
              data-testid="upload-competitor-semrush"
            >
              <Upload size={12} className="mr-1.5" /> Upload CSV
            </Button>
          </>
        }
      >
        <UploadsList uploads={sem} />
      </Section>

      {/* SF crawl */}
      <Section
        title="Screaming Frog crawl"
        icon={Plug}
        action={
          <>
            <input
              ref={sfInput}
              type="file"
              accept=".csv"
              onChange={(e) => { uploadSf(e.target.files?.[0]); e.target.value = ""; }}
              className="hidden"
            />
            <Button
              onClick={() => sfInput.current?.click()}
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-8 text-xs"
              data-testid="upload-competitor-sf"
            >
              <Upload size={12} className="mr-1.5" /> Upload SF CSV
            </Button>
          </>
        }
      >
        <SfBridgePanel
          clientId={clientId}
          competitor={competitor}
          bridgeStatus={bridgeStatus}
          activeCrawl={activeCrawl}
          crawlMaxUrls={crawlMaxUrls}
          setCrawlMaxUrls={setCrawlMaxUrls}
          onStart={startCrawl}
          starting={startingCrawl}
        />
        {sf.last_uploaded_at ? (
          <div className="mt-3"><SfCrawlSummary sf={sf} /></div>
        ) : (
          <div className="mt-3"><Empty msg="Upload an issues_overview or internal_all CSV, or trigger a crawl via your local bridge above." /></div>
        )}
      </Section>
    </div>
  );
}

function fmt(n) {
  if (n == null) return "—";
  if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k`;
  return n.toLocaleString();
}

function Section({ title, icon: Icon, action, children }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-5">
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-center gap-2">
          {Icon && <Icon size={14} className="text-zinc-400" />}
          <h2 className="font-heading text-sm text-zinc-100">{title}</h2>
        </div>
        <div className="flex items-center gap-2">{action}</div>
      </div>
      {children}
    </div>
  );
}

function MetricTile({ label, value, tone = "zinc" }) {
  const cls =
    tone === "emerald" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-200"
    : tone === "sky" ? "border-sky-400/30 bg-sky-400/10 text-sky-200"
    : tone === "amber" ? "border-amber-400/30 bg-amber-400/10 text-amber-200"
    : tone === "rose" ? "border-rose-400/30 bg-rose-400/10 text-rose-200"
    : "border-zinc-800 bg-zinc-900 text-zinc-100";
  return (
    <div className={`rounded-sm border ${cls} px-3 py-2.5`}>
      <div className="text-[10px] font-mono uppercase tracking-wider opacity-70">{label}</div>
      <div className="font-heading text-lg mt-0.5">{value ?? "—"}</div>
    </div>
  );
}

function Empty({ msg }) {
  return <div className="text-xs text-zinc-500 italic py-2">{msg}</div>;
}

function RankedKeywordsTable({ items, refreshedAt }) {
  return (
    <>
      <div className="rounded-sm border border-zinc-800 overflow-hidden">
        <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="bg-zinc-900 border-b border-zinc-800 sticky top-0">
              <tr>
                <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">Keyword</th>
                <th className="text-right px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">Pos</th>
                <th className="text-right px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">Volume</th>
                <th className="text-right px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">ETV</th>
                <th className="text-left px-3 py-2 font-mono uppercase tracking-wider text-[10px] text-zinc-500">URL</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 500).map((k, i) => (
                <tr key={i} className="border-b border-zinc-800 last:border-b-0">
                  <td className="px-3 py-2 text-zinc-100">{k.keyword}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200">{k.position ?? "—"}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200">{fmt(k.search_volume)}</td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-200">{fmt(k.etv)}</td>
                  <td className="px-3 py-2 max-w-xs">
                    {k.url ? (
                      <a href={k.url} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 font-mono text-[10px] break-all">
                        {k.url.length > 60 ? k.url.slice(0, 57) + "…" : k.url}
                      </a>
                    ) : <span className="text-zinc-600">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="text-[10px] font-mono text-zinc-600 mt-2">
        {items.length} keywords · refreshed {new Date(refreshedAt).toLocaleString()}
      </div>
    </>
  );
}

function UploadsList({ uploads }) {
  const entries = Object.entries(uploads).filter(([k]) => k !== "last_uploaded_at");
  if (!entries.length) return <Empty msg="No Semrush uploads yet. Supported: Domain Overview, Organic Positions, Competitors, Backlinks, Keyword Gap." />;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {entries.map(([type, data]) => (
        <div key={type} className="rounded-sm border border-zinc-800 bg-zinc-900 p-3" data-testid={`competitor-semrush-${type}`}>
          <div className="text-zinc-100 text-sm capitalize">{type.replace(/_/g, " ")}</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            {data.rows} rows · {data.filename} · {new Date(data.ingested_at).toLocaleDateString()}
          </div>
        </div>
      ))}
    </div>
  );
}

function SfCrawlSummary({ sf }) {
  const has_issues = (sf.issues || []).length > 0;
  const has_pages = (sf.page_index || []).length > 0;
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
      {has_issues && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-3">
          <div className="text-zinc-100 text-sm">Issues overview</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            {sf.issues.length} issues · {sf.issues_filename}
          </div>
        </div>
      )}
      {has_pages && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-3">
          <div className="text-zinc-100 text-sm">Page index</div>
          <div className="text-[10px] font-mono text-zinc-500 mt-0.5">
            {sf.page_index.length} URLs · {sf.page_index_filename}
          </div>
        </div>
      )}
    </div>
  );
}

function SfBridgePanel({ clientId, competitor, bridgeStatus, activeCrawl, crawlMaxUrls, setCrawlMaxUrls, onStart, starting }) {
  const ready = bridgeStatus?.configured && bridgeStatus?.health?.ok;
  if (!ready) {
    return (
      <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-3 flex items-start gap-3" data-testid="bridge-not-ready">
        <AlertCircle size={13} className="text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-zinc-400">
          Local Screaming Frog bridge isn't reachable.{" "}
          <Link to={`/clients/${clientId}/integrations`} className="text-emerald-300 hover:underline">Configure it</Link>{" "}
          to trigger competitor crawls in-app.
        </div>
      </div>
    );
  }
  if (activeCrawl?.job_id) {
    return (
      <div className="rounded-sm border border-emerald-400/30 bg-emerald-400/[0.06] p-3 flex items-center gap-3" data-testid="active-competitor-crawl">
        <Loader2 size={13} className="text-emerald-400 animate-spin shrink-0" />
        <div className="text-xs text-zinc-200 flex-1">
          <div>Crawling <span className="font-mono text-emerald-300">{activeCrawl.url}</span> · {activeCrawl.status || "running"}</div>
          {activeCrawl.urls_crawled != null && (
            <div className="text-[10px] text-zinc-500 font-mono mt-0.5">{activeCrawl.urls_crawled} URLs crawled · job {activeCrawl.job_id}</div>
          )}
        </div>
      </div>
    );
  }
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-3 flex flex-wrap items-end gap-3" data-testid="start-competitor-crawl-panel">
      <div className="grid gap-1">
        <Label className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Max URLs (≤200)</Label>
        <Input
          type="number"
          min={10}
          max={200}
          step={10}
          value={crawlMaxUrls}
          onChange={(e) => setCrawlMaxUrls(Math.min(200, Math.max(10, parseInt(e.target.value || "200", 10))))}
          className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 w-24 h-8 text-xs"
          data-testid="competitor-crawl-max-input"
        />
      </div>
      <Button
        onClick={onStart}
        disabled={starting || !competitor?.domain}
        className="bg-emerald-400/90 text-zinc-950 hover:bg-emerald-300 rounded-sm h-8 text-xs"
        data-testid="start-competitor-sf-crawl"
      >
        {starting ? <Loader2 size={12} className="mr-1.5 animate-spin" /> : <PlayCircle size={12} className="mr-1.5" />}
        Crawl {competitor?.domain} via local bridge
      </Button>
    </div>
  );
}
