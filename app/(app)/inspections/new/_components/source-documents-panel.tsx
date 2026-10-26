"use client";

// New Inspection's Source Documents (docs/AI.md, "Reading order documents"):
// the capture screen's first step on the form, so every paper and photo can
// come in while the inspection is created. The same title, Files / Media
// switch and rows as the step (source-documents-page.tsx), and no line under
// the title (Kenneth, 12 October 2026). Files: PDFs and photos of the PO,
// packing list or inspection form; Steri-AI reads them one at a time until
// the client, manufacturer, product type and product name are filled, and
// the PO, codes, dates and order lines it read go in with Create. Media: the
// visit's photos and videos, which Auto-Sort files into categories once the
// inspection exists. Everything stays in the browser until Create
// (use-held-sources.ts), then uploads to the new inspection.
//
// It is where a new inspection starts (Kenneth, 26 October 2026: "one of the
// most important section to start with, uploading document and let AI
// prefill straightaway"), so it is the form's main column. Each side opens
// on a large drop area, a tap anywhere in it opening the picker, that becomes
// a row above the list once something is added: the card is only as tall as
// what it holds, growing as documents come in (Kenneth, 26 October 2026). On
// a wide card (48rem), what Steri-AI filled in sits beside the files.
import {
  CheckIcon,
  EyeIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  ImageIcon,
  ImagePlusIcon,
  PlayIcon,
  RotateCcwIcon,
  SparklesIcon,
  Trash2Icon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { useId, useRef, useState, type ChangeEvent, type MouseEvent, type ReactNode } from "react";
import { FILE_ACCEPT } from "@/components/capture/files/file-add-controls";
import { FilePreviewDialog, type PreviewKind } from "@/components/capture/files/file-preview-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { countFiles } from "@/lib/inspections/photos/view";
import { SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import { cn } from "@/lib/utils";
import { NotReadBadge, ReadBadge, ReadingMark, WaitingMark } from "../../_components/reading-marks";
import { SourceTabs, type SourceTab } from "../../_components/source-tabs";
import { useFileDrop } from "../../_components/use-file-drop";
import { createLines, isPdf, type HeldDocument, type HeldMedia, type ReadState } from "../_lib/sources";
import { Panel } from "./panel";
import type { HeldSources } from "./use-held-sources";

export type SummaryLine = { label: string; value: string };

/** Types a browser shows as they are; anything else (a HEIC in Chrome) is offered for download. */
const SHOWABLE = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

function previewOf(file: File, video = false): PreviewKind {
  if (video) return "video";
  if (isPdf(file)) return "pdf";
  return SHOWABLE.has(file.type) ? "image" : "other";
}

type SourceDocumentsPanelProps = {
  id: string;
  sources: HeldSources;
  /** Create is under way: nothing is added or removed. */
  disabled: boolean;
  /** What Steri-AI filled in above, where it still stands. */
  filled: readonly SummaryLine[];
  /** Companies it read that are in neither list, while that field is still empty. */
  unlisted: readonly SummaryLine[];
};

export function SourceDocumentsPanel({ id, sources, disabled, filled, unlisted }: SourceDocumentsPanelProps) {
  const [tab, setTab] = useState<SourceTab>("files");
  const [previewing, setPreviewing] = useState<{ name: string; url: string; kind: PreviewKind } | null>(null);
  const reading = sources.documents.find((document) => document.state.step === "reading");
  return (
    <Panel
      headingId={`${id}-sources-heading`}
      icon={FolderOpenIcon}
      title={SOURCE_DOCUMENTS_TITLE}
      actions={<SourceTabs value={tab} onValueChange={setTab} />}
      className="gap-4"
      data-testid="source-documents"
    >
      <p role="status" className="sr-only">
        {reading ? `Steri-AI is reading ${reading.file.name}.` : ""}
      </p>
      {tab === "files" ? (
        <FilesSide
          sources={sources}
          disabled={disabled}
          filled={filled}
          unlisted={unlisted}
          onPreview={({ file, url }) => setPreviewing({ name: file.name, url, kind: previewOf(file) })}
        />
      ) : (
        <MediaSide
          sources={sources}
          disabled={disabled}
          onPreview={({ file, url, kind }) => setPreviewing({ name: file.name, url, kind: previewOf(file, kind === "video") })}
        />
      )}
      <FilePreviewDialog file={previewing} onClose={() => setPreviewing(null)} />
    </Panel>
  );
}

/* ------------------------------------------------------------------ *
 * Files
 * ------------------------------------------------------------------ */

function FilesSide({
  sources,
  disabled,
  filled,
  unlisted,
  onPreview,
}: Omit<SourceDocumentsPanelProps, "id"> & { onPreview: (document: HeldDocument) => void }) {
  const { documents, preparing, canRead } = sources;
  const lines = createLines(sources.fill);
  const empty = documents.length === 0 && preparing === 0;
  const summary = filled.length > 0 || unlisted.length > 0 || lines.length > 0;
  return (
    // A size container: the summary goes beside the files once the card is 48rem wide (landscape and desktop), under them in portrait.
    <div className="@container" data-slot="held-files">
      <div className={cn("grid gap-4", summary && "@3xl:grid-cols-[minmax(0,1fr)_minmax(16rem,22rem)] @3xl:items-start")}>
        <div className="flex min-w-0 flex-col gap-3">
          <DropArea
            slot="read-drop"
            title={empty ? "Start Here" : "More Documents"}
            text={
              empty
                ? "Drop the PO, packing list and inspection forms here. Steri-AI reads each one and fills in the inspection."
                : "Drop them here. Steri-AI reads each one in turn."
            }
            buttonLabel="Add Document"
            buttonIcon={FilePlusIcon}
            accept={FILE_ACCEPT}
            inputData={{ "data-file-input": "" }}
            roomy={empty}
            disabled={disabled}
            onFiles={sources.addDocuments}
          />
          {documents.length > 0 && (
            <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
              {documents.map((document) => (
                <li
                  key={document.key}
                  data-slot="file-row"
                  data-read={document.state.step}
                  // relative: anchors the buttons' sr-only names (docs/DESIGN.md).
                  className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
                >
                  <FileTextIcon aria-hidden className="size-5 shrink-0 text-brand-600" />
                  <div className="min-w-0 flex-1">
                    <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                      <p className="min-w-0 truncate font-medium text-foreground" title={document.file.name}>
                        {document.file.name}
                      </p>
                      <ReadMark
                        state={document.state}
                        canRead={canRead}
                        name={document.file.name}
                        onReadAgain={() => sources.readAgain(document.key)}
                      />
                    </div>
                    {document.state.step === "failed" && <p className="mt-1 text-sm text-warn">{document.state.message}</p>}
                  </div>
                  <RowButtons name={document.file.name} onPreview={() => onPreview(document)} onRemove={() => sources.removeDocument(document.key)} />
                </li>
              ))}
            </ul>
          )}
          {preparing > 0 && (
            <p role="status" className="flex items-center gap-2 text-sm text-brand-700">
              <Spinner aria-hidden className="size-4" />
              Preparing {countFiles(preparing)}…
            </p>
          )}
        </div>
        {/* Short: what it filled and what goes in. Steri-AI's note on a file is its badge's tooltip. */}
        {summary && (
          <div className="flex flex-col gap-3 rounded-lg bg-muted p-3 text-sm touch:text-base" data-testid="fill-summary">
            {(filled.length > 0 || unlisted.length > 0) && (
              <SummaryList title="Filled In">
                {filled.map((line) => (
                  <SummaryItem key={line.label} line={line} />
                ))}
                {unlisted.map((line) => (
                  <SummaryItem key={`unlisted-${line.label}`} line={line} warn />
                ))}
              </SummaryList>
            )}
            {lines.length > 0 && (
              <SummaryList title="Added on Create">
                {lines.map((line) => (
                  <SummaryItem key={line.label} line={line} />
                ))}
              </SummaryList>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/** Beside a document's name: what Steri-AI has done with it here. */
function ReadMark({ state, canRead, name, onReadAgain }: { state: ReadState; canRead: boolean; name: string; onReadAgain: () => void }) {
  switch (state.step) {
    case "waiting":
      return canRead ? <WaitingMark /> : <WaitingMark>Read after Create</WaitingMark>;
    case "later":
      return <WaitingMark title="Steri-AI reads it on Source Documents after Create.">Read after Create</WaitingMark>;
    case "reading":
      return <ReadingMark />;
    case "read":
      return (
        <ReadBadge title={state.read.notes ?? undefined} testId="ai-read">
          Steri-AI Read
        </ReadBadge>
      );
    case "failed":
      return (
        <span className="inline-flex flex-wrap items-center gap-2" data-testid="ai-failed">
          <NotReadBadge title={state.message} />
          {canRead && (
            <Button type="button" variant="ghost" size="xs" onClick={onReadAgain}>
              <RotateCcwIcon aria-hidden />
              Read Again<span className="sr-only">: {name}</span>
            </Button>
          )}
        </span>
      );
  }
}

function SummaryList({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">{title}</p>
      <ul className="flex flex-col gap-1">{children}</ul>
    </div>
  );
}

function SummaryItem({ line, warn = false }: { line: SummaryLine; warn?: boolean }) {
  return (
    <li className="flex gap-2">
      {warn ? (
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warn" />
      ) : (
        <CheckIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-pass" />
      )}
      <span className="min-w-0 break-words">
        <span className="text-muted-foreground">{line.label}: </span>
        <span className={warn ? "text-warn" : "text-foreground"}>{line.value}</span>
      </span>
    </li>
  );
}

/* ------------------------------------------------------------------ *
 * Media
 * ------------------------------------------------------------------ */

function MediaSide({
  sources,
  disabled,
  onPreview,
}: {
  sources: HeldSources;
  disabled: boolean;
  onPreview: (item: HeldMedia) => void;
}) {
  return (
    <div className="flex flex-col gap-3" data-slot="held-media">
      <DropArea
        slot="auto-sort"
        title="Auto-Sort"
        text="Drop all photos and videos here. Steri-AI sorts each into its category after Create."
        buttonLabel="Add Photos and Videos"
        buttonIcon={ImagePlusIcon}
        accept="image/*,video/*"
        inputData={{ "data-media-input": "new-inspection" }}
        roomy={sources.media.length === 0}
        disabled={disabled}
        onFiles={sources.addMedia}
      />
      {sources.media.length > 0 && (
        <ul className="divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border">
          {sources.media.map((item) => (
            <li key={item.key} data-slot="media-row" className="relative flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <Thumb item={item} />
                <p className="min-w-0 flex-1 truncate font-medium text-foreground" title={item.file.name}>
                  {item.file.name}
                </p>
              </div>
              <RowButtons name={item.file.name} onPreview={() => onPreview(item)} onRemove={() => sources.removeMedia(item.key)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Drop areas
 * ------------------------------------------------------------------ */

type DropAreaProps = {
  slot: string;
  title: string;
  text: string;
  buttonLabel: string;
  buttonIcon: LucideIcon;
  accept: string;
  /** On the picker, for the e2e specs: data-file-input, data-media-input. */
  inputData: Record<`data-${string}`, string>;
  /** Nothing added yet: large and centred, with the solid button, as the place to start. */
  roomy: boolean;
  disabled: boolean;
  onFiles: (files: readonly File[]) => void;
};

/**
 * A side's drop area, like Auto-Sort on the capture screen: files dropped
 * here (or chosen) are held for Create. While the side is empty it is large
 * and a tap anywhere in it opens the picker; then it is a row above the list.
 */
function DropArea({ slot, title, text, buttonLabel, buttonIcon: ButtonIcon, accept, inputData, roomy, disabled, onFiles }: DropAreaProps) {
  const titleId = useId();
  const input = useRef<HTMLInputElement>(null);
  const drop = useFileDrop(onFiles, !disabled);
  const take = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    // Cleared, so choosing the same file again still fires.
    event.target.value = "";
    if (files.length > 0) onFiles(files);
  };
  // The button opens the picker itself, and the picker's own click comes back up here.
  const open = (event: MouseEvent<HTMLElement>) => {
    if (!(event.target as Element).closest("button, input")) input.current?.click();
  };
  return (
    <section
      aria-labelledby={titleId}
      data-slot={slot}
      data-roomy={roomy || undefined}
      data-dragging={drop.dragging || undefined}
      className={cn(
        "relative flex rounded-lg border border-dashed border-brand-300 bg-brand-50 transition-colors",
        roomy
          ? "cursor-pointer flex-col items-center gap-4 px-6 py-10 text-center"
          : "flex-wrap items-center justify-between gap-x-4 gap-y-2 p-3",
        "data-dragging:border-primary data-dragging:outline-2 data-dragging:-outline-offset-2 data-dragging:outline-dashed data-dragging:outline-primary",
      )}
      onClick={roomy && !disabled ? open : undefined}
      {...drop.handlers}
    >
      <div className={cn("flex min-w-0", roomy ? "flex-col items-center gap-3" : "items-start gap-2.5")}>
        {roomy ? (
          <span className="flex size-12 shrink-0 items-center justify-center rounded-full bg-brand-100 text-brand-600">
            <SparklesIcon aria-hidden className="size-6" />
          </span>
        ) : (
          <SparklesIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-brand-600" />
        )}
        <div className="min-w-0">
          <h3 id={titleId} className={cn("leading-snug font-semibold text-foreground", roomy ? "text-lg" : "text-base")}>
            {title}
          </h3>
          <p className={cn("text-muted-foreground", roomy ? "mt-1 max-w-prose text-base text-balance" : "text-sm")}>
            {drop.dragging ? <span className="font-medium text-brand-700">Drop to add</span> : text}
          </p>
        </div>
      </div>
      <div className="relative">
        <Button
          type="button"
          variant={roomy ? "default" : "outline"}
          size={roomy ? "default" : "sm"}
          className="touch:text-base"
          disabled={disabled}
          onClick={() => input.current?.click()}
        >
          <ButtonIcon aria-hidden />
          {buttonLabel}
        </Button>
        {/* Visually hidden rather than display:none, which older iOS Safari will not open from a script. */}
        <input
          ref={input}
          type="file"
          accept={accept}
          multiple
          tabIndex={-1}
          aria-hidden
          className="sr-only"
          {...inputData}
          disabled={disabled}
          onChange={take}
        />
      </div>
    </section>
  );
}

/** A photo's thumbnail, from the file in this browser; a video's play mark. */
function Thumb({ item }: { item: HeldMedia }) {
  const [broken, setBroken] = useState(false);
  const box = "flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-md ring-1 ring-border touch:size-11";
  if (item.kind === "video") {
    return (
      <span className={cn(box, "bg-slate-100 text-slate-600")}>
        <PlayIcon aria-hidden className="size-4 fill-current" />
      </span>
    );
  }
  if (broken) {
    // A photo this browser cannot draw (a HEIC in Chrome): it still uploads.
    return (
      <span className={cn(box, "bg-muted text-muted-foreground")}>
        <ImageIcon aria-hidden className="size-4" />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- a link to a file in this browser: nothing for next/image to do
    <img
      src={item.url}
      alt=""
      draggable={false}
      decoding="async"
      onError={() => setBroken(true)}
      className={cn(box, "bg-muted object-cover")}
    />
  );
}

/** Preview (a dialog on the page) and Remove, as icons. */
function RowButtons({ name, onPreview, onRemove }: { name: string; onPreview: () => void; onRemove: () => void }) {
  return (
    <div className="flex flex-wrap items-center gap-1">
      <Button type="button" variant="ghost" size="icon" title="Preview" onClick={onPreview}>
        <EyeIcon aria-hidden />
        <span className="sr-only">Preview {name}</span>
      </Button>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        title="Remove"
        className="text-destructive hover:bg-fail-tint hover:text-destructive"
        onClick={onRemove}
      >
        <Trash2Icon aria-hidden />
        <span className="sr-only">Remove {name}</span>
      </Button>
    </div>
  );
}
