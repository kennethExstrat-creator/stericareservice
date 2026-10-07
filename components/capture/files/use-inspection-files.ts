"use client";

// The inspection's files as the modules decide with them (InspectionMeta.files,
// docs/MODULES.md 10.1): the uploaded rows from the page's media store and the
// files still queued on this device, null until both are known. A lab report
// deleted in a file slot or in the gallery drops out at once, and one added in
// the gallery counts for its module. The list keeps its identity while it says
// the same, so upload progress never makes the screen evaluate again.
import { useMemo } from "react";
import { useInspectionMedia, usePhotoQueue, useStartPhotoQueue } from "@/components/capture/photos/hooks";
import { inspectionFileRefs, type FileRef } from "@/components/capture/photos/photo-model";

export function useInspectionFiles(inspectionId: string): readonly FileRef[] | null {
  useStartPhotoQueue();
  const media = useInspectionMedia(inspectionId);
  const queue = usePhotoQueue();
  const loaded = media.status === "ready" && media.media !== null ? media.media.files : null;
  const said = JSON.stringify(inspectionFileRefs({ files: loaded, queue, inspectionId }));
  return useMemo(() => JSON.parse(said) as FileRef[] | null, [said]);
}
