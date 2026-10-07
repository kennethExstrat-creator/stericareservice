// Whether a file a module keeps is attached: a lab report (force_at_break,
// tensile), a certificate (documents). The screen's file slot beside it (the
// framework's ModuleFileSlot, BUILD_SPEC 8.1) attaches the file; this line
// only shows calc's state, so it carries no frame of its own and sits in the
// module's section with the slot. A kept file that is not among the
// inspection's files (deleted, or still uploading from another device) is
// missing, never Attached. A required file that is not attached reads as Not
// done, with why. With no control of its own, the line takes an issue link's
// focus itself, as a notice does.
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
  /** The file in the template's wording, e.g. "Lab report". */
  label: string;
  /** Until it is attached the section is not done: says so beside a Not done pill. */
  required?: boolean;
  /** The attached file's name, when the screen knows it. */
  fileName?: string | null;
  /** calc's warnings about the file (lab_report_missing), in amber; they replace the line's own words. */
  warning?: string | readonly string[] | null;
  /** Marks the line for issue links (useIssueFocus), e.g. ["labReport"]. */
  issuePath?: IssuePath;
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
        className,
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      {shown === "attached" ? (
        <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{fileName ?? "Attached"}</span>
      ) : required ? (
        <>
          <StatusPill size="sm" status="not_done" label="Not attached" />
          {notes.length === 0 && <span className="text-muted-foreground">Required before this section is done.</span>}
        </>
      ) : (
        <span className="text-muted-foreground">Not attached</span>
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
