// What the edit and delete dialogs do once submitted, apart from the dialogs,
// so each path is unit-tested without a browser: a photo still on this
// device changes in the upload queue (offline too); an uploaded one goes
// through the Server Actions, and the page's own copy follows the answer. A
// call that never got an answer comes back as a message, never a throw.
import { deleteInspectionFile, deletePhoto, updatePhotoTags } from "@/lib/inspections/photos/actions";
import { PHOTO_MESSAGES, type PhotoActionState } from "@/lib/inspections/photos/messages";
import { parsePhotoTagForm } from "@/lib/inspections/photos/schemas";
import { mediaStore } from "./media-store";
import type { SlotFile, SlotPhoto } from "./photo-model";
import { photoQueueStore } from "./queue-store";
import { unreachable } from "./unreachable";

export const REMOVED_PHOTO = "Photo removed from this device.";
export const REMOVED_FILE = "File removed from this device.";

type Item = Pick<SlotPhoto | SlotFile, "id" | "queued">;

/**
 * The edit dialog's save: checked on the device first (a queued photo has
 * no server to ask), then retagged in the queue, or through updatePhotoTags
 * once the photo has left the queue.
 */
export async function savePhotoEdit(
  inspectionId: string,
  photo: Item,
  previous: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  const parsed = parsePhotoTagForm(formData);
  if (!parsed.ok) return { status: "error", message: PHOTO_MESSAGES.checkFields, fieldErrors: parsed.fieldErrors };
  if (photo.queued) {
    const { moduleKey, target, caption } = parsed.data;
    // False once it has left the queue: its row is in, so the server takes the change.
    if (await photoQueueStore.retag(photo.id, { tag: { moduleKey, target }, caption })) {
      return { status: "success", message: PHOTO_MESSAGES.updated };
    }
  }
  const result = await updatePhotoTags(previous, formData).catch(unreachable);
  if (result.status === "success" && result.photo) mediaStore(inspectionId).applyPhoto(result.photo);
  return result;
}

/** The delete dialog for a photo: off this device while queued, else the row and its files through deletePhoto. */
export async function deleteSlotPhoto(
  inspectionId: string,
  photo: Item,
  previous: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  if (photo.queued && (await photoQueueStore.remove(photo.id))) {
    return { status: "success", message: REMOVED_PHOTO, removedId: photo.id };
  }
  // Uploaded, or it finished while the dialog was open: delete the row and its files.
  const result = await deletePhoto(previous, formData).catch(unreachable);
  if (result.status === "success") {
    mediaStore(inspectionId).removePhoto(photo.id);
    photoQueueStore.forgetPreview(photo.id);
  }
  return result;
}

/** The delete dialog for a lab report or certificate. */
export async function deleteSlotFile(
  inspectionId: string,
  file: Item,
  previous: PhotoActionState,
  formData: FormData,
): Promise<PhotoActionState> {
  if (file.queued && (await photoQueueStore.remove(file.id))) {
    return { status: "success", message: REMOVED_FILE, removedId: file.id };
  }
  const result = await deleteInspectionFile(previous, formData).catch(unreachable);
  if (result.status === "success") mediaStore(inspectionId).removeFile(file.id);
  return result;
}
