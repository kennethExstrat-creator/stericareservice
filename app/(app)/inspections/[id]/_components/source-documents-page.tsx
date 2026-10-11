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
      status={documents.status === "pass" ? "pass" : undefined}
      statusLabel="AI Verified"
      headingRef={titleRef(SOURCE_DOCUMENTS_KEY)}
      summary="Upload every file about this inspection: the handwritten inspection form, the PO, packing lists, photos of labels and cartons. AI reads each one and fills the empty fields in the steps that follow."
    >
      {parts.length > 1 && (
        <p className="text-sm text-muted-foreground touch:text-base" data-testid="source-shared">
          These files are shared by the {parts.length} POs of this inspection. AI fills each PO from its own forms, and adds a PO for
          a form whose PO is not here yet.
        </p>
      )}
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
        />
      )}
      <p className="text-sm text-muted-foreground touch:text-base">
        Check the filled-in values in each step: AI fills only empty fields and never changes what is already entered or the
        result.
      </p>
    </SectionFrame>
  );
}

function AiMark({ file, documents, readOnly }: { file: SlotFile; documents: SourceDocuments; readOnly: boolean }) {
  if (file.state !== "uploaded") return null;
  const reading = documents.statuses[file.id];
  if (!reading) {
    return readOnly ? null : (
      <p className="mt-1 text-sm text-muted-foreground" data-testid="ai-waiting">
        Waiting for AI…
      </p>
    );
  }
  if (reading.status === "reading") {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm text-brand-700" data-testid="ai-reading">
        <Spinner aria-hidden className="size-4" />
        {reading.elsewhere ? "AI is reading it on another screen…" : "AI is reading it…"}
      </p>
    );
  }
  if (reading.status === "read") {
    return (
      <div className="mt-1 flex flex-col gap-0.5" data-testid="ai-verified">
        <p className="flex items-center gap-1.5 text-sm font-semibold text-pass">
          <BadgeCheckIcon aria-hidden className="size-4 shrink-0" />
          AI Verified
          {reading.filled !== undefined && (
            <span className="font-normal text-muted-foreground">
              · {reading.filled > 0 ? `${reading.filled} ${reading.filled === 1 ? "field" : "fields"} filled` : "nothing new to fill"}
              {documents.parts.length > 1 && " in this PO"}
            </span>
          )}
        </p>
        {reading.summary && <p className="text-sm text-muted-foreground">{reading.summary}</p>}
      </div>
    );
  }
  return (
    <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1" data-testid="ai-failed">
      <p className="flex items-start gap-1.5 text-sm text-warn">
        <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        {reading.summary ?? "The AI could not read this file."}
      </p>
      {!readOnly && (
        <Button type="button" variant="ghost" size="sm" onClick={() => documents.retry(file.id)}>
          <RotateCcwIcon aria-hidden />
          Read Again<span className="sr-only">: {file.name}</span>
        </Button>
      )}
    </div>
  );
}
