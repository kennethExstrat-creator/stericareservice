// Whether a file a module needs is attached: a lab report (force_at_break,
// tensile), a certificate (documents). The capture screen uploads the file
// (BUILD_SPEC 8.1, inspection_files); this line only shows the state. A
// required file that is missing reads as Not done, with why.
import { FileCheckIcon, FileTextIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { issuePathProps, type IssuePath } from "./issue-path";
import { StatusPill } from "./status-pill";

type AttachmentStatusProps = {
  /** The file in the template's wording, e.g. "Lab report". */
  label: string;
  attached: boolean;
  /** Until it is attached the section is not done: says so beside a Not done pill. */
  required?: boolean;
  /** The attached file's name, when the screen knows it. */
  fileName?: string | null;
  /** Marks the line for issue links (useIssueFocus), e.g. ["labReport"]. */
  issuePath?: IssuePath;
  className?: string;
};

export function AttachmentStatus({
  label,
  attached,
  required = false,
  fileName,
  issuePath,
  className,
}: AttachmentStatusProps) {
  const Icon = attached ? FileCheckIcon : FileTextIcon;
  return (
    <div
      data-slot="attachment-status"
      data-attached={attached || undefined}
      {...issuePathProps(issuePath)}
      className={cn(
        "relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm touch:py-2.5 touch:text-base",
        className,
      )}
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      {attached ? (
        <span className="min-w-0 text-foreground [overflow-wrap:anywhere]">{fileName ?? "Attached"}</span>
      ) : required ? (
        <>
          <StatusPill size="sm" status="not_done" label="Not attached" />
          <span className="text-muted-foreground">Required before this section is done.</span>
        </>
      ) : (
        <span className="text-muted-foreground">Not attached</span>
      )}
    </div>
  );
}
