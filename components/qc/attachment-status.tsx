// Whether a file a module keeps is attached: a lab report (force_at_break,
// tensile), a certificate (documents). One line: the file in the template's
// wording, then, on the capture screen, the screen's file slot in place of
// the line's own words (the framework's ModuleFileSlot, BUILD_SPEC 8.1): the
// file Steri-AI linked from Source Documents with Preview and Unlink, or what
// Steri-AI found (Kenneth, 12 October 2026). Given no slot (a documents row in
// the template editor's preview, a test) the line says calc's state itself.
// It carries no frame of its own and sits in the module's section. A kept
// file that is not among the inspection's files (deleted, or still uploading
// from another device) is missing, never Attached, with calc's warning under
// the line. A required file that is not attached reads as Not done, with
// why, where the line has its own words. With no control of its own, the
// line takes an issue link's focus itself, as a notice does.
import type { ReactNode } from "react";
import { FileCheckIcon, FileTextIcon, FileXIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { issueNoticeProps, type IssuePath } from "./issue-path";
import { StatusIcon } from "./status-icon";
import { StatusPill } from "./status-pill";

/**
 * The framework's HeldFileState (modules/_framework/files.ts), which modules
 * pass as it is: none kept, attached, or kept but not among the inspection's
 * files.
 */
export type AttachmentState = "none" | "attached" | "missing";

type AttachmentStatusProps = {
  /** The file in the template's wording, e.g. "Lab Report". */
  label: string;
  /** Until it is attached the section is not done: the line's own words say so beside a Not Done pill. */
  required?: boolean;
  /** The attached file's name, when the screen knows it. */
  fileName?: string | null;
  /** calc's warnings about the file (lab_report_missing), in amber; they replace the line's own words. */
  warning?: string | readonly string[] | null;
  /** Marks the line for issue links (useIssueFocus), e.g. ["labReport"]. */
  issuePath?: IssuePath;
  /**
   * The screen's file slot (ModuleFileSlot): the file linked, or what
   * Steri-AI found. It takes the place of the line's own words, the pill
   * and the file's name included; calc's warnings stay under it.
   */
  children?: ReactNode;
  className?: string;
} & (
  | {
      /**
       * The kept file's state as calc reads it: `moduleFileState(context, …)`
       * for a module's one file (a lab report), `heldFileState(context, id)`
       * for a file kept per entry. Never `id !== null`: a file deleted since
       * would read Attached.
       */
      state: AttachmentState;
      attached?: never;
    }
  | {
      /** @deprecated Pass `state`: true or false cannot tell a missing file from an attached one. */
      attached: boolean;
      state?: never;
    }
);

/** The state's words, in the pill and without it: Title Case, as a status is. */
const NOT_ATTACHED = "Not Attached";

// The framework's missingFileMessage, less the name the line already shows.
const MISSING =
  "The file attached here is not among this inspection's files. It may still be uploading from another device; if it was deleted, attach it again.";

export function AttachmentStatus({
  label,
  state,
  attached,
  required = false,
  fileName,
  warning,
  issuePath,
  children,
  className,
}: AttachmentStatusProps) {
  const shown: AttachmentState = state ?? (attached ? "attached" : "none");
  const warnings = (typeof warning === "string" ? [warning] : (warning ?? [])).filter((text) => text !== "");
  // A missing file is never silent, even before calc's message arrives.
  const notes = warnings.length > 0 ? warnings : shown === "missing" ? [MISSING] : [];
  const Icon = shown === "attached" ? FileCheckIcon : shown === "missing" ? FileXIcon : FileTextIcon;
  return (
    <div
      data-slot="attachment-status"
      data-state={shown}
      data-attached={shown === "attached" || undefined}
      {...issueNoticeProps(issuePath)}
      className={cn(
        "relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md text-sm outline-none focus-ring touch:text-base",
        // The slot's buttons set the line's height, so it keeps it whether a file is linked or not.
        children !== undefined && "min-h-8 touch:min-h-11",
        className,
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      {children !== undefined ? (
        // Beside the label where there is room, else on a line of its own under it (a documents row's column).
        <div data-slot="attachment-file" className="flex min-w-[min(14rem,100%)] flex-1 items-center">
          {children}
        </div>
      ) : shown === "attached" ? (
        <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{fileName ?? "Attached"}</span>
      ) : required ? (
        <>
          <StatusPill size="sm" status="not_done" label={NOT_ATTACHED} />
          {notes.length === 0 && <span className="text-muted-foreground">Required before this section is done.</span>}
        </>
      ) : (
        <span className="text-muted-foreground">{NOT_ATTACHED}</span>
      )}
      {notes.map((note) => (
        <p key={note} className="flex basis-full items-start gap-1.5 text-warn">
          <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>{note}</span>
        </p>
      ))}
    </div>
  );
}
