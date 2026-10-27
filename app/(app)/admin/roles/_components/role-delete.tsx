"use client";

import { useActionState, useId, useRef, useState, type RefObject } from "react";
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
import { IDLE, unreachable } from "@/lib/admin/reference";
import { deleteBlocker, type RoleItem, type RoleResult } from "@/lib/admin/roles";
import { focusFirst, PanelSection } from "../../manufacturers/_components/reference-panel";
import { deleteRole } from "../actions";

/**
 * The end of a custom role's panel (the built-in roles are never deleted). A
 * role people have cannot be deleted (profiles.role_id restricts it too), and
 * the panel says how many have it instead of offering a button that can only
 * fail, as the manufacturers and clients panels do.
 */
export function RoleDeleteSection({ role, onDeleted }: { role: RoleItem; onDeleted: () => void }) {
  const titleId = useId();
  const reasonId = useId();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const blocker = deleteBlocker(role);

  return (
    <PanelSection title="Delete Role" titleId={titleId}>
      <p id={reasonId} className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{blocker ?? "Nobody has this role, so it can be deleted."}</span>
      </p>
      <div>
        <Button
          ref={deleteButton}
          type="button"
          variant="destructive"
          disabled={Boolean(blocker)}
          aria-describedby={reasonId}
          onClick={() => setConfirming(true)}
        >
          <Trash2Icon aria-hidden />
          Delete Role
        </Button>
      </div>
      {confirming && (
        <ConfirmDelete
          role={role}
          opener={deleteButton}
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
  role,
  opener,
  onCancel,
  onDeleted,
}: {
  role: RoleItem;
  /** The Delete button, which gets the focus back when this closes without deleting. */
  opener: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const deleted = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: RoleResult, formData: FormData) => {
    const result: RoleResult = await deleteRole(previous, formData).catch(unreachable);
    if (result.status === "success") {
      deleted.current = true;
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
        onCloseAutoFocus={(event) => {
          // Opened from code, so Radix has no Trigger to go back to.
          event.preventDefault();
          // Deleted: the panel is closing too, and puts the focus back itself.
          if (deleted.current) return;
          // The Delete button, or the panel when someone was given the role meanwhile (the button is disabled).
          focusFirst([opener.current, opener.current?.closest<HTMLElement>("[role='dialog']")]);
        }}
      >
        <form action={formAction} className="grid gap-6">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {role.name}?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <input type="hidden" name="id" value={role.id} />

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
              {pending ? "Deleting…" : "Delete Role"}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
