"use client";

// Shared by /admin/manufacturers and /admin/clients (see reference-panel.tsx).

import { useActionState, useId, useState } from "react";
import { InfoIcon, OctagonXIcon, Trash2Icon } from "lucide-react";
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
import {
  IDLE,
  KINDS,
  deleteBlocker,
  unreachable,
  type ActionResult,
  type ReferenceKind,
  type Usage,
} from "@/lib/admin/reference";
import { PanelSection } from "./reference-panel";

type DeleteAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

type DeleteSectionProps = {
  kind: ReferenceKind;
  id: string;
  name: string;
  usage: Usage;
  action: DeleteAction;
  /** What else goes with the row, said in the confirmation (a client's logo). */
  alsoDeletes?: string;
  onDeleted: () => void;
};

/**
 * The end of the edit panel. A row that templates or inspections use cannot
 * be deleted (the database restricts it too), and the panel says why instead
 * of offering a button that can only fail.
 */
export function DeleteSection({ kind, id, name, usage, action, alsoDeletes, onDeleted }: DeleteSectionProps) {
  const titleId = useId();
  const reasonId = useId();
  const [confirming, setConfirming] = useState(false);
  const noun = KINDS[kind].one;
  const blocker = deleteBlocker(usage);

  return (
    <PanelSection title={`Delete ${noun}`} titleId={titleId}>
      <p id={reasonId} className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{blocker ?? "Not used by any template or inspection, so it can be deleted."}</span>
      </p>
      <div>
        <Button
          type="button"
          variant="destructive"
          disabled={Boolean(blocker)}
          aria-describedby={reasonId}
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon aria-hidden />
          Delete {noun}
        </Button>
      </div>
      {confirming && (
        <ConfirmDelete
          kind={kind}
          id={id}
          name={name}
          action={action}
          alsoDeletes={alsoDeletes}
          onCancel={() => setConfirming(false)}
          onDeleted={() => {
            setConfirming(false);
            onDeleted();
          }}
        />
      )}
    </PanelSection>
  );
}

function ConfirmDelete({
  kind,
  id,
  name,
  action,
  alsoDeletes,
  onCancel,
  onDeleted,
}: Omit<DeleteSectionProps, "usage" | "onDeleted"> & { onCancel: () => void; onDeleted: () => void }) {
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await action(previous, formData).catch(unreachable);
    if (result.status === "success") {
      toast.success(result.message);
      onDeleted();
    }
    return result;
  }, IDLE);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onCancel();
      }}
    >
      <AlertDialogContent
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              {alsoDeletes ? `${alsoDeletes} ` : ""}This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={id} />

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
              {pending ? "Deleting…" : `Delete ${KINDS[kind].one}`}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
