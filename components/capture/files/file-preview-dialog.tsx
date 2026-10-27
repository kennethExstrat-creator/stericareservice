"use client";

// A file shown on the page instead of in a new tab (Source Documents): a
// PDF in the browser's own viewer, a photo as an image, an Excel or CSV file
// as a table of its sheets (Kenneth, 26 October 2026: read on the server,
// lib/spreadsheets), anything else with a Download button. The URL is the
// file's signed link (24 hours), or a blob: link to a file New Inspection
// holds before Create.
import { useEffect, useState, type ReactNode } from "react";
import { DownloadIcon, TriangleAlertIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { spreadsheetTypeOf } from "@/lib/photos/sniff";
import { columnLetters, previewNote, type SheetPreview, type SpreadsheetPreviewResult } from "@/lib/spreadsheets/preview";
import { cn } from "@/lib/utils";

export type PreviewKind = "pdf" | "image" | "video" | "sheet" | "other";

export function previewKind(name: string): PreviewKind {
  if (/\.pdf$/i.test(name)) return "pdf";
  if (/\.(jpe?g|png|webp|gif)$/i.test(name)) return "image";
  if (/\.(mp4|m4v|mov|webm)$/i.test(name)) return "video";
  if (spreadsheetTypeOf({ name })) return "sheet";
  return "other";
}

/**
 * A file the dialog shows. kind: what it is, where its name does not say
 * (Media's "Photo 3"); by its name otherwise. downloadName: the name it is
 * saved under, when not its name. sheets: a spreadsheet's sheets, read on
 * the server (fetchSheets, lib/spreadsheets/preview.ts); without it a
 * spreadsheet is offered for download.
 */
export type PreviewFile = {
  name: string;
  url: string;
  kind?: PreviewKind;
  downloadName?: string;
  sheets?: () => Promise<SpreadsheetPreviewResult>;
};

/**
 * The signed link, asking the browser to save the file under its name
 * instead of showing it. A file still in this browser (a blob: link, New
 * Inspection's Source Documents) is saved as it is: such a link takes no
 * query, and the anchor's download attribute names it.
 */
export function downloadUrl(url: string, name: string): string {
  if (url.startsWith("blob:")) return url;
  return `${url}${url.includes("?") ? "&" : "?"}download=${encodeURIComponent(name)}`;
}

/**
 * `children`: what the dialog shows in place of the file, under its title
 * and Download (Media's photo with its defect marks, which brings its own
 * frame).
 */
export function FilePreviewDialog({ file, onClose, children }: { file: PreviewFile | null; onClose: () => void; children?: ReactNode }) {
  const kind = file ? (file.kind ?? previewKind(file.name)) : "other";
  const saveAs = file ? (file.downloadName ?? file.name) : "";
  return (
    <Dialog open={file !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="flex h-[min(90dvh,60rem)] w-full flex-col gap-4 p-4 sm:max-w-5xl touch:p-5" data-testid="file-preview">
        <DialogHeader className="flex-row items-center gap-3 pr-10">
          <DialogTitle className="min-w-0 flex-1 truncate text-base">{file?.name}</DialogTitle>
          <DialogDescription className="sr-only">A preview of the file.</DialogDescription>
          {file && (
            <Button asChild variant="outline" size="sm">
              <a href={downloadUrl(file.url, saveAs)} download={saveAs}>
                <DownloadIcon aria-hidden />
                Download
              </a>
            </Button>
          )}
        </DialogHeader>
        {children ?? (
          <div className="min-h-0 flex-1 overflow-hidden rounded-lg bg-muted ring-1 ring-border">
            {file && kind === "pdf" && <iframe src={file.url} title={file.name} className="size-full border-0 bg-white" />}
            {file && kind === "image" && (
              // eslint-disable-next-line @next/next/no-img-element -- a signed link to a private file: not for next/image
              <img src={file.url} alt={file.name} className="size-full object-contain" />
            )}
            {file && kind === "video" && (
              <video src={file.url} controls playsInline className="size-full bg-black object-contain">
                <track kind="captions" />
              </video>
            )}
            {/* Keyed by the link: another file's sheets are read afresh. */}
            {file && kind === "sheet" && file.sheets && <SheetsView key={file.url} load={file.sheets} />}
            {file && (kind === "other" || (kind === "sheet" && !file.sheets)) && (
              <p className="flex size-full items-center justify-center p-6 text-center text-muted-foreground">
                This file cannot be shown here. Download it to open it.
              </p>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

/** A spreadsheet's sheets as tables, one tab per sheet when there are several. */
function SheetsView({ load }: { load: () => Promise<SpreadsheetPreviewResult> }) {
  const [result, setResult] = useState<SpreadsheetPreviewResult | null>(null);
  useEffect(() => {
    let alive = true;
    load().then(
      (answer) => alive && setResult(answer),
      () => alive && setResult({ status: "error", message: UNREACHABLE }),
    );
    return () => {
      alive = false;
    };
  }, [load]);

  if (!result) {
    return (
      <p role="status" className="flex size-full items-center justify-center gap-2 p-6 text-muted-foreground">
        <Spinner aria-hidden className="size-4" />
        Reading the spreadsheet…
      </p>
    );
  }
  if (result.status === "error") {
    return (
      <p role="alert" className="flex size-full items-center justify-center gap-2 p-6 text-center text-muted-foreground">
        <TriangleAlertIcon aria-hidden className="size-4 shrink-0 text-warn" />
        {result.message}
      </p>
    );
  }
  if (result.sheets.length === 1) return <SheetTable sheet={result.sheets[0]} />;
  return (
    <Tabs defaultValue="0" className="size-full gap-0">
      {/* relative: anchors the tabs' sr-only text inside the scroller (docs/DESIGN.md). */}
      <div className="relative border-b border-border p-1.5">
        <TabsList aria-label="Sheets" className="max-w-full justify-start overflow-x-auto">
          {result.sheets.map((sheet, index) => (
            <TabsTrigger key={index} value={String(index)} className="flex-none">
              {sheet.name}
              {sheet.hidden && <span className="font-normal text-muted-foreground">(Hidden)</span>}
            </TabsTrigger>
          ))}
        </TabsList>
      </div>
      {result.sheets.map((sheet, index) => (
        <TabsContent key={index} value={String(index)} className="min-h-0">
          <SheetTable sheet={sheet} />
        </TabsContent>
      ))}
    </Tabs>
  );
}

/** A number as a spreadsheet shows one, right aligned like the data in a table: 20, 1,234.50, -3.5, 12%. */
const NUMBER = /^[-+]?(\d{1,3}(,\d{3})+|\d+)(\.\d+)?%?$/;

/** One sheet as Excel lays it out: column letters across the top, row numbers down the side, both kept in view. */
export function SheetTable({ sheet }: { sheet: SheetPreview }) {
  const note = previewNote(sheet);
  const columns = sheet.rows[0]?.length ?? 0;
  const head = "border-r border-b border-border bg-muted px-2 py-1 text-xs font-semibold text-muted-foreground tabular-nums";
  return (
    <div className="flex size-full min-h-0 flex-col" data-slot="sheet-preview">
      {note && <p className="border-b border-border px-3 py-2 text-sm text-muted-foreground">{note}</p>}
      <div className="min-h-0 flex-1 overflow-auto bg-card">
        <table className="border-separate border-spacing-0 text-sm text-foreground touch:text-base">
          <thead>
            <tr>
              <th className={cn(head, "sticky top-0 left-0 z-20")}>
                <span className="sr-only">Row</span>
              </th>
              {Array.from({ length: columns }, (_, index) => (
                <th key={index} scope="col" className={cn(head, "sticky top-0 z-10 min-w-16 text-center")}>
                  {columnLetters(sheet.firstColumn + index)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sheet.rows.map((row, r) => (
              <tr key={r}>
                <th scope="row" className={cn(head, "sticky left-0 z-10 text-right")}>
                  {sheet.firstRow + r + 1}
                </th>
                {row.map((cell, c) => (
                  <td
                    key={c}
                    className={cn(
                      "max-w-xs border-r border-b border-border px-2 py-1 align-top whitespace-pre-wrap [overflow-wrap:anywhere]",
                      NUMBER.test(cell.trim()) && "text-right tabular-nums",
                    )}
                  >
                    {cell}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
