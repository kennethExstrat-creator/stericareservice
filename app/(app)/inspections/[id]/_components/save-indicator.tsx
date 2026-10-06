// The autosave pill (BUILD_SPEC 8: Saved, Saving, Offline (will sync)) with
// the upload badge. SaveStatus draws those three states; when saving needs
// the inspector (a conflict, a refused save, another tab, no local copy)
// the pill turns red and says so in two words, and the notice under the
// header carries the full message and what to do (capture-notices.tsx).
import { CloudAlertIcon, UploadIcon } from "lucide-react";
import { SaveStatus } from "@/components/qc";
import type { AutosaveStatus } from "@/lib/offline";
import { cn } from "@/lib/utils";

export type SaveIndicatorProps = {
  status: AutosaveStatus;
  /** Photos and files of this inspection still waiting to upload; null while unknown. */
  pendingUploads: number | null;
  className?: string;
};

export function SaveIndicator({ status, pendingUploads, className }: SaveIndicatorProps) {
  if (status !== "error") {
    return <SaveStatus state={status} pendingUploads={pendingUploads ?? 0} className={className} />;
  }
  return (
    <div
      role="status"
      data-slot="save-status"
      data-state="error"
      className={cn("relative inline-flex items-center gap-2", className)}
    >
      <span className="inline-flex h-7 items-center gap-1.5 rounded-full border border-fail-border bg-fail-tint px-3 text-sm font-medium whitespace-nowrap text-fail [&>svg]:size-4">
        <CloudAlertIcon aria-hidden />
        Not saved
      </span>
      {pendingUploads !== null && pendingUploads > 0 && (
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
