"use client";

// A step's lab report or certificate, linked from Source Documents (docs/AI.md,
// "Source Documents"; docs/MODULES.md 10.1): every file is uploaded once, on
// the first step, and a module page only links one of them (the AI links a
// lab report it reads there by itself). The capture screen's renderer for a
// module's ModuleFileSlot (section-body.tsx). Linked: one line, the file's
// name with Preview and Unlink (which never deletes the file). Not linked:
// one Choose File menu of the Source Documents' files, then those uploaded
// on this page before Source Documents existed (they still count, so none is
// lost), and Go to Source Documents. No file at all yet: one line and a
// button to the step. Read-only: the linked file only.
import { useCallback, useMemo, useRef, useState } from "react";
import { ChevronDownIcon, EyeIcon, FileSearchIcon, FileTextIcon, PaperclipIcon, UnlinkIcon } from "lucide-react";
import { FilePreviewDialog } from "@/components/capture/files/file-preview-dialog";
import { useInspectionMedia, usePhotoQueue, useStartPhotoQueue } from "@/components/capture/photos/hooks";
import { slotFiles, type SlotFile } from "@/components/capture/photos/photo-model";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SOURCE_DOCUMENTS_KEY } from "@/lib/inspections/source-documents";
import type { FileSlotRequest } from "@/modules/_framework/file-slot";

/** The slot's file for screen readers, when the module gives no title. */
const KIND_NAME = { lab_report: "Lab Report", certificate: "Certificate", other: "Document" } as const;

/**
 * What a module can link: the Source Documents' files (the Files side), and
 * the files uploaded on the module's own page before. Never one whose upload
 * stopped: it may not arrive.
 */
export function linkChoices(files: readonly SlotFile[], moduleKey: string): { sources: SlotFile[]; earlier: SlotFile[] } {
  const usable = files.filter((file) => file.state !== "failed");
  return {
    sources: usable.filter((file) => file.moduleKey === SOURCE_DOCUMENTS_KEY),
    earlier: usable.filter((file) => file.moduleKey === moduleKey),
  };
}

export function SourceFileLink({
  inspectionId,
  slot,
  readOnly,
  onOpenSourceDocuments,
}: {
  inspectionId: string;
  slot: FileSlotRequest;
  readOnly: boolean;
  /** Opens the Source Documents step, where files are uploaded. */
  onOpenSourceDocuments?: () => void;
}) {
  useStartPhotoQueue();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  // Uploaded and still queued, every module's: a kept id may be any of them.
  const files = useMemo(
    () => slotFiles({ files: media.media?.files ?? [], queue, inspectionId, moduleKey: undefined }),
    [media.media, queue, inspectionId],
  );
  const [previewing, setPreviewing] = useState<{ name: string; url: string } | null>(null);
  // Linking or unlinking takes away the control pressed: the focus goes to the one in its place.
  const refocus = useRef(false);
  const chosen = useRef(false);
  const takeFocus = useCallback((node: HTMLElement | null) => {
    if (!node || !refocus.current) return;
    refocus.current = false;
    (node instanceof HTMLButtonElement ? node : node.querySelector("button"))?.focus();
  }, []);

  const linked = slot.fileId ? (files.find((file) => file.id === slot.fileId) ?? null) : null;
  if (linked) {
    const url = linked.url;
    return (
      <>
        <div ref={takeFocus} data-slot="source-file-link" data-file-id={linked.id} className="relative flex min-w-0 items-center gap-2">
          <FileTextIcon aria-hidden className="size-4 shrink-0 text-brand-600 touch:size-5" />
          <span className="min-w-0 flex-1 truncate text-sm font-medium text-foreground touch:text-base" title={linked.name}>
            {linked.name}
          </span>
          {url && (
            <Button type="button" variant="ghost" size="icon-sm" title="Preview" onClick={() => setPreviewing({ name: linked.name, url })}>
              <EyeIcon aria-hidden />
              <span className="sr-only">Preview {linked.name}</span>
            </Button>
          )}
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              title="Unlink"
              onClick={() => {
                refocus.current = true;
                slot.onRemoved(linked.id);
              }}
            >
              <UnlinkIcon aria-hidden />
              <span className="sr-only">Unlink {linked.name}</span>
            </Button>
          )}
        </div>
        <FilePreviewDialog file={previewing} onClose={() => setPreviewing(null)} />
      </>
    );
  }

  const { sources, earlier } = linkChoices(files, slot.moduleKey);
  const none = sources.length === 0 && earlier.length === 0;
  // Nothing to say where nothing can be linked, nor before the files (the kept one among them) are known.
  if (readOnly || ((none || slot.fileId) && media.status !== "ready")) return null;
  if (none) {
    return (
      <div data-slot="source-file-link" data-empty="" className="relative flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-muted-foreground touch:text-base">No source documents yet.</span>
        {onOpenSourceDocuments && (
          <Button type="button" variant="outline" size="sm" onClick={onOpenSourceDocuments}>
            <FileSearchIcon aria-hidden />
            Go to Source Documents
          </Button>
        )}
      </div>
    );
  }
  if (!slot.addable) return null;

  const item = (file: SlotFile) => (
    <DropdownMenuItem
      key={file.id}
      onSelect={() => {
        chosen.current = true;
        refocus.current = true;
        slot.onAdded({ id: file.id, name: file.name, kind: slot.kind });
      }}
    >
      <FileTextIcon aria-hidden className="text-brand-600" />
      <span className="min-w-0 truncate">{file.name}</span>
    </DropdownMenuItem>
  );
  return (
    <div ref={takeFocus} data-slot="source-file-link" className="relative">
      <DropdownMenu modal={false}>
        <DropdownMenuTrigger asChild>
          <Button type="button" variant="outline" size="sm">
            <PaperclipIcon aria-hidden />
            Choose File
            <span className="sr-only">: {slot.title ?? KIND_NAME[slot.kind]}</span>
            <ChevronDownIcon aria-hidden />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="start"
          className="w-auto min-w-56 max-w-[min(28rem,calc(100vw-2rem))]"
          // A file chosen, or the step opened: the trigger is gone, the focus goes elsewhere.
          onCloseAutoFocus={(event) => {
            if (!chosen.current) return;
            chosen.current = false;
            event.preventDefault();
          }}
        >
          {sources.length > 0 && (
            <DropdownMenuGroup>
              <DropdownMenuLabel>Source Documents</DropdownMenuLabel>
              {sources.map(item)}
            </DropdownMenuGroup>
          )}
          {earlier.length > 0 && (
            <DropdownMenuGroup>
              {sources.length > 0 && <DropdownMenuSeparator />}
              <DropdownMenuLabel>Uploaded Here</DropdownMenuLabel>
              {earlier.map(item)}
            </DropdownMenuGroup>
          )}
          {onOpenSourceDocuments && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                onSelect={() => {
                  chosen.current = true;
                  onOpenSourceDocuments();
                }}
              >
                <FileSearchIcon aria-hidden />
                Go to Source Documents
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
}
