"use client";

// Source Documents: the capture screen's first page, before every module
// (docs/AI.md, "Source Documents"). Files holds every paper about the
// inspection: the handwritten inspection form, the PO, packing lists, photos
// of labels and cartons. The AI reads each one and fills the empty fields of
// the pages after it; a file it has read is AI Verified. Photos are made
// 2048 px JPEG first, as every photo is (lib/photos), so the AI can read them.
// Media holds the visit's photos and videos, in categories (source-media.tsx).
import { BadgeCheckIcon, FileTextIcon, ImagesIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { useState, type Ref } from "react";
import { FileSlot } from "@/components/capture/files";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE } from "@/lib/inspections/source-documents";
import { browserCodec } from "@/lib/photos/browser-codec";
import { FILE_SIZE_LIMIT } from "@/lib/photos/paths";
import { processPhoto } from "@/lib/photos/process";
import { SectionFrame } from "./section-frame";
import { SourceMedia } from "./source-media";
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

type SourceTab = "files" | "media";

/** One side of the Files / Media pill switch. */
const PILL =
  "h-8 gap-1.5 rounded-full px-4 font-semibold text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground touch:h-11 touch:px-5 data-[state=on]:bg-card data-[state=on]:text-brand-700 data-[state=on]:shadow-sm data-[state=on]:ring-1 data-[state=on]:ring-border";

export function SourceDocumentsPage({ panelId, tabLabelledBy, titleRef, inspectionId, readOnly, documents }: SourceDocumentsPageProps) {
  const [tab, setTab] = useState<SourceTab>("files");
  return (
    <SectionFrame
      id={panelId}
      sectionKey={SOURCE_DOCUMENTS_KEY}
      tabLabelledBy={tabLabelledBy}
      title={SOURCE_DOCUMENTS_TITLE}
      headingRef={titleRef(SOURCE_DOCUMENTS_KEY)}
      summary={
        tab === "files" ? (
          "Inspection forms and PO papers for this PO. AI fills in the steps."
        ) : (
          <>
            Photos and videos from the visit, by category.
            {!readOnly && ` Videos can be up to ${Math.round(FILE_SIZE_LIMIT / (1024 * 1024))} MB each.`}
            {/* A desktop drops files; the iPad's buttons open its picker. */}
            {!readOnly && <span className="hidden fine:inline"> Drop files on a category to add them.</span>}
          </>
        )
      }
      actions={
        // A pill switch: a soft capsule, the chosen side a white pill on it.
        <ToggleGroup
          type="single"
          spacing={1}
          value={tab}
          onValueChange={(value) => value && setTab(value as SourceTab)}
          aria-label="Show"
          className="rounded-full bg-muted p-1 ring-1 ring-border/60"
          data-testid="source-tabs"
        >
          <ToggleGroupItem value="files" className={PILL}>
            <FileTextIcon aria-hidden />
            Files
          </ToggleGroupItem>
          <ToggleGroupItem value="media" className={PILL}>
            <ImagesIcon aria-hidden />
            Media
          </ToggleGroupItem>
        </ToggleGroup>
      }
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
          compactRows
        />
      ) : (
        <SourceMedia inspectionId={inspectionId} readOnly={readOnly} />
      )}
    </SectionFrame>
  );
}

/** The AI's short sentence about the file, without how it read the shortforms. */
function readingNote(summary: string | null): string {
  return (summary ?? "").split(" Read as: ")[0].trim();
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
    return (
      <span
        className="inline-flex shrink-0 items-center gap-1 rounded-full bg-pass-tint px-2 py-0.5 text-sm font-semibold text-pass ring-1 ring-pass-border"
        title={readingNote(reading.summary) || undefined}
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
        title={readingNote(reading.summary) || undefined}
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
