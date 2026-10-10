"use client";

// Fill From a Document (docs/AI.md, "Reading order documents"): the inspector
// uploads a PO, packing list or inspection request in any layout; the AI
// reads it and the form fills in what matches. The client, manufacturer,
// product type and product name fill the form at once; the PO, codes, dates
// and order lines go into the new inspection on Create. Everything stays
// editable, and nothing is filled over a value already set in the inspection.
//
// Photos are made JPEG (2048 px) in the browser first, as every photo is
// (lib/photos), so a large iPad photo stays under the upload limit.
import { TriangleAlertIcon, CameraIcon, CheckIcon, FileUpIcon, RotateCcwIcon, ScanTextIcon, XIcon } from "lucide-react";
import { useRef, useState, useTransition, type DragEvent } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { PRODUCT_TYPE_LABEL } from "@/lib/inspections/create";
import { browserCodec } from "@/lib/photos/browser-codec";
import { processPhoto } from "@/lib/photos/process";
import { DOCUMENT_MAX_BYTES, type DocumentReadResult } from "@/lib/schemas/document-fill";
import { cn } from "@/lib/utils";
import { HEADER_LABELS } from "@/modules/header/config";
import { readDocument } from "../actions";
import type { Option } from "../_lib/types";
import { Panel } from "./panel";

export type DocumentRead = Extract<DocumentReadResult, { status: "read" }>;

const ACCEPT = "application/pdf,image/*";
const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

type DocumentPanelProps = {
  id: string;
  clients: readonly Option[];
  manufacturers: readonly Option[];
  /** The last document read, or null. */
  read: DocumentRead | null;
  /** With the file as it was read: it is kept with the inspection, as its first Source Document. */
  onRead: (read: DocumentRead, file: File) => void;
  onClear: () => void;
};

/** A PDF as it is; a photo as a 2048 px JPEG. Null with a message when it cannot be sent. */
async function prepare(file: File): Promise<{ blob: File; name: string } | { error: string }> {
  if (file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")) {
    if (file.size > DOCUMENT_MAX_BYTES) return { error: "The PDF is larger than 4 MB. Upload just the pages with the order details." };
    return { blob: new File([file], file.name, { type: "application/pdf" }), name: file.name };
  }
  if (!file.type.startsWith("image/") && !/\.(heic|heif|jpe?g|png|webp|gif)$/i.test(file.name)) {
    return { error: "Upload a PDF or a photo of the document." };
  }
  const result = await processPhoto(file, { codec: browserCodec() });
  if (!result.ok) return { error: result.message };
  if (result.photo.flagged) return { error: "This photo could not be converted. Take a screenshot of it, or save it as JPEG, and try again." };
  if (result.photo.blob.size > DOCUMENT_MAX_BYTES) return { error: "The photo is too large to send. Try a closer, simpler shot." };
  const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
  return { blob: new File([result.photo.blob], name, { type: "image/jpeg" }), name };
}

export function DocumentPanel({ id, clients, manufacturers, read, onRead, onClear }: DocumentPanelProps) {
  const [reading, startReading] = useTransition();
  const [fileName, setFileName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const cameraInput = useRef<HTMLInputElement>(null);

  function readFile(file: File | undefined) {
    if (!file || reading) return;
    setError(null);
    setFileName(file.name);
    startReading(async () => {
      try {
        const prepared = await prepare(file);
        if ("error" in prepared) {
          setError(prepared.error);
          return;
        }
        const formData = new FormData();
        formData.append("document", prepared.blob, prepared.name);
        const result = await readDocument(formData);
        if (result.status === "read") onRead(result, prepared.blob);
        else setError(result.message);
      } catch (cause) {
        console.error(cause);
        setError(UNREACHABLE);
      }
    });
  }

  function drop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragging(false);
    readFile(event.dataTransfer.files[0]);
  }

  return (
    <Panel
      headingId={`${id}-document-heading`}
      icon={ScanTextIcon}
      title="Fill From a Document"
      description="Upload the PO, packing list or inspection request. AI reads it and fills in what matches."
      className="gap-4"
      data-testid="document-panel"
    >
      <p role="status" className="sr-only">
        {reading ? "Reading the document." : read ? `Filled from ${read.fileName}.` : ""}
      </p>

      {/* Not posted with the form: each file is sent to the reader on its own. */}
      <input
        ref={fileInput}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          readFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />
      <input
        ref={cameraInput}
        type="file"
        accept="image/*"
        capture="environment"
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        onChange={(event) => {
          readFile(event.target.files?.[0]);
          event.target.value = "";
        }}
      />

      {reading ? (
        <div className="flex items-center gap-3 rounded-lg bg-brand-50 p-4 text-sm text-brand-700 touch:text-base" data-testid="document-reading">
          <Spinner aria-hidden className="size-5 shrink-0" />
          <div className="flex min-w-0 flex-col">
            <span className="truncate font-semibold">Reading {fileName}…</span>
            <span>This can take up to a minute.</span>
          </div>
        </div>
      ) : read ? (
        <Summary read={read} clients={clients} manufacturers={manufacturers} />
      ) : (
        <div
          onDragOver={(event) => {
            event.preventDefault();
            setDragging(true);
          }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
          className={cn(
            "flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-border px-4 py-6 text-center",
            dragging && "border-brand-500 bg-brand-50",
          )}
        >
          <FileUpIcon aria-hidden className="size-8 text-brand-600" />
          <p className="text-sm text-muted-foreground touch:text-base">
            <span className="touch:hidden">Drop a PDF or a photo here, or choose one.</span>
            <span className="hidden touch:inline">Take a photo of the document, or choose a PDF or photo.</span>
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Button type="button" variant="outline" className="hidden touch:inline-flex" onClick={() => cameraInput.current?.click()}>
              <CameraIcon aria-hidden />
              Take Photo
            </Button>
            <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
              <FileUpIcon aria-hidden />
              Choose File
            </Button>
          </div>
        </div>
      )}

      {error && !reading && (
        <Alert variant="destructive" data-testid="document-error">
          <TriangleAlertIcon aria-hidden />
          <AlertDescription className="text-destructive">{error}</AlertDescription>
        </Alert>
      )}

      {read && !reading && (
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" onClick={() => fileInput.current?.click()}>
            <RotateCcwIcon aria-hidden />
            Read Another
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              setError(null);
              onClear();
            }}
          >
            <XIcon aria-hidden />
            Clear
          </Button>
        </div>
      )}
    </Panel>
  );
}

const DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });

function day(iso: string): string {
  return DAY.format(new Date(`${iso}T00:00:00Z`));
}

type Row = { label: string; value: string; ok: boolean };

function Summary({ read, clients, manufacturers }: { read: DocumentRead; clients: readonly Option[]; manufacturers: readonly Option[] }) {
  const { form, fill } = read;
  const picked = (entries: readonly Option[], id: string | null) => entries.find((entry) => entry.id === id)?.label ?? null;
  const client = picked(clients, form.clientId);
  const manufacturer = picked(manufacturers, form.manufacturerId);

  const rows: Row[] = [];
  if (client) rows.push({ label: "Client", value: client, ok: true });
  else if (form.clientName) rows.push({ label: "Client", value: `“${form.clientName}” is not in the client list`, ok: false });
  if (manufacturer) rows.push({ label: "Manufacturer", value: manufacturer, ok: true });
  else if (form.manufacturerName) {
    rows.push({ label: "Manufacturer", value: `“${form.manufacturerName}” is not in the manufacturer list`, ok: false });
  }
  if (form.productType) rows.push({ label: "Product Type", value: PRODUCT_TYPE_LABEL[form.productType], ok: true });
  if (form.productName) rows.push({ label: "Product Name", value: form.productName, ok: true });

  const later: Row[] = [];
  const { header } = fill;
  if (header.poNo) later.push({ label: HEADER_LABELS.poNo, value: header.poNo, ok: true });
  if (header.productCode) later.push({ label: HEADER_LABELS.productCode, value: header.productCode, ok: true });
  if (header.factoryGloveCode) later.push({ label: HEADER_LABELS.factoryGloveCode, value: header.factoryGloveCode, ok: true });
  if (header.mfgDate) later.push({ label: HEADER_LABELS.mfgDate, value: day(header.mfgDate), ok: true });
  if (header.expiryDate) later.push({ label: HEADER_LABELS.expiryDate, value: day(header.expiryDate), ok: true });
  for (const [size, line] of Object.entries(fill.sizes)) {
    const parts = [
      line.qtyCases !== null ? `${line.qtyCases} ${line.qtyCases === 1 ? "case" : "cases"}` : null,
      line.lotNumbers.length > 0 ? `${line.lotNumbers.length === 1 ? "Lot" : "Lots"} ${line.lotNumbers.join(", ")}` : null,
    ].filter((part) => part !== null);
    if (parts.length > 0) later.push({ label: `Size ${size}`, value: parts.join(" · "), ok: true });
  }

  return (
    <div className="flex flex-col gap-4" data-testid="document-summary">
      <p className="text-sm font-semibold text-foreground touch:text-base">
        From <span className="break-all">{read.fileName}</span>
      </p>
      {rows.length === 0 && later.length === 0 ? (
        <p className="text-sm text-muted-foreground touch:text-base">Nothing on this document matched the inspection&apos;s fields.</p>
      ) : (
        <>
          {rows.length > 0 && <Rows title="Filled In Above" rows={rows} />}
          {later.length > 0 && <Rows title="Goes Into the Inspection" rows={later} />}
        </>
      )}
      {read.notes && <p className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground touch:text-base">{read.notes}</p>}
      <p className="text-xs text-muted-foreground touch:text-sm">Check each value. Values already set in the inspection are kept.</p>
    </div>
  );
}

function Rows({ title, rows }: { title: string; rows: readonly Row[] }) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="flex flex-col gap-1.5">
        {rows.map((row) => (
          <li key={`${row.label}-${row.value}`} className="flex gap-2 text-sm touch:text-base">
            {row.ok ? (
              <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-pass" />
            ) : (
              <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
            )}
            <span className="min-w-0">
              <span className="text-muted-foreground">{row.label}: </span>
              <span className={row.ok ? "text-foreground" : "text-warn"}>{row.value}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
