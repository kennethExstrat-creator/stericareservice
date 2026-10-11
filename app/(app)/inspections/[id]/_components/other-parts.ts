// Before Submit sends every PO part of the inspection (submit-control.tsx):
// what this device still holds of the parts that are not on screen. The
// screen saves its own part and waits for its own uploads (prepare); the
// other parts go as the server has them, so their photos and files must
// have uploaded too (BUILD_SPEC 8.1), and their local copies must hold
// nothing the server does not have yet. A part edited offline whose changes
// never reached the server would go without them, and once it is submitted
// they could no longer be saved.
import { photoUploadsSettled } from "@/components/capture/photos";
import { joinWords, type SubmitPartProblem } from "@/lib/inspections/part-moves";
import { partLabel, type InspectionPart } from "@/lib/inspections/parts";
import { getOfflineDatabase } from "@/lib/offline/db";
import { draftKey, hasUnsavedChanges, LocalDraftSchema } from "@/lib/offline/drafts";

/** Why submit waits for the other parts, with those to open (none while it only has to wait for uploads). */
export type HeldUp = { message: string; parts: SubmitPartProblem[] };

/**
 * The parts other than `currentId` that this device holds up, or null when
 * none does. Parts submitted or approved already are not sent again and are
 * left out. Without `userId` (no photo queue user on the page) local copies
 * are not looked at.
 */
export async function otherPartsHeldUp(
  parts: readonly InspectionPart[],
  currentId: string,
  userId: string | null,
): Promise<HeldUp | null> {
  const open = parts.flatMap((part, index) =>
    part.id !== currentId && (part.status === "draft" || part.status === "reopened") ? [{ part, label: partLabel(part, index) }] : [],
  );

  const uploading: string[] = [];
  for (const { part, label } of open) if (!(await photoUploadsSettled(part.id))) uploading.push(label);
  if (uploading.length > 0) {
    return {
      message: `Photos or files of ${joinWords(uploading)} are still uploading on this device. Submit once they are done.`,
      parts: [],
    };
  }

  if (userId === null) return null;
  const unsaved: SubmitPartProblem[] = [];
  try {
    const store = (await getOfflineDatabase()).store("drafts");
    for (const { part, label } of open) {
      const copy = LocalDraftSchema.safeParse(await store.get(draftKey({ userId, inspectionId: part.id })));
      if (copy.success && hasUnsavedChanges(copy.data)) {
        unsaved.push({ id: part.id, label, message: `${label} has changes on this device that are not saved yet.` });
      }
    }
  } catch (error) {
    // The local copies cannot be read here: the part's own screen deals with them when it opens.
    console.warn("[capture] the other POs' local copies could not be read", error);
    return null;
  }
  if (unsaved.length === 0) return null;
  const several = unsaved.length > 1;
  return {
    message: `${joinWords(unsaved.map((part) => part.label))} ${several ? "have" : "has"} changes on this device that are not saved yet. Open ${several ? "them" : "it"} so they are saved, then submit.`,
    parts: unsaved,
  };
}
