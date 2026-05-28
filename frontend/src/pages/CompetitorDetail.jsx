import React, { useEffect, useMemo, useRef, useState } from "react";
import { useParams, Link } from "react-router-dom";
import {
  ArrowLeft, RefreshCw, Loader2, Upload, FileSpreadsheet, Plug, ExternalLink,
  TrendingUp, BarChart3, Sparkles,
} from "lucide-react";
import api from "../lib/api";
import { Button } from "../components/ui/button";
import { toast } from "sonner";

export default function CompetitorDetail() {
  const { clientId, competitorId } = useParams();
  const [client, setClient] = useState(null);
  const [refreshing, setRefreshing] = useState({ metrics: false, keywords: false });
  const semrushInput = useRef();
  const sfInput = useRef();

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
            {m.refreshed_at ? "Refresh" : "Pull metrics"}
          </Button>
        }
      >
        {m.refreshed_at ? (
          <div className="grid grid-cols-2 md:grid-cols-6 gap-2">
            <MetricTile label="Domain Rating" value={m.domain_rating != null ? Math.round(m.domain_rating / 10) : null} max={100} tone="emerald" />
            <MetricTile label="Page Rating" value={m.page_rating != null ? Math.round(m.page_rating / 10) : null} max={100} tone="sky" />
            <MetricTile label="Backlinks" value={fmt(m.backlinks)} />
            <MetricTile label="Ref. domains" value={fmt(m.referring_domains)} />
            <MetricTile label="Dofollow domains" value={fmt(m.referring_domains_dofollow)} tone="emerald" />
            <MetricTile label="Spam score" value={m.spam_score} tone={m.spam_score >= 50 ? "rose" : m.spam_score >= 30 ? "amber" : "zinc"} />
          </div>
        ) : (
          <Empty msg="No DataForSEO metrics yet — click Pull metrics (~$0.003)." />
        )}
        {m.refreshed_at && (
          <div className="text-[10px] font-mono text-zinc-600 mt-2">Refreshed {new Date(m.refreshed_at).toLocaleString()}</div>
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
        {sf.last_uploaded_at ? (
          <SfCrawlSummary sf={sf} />
        ) : (
          <Empty msg="Upload an issues_overview or internal_all CSV exported from Screaming Frog for this competitor's site." />
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
