"use client";

// Source Documents: the capture screen's first page, before every module
// (docs/AI.md, "Source Documents"). Every file about the inspection goes
// here: the handwritten inspection forms, the POs, packing lists, photos of
// labels and cartons. One set of files serves every PO of the inspection:
// they are kept on its first PO (use-source-documents.ts), so each PO's page
// shows and adds to the same files. The AI reads each one once and fills the
// empty fields of every PO from its own forms, adding a PO it finds that the
// inspection has not got yet; a file it has read is AI Verified, with what
// it did for each PO. Photos are made 2048 px JPEG first, as every photo is
// (lib/photos), so the AI can read them.
import { BadgeCheckIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import type { Ref } from "react";
import { FileSlot } from "@/components/capture/files";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import { splitReading } from "@/lib/inspections/source-parts";
import { browserCodec } from "@/lib/photos/browser-codec";
import { processPhoto } from "@/lib/photos/process";
import { SectionFrame } from "./section-frame";
import type { SourceDocuments } from "./use-source-documents";

type SourceDocumentsPageProps = {
  panelId: string;
  tabLabelledBy?: string;
  /** The callback ref of each page's title, by key: the screen focuses titles. */
  titleRef: (key: string) => Ref<HTMLHeadingElement>;
  inspectionId: string;
  readOnly: boolean;
  documents: SourceDocuments;
};

/** A photo as a 2048 px JPEG; a PDF, or a photo the browser cannot convert, as it is. */
async function readable(files: File[]): Promise<File[]> {
  return Promise.all(
    files.map(async (file) => {
      if (!file.type.startsWith("image/")) return file;
      const result = await processPhoto(file, { codec: browserCodec() }).catch(() => null);
      if (!result?.ok || result.photo.flagged) return file;
      return new File([result.photo.blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
    }),
  );
}

export function SourceDocumentsPage({ panelId, tabLabelledBy, titleRef, inspectionId, readOnly, documents }: SourceDocumentsPageProps) {
  const { homeId, parts } = documents;
  const extra = (file: SlotFile) => <AiMark file={file} documents={documents} readOnly={readOnly} />;
  return (
    <SectionFrame
      id={panelId}
      sectionKey={SOURCE_DOCUMENTS_KEY}
      tabLabelledBy={tabLabelledBy}
      title={SOURCE_DOCUMENTS_TITLE}
      headingRef={titleRef(SOURCE_DOCUMENTS_KEY)}
      summary={parts.length > 1 ? `Forms, POs and photos for all ${parts.length} POs. AI fills in the steps.` : "Forms, POs and photos. AI fills in the steps."}
    >
      {homeId === null ? (
        <p role="status" className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <Spinner aria-hidden className="size-4" />
          Loading files…
        </p>
      ) : (
        <FileSlot
          inspectionId={homeId}
          moduleKey={SOURCE_DOCUMENTS_KEY}
          kind="other"
          title="Files"
          readOnly={readOnly}
          prepare={readable}
          fileExtra={extra}
          compactRows
        />
      )}
      {homeId !== null && homeId !== inspectionId && documents.ownFiles > 0 && (
        // Kept on this PO before it shared the inspection's files (or added offline): still read, new files go above.
        <FileSlot
          inspectionId={inspectionId}
          moduleKey={SOURCE_DOCUMENTS_KEY}
          kind="other"
          title="Files Kept on This PO"
          readOnly={readOnly}
          canAdd={false}
          fileExtra={extra}
          compactRows
        />
      )}
    </SectionFrame>
  );
}

/** Beside the file's name: what the AI has done with it. */
function AiMark({ file, documents, readOnly }: { file: SlotFile; documents: SourceDocuments; readOnly: boolean }) {
  if (file.state !== "uploaded") return null;
  const reading = documents.statuses[file.id];
  if (!reading) {
    return readOnly ? null : (
      <span className="text-sm text-muted-foreground" data-testid="ai-waiting">
        Waiting for AI…
      </span>
    );
  }
  if (reading.status === "reading") {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-brand-700" data-testid="ai-reading">
        <Spinner aria-hidden className="size-3.5" />
        AI is reading…
      </span>
    );
  }
  if (reading.status === "read") {
    const headline = splitReading(reading.summary).headline;
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pass-tint px-2 py-0.5 text-sm font-semibold text-pass ring-1 ring-pass-border"
        title={headline || undefined}
        data-testid="ai-verified"
      >
        <BadgeCheckIcon aria-hidden className="size-3.5 shrink-0" />
        AI Verified
      </span>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2" data-testid="ai-failed">
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-warn-tint px-2 py-0.5 text-sm font-semibold text-warn ring-1 ring-warn-border"
        title={splitReading(reading.summary).note || undefined}
      >
        <TriangleAlertIcon aria-hidden className="size-3.5 shrink-0" />
        Not Read
      </span>
      {!readOnly && (
        <Button type="button" variant="ghost" size="xs" onClick={() => documents.retry(file.id)}>
          <RotateCcwIcon aria-hidden />
          Read Again<span className="sr-only">: {file.name}</span>
        </Button>
      )}
    </span>
  );
}
