import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { CheckCircle2, Globe, RefreshCw, Unlink2, Zap, AlertCircle } from "lucide-react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";
import api from "../lib/api";
import { formatRelative } from "./Bits";

export default function GscConnect({ clientId }) {
  const [status, setStatus] = useState(null);
  const [sites, setSites] = useState([]);
  const [loadingSites, setLoadingSites] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const loadStatus = async () => {
    try {
      const s = await api.gscStatus(clientId);
      setStatus(s);
      return s;
    } catch {
      return null;
    }
  };

  useEffect(() => {
    loadStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // Handle callback redirect query params
  useEffect(() => {
    const gsc = searchParams.get("gsc");
    const reason = searchParams.get("reason");
    if (gsc === "connected") {
      toast.success("Google Search Console connected");
      loadStatus();
      searchParams.delete("gsc");
      setSearchParams(searchParams, { replace: true });
    } else if (gsc === "error") {
      toast.error(`GSC connection failed${reason ? ` · ${reason}` : ""}`);
      searchParams.delete("gsc");
      searchParams.delete("reason");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadSites = async () => {
    setLoadingSites(true);
    try {
      const r = await api.gscSites(clientId);
      setSites(r.sites || []);
    } catch (e) {
      toast.error("Could not list GSC sites");
    } finally {
      setLoadingSites(false);
    }
  };

  useEffect(() => {
    if (status?.connected) loadSites();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  const handleConnect = () => {
    window.location.href = api.gscConnectUrl(clientId);
  };

  const handleSelectSite = async (siteUrl) => {
    try {
      await api.gscSelectSite(clientId, siteUrl);
      toast.success("Site selected");
      loadStatus();
    } catch {
      toast.error("Failed to select site");
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await api.gscRefresh(clientId);
      toast.success(`GSC data refreshed · ${r.totals?.queries || 0} queries, ${r.totals?.clicks || 0} clicks`);
      loadStatus();
    } catch (e) {
      const msg = e?.response?.data?.detail || "Refresh failed";
      toast.error(msg);
    } finally {
      setRefreshing(false);
    }
  };

  const handleDisconnect = async () => {
    if (!window.confirm("Disconnect Google Search Console for this client?")) return;
    try {
      await api.gscDisconnect(clientId);
      toast.success("Disconnected");
      setSites([]);
      loadStatus();
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  const dotColor = status?.connected ? "bg-emerald-400" : "bg-zinc-600";

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5" data-testid="gsc-connect-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 grid place-items-center rounded-sm border border-zinc-800 bg-zinc-950">
            <Globe size={16} className="text-zinc-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-heading text-base font-medium text-zinc-50">Google Search Console</div>
              <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {status?.connected
                ? `Connected${status.google_email ? ` · ${status.google_email}` : ""}`
                : "Not connected — link a Google account that owns the site"}
            </div>
          </div>
        </div>
        {!status?.connected ? (
          <Button
            data-testid="gsc-connect-btn"
            onClick={handleConnect}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
          >
            Connect GSC
          </Button>
        ) : (
          <Button
            data-testid="gsc-disconnect-btn"
            variant="ghost"
            onClick={handleDisconnect}
            className="text-zinc-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-sm"
          >
            <Unlink2 size={13} className="mr-1.5" /> Disconnect
          </Button>
        )}
      </div>

      {status?.connected && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Selected site</div>
            <Select
              value={status.selected_site_url || ""}
              onValueChange={handleSelectSite}
            >
              <SelectTrigger
                data-testid="gsc-site-select"
                className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-xs"
              >
                <SelectValue placeholder={loadingSites ? "Loading sites…" : "Pick a site to monitor"} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                {sites.length === 0 && (
                  <div className="px-2 py-3 text-xs text-zinc-500">
                    {loadingSites ? "Loading…" : "No verified sites on this account."}
                  </div>
                )}
                {sites.map((s) => (
                  <SelectItem
                    key={s.siteUrl}
                    value={s.siteUrl}
                    data-testid={`gsc-site-${s.siteUrl}`}
                    className="focus:bg-zinc-800 focus:text-zinc-50 font-mono text-xs"
                  >
                    <div className="flex flex-col">
                      <span>{s.siteUrl}</span>
                      <span className="text-[10px] text-zinc-500">permission: {s.permissionLevel}</span>
                    </div>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Last 28-day pull</div>
            <div className="flex items-center gap-2">
              <Button
                data-testid="gsc-refresh-btn"
                disabled={!status.selected_site_url || refreshing}
                onClick={handleRefresh}
                className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
              >
                <RefreshCw size={13} className={`mr-1.5 ${refreshing ? "animate-spin" : ""}`} />
                {refreshing ? "Pulling…" : "Refresh data"}
              </Button>
              {status.last_refreshed_at && (
                <span className="text-xs text-zinc-500 font-mono">{formatRelative(status.last_refreshed_at)}</span>
              )}
            </div>
          </div>

          {status.totals && (
            <div className="md:col-span-2 grid grid-cols-2 md:grid-cols-4 gap-2 mt-1">
              <Tile label="Queries" value={status.totals.queries} />
              <Tile label="Pages" value={status.totals.pages} />
              <Tile label="Clicks" value={status.totals.clicks} tone="text-emerald-400" />
              <Tile label="Impressions" value={status.totals.impressions} tone="text-sky-400" />
            </div>
          )}

          <div className="md:col-span-2 mt-2 flex items-start gap-2 text-xs text-zinc-500">
            <Zap size={12} className="text-amber-400 mt-0.5" />
            <span>
              When connected and refreshed, the Keyword Research agent grounds its analysis in your real GSC data
              (top queries, pages, clicks, impressions, CTR, position).
            </span>
          </div>
        </div>
      )}

      {!status?.configured && (
        <div className="mt-4 flex items-start gap-2 text-xs text-amber-400">
          <AlertCircle size={12} className="mt-0.5" />
          <span>Server is missing Google OAuth env vars — contact the operator.</span>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, tone = "text-zinc-50" }) {
  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-950 px-3 py-2">
      <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500">{label}</div>
      <div className={`font-heading text-lg font-semibold ${tone}`}>{value ?? "—"}</div>
    </div>
  );
}
