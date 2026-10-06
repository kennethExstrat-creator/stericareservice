"use client";

// Lab reports and certificates as rows: name, kind, upload state, and Open
// (a signed URL in a new tab), Try again or Delete where they apply.
import { useRef, useState } from "react";
import { ExternalLinkIcon, FileTextIcon, RotateCwIcon, Trash2Icon, TriangleAlertIcon } from "lucide-react";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import { photoQueueStore } from "@/components/capture/photos/queue-store";
import { Button } from "@/components/ui/button";
import { FILE_KIND_LABEL, moduleTitle, type PhotoTagOptions } from "@/lib/inspections/photos/view";
import { cn } from "@/lib/utils";
import { FileDeleteDialog } from "./file-delete-dialog";

function stateText(file: SlotFile): string {
  switch (file.state) {
    case "uploaded":
      return "Uploaded";
    case "uploading":
      return `Uploading ${Math.round(file.progress * 100)}%`;
    case "failed":
      return "Upload stopped";
    case "waiting":
      return "Waiting to upload";
  }
}

export function FileList({
  inspectionId,
  files,
  canEditUploaded,
  canEditQueued,
  options,
  showModule = false,
  className,
}: {
  inspectionId: string;
  files: readonly SlotFile[];
  canEditUploaded: boolean;
  canEditQueued: boolean;
  options: PhotoTagOptions;
  /** For lists that mix modules: say which module each file belongs to. */
  showModule?: boolean;
  className?: string;
}) {
  const [deleting, setDeleting] = useState<string | null>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const deletingFile = files.find((file) => file.id === deleting) ?? null;

  return (
    <>
      <ul ref={listRef} className={cn("divide-y divide-border overflow-hidden rounded-lg bg-card ring-1 ring-border", className)}>
        {files.map((file) => {
          const canDelete = file.queued ? canEditQueued || file.state === "failed" : canEditUploaded;
          return (
            <li
              key={file.id}
              data-slot="file-row"
              data-file-id={file.id}
              data-upload-state={file.state}
              className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5"
            >
              <FileTextIcon aria-hidden className="size-5 shrink-0 text-brand-600" />
              <div className="min-w-0 flex-1">
                <p className="truncate font-medium text-foreground" title={file.name}>
                  {file.name}
                </p>
                <p className="text-sm text-muted-foreground">
                  {file.kind ? FILE_KIND_LABEL[file.kind] : "File"}
                  {showModule ? ` · ${moduleTitle(file.moduleKey, options)}` : ""} · {stateText(file)}
                </p>
                {file.state === "failed" && file.error && (
                  <p className="mt-1 flex items-start gap-1.5 text-sm text-fail">
                    <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                    {file.error}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {file.state === "uploaded" && file.url && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={file.url} target="_blank" rel="noopener noreferrer">
                      <ExternalLinkIcon aria-hidden />
                      Open<span className="sr-only"> {file.name} in a new tab</span>
                    </a>
                  </Button>
                )}
                {file.state === "failed" && (
                  <Button type="button" variant="ghost" size="sm" onClick={() => photoQueueStore.retryNow(file.id)}>
                    <RotateCwIcon aria-hidden />
                    Try again<span className="sr-only">: {file.name}</span>
                  </Button>
                )}
                {canDelete && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-fail-tint hover:text-destructive"
                    onClick={() => setDeleting(file.id)}
                  >
                    <Trash2Icon aria-hidden />
                    {file.queued ? "Remove" : "Delete"}
                    <span className="sr-only"> {file.name}</span>
                  </Button>
                )}
              </div>
            </li>
          );
        })}
      </ul>
      {deletingFile && (
        <FileDeleteDialog
          inspectionId={inspectionId}
          file={deletingFile}
          onClose={() => {
            setDeleting(null);
            // The row (and its button) may be gone: focus the list's first control instead.
            requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>("a, button")?.focus());
          }}
        />
      )}
    </>
  );
}
