import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { BarChart, RefreshCw, Unlink2, AlertCircle, Zap } from "lucide-react";
import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { toast } from "sonner";
import axios from "axios";
import { API } from "../lib/api";
import { formatRelative } from "./Bits";

const ax = axios.create({ baseURL: API });

export default function GaConnect({ clientId }) {
  const [status, setStatus] = useState(null);
  const [props, setProps] = useState([]);
  const [loadingProps, setLoadingProps] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [searchParams, setSearchParams] = useSearchParams();

  const loadStatus = async () => {
    try {
      const r = await ax.get(`/clients/${clientId}/integrations/ga/status`);
      setStatus(r.data);
    } catch {}
  };

  useEffect(() => { loadStatus(); }, [clientId]);

  useEffect(() => {
    const v = searchParams.get("ga");
    const reason = searchParams.get("reason");
    if (v === "connected") {
      toast.success("Google Analytics connected");
      loadStatus();
      searchParams.delete("ga");
      setSearchParams(searchParams, { replace: true });
    } else if (v === "error") {
      toast.error(`GA connection failed${reason ? ` · ${reason}` : ""}`);
      searchParams.delete("ga");
      searchParams.delete("reason");
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  const loadProps = async () => {
    setLoadingProps(true);
    try {
      const r = await ax.get(`/clients/${clientId}/integrations/ga/properties`);
      setProps(r.data.properties || []);
    } catch {
      toast.error("Could not list GA properties");
    } finally {
      setLoadingProps(false);
    }
  };

  useEffect(() => {
    if (status?.connected) loadProps();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status?.connected]);

  const onConnect = () => {
    window.location.href = `${API}/integrations/ga/connect?client_id=${encodeURIComponent(clientId)}`;
  };

  const onSelect = async (val) => {
    const p = props.find((x) => x.property === val);
    try {
      await ax.post(`/clients/${clientId}/integrations/ga/select-property`, {
        property_id: val,
        property_name: p?.displayName || "",
      });
      toast.success("Property selected");
      loadStatus();
    } catch {
      toast.error("Failed to select property");
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    try {
      const r = await ax.post(`/clients/${clientId}/integrations/ga/refresh`);
      toast.success(`GA data refreshed · ${r.data.totals?.sessions || 0} sessions`);
      loadStatus();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Refresh failed");
    } finally {
      setRefreshing(false);
    }
  };

  const onDisconnect = async () => {
    if (!window.confirm("Disconnect Google Analytics for this client?")) return;
    try {
      await ax.post(`/clients/${clientId}/integrations/ga/disconnect`);
      toast.success("Disconnected");
      setProps([]);
      loadStatus();
    } catch {
      toast.error("Failed to disconnect");
    }
  };

  const dotColor = status?.connected ? "bg-emerald-400" : "bg-zinc-600";

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5" data-testid="ga-connect-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 grid place-items-center rounded-sm border border-zinc-800 bg-zinc-950">
            <BarChart size={16} className="text-zinc-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-heading text-base font-medium text-zinc-50">Google Analytics 4</div>
              <span className={`h-1.5 w-1.5 rounded-full ${dotColor}`} />
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {status?.connected
                ? `Connected${status.google_email ? ` · ${status.google_email}` : ""}`
                : "Not connected — link a Google account with GA4 access"}
            </div>
          </div>
        </div>
        {!status?.connected ? (
          <Button
            data-testid="ga-connect-btn"
            onClick={onConnect}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm"
          >
            Connect GA
          </Button>
        ) : (
          <Button
            data-testid="ga-disconnect-btn"
            variant="ghost"
            onClick={onDisconnect}
            className="text-zinc-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-sm"
          >
            <Unlink2 size={13} className="mr-1.5" /> Disconnect
          </Button>
        )}
      </div>

      {status?.connected && (
        <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-3">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">GA4 property</div>
            <Select value={status.selected_property_id || ""} onValueChange={onSelect}>
              <SelectTrigger
                data-testid="ga-property-select"
                className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-xs"
              >
                <SelectValue placeholder={loadingProps ? "Loading properties…" : "Pick a property"} />
              </SelectTrigger>
              <SelectContent className="bg-zinc-900 border-zinc-800 text-zinc-100">
                {props.length === 0 && (
                  <div className="px-2 py-3 text-xs text-zinc-500">
                    {loadingProps ? "Loading…" : "No GA4 properties on this account."}
                  </div>
                )}
                {props.map((p) => (
                  <SelectItem
                    key={p.property}
                    value={p.property}
                    data-testid={`ga-property-${p.property}`}
                    className="focus:bg-zinc-800 focus:text-zinc-50 font-mono text-xs"
                  >
                    <div className="flex flex-col">
                      <span>{p.displayName}</span>
                      <span className="text-[10px] text-zinc-500">{p.account} · {p.property}</span>
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
                data-testid="ga-refresh-btn"
                disabled={!status.selected_property_id || refreshing}
                onClick={onRefresh}
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
              <Tile label="Sessions" value={status.totals.sessions} tone="text-emerald-400" />
              <Tile label="Users" value={status.totals.totalUsers} tone="text-sky-400" />
              <Tile label="Pageviews" value={status.totals.screenPageViews} />
              <Tile label="Engagement" value={status.totals.engagementRate} />
            </div>
          )}

          <div className="md:col-span-2 mt-2 flex items-start gap-2 text-xs text-zinc-500">
            <Zap size={12} className="text-amber-400 mt-0.5" />
            <span>
              When connected and refreshed, the Technical Audit and Strategy agents weight recommendations
              by your real traffic — top landing pages, sources, and engagement signals.
            </span>
          </div>
        </div>
      )}

      {!status?.configured && (
        <div className="mt-4 flex items-start gap-2 text-xs text-amber-400">
          <AlertCircle size={12} className="mt-0.5" />
          <span>Server is missing GA OAuth env vars — contact the operator.</span>
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
