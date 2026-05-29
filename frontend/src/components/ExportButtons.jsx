import React from "react";
import { FileType, Sheet, Download } from "lucide-react";
import api from "../lib/api";

/**
 * Compact export-buttons row used inside approval cards and detail dialogs.
 * Shows DOCX + XLSX buttons for any approval kind.
 * Renders as <a> with download attribute so the browser handles the file save.
 */
export function ExportButtons({ approvalId, layout = "row", testIdSuffix = "" }) {
  if (!approvalId) return null;
  const docx = api.deliverableDocxUrl(approvalId);
  const xlsx = api.deliverableXlsxUrl(approvalId);
  const wrapperCls = layout === "stack"
    ? "flex flex-col gap-2"
    : "flex flex-wrap items-center gap-2";
  return (
    <div className={wrapperCls}>
      <a
        href={docx}
        download
        className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-emerald-400/40 hover:text-emerald-300 text-zinc-200 rounded-sm transition-colors"
        onClick={(e) => e.stopPropagation()}
        data-testid={`export-docx${testIdSuffix ? `-${testIdSuffix}` : ""}`}
        title="Open in Google Docs, Word, or Pages"
      >
        <FileType size={11} />
        Docs / Word
        <Download size={9} className="opacity-60" />
      </a>
      <a
        href={xlsx}
        download
        className="inline-flex items-center gap-1.5 text-[11px] px-2.5 py-1.5 bg-zinc-900 border border-zinc-800 hover:border-emerald-400/40 hover:text-emerald-300 text-zinc-200 rounded-sm transition-colors"
        onClick={(e) => e.stopPropagation()}
        data-testid={`export-xlsx${testIdSuffix ? `-${testIdSuffix}` : ""}`}
        title="Open in Google Sheets, Excel, or Numbers"
      >
        <Sheet size={11} />
        Sheets / Excel
        <Download size={9} className="opacity-60" />
      </a>
    </div>
  );
}
