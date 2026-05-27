import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import {
  RefreshCw, Loader2, Search, ExternalLink, Star, MapPin, Scan,
  AlertTriangle, Globe, TrendingDown, ChevronRight, FileSearch, X,
  Map as MapIcon, Sparkles, Check, Lightbulb,
} from "lucide-react";
import api from "../lib/api";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "../components/ui/dialog";
import { Label } from "../components/ui/label";
import { toast } from "sonner";

const STATUS_TONE = {
  aligned:           { label: "Aligned",          cls: "border-emerald-400/30 bg-emerald-400/10 text-emerald-300", icon: MapPin },
  cannibalized:      { label: "Cannibalized",     cls: "border-rose-400/30 bg-rose-400/10 text-rose-300",         icon: AlertTriangle },
  wrong_page:        { label: "Wrong page",       cls: "border-amber-400/30 bg-amber-400/10 text-amber-300",      icon: ChevronRight },
  missing_page:      { label: "Missing page",     cls: "border-sky-400/30 bg-sky-400/10 text-sky-300",            icon: Globe },
  under_optimized:   { label: "Under-optimized",  cls: "border-violet-400/30 bg-violet-400/10 text-violet-300",   icon: TrendingDown },
  low_position:      { label: "Low position",     cls: "border-zinc-500/40 bg-zinc-700/30 text-zinc-300",         icon: TrendingDown },
  unknown:           { label: "Unknown",          cls: "border-zinc-700 bg-zinc-900 text-zinc-400",               icon: Scan },
};

const SOURCE_LABEL = { gsc: "GSC", semrush_pos: "Semrush", semrush_gap: "Gap" };

