// Autosave state for the capture screen (BUILD_SPEC 8): Saved, Saving,
// Offline (Will Sync), or Not Saved when saving needs the inspector (a
// conflict, a refused save), with the photo upload queue as a count badge.
// Both read 16 px on iPad, as StatusPill does. A pill's words are Title
// Case, as every label's.
import { CloudAlertIcon, CloudCheckIcon, CloudOffIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState = "saved" | "saving" | "offline" | "error";

const STATE = {
  saved: {
    label: "Saved",
    Icon: CloudCheckIcon,
    className: "border-border bg-card text-muted-foreground",
  },
  saving: {
    label: "Saving…",
    Icon: LoaderCircleIcon,
    className: "border-brand-200 bg-brand-50 text-brand-700 [&>svg]:animate-spin",
  },
  offline: {
    label: "Offline (Will Sync)",
    Icon: CloudOffIcon,
    className: "border-warn-border bg-warn-tint text-warn",
  },
  // Two words in the pill: the screen says what happened and what to do beside it.
  error: {
    label: "Not Saved",
    Icon: CloudAlertIcon,
    className: "border-fail-border bg-fail-tint text-fail",
  },
} as const;

export function SaveStatus({
  state,
  pendingUploads = 0,
  label: words,
  className,
}: {
  state: SaveState;
  /** Photos still in the upload queue. Hidden at zero. */
  pendingUploads?: number;
  /**
   * Words in place of the state's own, in its colours and with its icon, for
   * a save that does more: "Sorting…" while a photo's defect marks are saved
   * and Steri-AI sorts it again, "Moved to Product Defects" once saved.
   */
  label?: string;
  className?: string;
}) {
  const { label: stateLabel, Icon, className: stateClass } = STATE[state];
  const label = words ?? stateLabel;
  return (
    <div
      role="status"
      data-slot="save-status"
      data-state={state}
      className={cn("relative inline-flex items-center gap-2", className)}
    >
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap [&>svg]:size-4 touch:h-8 touch:text-base",
          stateClass,
        )}
      >
        <Icon aria-hidden />
        {label}
      </span>
      {pendingUploads > 0 && (
        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-sm font-semibold text-primary-foreground tabular-nums touch:h-8 touch:text-base">
          <UploadIcon aria-hidden className="size-4" />
          {pendingUploads}
          <span className="sr-only">
            {pendingUploads === 1 ? "photo waiting to upload" : "photos waiting to upload"}
          </span>
        </span>
      )}
    </div>
  );
}
