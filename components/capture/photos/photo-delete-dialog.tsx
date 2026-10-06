"use client";

// Confirms deleting a photo. One still on this device leaves the upload
// queue (with anything it already uploaded); an uploaded one goes through
// the deletePhoto action, which removes the row and its files in Storage.
import { useActionState } from "react";
import { OctagonXIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { IDLE_PHOTO_ACTION, type PhotoActionState } from "@/lib/inspections/photos/messages";
import { deleteSlotPhoto } from "./edit-flows";
import type { SlotPhoto } from "./photo-model";

type PhotoDeleteDialogProps = {
  inspectionId: string;
  photo: SlotPhoto;
  alt: string;
  onClose: () => void;
};

export function PhotoDeleteDialog({ inspectionId, photo, alt, onClose }: PhotoDeleteDialogProps) {
  const [state, formAction, pending] = useActionState(
    async (previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> => {
      const result = await deleteSlotPhoto(inspectionId, photo, previous, formData);
      if (result.status === "success") {
        toast.success(result.message);
        onClose();
      }
      return result;
    },
    IDLE_PHOTO_ACTION,
  );

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        // The slot puts focus back itself: the deleted photo's button is gone.
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>
              {photo.queued ? "Remove this photo?" : "Delete this photo?"}
              <span className="sr-only"> {alt}</span>
            </AlertDialogTitle>
            <AlertDialogDescription>
              {photo.queued
                ? "It has not finished uploading. It is taken off this device and never reaches the inspection."
                : "It is removed from the inspection and from storage. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <input type="hidden" name="photoId" value={photo.id} />

          {/* role="alert": read out as soon as it appears. */}
          {state.status === "error" && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertDescription className="text-destructive">{state.message}</AlertDescription>
            </Alert>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel type="button" disabled={pending}>
              Cancel
            </AlertDialogCancel>
            <Button type="submit" variant="destructive" disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? (photo.queued ? "Removing…" : "Deleting…") : photo.queued ? "Remove photo" : "Delete photo"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
