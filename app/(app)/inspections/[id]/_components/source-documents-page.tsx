"use client";

// Source Documents: the capture screen's first page, before every module
// (docs/AI.md, "Source Documents"). Files holds every paper about the
// inspection: the handwritten inspection form, the PO, packing lists, photos
// of labels and cartons. Steri-AI reads each one and fills the empty fields
// of the pages after it; a file it has read is Steri-AI Verified. Photos are
// made 2048 px JPEG first, as every photo is (lib/photos/readable.ts), so it
// can read them. Media holds the visit's photos and videos, in categories
// (source-media.tsx). The card has its title and the Files / Media switch,
// no line under the title (Kenneth, 12 October 2026). New Inspection's
// Source Documents card hands its files over to this page on Create. On the
// page it is the main column, General Information on its left
// (capture-screen.tsx ActivePage; Kenneth, 26 October 2026).
import { useState, type Ref } from "react";
import { FileSlot } from "@/components/capture/files";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import { Button } from "@/components/ui/button";
import { SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import { readableFile } from "@/lib/photos/readable";
import { NotReadBadge, ReadBadge, ReadingMark, WaitingMark } from "../../_components/reading-marks";
import { SourceTabs, type SourceTab } from "../../_components/source-tabs";
import { SectionFrame } from "./section-frame";
import { SourceMedia } from "./source-media";
import type { SourceDocuments } from "./use-source-documents";

type SourceDocumentsPageProps = {
  /** The frame's id: the panel's while the files are the page's only section, else its own. */
  id: string;
  /** Below 1280 px, while the files are the page's only section: the id of its tab, which names the frame. */
  tabLabelledBy?: string;
  /** The callback ref of each page's title, by key: the screen focuses titles. */
  titleRef: (key: string) => Ref<HTMLHeadingElement>;
  inspectionId: string;
  readOnly: boolean;
  documents: SourceDocuments;
};

/** Each photo as a 2048 px JPEG; a PDF, or a photo the browser cannot convert, as it is. */
function readable(files: File[]): Promise<File[]> {
  return Promise.all(files.map(readableFile));
}

export function SourceDocumentsPage({ id, tabLabelledBy, titleRef, inspectionId, readOnly, documents }: SourceDocumentsPageProps) {
  const [tab, setTab] = useState<SourceTab>("files");
  return (
    <SectionFrame
      id={id}
      sectionKey={SOURCE_DOCUMENTS_KEY}
      tabLabelledBy={tabLabelledBy}
      title={SOURCE_DOCUMENTS_TITLE}
      headingRef={titleRef(SOURCE_DOCUMENTS_KEY)}
      actions={<SourceTabs value={tab} onValueChange={setTab} />}
    >
      {tab === "files" ? (
        <FileSlot
          inspectionId={inspectionId}
          moduleKey={SOURCE_DOCUMENTS_KEY}
          kind="other"
          title="Files"
          readOnly={readOnly}
          prepare={readable}
          fileExtra={(file) => <AiMark file={file} documents={documents} readOnly={readOnly} />}
          fileActions={(file) => <ReadAgainButton file={file} documents={documents} readOnly={readOnly} />}
          compactRows
        />
      ) : (
        <SourceMedia inspectionId={inspectionId} readOnly={readOnly} />
      )}
    </SectionFrame>
  );
}

/** Steri-AI's short sentence about the file, without how it read the shortforms. */
function readingNote(summary: string | null): string {
  return (summary ?? "").split(" Read as: ")[0].trim();
}

/** Beside the file's name: what Steri-AI has done with it. Read Again is among the row's icons (ReadAgainButton). */
export function AiMark({ file, documents, readOnly }: { file: SlotFile; documents: SourceDocuments; readOnly: boolean }) {
  if (file.state !== "uploaded") return null;
  const reading = documents.statuses[file.id];
  if (!reading) return readOnly ? null : <WaitingMark />;
  if (reading.status === "reading") return <ReadingMark />;
  if (reading.status === "read") {
    return (
      <ReadBadge title={readingNote(reading.summary)} testId="ai-verified">
        Steri-AI Verified
      </ReadBadge>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="ai-failed">
      <NotReadBadge title={readingNote(reading.summary)} />
    </span>
  );
}

/**
 * Read Again, among the row's icons before Preview (Kenneth, 26 October
 * 2026: "an icon of reload with a tick in the centre"), for a file read or
 * not read: the new reading fills the fields still empty.
 */
export function ReadAgainButton({ file, documents, readOnly }: { file: SlotFile; documents: SourceDocuments; readOnly: boolean }) {
  const reading = documents.statuses[file.id];
  if (readOnly || file.state !== "uploaded" || !reading || reading.status === "reading") return null;
  return (
    <Button type="button" variant="ghost" size="icon" title="Read Again" onClick={() => documents.retry(file.id)}>
      <ReadAgainIcon />
      <span className="sr-only">Read Again {file.name}</span>
    </Button>
  );
}

/** A reload arrow with a tick in its centre, drawn as lucide's icons are. */
function ReadAgainIcon() {
  return (
    <svg
      aria-hidden
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className="size-4"
    >
      <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="m8.5 12.5 2.5 2.5 4.5-5" />
    </svg>
  );
}
