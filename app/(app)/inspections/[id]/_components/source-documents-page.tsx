"use client";

// Source Documents: the capture screen's first page, before every module
// (docs/AI.md, "Source Documents"). Every file about the inspection goes
// here: the handwritten inspection form, the PO, packing lists, photos of
// labels and cartons. The AI reads each one and fills the empty fields of
// the pages after it; a file it has read is AI Verified. Photos are made
// 2048 px JPEG first, as every photo is (lib/photos), so the AI can read them.
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
      <FileSlot
        inspectionId={inspectionId}
        moduleKey={SOURCE_DOCUMENTS_KEY}
        kind="other"
        title="Files"
        readOnly={readOnly}
        prepare={readable}
        fileExtra={(file) => <AiMark file={file} documents={documents} readOnly={readOnly} />}
      />
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
        AI is reading it…
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
