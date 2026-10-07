"use client";

// Confirms deleting a lab report or certificate. One still on this device
// leaves the upload queue; an uploaded one goes through the
// deleteInspectionFile action (row, then the file in Storage).
import { useActionState } from "react";
import { OctagonXIcon } from "lucide-react";
import { toast } from "sonner";
import { deleteSlotFile } from "@/components/capture/photos/edit-flows";
import type { SlotFile } from "@/components/capture/photos/photo-model";
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

export function FileDeleteDialog({
  inspectionId,
  file,
  onDeleted,
  onClose,
}: {
  inspectionId: string;
  file: SlotFile;
  /** The file is gone from the inspection (or from this device): a module keeping its id drops it. */
  onDeleted?: (fileId: string) => void;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(
    async (previous: PhotoActionState, formData: FormData): Promise<PhotoActionState> => {
      const result = await deleteSlotFile(inspectionId, file, previous, formData);
      if (result.status === "success") {
        onDeleted?.(file.id);
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
        onCloseAutoFocus={(event) => event.preventDefault()}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle className="break-words">
              {file.queued ? "Remove" : "Delete"} {file.name}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              {file.queued
                ? "It has not finished uploading. It is taken off this device and never reaches the inspection."
                : "It is removed from the inspection and from storage. This cannot be undone."}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <input type="hidden" name="fileId" value={file.id} />

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
              {pending ? (file.queued ? "Removing…" : "Deleting…") : file.queued ? "Remove File" : "Delete File"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