export default function KeywordMap() {
  const { clientId } = useParams();
  const [map, setMap] = useState(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [drawerKw, setDrawerKw] = useState(null);
  const [showSparse, setShowSparse] = useState(false);
  const [showRefined, setShowRefined] = useState(false);
  const [refineModalOpen, setRefineModalOpen] = useState(false);
  const [refinementState, setRefinementState] = useState(null);
  const [urlRefinements, setUrlRefinements] = useState({});

  const load = async () => {
    setLoading(true);
    try {
      const r = await api.getKeywordMap(clientId);
      setMap(r);
    } catch (e) {
      toast.error("Failed to load keyword map");
    } finally {
      setLoading(false);
    }
  };

  const loadRefinementStatus = async () => {
    try {
      const r = await api.refinementStatus(clientId);
      setRefinementState(r.refinement);
      return r;
    } catch {
      return null;
    }
  };

  const loadRefinements = async () => {
    try {
      const r = await api.listRefinements(clientId);
      setUrlRefinements(r.refinements || {});
    } catch {}
  };

  useEffect(() => {
    load();
    loadRefinementStatus();
    loadRefinements();
  }, [clientId]);

  // Poll refinement progress while it's running
  useEffect(() => {
    if (!refinementState || refinementState.status !== "running") return;
    let stop = false;
    const tick = async () => {
      if (stop) return;
      const r = await loadRefinementStatus();
      if (r?.refinement?.status === "done") {
        await loadRefinements();
        toast.success(`Refinement complete · ${r.refinement.completed}/${r.refinement.total}`);
        return;
      }
      if (r?.refinement?.status === "failed") {
        toast.error(`Refinement failed: ${r.refinement.error || "unknown"}`);
        return;
      }
      setTimeout(tick, 3000);
    };
    setTimeout(tick, 3000);
    return () => { stop = true; };
  }, [refinementState?.status, refinementState?.job_id]);

  const onBuild = async () => {
    setBuilding(true);
    try {
      const r = await api.buildKeywordMap(clientId);
      toast.success(`Built · ${r.stats?.total_keywords || 0} keywords`);
      await load();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Build failed");
    } finally {
      setBuilding(false);
    }
  };

  const keywords = useMemo(() => {
    if (!map?.keywords) return [];
    let arr = Object.values(map.keywords);
    if (query.trim()) {
      const q = query.toLowerCase().trim();
      arr = arr.filter((k) =>
        (k.keyword || "").toLowerCase().includes(q) ||
        (k.current_url || "").toLowerCase().includes(q),
      );
    }
    if (statusFilter !== "all") arr = arr.filter((k) => k.status === statusFilter);
    arr.sort((a, b) => {
      if (a.priority && !b.priority) return -1;
      if (b.priority && !a.priority) return 1;
      return (b.search_volume || 0) - (a.search_volume || 0);
    });
    return arr;
  }, [map, query, statusFilter]);

  const stats = map?.stats || {};
  const byStatus = stats.by_status || {};
  const sources = stats.sources || {};

  return (
    <div className="space-y-6" data-testid="keyword-map-page">
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2">
            <MapIcon size={16} className="text-emerald-400" />
            <h1 className="font-heading text-2xl font-medium text-zinc-50">Keyword Map</h1>
          </div>
          <p className="text-xs text-zinc-500 mt-1.5 max-w-2xl leading-relaxed">
            Every keyword mapped to the URL that should own it. Built from GSC + Semrush organic positions + keyword gap.
            Use this as the source of truth before running on-page optimization, content briefs, or strategy synthesis.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => setShowRefined(!showRefined)}
            variant="ghost"
            className="text-violet-300 hover:bg-violet-400/10 hover:text-violet-200 rounded-sm"
            data-testid="toggle-refined-panel"
          >
            <Sparkles size={13} className="mr-1.5" />
            {Object.keys(urlRefinements).length > 0
              ? `${Object.keys(urlRefinements).length} refined`
              : "Refined URLs"}
          </Button>
          <Button
            onClick={() => setShowSparse(!showSparse)}
            variant="ghost"
            className="text-zinc-300 hover:bg-zinc-800 rounded-sm"
            data-testid="toggle-sparse-pages"
          >
            <FileSearch size={13} className="mr-1.5" />
            {showSparse ? "Hide sparse pages" : "Sparse pages"}
          </Button>
          <Button
            onClick={() => setRefineModalOpen(true)}
            disabled={refinementState?.status === "running"}
            variant="ghost"
            className="text-violet-300 hover:bg-violet-400/10 hover:text-violet-200 rounded-sm border border-violet-400/30"
            data-testid="open-refine-modal"
          >
            {refinementState?.status === "running" ? (
              <>
                <Loader2 size={13} className="mr-1.5 animate-spin" />
                Refining {refinementState.completed}/{refinementState.total}
              </>
            ) : (
              <>
                <Sparkles size={13} className="mr-1.5" />
                Refine with AI
              </>
            )}
          </Button>
          <Button
            onClick={onBuild}
            disabled={building}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
            data-testid="build-keyword-map"
          >
            {building ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <RefreshCw size={13} className="mr-1.5" />}
            {map?.built_at ? "Rebuild" : "Build map"}
          </Button>
        </div>
      </div>

      <RefineModal
        open={refineModalOpen}
        onOpenChange={setRefineModalOpen}
        clientId={clientId}
        onStarted={(s) => { setRefinementState(s); setRefineModalOpen(false); }}
      />

      {/* Stats strip */}
      <div className="grid grid-cols-2 md:grid-cols-7 gap-2">
        <StatTile label="Total keywords" value={stats.total_keywords || 0} testId="stat-total" highlight />
        {Object.entries(STATUS_TONE).filter(([k]) => k !== "unknown").map(([k, def]) => (
          <StatTile
            key={k}
            label={def.label}
            value={byStatus[k] || 0}
            testId={`stat-${k}`}
            tone={k}
            onClick={() => setStatusFilter(statusFilter === k ? "all" : k)}
            active={statusFilter === k}
          />
        ))}
      </div>

      {/* Source indicators */}
      <div className="flex items-center gap-3 text-[11px] font-mono text-zinc-500">
        <span className="text-zinc-600 uppercase tracking-wider">Sources:</span>
        <SourcePill active={sources.gsc} label="GSC" />
        <SourcePill active={sources.semrush_positions} label="Semrush organic" />
        <SourcePill active={sources.semrush_gap} label="Semrush gap" />
        {map?.built_at && (
          <span className="ml-auto text-zinc-600">Built {new Date(map.built_at).toLocaleString()}</span>
        )}
      </div>

      {showRefined && (
        <RefinedUrlsPanel refinements={urlRefinements} onClose={() => setShowRefined(false)} />
      )}

      {showSparse && (
        <SparsePagesPanel clientId={clientId} onClose={() => setShowSparse(false)} onAnalyzed={load} />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search keyword or URL"
            className="pl-8 bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 text-sm"
            data-testid="keyword-map-search"
          />
        </div>
        {statusFilter !== "all" && (
          <Button onClick={() => setStatusFilter("all")} variant="ghost" className="text-zinc-400 hover:bg-zinc-800 rounded-sm text-xs">
            <X size={11} className="mr-1" /> Clear filter: {STATUS_TONE[statusFilter]?.label}
          </Button>
        )}
        <div className="text-xs text-zinc-500 font-mono ml-auto">
          {keywords.length} shown
        </div>
      </div>

      {/* Table */}
      {loading ? (
        <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-8 text-center text-zinc-500 text-sm">
          <Loader2 className="inline animate-spin mr-2" size={14} /> Loading…
        </div>
      ) : !map?.keywords || Object.keys(map.keywords).length === 0 ? (
        <EmptyState onBuild={onBuild} building={building} />
      ) : (
        <KeywordTable rows={keywords} urlRefinements={urlRefinements} onSelect={setDrawerKw} />
      )}

      {drawerKw && (
        <KeywordDrawer
          clientId={clientId}
          keyword={drawerKw}
          fullData={map.keywords[drawerKw]}
          urlRefinements={urlRefinements}
          onClose={() => setDrawerKw(null)}
          onChanged={load}
        />
      )}
    </div>
  );
}

function RefineModal({ open, onOpenChange, clientId, onStarted }) {
  const [pageTotal, setPageTotal] = useState(0);
  const [limit, setLimit] = useState(100);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const r = await api.refinementStatus(clientId);
      setPageTotal(r.page_index_total || 0);
      if (r.page_index_total && r.page_index_total < 100) setLimit(r.page_index_total);
    })();
  }, [open, clientId]);

  const effLimit = Math.min(Math.max(1, Number(limit) || 1), pageTotal || 5000);
  const estCost = (effLimit * 0.002).toFixed(2);  // ~$0.001 AI + ~$0.001 DFS keyword suggestions
  const estTime = Math.ceil(effLimit / 5 * 1.5);   // 5 in parallel, ~1.5s each

  const start = async () => {
    setBusy(true);
    try {
      const r = await api.startRefinement(clientId, effLimit);
      toast.success(`Refining ${r.total} URLs… this will take a few minutes`);
      onStarted?.(r);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-zinc-950 border-zinc-800" data-testid="refine-modal">
        <DialogHeader>
          <DialogTitle className="text-zinc-100 flex items-center gap-2">
            <Sparkles size={16} className="text-violet-400" />
            Refine with AI · relevance-first
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 text-sm text-zinc-300 leading-relaxed">
          <p>
            For each URL in your Screaming Frog page index, an AI agent fetches the page,
            reads the actual content, and picks the most <strong className="text-zinc-100">relevant</strong> primary
            keyword — not just whatever Semrush currently sees ranking. Long-tail variants like
            "sicilian baked cassata recipe" win over broad terms like "cassata" when they
            fit the page better.
          </p>
          <p className="text-zinc-500 text-xs">
            URLs are ranked by Inlinks (most important pages first). DataForSEO is also queried
            for related keyword variants for each URL.
          </p>

          <div className="space-y-2 pt-2">
            <Label className="text-xs text-zinc-400">How many URLs to refine</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min="1"
                max={pageTotal || 5000}
                value={limit}
                onChange={(e) => setLimit(e.target.value)}
                className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono"
                data-testid="refine-limit-input"
              />
              <span className="text-xs text-zinc-500 whitespace-nowrap">
                of <span className="text-zinc-300">{pageTotal.toLocaleString()}</span> pages
              </span>
            </div>
            <div className="flex flex-wrap gap-1.5 pt-1">
              {[25, 100, 250, 500, pageTotal].filter((n, i, a) => n && a.indexOf(n) === i).map((n) => (
                <button
                  key={n}
                  onClick={() => setLimit(n)}
                  className={`px-2 py-0.5 rounded-sm border font-mono text-[11px] ${
                    Number(limit) === n
                      ? "border-violet-400/40 bg-violet-400/15 text-violet-200"
                      : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:text-zinc-200"
                  }`}
                  data-testid={`refine-preset-${n}`}
                >
                  {n === pageTotal ? `All (${n})` : n.toLocaleString()}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
            <div className="rounded-sm border border-zinc-800 bg-zinc-900 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Est. cost</div>
              <div className="text-zinc-100 font-heading text-base mt-0.5">${estCost}</div>
            </div>
            <div className="rounded-sm border border-zinc-800 bg-zinc-900 px-3 py-2">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Est. time</div>
              <div className="text-zinc-100 font-heading text-base mt-0.5">~{estTime}s</div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={() => onOpenChange(false)}
            variant="ghost"
            className="text-zinc-400 hover:bg-zinc-800 rounded-sm"
          >
            Cancel
          </Button>
          <Button
            onClick={start}
            disabled={busy || !pageTotal}
            className="bg-violet-400/20 hover:bg-violet-400/30 text-violet-200 border border-violet-400/40 rounded-sm"
            data-testid="refine-start-btn"
          >
            {busy ? <Loader2 size={13} className="mr-1.5 animate-spin" /> : <Sparkles size={13} className="mr-1.5" />}
            Refine {effLimit.toLocaleString()} URLs
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatTile({ label, value, tone, testId, onClick, active, highlight }) {
  const toneCls = tone && STATUS_TONE[tone] ? STATUS_TONE[tone].cls : "border-zinc-800 bg-zinc-950";
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!onClick}
      data-testid={testId}
      className={`text-left rounded-sm border ${toneCls} px-3 py-2.5 transition ${
        onClick ? "hover:brightness-125 cursor-pointer" : ""
      } ${active ? "ring-1 ring-zinc-50" : ""} ${highlight ? "bg-zinc-900 border-zinc-700" : ""}`}
    >
      <div className="text-[10px] font-mono uppercase tracking-wider opacity-70">{label}</div>
      <div className={`mt-1 font-heading text-xl ${highlight ? "text-zinc-50" : ""}`}>{value}</div>
    </button>
  );
}

function SourcePill({ active, label }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border ${
        active
          ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
          : "border-zinc-800 bg-zinc-950 text-zinc-600"
      } text-[10px] font-mono uppercase`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${active ? "bg-emerald-400" : "bg-zinc-700"}`} />
      {label}
    </span>
  );
}

function VerdictPill({ verdict }) {
  const tone =
    verdict === "matches" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
    : verdict === "better_alternative" ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
    : verdict === "not_relevant" ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
    : "border-zinc-800 bg-zinc-900 text-zinc-400";
  const label =
    verdict === "matches" ? "AI ✓"
    : verdict === "better_alternative" ? "AI: better alt exists"
    : verdict === "not_relevant" ? "AI: not relevant"
    : "AI";
  return (
    <span className={`inline-flex items-center px-1 py-0 rounded-sm border ${tone} font-mono text-[9px] uppercase`}>
      {label}
    </span>
  );
}

function RefinedUrlsPanel({ refinements, onClose }) {
  const [query, setQuery] = useState("");
  const list = useMemo(() => {
    const arr = Object.values(refinements || {});
    arr.sort((a, b) => (b.confidence || 0) - (a.confidence || 0));
    if (!query.trim()) return arr;
    const q = query.toLowerCase().trim();
    return arr.filter(
      (r) =>
        (r.url || "").toLowerCase().includes(q) ||
        (r.recommended_primary || "").toLowerCase().includes(q) ||
        (r.content_summary?.title || "").toLowerCase().includes(q),
    );
  }, [refinements, query]);

  if (!list.length && !query) {
    return (
      <div className="rounded-sm border border-violet-400/20 bg-violet-400/[0.03] p-5 text-center text-xs text-zinc-400" data-testid="refined-panel-empty">
        No URLs have been refined yet. Click <strong className="text-violet-300">Refine with AI</strong> above to start.
      </div>
    );
  }

  const verdictCounts = (r) => {
    const v = r.relevance_per_mapped || {};
    return {
      m: Object.values(v).filter((x) => x === "matches").length,
      b: Object.values(v).filter((x) => x === "better_alternative").length,
      n: Object.values(v).filter((x) => x === "not_relevant").length,
    };
  };

  return (
    <div className="rounded-sm border border-violet-400/20 bg-violet-400/[0.03] p-4 space-y-3" data-testid="refined-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-heading text-sm text-violet-300 flex items-center gap-1.5">
            <Sparkles size={13} /> AI-refined URLs ({Object.keys(refinements).length})
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 max-w-2xl">
            Each URL was analyzed for content relevance. Recommended primary keyword + per-mapped-keyword verdicts.
            Sorted by AI confidence.
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1" data-testid="refined-panel-close">
          <X size={14} />
        </button>
      </div>

      <div className="relative max-w-md">
        <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-zinc-500" />
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search URL, recommended keyword, or page title"
          className="pl-8 bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 text-xs h-8"
          data-testid="refined-search"
        />
      </div>

      <div className="space-y-1.5 max-h-[600px] overflow-y-auto">
        {list.map((r) => {
          const c = verdictCounts(r);
          return (
            <RefinedRow key={r.url} r={r} counts={c} />
          );
        })}
      </div>
    </div>
  );
}

function RefinedRow({ r, counts }) {
  const [open, setOpen] = useState(false);
  const conf = r.confidence != null ? Math.round(r.confidence * 100) : null;
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950" data-testid={`refined-row-${r.url}`}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full text-left p-2.5 hover:bg-zinc-900/50 transition"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 mb-0.5">
              <span className="text-emerald-300 font-mono text-[11px] break-all">{r.url}</span>
            </div>
            <div className="text-[11px] text-zinc-300">
              <span className="text-zinc-500">Recommended primary:</span>{" "}
              <span className="text-violet-200 font-medium">{r.recommended_primary || "—"}</span>
            </div>
            {r.content_summary?.title && (
              <div className="text-[10px] text-zinc-600 mt-0.5 font-mono truncate">
                {r.content_summary.title}
              </div>
            )}
          </div>
          <div className="shrink-0 flex flex-col items-end gap-1">
            {conf != null && (
              <span className="text-[10px] font-mono text-zinc-500">conf {conf}%</span>
            )}
            <div className="flex items-center gap-0.5 text-[9px] font-mono">
              {counts.m > 0 && <span className="px-1 rounded-sm bg-emerald-400/15 text-emerald-300">{counts.m}✓</span>}
              {counts.b > 0 && <span className="px-1 rounded-sm bg-amber-400/15 text-amber-300">{counts.b} alt</span>}
              {counts.n > 0 && <span className="px-1 rounded-sm bg-rose-400/15 text-rose-300">{counts.n}✗</span>}
            </div>
          </div>
        </div>
      </button>

      {open && (
        <div className="border-t border-zinc-800 p-3 space-y-2 text-[11px]">
          {r.rationale && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-0.5">Rationale</div>
              <div className="text-zinc-300 leading-relaxed italic">{r.rationale}</div>
            </div>
          )}
          {r.supporting_keywords?.length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Supporting keywords</div>
              <div className="flex flex-wrap gap-1">
                {r.supporting_keywords.map((s, i) => (
                  <span key={i} className="px-1.5 py-0.5 rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-300 font-mono text-[10px]">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}
          {r.relevance_per_mapped && Object.keys(r.relevance_per_mapped).length > 0 && (
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Mapped keyword verdicts</div>
              <div className="space-y-0.5">
                {Object.entries(r.relevance_per_mapped).map(([kw, v]) => (
                  <div key={kw} className="flex items-center justify-between gap-2">
                    <span className="text-zinc-200 font-mono text-[10px] truncate">{kw}</span>
                    <VerdictPill verdict={v} />
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function EmptyState({ onBuild, building }) {
  return (
    <div className="rounded-sm border border-dashed border-zinc-800 bg-zinc-950 p-10 text-center">
      <MapIcon size={28} className="mx-auto text-zinc-700 mb-3" />
      <div className="text-zinc-200 font-heading text-base">No keyword map yet</div>
      <div className="text-zinc-500 text-xs mt-1.5 max-w-sm mx-auto leading-relaxed">
        Connect GSC and/or upload Semrush organic positions, then build. Most useful when you have at least one of those sources.
      </div>
      <Button
        onClick={onBuild}
        disabled={building}
        className="mt-5 bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
        data-testid="build-empty"
      >
        {building ? <Loader2 size={13} className="animate-spin mr-1.5" /> : <RefreshCw size={13} className="mr-1.5" />}
        Build keyword map
      </Button>
    </div>
  );
}

function KeywordTable({ rows, urlRefinements, onSelect }) {
  return (
    <div className="rounded-sm border border-zinc-800 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead className="bg-zinc-950 border-b border-zinc-800">
            <tr>
              <Th>Keyword</Th>
              <Th>Status</Th>
              <Th className="text-right">Pos</Th>
              <Th className="text-right">Vol</Th>
              <Th>Current URL</Th>
              <Th>Target URL</Th>
              <Th>Sources</Th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 500).map((k) => (
              <KeywordRow key={k.keyword} k={k} urlRefinements={urlRefinements} onSelect={onSelect} />
            ))}
          </tbody>
        </table>
      </div>
      {rows.length > 500 && (
        <div className="text-[10px] font-mono text-zinc-600 px-3 py-2 border-t border-zinc-800 bg-zinc-950">
          Showing first 500 of {rows.length}. Use search/filter to narrow.
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

function KeywordRow({ k, urlRefinements, onSelect }) {
  const def = STATUS_TONE[k.status] || STATUS_TONE.unknown;
  const Icon = def.icon;
  const refinement = k.current_url && urlRefinements?.[normalizeUrl(k.current_url)];
  const verdict = refinement?.relevance_per_mapped?.[k.keyword.toLowerCase()];
  return (
    <tr
      onClick={() => onSelect(k.keyword)}
      className="border-b border-zinc-800 last:border-b-0 hover:bg-zinc-900/60 cursor-pointer"
      data-testid={`kw-row-${k.keyword}`}
    >
      <td className="px-3 py-2 align-top">
        <div className="flex items-center gap-1.5">
          {k.priority && <Star size={10} className="text-amber-400 shrink-0 fill-amber-400" />}
          <span className="text-zinc-100 break-words">{k.keyword}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          {k.intent && (
            <span className="text-[10px] text-zinc-600 font-mono uppercase tracking-wider">{k.intent}</span>
          )}
          {verdict && <VerdictPill verdict={verdict} />}
        </div>
      </td>
      <td className="px-3 py-2 align-top">
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border ${def.cls} font-mono text-[10px] uppercase`}>
          <Icon size={9} /> {def.label}
        </span>
      </td>
      <td className="px-3 py-2 align-top text-right text-zinc-200 font-mono">
        {k.current_position != null ? k.current_position : "—"}
      </td>
      <td className="px-3 py-2 align-top text-right text-zinc-200 font-mono">
        {k.search_volume != null ? k.search_volume.toLocaleString() : "—"}
      </td>
      <td className="px-3 py-2 align-top max-w-xs">
        {k.current_url ? (
          <div className="flex items-center gap-1.5">
            <a
              href={k.current_url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="text-emerald-300 hover:text-emerald-200 font-mono text-[11px] break-all inline-flex items-center gap-1"
            >
              {truncatePath(k.current_url)} <ExternalLink size={9} className="shrink-0" />
            </a>
            {refinement && (
              <span title={`AI refined · recommends "${refinement.recommended_primary}"`} className="shrink-0 text-violet-400">
                <Sparkles size={10} />
              </span>
            )}
          </div>
        ) : (
          <span className="text-zinc-600 italic">none</span>
        )}
      </td>
      <td className="px-3 py-2 align-top max-w-xs">
        {k.target_url ? (
          <span className={`font-mono text-[11px] break-all ${k.target_url_user_set ? "text-zinc-100" : "text-zinc-400"}`}>
            {truncatePath(k.target_url)}
            {k.target_url_user_set && <span className="ml-1 text-[9px] text-emerald-400">✓</span>}
          </span>
        ) : (
          <span className="text-zinc-600 italic">unset</span>
        )}
      </td>
      <td className="px-3 py-2 align-top">
        <div className="flex flex-wrap gap-1">
          {Object.keys(k.sources || {}).filter((s) => k.sources[s]).map((s) => (
            <span key={s} className="px-1 py-0 rounded-sm border border-zinc-800 bg-zinc-950 text-zinc-400 font-mono text-[9px] uppercase">
              {SOURCE_LABEL[s] || s}
            </span>
          ))}
        </div>
      </td>
    </tr>
  );
}

function truncatePath(url) {
  if (!url) return "";
  try {
    const u = new URL(url);
    const p = u.pathname.length > 50 ? `…${u.pathname.slice(-47)}` : u.pathname;
    return `${u.hostname}${p}`;
  } catch {
    return url.length > 60 ? url.slice(0, 57) + "…" : url;
  }
}

function normalizeUrl(url) {
  if (!url) return "";
  let s = url.trim().toLowerCase();
  s = s.replace(/^https?:\/\//, "");
  if (s.startsWith("www.")) s = s.slice(4);
  s = s.split("#")[0];
  s = s.replace(/\/+$/, "");
  return s;
}

function KeywordDrawer({ clientId, keyword, fullData, urlRefinements, onClose, onChanged }) {
  const [targetUrl, setTargetUrl] = useState(fullData?.target_url || "");
  const [busy, setBusy] = useState(false);
  const [fetchingSerp, setFetchingSerp] = useState(false);

  // Look up AI refinement for the current URL of this keyword
  const refinement = useMemo(() => {
    if (!fullData?.current_url || !urlRefinements) return null;
    const norm = normalizeUrl(fullData.current_url);
    return urlRefinements[norm] || null;
  }, [fullData?.current_url, urlRefinements]);

  const myRelevance = refinement?.relevance_per_mapped?.[keyword.toLowerCase()];

  const save = async (patch) => {
    setBusy(true);
    try {
      await api.updateKeyword(clientId, keyword, patch);
      toast.success("Updated");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Update failed");
    } finally {
      setBusy(false);
    }
  };

  const fetchSerp = async () => {
    setFetchingSerp(true);
    try {
      await api.fetchSerp(clientId, keyword);
      toast.success("SERP landscape pulled");
      onChanged?.();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "SERP fetch failed");
    } finally {
      setFetchingSerp(false);
    }
  };

  return (
    <div className="fixed inset-y-0 right-0 w-full md:w-[520px] bg-zinc-950 border-l border-zinc-800 z-40 overflow-y-auto" data-testid="kw-drawer">
      <div className="sticky top-0 z-10 bg-zinc-950 border-b border-zinc-800 px-5 py-4 flex items-center justify-between">
        <div className="min-w-0">
          <div className="font-heading text-lg text-zinc-50 truncate">{keyword}</div>
          {fullData?.intent && (
            <div className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider mt-0.5">{fullData.intent} intent</div>
          )}
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1" data-testid="kw-drawer-close">
          <X size={16} />
        </button>
      </div>

      <div className="p-5 space-y-5">
        <div className="grid grid-cols-3 gap-2">
          <Metric label="Position" value={fullData?.current_position ?? "—"} />
          <Metric label="Volume" value={fullData?.search_volume?.toLocaleString() ?? "—"} />
          <Metric label="Traffic" value={fullData?.traffic?.toLocaleString() ?? "—"} />
        </div>

        {refinement && <RefinementPanel refinement={refinement} myKeyword={keyword} myRelevance={myRelevance} onApplyTarget={(url) => { setTargetUrl(url); }} />}

        {/* Priority + target */}
        <div className="space-y-2">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Target URL</div>
          <Input
            value={targetUrl}
            onChange={(e) => setTargetUrl(e.target.value)}
            placeholder="https://…"
            className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 text-sm font-mono"
            data-testid="kw-drawer-target-url"
          />
          <div className="flex items-center gap-2">
            <Button
              onClick={() => save({ target_url: targetUrl })}
              disabled={busy || !targetUrl}
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm h-8 text-xs"
              data-testid="kw-drawer-save-target"
            >
              Save target
            </Button>
            <Button
              onClick={() => save({ priority: !fullData?.priority })}
              disabled={busy}
              variant="ghost"
              className={`rounded-sm h-8 text-xs ${fullData?.priority ? "text-amber-400 hover:text-amber-300 hover:bg-amber-400/10" : "text-zinc-400 hover:bg-zinc-800"}`}
              data-testid="kw-drawer-toggle-priority"
            >
              <Star size={11} className={`mr-1 ${fullData?.priority ? "fill-amber-400" : ""}`} />
              {fullData?.priority ? "Priority on" : "Mark priority"}
            </Button>
          </div>
        </div>

        {/* Cannibal URLs */}
        {fullData?.cannibal_urls?.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-rose-400">Competing pages (cannibalization)</div>
            <div className="space-y-1.5">
              {fullData.cannibal_urls.map((u, i) => (
                <div key={i} className="text-[11px] rounded-sm border border-rose-400/20 bg-rose-400/5 p-2">
                  <div className="font-mono text-rose-200 break-all">{u.url}</div>
                  <div className="text-zinc-500 mt-0.5">pos {u.position} · {u.clicks} clicks · {u.impressions} impr</div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Competitor URLs (from keyword gap) */}
        {fullData?.competitor_urls?.length > 0 && (
          <div className="space-y-2">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Competitors ranking for this</div>
            <div className="space-y-1">
              {fullData.competitor_urls.slice(0, 5).map((c, i) => (
                <div key={i} className="text-[11px] flex items-center justify-between gap-2">
                  <a href={c.url} target="_blank" rel="noopener noreferrer" className="text-zinc-300 hover:text-zinc-100 font-mono break-all">
                    {c.url}
                  </a>
                  <span className="text-zinc-500 font-mono shrink-0">pos {c.position}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* SERP */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">Live SERP landscape</div>
            <Button
              onClick={fetchSerp}
              disabled={fetchingSerp}
              className="bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 rounded-sm h-7 text-[11px] px-2"
              data-testid="kw-drawer-fetch-serp"
            >
              {fetchingSerp ? <Loader2 size={11} className="animate-spin mr-1" /> : <Globe size={11} className="mr-1" />}
              {fullData?.serp ? "Refresh SERP" : "Fetch SERP"}
            </Button>
          </div>
          {fullData?.serp?.organic && (
            <div className="space-y-1">
              {fullData.serp.features?.length > 0 && (
                <div className="flex flex-wrap gap-1 mb-2">
                  {fullData.serp.features.map((f) => (
                    <span key={f} className="px-1.5 py-0.5 rounded-sm border border-violet-400/30 bg-violet-400/10 text-violet-300 font-mono text-[9px] uppercase">
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {fullData.serp.organic.map((o, i) => (
                <div key={i} className="text-[11px] rounded-sm border border-zinc-800 bg-zinc-900/50 p-2 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-zinc-500 font-mono shrink-0">#{o.rank}</span>
                    <a href={o.url} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 font-mono break-all">
                      {o.domain}
                    </a>
                  </div>
                  <div className="text-zinc-200 leading-snug">{o.title}</div>
                  {o.backlinks_profile && <BacklinkBar profile={o.backlinks_profile} />}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950 px-2.5 py-2 text-center">
      <div className="text-[9px] font-mono text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className="text-zinc-100 font-heading text-base mt-0.5">{value}</div>
    </div>
  );
}

function RefinementPanel({ refinement, myKeyword, myRelevance, onApplyTarget }) {
  const relTone =
    myRelevance === "matches" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
    : myRelevance === "better_alternative" ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
    : myRelevance === "not_relevant" ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
    : "border-zinc-700 bg-zinc-900 text-zinc-400";
  const relLabel =
    myRelevance === "matches" ? "Genuinely relevant to this URL"
    : myRelevance === "better_alternative" ? "Relevant, but more specific phrasing exists"
    : myRelevance === "not_relevant" ? "Not the right keyword for this URL"
    : null;

  return (
    <div className="rounded-sm border border-violet-400/20 bg-violet-400/[0.04] p-3.5 space-y-3" data-testid="kw-drawer-refinement">
      <div className="flex items-center gap-2 text-violet-300">
        <Sparkles size={12} />
        <span className="font-mono uppercase tracking-wider text-[10px]">AI relevance pass</span>
        {refinement.confidence != null && (
          <span className="ml-auto text-[10px] font-mono text-zinc-500">
            confidence {Math.round((refinement.confidence || 0) * 100)}%
          </span>
        )}
      </div>

      <div>
        <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-0.5">
          Recommended primary for this URL
        </div>
        <div className="text-zinc-100 font-heading text-sm">{refinement.recommended_primary}</div>
        {refinement.rationale && (
          <div className="text-[11px] text-zinc-400 mt-1 italic leading-relaxed">{refinement.rationale}</div>
        )}
      </div>

      {myRelevance && (
        <div className="space-y-1">
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">
            Verdict on "{myKeyword}"
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-sm border ${relTone} font-mono text-[10px]`}>
            {myRelevance === "matches" && <Check size={9} />}
            {myRelevance === "better_alternative" && <Lightbulb size={9} />}
            {myRelevance === "not_relevant" && <X size={9} />}
            <span className="uppercase">{myRelevance.replace("_", " ")}</span>
          </span>
          <div className="text-[11px] text-zinc-500">{relLabel}</div>
        </div>
      )}

      {refinement.supporting_keywords?.length > 0 && (
        <div>
          <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1">Supporting keywords</div>
          <div className="flex flex-wrap gap-1">
            {refinement.supporting_keywords.map((s, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded-sm border border-zinc-800 bg-zinc-900 text-zinc-300 font-mono text-[10px]">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function BacklinkBar({ profile }) {
  if (!profile) return null;
  const fmt = (n) => (n == null ? "—" : n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : n.toLocaleString());
  const dr = profile.domain_rating;
  const pr = profile.page_rating;
  // DR scaled to 0-100 (DataForSEO uses 0-1000; divide by 10 for Ahrefs-like display)
  const drScaled = dr != null ? Math.round(dr / 10) : null;
  const prScaled = pr != null ? Math.round(pr / 10) : null;
  // Spam score: 0-100 (higher = spammier). Color: emerald <15, zinc 15-30, amber 30-50, rose 50+
  const spam = profile.spam_score;
  const spamTone =
    spam == null ? "zinc"
    : spam >= 50 ? "rose"
    : spam >= 30 ? "amber"
    : spam >= 15 ? "zinc"
    : "emerald";
  return (
    <div className="flex flex-wrap items-center gap-1.5 pt-1.5 border-t border-zinc-800">
      <BLPill label="DR" value={drScaled} tone="emerald" title="Domain Rating (0-100)" />
      <BLPill label="PR" value={prScaled} tone="sky" title="Page Rating (0-100)" />
      <BLPill label="BL" value={fmt(profile.backlinks)} title="Total backlinks pointing at this URL" />
      <BLPill label="RD" value={fmt(profile.referring_domains)} title="Total referring domains" />
      <BLPill
        label="Dofollow"
        value={fmt(profile.referring_domains_dofollow)}
        tone="emerald"
        title="Dofollow referring domains (total − nofollow)"
      />
      <BLPill
        label="Spam"
        value={spam != null ? spam : "—"}
        tone={spamTone}
        title="Backlinks spam score (0-100). Higher = spammier link profile. >30 worth investigating, >50 concerning."
      />
    </div>
  );
}

function BLPill({ label, value, tone = "zinc", title }) {
  const toneCls =
    tone === "emerald" ? "border-emerald-400/30 bg-emerald-400/10 text-emerald-300"
    : tone === "sky" ? "border-sky-400/30 bg-sky-400/10 text-sky-300"
    : tone === "amber" ? "border-amber-400/30 bg-amber-400/10 text-amber-300"
    : tone === "rose" ? "border-rose-400/30 bg-rose-400/10 text-rose-300"
    : "border-zinc-700 bg-zinc-900 text-zinc-300";
  return (
    <span title={title} className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm border ${toneCls} font-mono text-[10px]`}>
      <span className="opacity-70 uppercase">{label}</span>
      <span>{value ?? "—"}</span>
    </span>
  );
}

// ---------- Sparse pages panel ----------

function SparsePagesPanel({ clientId, onClose, onAnalyzed }) {
  const [sparse, setSparse] = useState([]);
  const [loading, setLoading] = useState(true);
  const [analyzingUrl, setAnalyzingUrl] = useState(null);
  const [results, setResults] = useState({});

  useEffect(() => {
    (async () => {
      try {
        const r = await api.getSparseUrls(clientId, 50);
        setSparse(r.urls || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [clientId]);

  const analyze = async (url) => {
    setAnalyzingUrl(url);
    try {
      const r = await api.analyzePages(clientId, [url]);
      const res = r.results?.[0];
      if (res?.ok) {
        toast.success(`${url}: ${res.recommended_keyword}`);
        setResults((p) => ({ ...p, [url]: res }));
      } else {
        toast.error(`${url}: ${res?.error || "failed"}`);
      }
    } catch (e) {
      toast.error("Analysis failed");
    } finally {
      setAnalyzingUrl(null);
      onAnalyzed?.();
    }
  };

  return (
    <div className="rounded-sm border border-amber-400/20 bg-amber-400/[0.03] p-4 space-y-3" data-testid="sparse-panel">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-heading text-sm text-amber-300 flex items-center gap-1.5">
            <FileSearch size={13} /> Pages with weak keyword signal
          </div>
          <div className="text-[11px] text-zinc-400 mt-1 max-w-2xl">
            These pages have fewer than 3 ranking keywords and below 50 impressions in the data we have. Click <em>Analyze</em>
            to fetch the page, identify its primary keyword via AI, and pull related variants from DataForSEO.
          </div>
        </div>
        <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200 p-1">
          <X size={14} />
        </button>
      </div>

      {loading ? (
        <div className="text-xs text-zinc-500"><Loader2 size={11} className="inline animate-spin mr-1" /> Loading sparse pages…</div>
      ) : sparse.length === 0 ? (
        <div className="text-xs text-zinc-500">No sparse pages — your data signal is strong across the indexed pages.</div>
      ) : (
        <div className="space-y-1.5">
          {sparse.slice(0, 20).map((p) => (
            <div key={p.url} className="rounded-sm border border-zinc-800 bg-zinc-950 p-2.5">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <a href={p.url} target="_blank" rel="noopener noreferrer" className="text-emerald-300 hover:text-emerald-200 font-mono text-[11px] break-all">
                    {p.url}
                  </a>
                  <div className="text-[10px] text-zinc-500 mt-0.5 font-mono">
                    {p.title || "(no title)"} · words {p.word_count ?? "?"} · inlinks {p.inlinks ?? "?"}
                  </div>
                </div>
                <Button
                  onClick={() => analyze(p.url)}
                  disabled={analyzingUrl === p.url}
                  className="shrink-0 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-300 border border-emerald-400/30 rounded-sm h-7 px-2 text-[11px]"
                  data-testid={`sparse-analyze-${p.url}`}
                >
                  {analyzingUrl === p.url ? <Loader2 size={11} className="animate-spin" /> : <Scan size={11} />}
                  <span className="ml-1">{results[p.url] ? "Re-analyze" : "Analyze"}</span>
                </Button>
              </div>
              {results[p.url] && results[p.url].ok && (
                <div className="mt-2 pl-2 border-l-2 border-emerald-400/30 text-[11px] space-y-1">
                  <div>
                    <span className="text-zinc-500">Recommended: </span>
                    <span className="text-emerald-300 font-mono">{results[p.url].recommended_keyword}</span>
                  </div>
                  <div>
                    <span className="text-zinc-500">Detected primary: </span>
                    <span className="text-zinc-300 font-mono">{results[p.url].primary_keyword_guess}</span>
                  </div>
                  {results[p.url].related_keywords?.length > 0 && (
                    <div className="text-zinc-500">
                      {results[p.url].related_keywords.length} related variants pulled from DataForSEO
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
