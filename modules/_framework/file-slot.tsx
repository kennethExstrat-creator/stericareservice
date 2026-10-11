"use client";

// Where a module's Capture attaches lab reports and certificates (BUILD_SPEC
// 8.1). Modules stay decoupled from storage: a Capture renders
// <ModuleFileSlot> with the id it keeps (`fileId`) and keeps the id of each
// file it is handed (files.ts); the capture screen wraps the modules in
// <FileSlotProvider> with a renderer that links one of the inspection's
// Source Documents (section-body.tsx, source-file-link.tsx): files are
// uploaded once, on the first step, never on a module page. Without a
// provider (the template editor's preview, a test) the slot says where files
// are attached instead, and the module still shows what it keeps.
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
  /**
   * The id the module keeps for this slot now (tensile's labReport, the
   * chosen document's file), null for none: the slot shows that file. Absent
   * when the module does not say.
   */
  readonly fileId?: string | null;
  /** Nothing can be linked or unlinked here: approved, or not the user's. */
  readonly readOnly: boolean;
  /**
   * A file can be linked now. False while the module has nothing to file it
   * under (documents before a document is chosen).
   */
  readonly addable: boolean;
  /** A file was chosen for the module (one of Source Documents', or one added here before): its inspection_files id. */
  onAdded(file: AttachedFile): void;
  /** The file was unlinked here (never deleted), or deleted: drop its id. */
  onRemoved(fileId: string): void;
};

/** Renders the screen's file slot for a module's request. */
export type FileSlotRenderer = (request: FileSlotRequest) => ReactNode;

const FileSlotContext = createContext<FileSlotRenderer | null>(null);

/**
 * Given by the capture screen around the modules it renders, with a renderer
 * for its file slot; docs/MODULES.md 10.1 shows the renderer.
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
  /** The id the module keeps for this slot (null for none): the screen shows that file, with Unlink. */
  fileId?: string | null;
  readOnly: boolean;
  /** False while there is nothing to file a new file under: no linking, unlinking still allowed. */
  addable?: boolean;
  /** Keep the file's id in the module's data, through useDataUpdater. */
  onAdded: (file: AttachedFile) => void;
  /** Drop the id when the module keeps it. Without it, a deleted file stays kept until replaced. */
  onRemoved?: (fileId: string) => void;
  className?: string;
};

/**
 * The slot where a module attaches its files: the screen's file slot, or,
 * where there is none, a note that files are attached on the inspection
 * screen.
 */
export function ModuleFileSlot({
  moduleKey,
  kind,
  title,
  focus = null,
  fileId,
  readOnly,
  addable = true,
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
          ...(fileId === undefined ? {} : { fileId }),
          readOnly,
          addable: !readOnly && addable,
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
