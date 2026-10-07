"use client";

// The autosave pill (BUILD_SPEC 8: Saved, Saving, Offline (will sync)) with
// the upload badge (8.1: photos and files still waiting on this device).
// When saving needs the inspector (a conflict, a refused save, no local
// copy) the kit's pill says Not saved in red, and the notice under the
// header carries the full message and what to do (capture-notices.tsx). The
// badge is the photo build's own: the count, a red one when an upload
// stopped, and unknown, never 0, while the queue is still reading this
// device.
import { PhotoUploadBadge } from "@/components/capture/photos";
import { SaveStatus } from "@/components/qc";
import type { AutosaveStatus } from "@/lib/offline";
import { cn } from "@/lib/utils";

export type SaveIndicatorProps = {
  status: AutosaveStatus;
  inspectionId: string;
  className?: string;
};

export function SaveIndicator({ status, inspectionId, className }: SaveIndicatorProps) {
  return (
    <div data-slot="save-indicator" className={cn("inline-flex items-center gap-2", className)}>
      <SaveStatus state={status} />
      <PhotoUploadBadge inspectionId={inspectionId} />
    </div>
  );
}
