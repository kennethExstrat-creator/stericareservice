"use client";

// The admin's choice of report photos (BUILD_SPEC 8.1, "Admin can mark
// photos include in report"): flips at once, saves through setPhotoInReport,
// and falls back with a message when the save is refused.
import { startTransition, useActionState, useId, useOptimistic } from "react";
import { toast } from "sonner";
import { Switch } from "@/components/ui/switch";
import { setPhotoInReport } from "@/lib/inspections/photos/actions";
import { IDLE_PHOTO_ACTION, type PhotoActionState } from "@/lib/inspections/photos/messages";
import { mediaStore } from "./media-store";
import { unreachable } from "./unreachable";

export function useReportChoice(inspectionId: string, photoId: string, includeInReport: boolean) {
  const [included, setIncluded] = useOptimistic(includeInReport);
  const [, dispatch, pending] = useActionState(
    async (previous: PhotoActionState, include: boolean): Promise<PhotoActionState> => {
      const form = new FormData();
      form.set("photoId", photoId);
      form.set("include", String(include));
      const result = await setPhotoInReport(previous, form).catch(unreachable);
      if (result.status === "success" && result.photo) mediaStore(inspectionId).applyPhoto(result.photo);
      if (result.status === "error") toast.error("The report choice was not saved", { description: result.message });
      return result;
    },
    IDLE_PHOTO_ACTION,
  );

  const change = (include: boolean) => {
    startTransition(() => {
      setIncluded(include);
      dispatch(include);
    });
  };
  return { included, change, pending };
}

/** The switch on its own, for the photo viewer. */
export function ReportSwitch({ inspectionId, photoId, includeInReport }: { inspectionId: string; photoId: string; includeInReport: boolean }) {
  const id = useId();
  const { included, change } = useReportChoice(inspectionId, photoId, includeInReport);
  return (
    <span className="relative inline-flex items-center gap-3 text-sm font-medium text-foreground">
      <label htmlFor={id}>Include in Report</label>
      <Switch id={id} checked={included} onCheckedChange={change} />
    </span>
  );
}
