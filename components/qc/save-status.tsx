// Autosave state for the capture screen (BUILD_SPEC 8): Saved, Saving, or
// Offline (will sync), with the photo upload queue as a count badge.
import { CloudCheckIcon, CloudOffIcon, LoaderCircleIcon, UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";

export type SaveState = "saved" | "saving" | "offline";

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
    label: "Offline (will sync)",
    Icon: CloudOffIcon,
    className: "border-warn-border bg-warn-tint text-warn",
  },
} as const;

export function SaveStatus({
  state,
  pendingUploads = 0,
  className,
}: {
  state: SaveState;
  /** Photos still in the upload queue. Hidden at zero. */
  pendingUploads?: number;
  className?: string;
}) {
  const { label, Icon, className: stateClass } = STATE[state];
  return (
    <div
      role="status"
      data-slot="save-status"
      data-state={state}
      className={cn("inline-flex items-center gap-2", className)}
    >
      <span
        className={cn(
          "inline-flex h-7 items-center gap-1.5 rounded-full border px-3 text-sm font-medium whitespace-nowrap [&>svg]:size-4",
          stateClass,
        )}
      >
        <Icon aria-hidden />
        {label}
      </span>
      {pendingUploads > 0 && (
        <span className="inline-flex h-7 items-center gap-1 rounded-full bg-primary px-2.5 text-sm font-semibold text-primary-foreground tabular-nums">
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
