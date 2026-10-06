"use client";

// Where a module's Capture attaches lab reports and certificates (BUILD_SPEC
// 8.1). Modules stay decoupled from storage: a Capture renders
// <ModuleFileSlot> and keeps the id of each file it is handed (files.ts);
// the capture screen wraps the modules in <FileSlotProvider> with a renderer
// for its upload slot (components/capture/files FileSlot), which owns the
// file list, the upload queue and the inspection id. Without a provider (the
// template editor's preview, a test) the slot says where files are attached
// instead, and the module still shows what it keeps.
import { createContext, useContext, type ReactNode } from "react";
import { PaperclipIcon } from "lucide-react";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { cn } from "@/lib/utils";
import type { CaptureFocus } from "./contract";
import type { AttachedFile, FileKind } from "./files";

/** What a module asks the screen's file slot for: the renderer's input. */
export type FileSlotRequest = {
  /** The module the files belong to: inspection_files.module_key. */
  readonly moduleKey: ModuleKey;
  /** inspection_files.kind of the files added here. */
  readonly kind: FileKind;
  /** The slot's heading in the template's wording; the renderer's own (by kind) when absent. */
  readonly title?: string;
  /** What is in focus when a file is added: the size a report is for, the document on the checklist. */
  readonly focus: CaptureFocus | null;
  /** Nothing can be added or deleted here (approved, not the user's, or nothing chosen to file it under). */
  readonly readOnly: boolean;
  /** A file was handed to the upload queue: its future inspection_files id. */
  onAdded(file: AttachedFile): void;
  /** A file of the module was deleted or taken off the queue. */
  onRemoved(fileId: string): void;
};

/** Renders the screen's file slot for a module's request. */
export type FileSlotRenderer = (request: FileSlotRequest) => ReactNode;

const FileSlotContext = createContext<FileSlotRenderer | null>(null);

/**
 * Given by the capture screen around the modules it renders:
 *
 *   <FileSlotProvider render={(slot) => (
 *     <FileSlot inspectionId={id} moduleKey={slot.moduleKey} kind={slot.kind} title={slot.title}
 *               focus={slot.focus} readOnly={slot.readOnly || readOnly} onAdded={slot.onAdded} />
 *   )}>
 */
export function FileSlotProvider({ render, children }: { render: FileSlotRenderer; children?: ReactNode }) {
  return <FileSlotContext.Provider value={render}>{children}</FileSlotContext.Provider>;
}

/** The screen's renderer, or null where files cannot be attached. */
export function useFileSlotRenderer(): FileSlotRenderer | null {
  return useContext(FileSlotContext);
}

export type ModuleFileSlotProps = {
  moduleKey: ModuleKey;
  kind: FileKind;
  title?: string;
  focus?: CaptureFocus | null;
  readOnly: boolean;
  /** Keep the file's id in the module's data, through useDataUpdater. */
  onAdded: (file: AttachedFile) => void;
  /** Drop the id when the module keeps it. Without it, a deleted file stays kept until replaced. */
  onRemoved?: (fileId: string) => void;
  className?: string;
};

/**
 * The slot where a module attaches its files: the screen's upload slot, or,
 * where there is none, a note that files are attached on the inspection
 * screen.
 */
export function ModuleFileSlot({
  moduleKey,
  kind,
  title,
  focus = null,
  readOnly,
  onAdded,
  onRemoved,
  className,
}: ModuleFileSlotProps) {
  const render = useFileSlotRenderer();
  if (render) {
    return (
      <div data-slot="module-file-slot" data-module={moduleKey} className={cn("min-w-0", className)}>
        {render({
          moduleKey,
          kind,
          ...(title === undefined ? {} : { title }),
          focus,
          readOnly,
          onAdded,
          onRemoved: (fileId) => onRemoved?.(fileId),
        })}
      </div>
    );
  }
  return (
    <p
      data-slot="module-file-slot"
      data-module={moduleKey}
      data-unavailable=""
      className={cn(
        "relative flex items-start gap-2 rounded-lg border border-dashed border-slate-300 px-3 py-2 text-sm text-muted-foreground touch:text-base",
        className,
      )}
    >
      <PaperclipIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:size-5" />
      <span>
        {title ? <span className="font-medium text-foreground">{title}: </span> : null}
        Attach files on the inspection screen.
      </span>
    </p>
  );
}
