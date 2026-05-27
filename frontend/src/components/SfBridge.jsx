import React, { useEffect, useState } from "react";
import {
  Plug, Download, CheckCircle2, XCircle, Loader2, Play, RefreshCw, Trash2,
  Terminal, BookOpen,
} from "lucide-react";
import axios from "axios";
import { API } from "../lib/api";
import { Button } from "./ui/button";
import { Input } from "./ui/input";
import { Label } from "./ui/label";
import { toast } from "sonner";
import { formatRelative } from "./Bits";

const ax = axios.create({ baseURL: API });

export default function SfBridge({ clientId }) {
  const [status, setStatus] = useState({ loading: true });
  const [form, setForm] = useState({ base_url: "", token: "" });
  const [busy, setBusy] = useState(false);
  const [crawlForm, setCrawlForm] = useState({ url: "", max_urls: 500 });
  const [activeJob, setActiveJob] = useState(null);
  const [jobStatus, setJobStatus] = useState(null);

  const loadStatus = async () => {
    try {
      const r = await ax.get(`/clients/${clientId}/integrations/sf-bridge/status`);
      setStatus({ ...r.data, loading: false });
      if (r.data.configured) {
        setForm({ base_url: r.data.base_url || "", token: "" });
      }
    } catch {
      setStatus({ configured: false, loading: false });
    }
  };

  useEffect(() => { loadStatus(); }, [clientId]);

  // Poll active crawl (resilient — transient errors don't kill the loop)
  useEffect(() => {
    if (!activeJob) return;
    let stop = false;
    let consecutiveErrors = 0;
    const tick = async () => {
      try {
        const r = await ax.get(`/clients/${clientId}/integrations/sf-bridge/crawl/${activeJob}`);
        if (stop) return;
        consecutiveErrors = 0;
        setJobStatus(r.data);
        if (["done", "completed", "finished", "success", "failed", "error"].includes((r.data.status || "").toLowerCase())) return;
        setTimeout(tick, 4000);
      } catch (e) {
        if (stop) return;
        consecutiveErrors += 1;
        // Tolerate up to 5 transient errors (ngrok blips, network jitter) before
        // marking the job as errored. Crawls often run 2-10 min.
        if (consecutiveErrors >= 5) {
          setJobStatus((prev) => ({
            ...(prev || {}),
            status: "error",
            error: e?.response?.data?.detail || "Lost connection to bridge after multiple retries. Re-check the bridge URL / token, then poll manually.",
          }));
          return;
        }
        // Stay in current status but keep polling with backoff
        setTimeout(tick, 6000 + consecutiveErrors * 2000);
      }
    };
    tick();
    return () => { stop = true; };
  }, [activeJob, clientId]);

  const save = async () => {
    if (!form.base_url.trim()) { toast.error("Bridge URL required"); return; }
    setBusy(true);
    try {
      await ax.post(`/clients/${clientId}/integrations/sf-bridge/configure`, {
        base_url: form.base_url.trim(),
        token: form.token.trim(),
      });
      toast.success("Bridge configured");
      await loadStatus();
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to save");
    } finally { setBusy(false); }
  };

  const disconnect = async () => {
    if (!window.confirm("Disconnect the Screaming Frog bridge?")) return;
    try {
      await ax.post(`/clients/${clientId}/integrations/sf-bridge/disconnect`);
      setForm({ base_url: "", token: "" });
      setActiveJob(null);
      setJobStatus(null);
      toast.success("Disconnected");
      loadStatus();
    } catch {
      toast.error("Failed");
    }
  };

  const startCrawl = async () => {
    if (!crawlForm.url.trim()) { toast.error("URL required"); return; }
    setBusy(true);
    try {
      const r = await ax.post(`/clients/${clientId}/integrations/sf-bridge/crawl`, {
        url: crawlForm.url.trim(),
        max_urls: Number(crawlForm.max_urls) || 500,
      });
      setActiveJob(r.data.job_id);
      setJobStatus({ status: r.data.status, job_id: r.data.job_id });
      toast.success(`Crawl started · job ${r.data.job_id}`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to start crawl");
    } finally { setBusy(false); }
  };

  const ingest = async () => {
    if (!activeJob) return;
    setBusy(true);
    try {
      const r = await ax.post(`/clients/${clientId}/integrations/sf-bridge/crawl/${activeJob}/ingest`);
      toast.success(`Ingested · ${r.data.format} · ${r.data.rows} rows`);
    } catch (e) {
      toast.error(e?.response?.data?.detail || "Failed to ingest");
    } finally { setBusy(false); }
  };

  const downloadBridge = () => {
    window.open(`${API}/integrations/sf-bridge/download`, "_blank");
  };

  const downloadReadme = () => {
    window.open(`${API}/integrations/sf-bridge/readme`, "_blank");
  };

  const ok = !!status?.ok;
  const configured = !!status?.configured;
  const isRunning = jobStatus && ["queued", "running"].includes((jobStatus.status || "").toLowerCase());
  const isDone = jobStatus && ["done", "completed", "finished", "success"].includes((jobStatus.status || "").toLowerCase());
  const isFailed = jobStatus && ["failed", "error"].includes((jobStatus.status || "").toLowerCase());

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5 space-y-5" data-testid="sf-bridge-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 grid place-items-center rounded-sm border border-zinc-800 bg-zinc-950">
            <Plug size={16} className="text-zinc-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-heading text-base font-medium text-zinc-50">Screaming Frog bridge</div>
              {status.loading ? (
                <Loader2 size={13} className="text-zinc-500 animate-spin" />
              ) : ok ? (
                <CheckCircle2 size={13} className="text-emerald-400" />
              ) : configured ? (
                <XCircle size={13} className="text-rose-400" />
              ) : (
                <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
              )}
              <span
                data-testid="sf-bridge-state"
                className={`text-[10px] font-mono uppercase tracking-wider ${
                  ok ? "text-emerald-400" : configured ? "text-rose-400" : "text-zinc-500"
                }`}
              >
                {status.loading ? "checking…" : ok ? "Connected" : configured ? (status.error || "unreachable") : "Not configured"}
              </span>
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Trigger real crawls on your Windows desktop. The cloud agent calls your local bridge via ngrok.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={downloadBridge}
            variant="ghost"
            className="text-zinc-300 hover:bg-zinc-800 rounded-sm"
            data-testid="sf-bridge-download"
          >
            <Download size={13} className="mr-1.5" /> sf_bridge.py
          </Button>
          <Button
            onClick={downloadReadme}
            variant="ghost"
            className="text-zinc-400 hover:bg-zinc-800 rounded-sm"
            data-testid="sf-bridge-readme"
          >
            <BookOpen size={13} className="mr-1.5" /> Setup guide
          </Button>
        </div>
      </div>

      {/* Setup callout */}
      {!ok && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-4 text-xs text-zinc-400 leading-relaxed">
          <div className="flex items-center gap-2 text-zinc-200 mb-2">
            <Terminal size={12} /> <span className="font-mono uppercase tracking-wider text-[10px]">Quick setup</span>
          </div>
          <ol className="list-decimal list-inside space-y-1 font-mono text-[11px]">
            <li>Download <span className="text-zinc-200">sf_bridge.py</span> + the setup guide.</li>
            <li><span className="text-zinc-200">pip install fastapi uvicorn</span></li>
            <li><span className="text-zinc-200">python sf_bridge.py --token MYSECRET --port 8765</span></li>
            <li>In a new terminal: <span className="text-zinc-200">ngrok http 8765</span></li>
            <li>Paste the ngrok URL + the same token below.</li>
          </ol>
        </div>
      )}

      {/* Config form */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <div className="md:col-span-2">
          <Label className="text-xs text-zinc-400">Bridge URL (from ngrok)</Label>
          <Input
            data-testid="sf-bridge-url"
            value={form.base_url}
            onChange={(e) => setForm({ ...form, base_url: e.target.value })}
            placeholder="https://xxxxx.ngrok-free.app"
            className="mt-1 bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-sm"
          />
        </div>
        <div>
          <Label className="text-xs text-zinc-400">Shared token</Label>
          <Input
            data-testid="sf-bridge-token"
            type="password"
            value={form.token}
            onChange={(e) => setForm({ ...form, token: e.target.value })}
            placeholder={configured ? "•••••••• (already set — leave blank to keep)" : "must match --token on the bridge"}
            className="mt-1 bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-sm"
          />
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Button
          onClick={save}
          disabled={busy}
          data-testid="sf-bridge-save"
          className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save & test"}
        </Button>
        <Button
          onClick={loadStatus}
          variant="ghost"
          className="text-zinc-300 hover:bg-zinc-800 rounded-sm"
          data-testid="sf-bridge-refresh"
        >
          <RefreshCw size={13} className="mr-1.5" /> Re-check
        </Button>
        {configured && (
          <Button
            onClick={disconnect}
            variant="ghost"
            className="text-zinc-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-sm ml-auto"
            data-testid="sf-bridge-disconnect"
          >
            <Trash2 size={13} className="mr-1.5" /> Disconnect
          </Button>
        )}
      </div>

      {/* Crawl panel */}
      {ok && (
        <div className="rounded-sm border border-zinc-800 bg-zinc-950 p-4 space-y-3" data-testid="sf-bridge-crawl">
          <div className="flex items-center gap-2 text-zinc-200">
            <Play size={12} /> <span className="font-mono uppercase tracking-wider text-[10px]">Trigger a crawl</span>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
            <Input
              data-testid="sf-crawl-url"
              value={crawlForm.url}
              onChange={(e) => setCrawlForm({ ...crawlForm, url: e.target.value })}
              placeholder="https://example.com"
              className="md:col-span-3 bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-sm"
            />
            <Input
              data-testid="sf-crawl-max"
              type="number"
              value={crawlForm.max_urls}
              onChange={(e) => setCrawlForm({ ...crawlForm, max_urls: e.target.value })}
              className="bg-zinc-950 border-zinc-800 rounded-sm text-zinc-100 font-mono text-sm"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button
              onClick={startCrawl}
              disabled={busy || isRunning}
              data-testid="sf-crawl-start"
              className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
            >
              <Play size={13} className="mr-1.5" /> Start crawl
            </Button>
            {jobStatus && (
              <div className="text-xs font-mono text-zinc-400">
                job <span className="text-zinc-200">{jobStatus.job_id || activeJob}</span>
                {" · "}
                status <span className={
                  isDone ? "text-emerald-400" : isFailed ? "text-rose-400" : "text-amber-400"
                }>{jobStatus.status}</span>
                {jobStatus.started_at && ` · started ${formatRelative(jobStatus.started_at)}`}
              </div>
            )}
            {isDone && (
              <Button
                onClick={ingest}
                disabled={busy}
                data-testid="sf-crawl-ingest"
                className="ml-auto bg-emerald-400/10 text-emerald-300 hover:bg-emerald-400/20 rounded-sm border border-emerald-400/30"
              >
                Ingest into audit
              </Button>
            )}
          </div>
          {isFailed && (jobStatus.error || (jobStatus.stdout_tail || []).length > 0) && (
            <div className="mt-1 space-y-1.5">
              {jobStatus.error && (
                <div className="text-xs text-rose-400 font-mono whitespace-pre-wrap break-words rounded-sm border border-rose-400/20 bg-rose-400/5 p-2">
                  {jobStatus.error}
                </div>
              )}
              {(jobStatus.stdout_tail || []).length > 0 && (
                <details className="text-[11px] font-mono text-zinc-500">
                  <summary className="cursor-pointer hover:text-zinc-300">Screaming Frog output</summary>
                  <pre className="mt-1 p-2 rounded-sm border border-zinc-800 bg-zinc-950 text-zinc-400 whitespace-pre-wrap break-words max-h-48 overflow-y-auto">
                    {(jobStatus.stdout_tail || []).join("\n")}
                  </pre>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
