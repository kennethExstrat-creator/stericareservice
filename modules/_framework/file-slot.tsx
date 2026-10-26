"use client";

// Where a module's Capture shows the lab report or certificate it keeps
// (BUILD_SPEC 8.1). Every file is uploaded once, on Source Documents, and
// Steri-AI links each lab report or certificate it reads there to its step
// (readSourceFile, docs/AI.md "Source Documents"): a module page links
// nothing by hand (Kenneth, 12 October 2026). Modules stay decoupled from
// storage: a Capture renders <ModuleFileSlot> with the id it keeps
// (`fileId`) and calc's state of it; the capture screen wraps the modules in
// <FileSlotProvider> with a renderer (section-body.tsx, source-file-link.tsx)
// that shows the file with Preview and Unlink, or what Steri-AI found.
// Without a provider (the template editor's preview, a test) the slot says
// where files are attached instead, and the module still shows what it keeps.
import { createContext, useContext, type ReactNode } from "react";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { cn } from "@/lib/utils";
import type { FileKind, HeldFileState } from "./files";

/** What a module asks the screen's file slot for: the renderer's input. */
export type FileSlotRequest = {
  /** The module the file is for; files uploaded on its page before keep it as inspection_files.module_key. */
  readonly moduleKey: ModuleKey;
  /** inspection_files.kind of the file kept here: what the slot says while none is. */
  readonly kind: FileKind;
  /** The id the module keeps for this slot (one of tensile's lab reports, a document's file), null for none. */
  readonly fileId: string | null;
  /**
   * Which of the module's files this is, shown before its name as "Size S ·
   * name": the sizes a lab report gives results for (LabReports). Absent, the
   * name alone.
   */
  readonly caption?: string;
  /**
   * calc's state of that file (heldFileState, moduleFileState): attached, kept
   * but not among the inspection's files (its warning sits beside the slot), or none.
   */
  readonly state: HeldFileState;
  /**
   * The module needs one file of its kind (moduleFileState: tensile's and
   * force at break's lab report), so one uploaded on its page before 12
   * October 2026 counts, kept or not: the slot shows it while it shows no
   * kept file, without Unlink, since it counts by its module and not by a link.
   */
  readonly countsModuleFiles: boolean;
  /** What the slot says once Steri-AI has read every Source Document and linked nothing; its own, by kind, when absent. */
  readonly notFoundText?: string;
  /** Nothing can be unlinked here: approved, or not the user's. */
  readonly readOnly: boolean;
  /** The file was unlinked here, which never deletes it: drop its id. */
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

/** The screen's renderer, or null where no file is shown. */
export function useFileSlotRenderer(): FileSlotRenderer | null {
  return useContext(FileSlotContext);
}

export type ModuleFileSlotProps = {
  moduleKey: ModuleKey;
  kind: FileKind;
  /** The id the module keeps for this slot, null for none: the screen shows that file, with Unlink. */
  fileId: string | null;
  /** Shown before the file's name: "Size S" for a lab report of size S. */
  caption?: string;
  /** calc's state of the kept file: `moduleFileState` for a module's one file, `heldFileState` for one kept per entry. */
  state: HeldFileState;
  /** A file of the module and kind counts kept or not (moduleFileState): tensile's and force at break's lab report. */
  countsModuleFiles?: boolean;
  /** What the slot says once Steri-AI has linked nothing, when not the words for its kind ("No documents detected by Steri-AI."). */
  notFoundText?: string;
  readOnly: boolean;
  /** Unlink: drop the id from the module's data, through useDataUpdater. */
  onRemoved: (fileId: string) => void;
  className?: string;
};

/**
 * The slot where a module shows the file it keeps: the screen's file slot,
 * or, where there is none, a note that files are attached on the inspection
 * screen.
 */
export function ModuleFileSlot({
  moduleKey,
  kind,
  fileId,
  caption,
  state,
  countsModuleFiles = false,
  notFoundText,
  readOnly,
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
          fileId,
          ...(caption === undefined ? {} : { caption }),
          state,
          countsModuleFiles,
          ...(notFoundText === undefined ? {} : { notFoundText }),
          readOnly,
          onRemoved,
        })}
      </div>
    );
  }
  return (
    <p
      data-slot="module-file-slot"
      data-module={moduleKey}
      data-unavailable=""
      className={cn("text-sm text-muted-foreground touch:text-base", className)}
    >
      Attach files on the inspection screen.
    </p>
  );
}
