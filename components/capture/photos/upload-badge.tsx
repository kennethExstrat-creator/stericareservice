"use client";

// The pending-uploads badge (BUILD_SPEC 8.1): how many photos and files of
// an inspection are not uploaded yet, as the brand count pill SaveStatus
// uses. Hidden at zero. While the queue is still reading what this device
// kept, the count is unknown, never a reassuring 0.
import { LoaderCircleIcon, TriangleAlertIcon, UploadIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePhotoUploadStatus } from "./hooks";
import { describeItems } from "./photo-model";

export function PhotoUploadBadge({ inspectionId, className }: { inspectionId: string; className?: string }) {
  const status = usePhotoUploadStatus(inspectionId);
  const pill = "relative inline-flex h-7 items-center gap-1 rounded-full px-2.5 text-sm font-semibold tabular-nums [&>svg]:size-4";

  if (!status.ready && status.pending === 0) {
    if (!status.blocking) return null;
    return (
      <span data-slot="upload-badge" data-state="checking" className={cn(pill, "border border-border bg-card text-muted-foreground", className)}>
        <LoaderCircleIcon aria-hidden className="animate-spin" />
        <span className="sr-only">Checking for photos waiting on this device</span>
      </span>
    );
  }
  if (status.pending === 0) return null;

  const failed = status.failed > 0;
  // Read as one phrase: "2 photos waiting to upload"; the digits alone are for the eye.
  const label = failed
    ? (status.message ?? `${describeItems(status.photos, status.files)} could not upload`)
    : `${describeItems(status.photos + status.preparing, status.files)} waiting to upload`;
  return (
    <span
      data-slot="upload-badge"
      data-state={failed ? "failed" : "pending"}
      data-count={status.pending}
      title={status.message ?? undefined}
      className={cn(
        pill,
        failed ? "border border-fail-border bg-fail-tint text-fail" : "bg-primary text-primary-foreground",
        className,
      )}
    >
      {failed ? <TriangleAlertIcon aria-hidden /> : <UploadIcon aria-hidden />}
      <span aria-hidden>{status.pending}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}
