import React, { useEffect, useRef, useState } from "react";
import { Upload, FileSpreadsheet, Trash2, AlertCircle, CheckCircle2 } from "lucide-react";
import axios from "axios";
import { API } from "../lib/api";
import { Button } from "./ui/button";
import { toast } from "sonner";
import { formatRelative } from "./Bits";

const ax = axios.create({ baseURL: API });

const TYPE_LABELS = {
  domain_overview: "Domain Overview",
  organic_positions: "Organic Positions",
  competitors: "Competitors",
  backlinks: "Backlinks",
  keyword_gap: "Keyword Gap",
};

const TYPE_HINTS = {
  domain_overview: "From: Domain Overview → Export CSV",
  organic_positions: "From: Organic Research → Positions → Export CSV",
  competitors: "From: Organic Research → Competitors → Export CSV",
  backlinks: "From: Backlinks → Referring URLs → Export CSV",
  keyword_gap: "From: Keyword Gap → Export missing keywords CSV",
};

export default function SemrushUpload({ clientId }) {
  const [uploads, setUploads] = useState({});
  const [busy, setBusy] = useState(false);
  const inputRef = useRef();

  const load = async () => {
    try {
      const r = await ax.get(`/clients/${clientId}/integrations/semrush/uploads`);
      setUploads(r.data.uploads || {});
    } catch {}
  };

  useEffect(() => { load(); }, [clientId]);

  const onPick = () => inputRef.current?.click();

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    if (!f.name.toLowerCase().endsWith(".csv")) {
      toast.error("Upload a .csv export from Semrush");
      return;
    }
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", f);
      const r = await ax.post(`/clients/${clientId}/integrations/semrush/upload`, form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      const label = TYPE_LABELS[r.data.type] || r.data.type;
      toast.success(`${label} ingested · ${r.data.rows} rows`);
      load();
    } catch (err) {
      toast.error(err?.response?.data?.detail || "Upload failed");
    } finally {
      setBusy(false);
      e.target.value = "";
    }
  };

  const onClear = async (etype) => {
    if (!window.confirm(`Remove uploaded ${TYPE_LABELS[etype]} data?`)) return;
    try {
      await ax.delete(`/clients/${clientId}/integrations/semrush/upload/${etype}`);
      toast.success("Removed");
      load();
    } catch {
      toast.error("Failed to clear");
    }
  };

  const present = Object.keys(uploads);

  return (
    <div className="rounded-sm border border-zinc-800 bg-zinc-900 p-5" data-testid="semrush-upload-card">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 grid place-items-center rounded-sm border border-zinc-800 bg-zinc-950">
            <FileSpreadsheet size={16} className="text-zinc-300" />
          </div>
          <div>
            <div className="font-heading text-base font-medium text-zinc-50">Semrush manual uploads</div>
            <div className="text-xs text-zinc-500 mt-0.5">
              Drop in CSV exports to ground the agents without burning API credits.
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            accept=".csv"
            onChange={onFile}
            className="hidden"
            data-testid="semrush-file-input"
          />
          <Button
            data-testid="semrush-upload-btn"
            onClick={onPick}
            disabled={busy}
            className="bg-zinc-50 text-zinc-950 hover:bg-zinc-200 rounded-sm disabled:opacity-50"
          >
            <Upload size={13} className="mr-1.5" /> {busy ? "Uploading…" : "Upload CSV"}
          </Button>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 md:grid-cols-2 gap-2">
        {Object.entries(TYPE_LABELS).map(([key, label]) => {
          const u = uploads[key];
          const ok = !!u;
          return (
            <div
              key={key}
              className="rounded-sm border border-zinc-800 bg-zinc-950 px-3 py-2.5 flex items-start justify-between gap-3"
              data-testid={`semrush-upload-${key}`}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  {ok ? (
                    <CheckCircle2 size={12} className="text-emerald-400 shrink-0" />
                  ) : (
                    <span className="h-1.5 w-1.5 rounded-full bg-zinc-700 shrink-0" />
                  )}
                  <div className="text-sm text-zinc-100 truncate">{label}</div>
                </div>
                {ok ? (
                  <div className="text-[11px] text-zinc-500 mt-1 font-mono truncate">
                    {u.rows} rows · {formatRelative(u.ingested_at)}
                  </div>
                ) : (
                  <div className="text-[11px] text-zinc-600 mt-1 leading-snug">{TYPE_HINTS[key]}</div>
                )}
              </div>
              {ok && (
                <Button
                  data-testid={`semrush-clear-${key}`}
                  onClick={() => onClear(key)}
                  variant="ghost"
                  className="text-zinc-500 hover:text-rose-400 hover:bg-rose-400/10 rounded-sm h-7 w-7 p-0 shrink-0"
                  aria-label={`Remove ${label}`}
                >
                  <Trash2 size={12} />
                </Button>
              )}
            </div>
          );
        })}
      </div>

      <div className="mt-4 flex items-start gap-2 text-xs text-zinc-500">
        <AlertCircle size={12} className="text-zinc-500 mt-0.5 shrink-0" />
        <span>
          Agents automatically prefer uploaded CSVs over live API calls. Re-upload anytime to refresh —
          the format is auto-detected from column headers. Semicolon, comma, or tab delimiters all work.
        </span>
      </div>
    </div>
  );
}
