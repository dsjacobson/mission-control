import React, { useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Trash2, AlertCircle } from "lucide-react";
import axios from "axios";
import { API } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { formatRelative } from "./Bits";

const ax = axios.create({ baseURL: API });

export default function ScreamingFrogUpload({ clientId }) {
  const [status, setStatus] = useState(null);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();

  const load = async () => {
    try {
      const r = await ax.get(`/clients/${clientId}/integrations/screamingfrog/status`);
      setStatus(r.data);
    } catch {}
  };

  useEffect(() => { load(); }, [clientId]);

  const onPick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Upload a .csv export (Issues Overview or internal_all)");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await ax.post(`/clients/${clientId}/integrations/screamingfrog/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      toast.success(`Crawl uploaded · ${r.data.rows} rows, ${r.data.issue_count} issues parsed`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const onClear = async () => {
    if (!window.confirm("Remove uploaded crawl data?")) return;
    try {
      await ax.delete(`/clients/${clientId}/integrations/screamingfrog`);
      toast.success("Crawl removed");
      setStatus({ uploaded: false });
    } catch {
      toast.error("Failed to clear");
    }
  };

  const uploaded = !!status?.uploaded;

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5" data-testid="sf-upload-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 grid place-items-center rounded-sm border border-zinc-800 bg-zinc-950">
            <FileSpreadsheet size={16} className="text-zinc-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <div className="font-heading text-base font-medium text-zinc-50">Screaming Frog</div>
              <span className={`h-1.5 w-1.5 rounded-full ${uploaded ? "bg-emerald-400" : "bg-zinc-600"}`} />
            </div>
            <div className="text-xs text-zinc-500 mt-0.5">
              {uploaded
                ? `${status.filename || "crawl"} · ${status.rows || 0} rows · ${formatRelative(status.ingested_at)}`
                : "No crawl uploaded — export from SEO Spider and upload the CSV"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input ref={inputRef} type="file" accept=".csv" onChange={onFile} className="hidden" data-testid="sf-file-input" />
          <Button
            data-testid="sf-upload-btn"
            onClick={onPick}
            disabled={busy}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
          >
            <Upload size={13} className="mr-1.5" /> {busy ? "Uploading…" : uploaded ? "Replace" : "Upload CSV"}
          </Button>
          {uploaded && (
            <Button
              data-testid="sf-clear-btn"
              onClick={onClear}
              variant="ghost"
              className="text-zinc-400 hover:text-rose-400 hover:bg-rose-400/10 rounded-sm"
            >
              <Trash2 size={13} />
            </Button>
          )}
        </div>
      </div>

      {uploaded && status.summary && (
        <div className="mt-5 grid grid-cols-2 md:grid-cols-4 gap-2">
          {status.summary.by_priority && (
            <>
              <Tile label="High" value={status.summary.by_priority.High || 0} tone="text-rose-400" />
              <Tile label="Medium" value={status.summary.by_priority.Medium || 0} tone="text-amber-400" />
              <Tile label="Low" value={status.summary.by_priority.Low || 0} tone="text-sky-400" />
              <Tile label="URLs affected" value={status.summary.total_urls_affected || 0} />
            </>
          )}
          {status.summary.status_codes && (
            <div className="md:col-span-4">
              <div className="text-[10px] font-mono uppercase tracking-wider text-zinc-500 mb-1.5">Status codes</div>
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(status.summary.status_codes).map(([code, n]) => (
                  <span key={code} className="text-[11px] font-mono px-1.5 py-0.5 rounded-sm border border-zinc-800 bg-zinc-950 text-zinc-300">
                    {code} · {n}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      <div className="mt-4 flex items-start gap-2 text-xs text-zinc-500">
        <AlertCircle size={12} className="text-zinc-500 mt-0.5" />
        <span>
          Run a crawl in SEO Spider → <span className="font-mono text-zinc-300">Reports → Issues → Export</span>{" "}
          (issues_overview.csv) or <span className="font-mono text-zinc-300">Internal → All → Export</span>{" "}
          (internal_all.csv). The Technical Audit agent anchors priorities to your real crawl when present.
        </span>
      </div>
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
