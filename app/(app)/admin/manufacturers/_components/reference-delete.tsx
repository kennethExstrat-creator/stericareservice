"use client";

// Shared by /admin/manufacturers and /admin/clients (see reference-panel.tsx).

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
import type { ManufacturerKind } from "@/lib/admin/manufacturers";
import {
  IDLE,
  deleteBlocker,
  unreachable,
  type ActionResult,
  type ReferenceKind,
  type Usage,
} from "@/lib/admin/reference";
import { focusFirst, PanelSection } from "./reference-panel";

type DeleteAction = (previous: ActionResult, formData: FormData) => Promise<ActionResult>;

type DeleteKind = ReferenceKind | ManufacturerKind;

/** The kind in a heading or on a button, in Title Case: "Delete Brand". KINDS and MANUFACTURER_KINDS word it for sentences. */
const KIND_TITLE: Readonly<Record<DeleteKind, string>> = {
  client: "Client",
  brand: "Brand",
  company: "Company",
  factory: "Factory",
};

/**
 * What keeps the row: the templates and inspections that use it (a client,
 * a factory), or a reason of its own with the line shown when there is none
 * (a brand's companies, a company's factories).
 */
type DeleteReason =
  | { usage: Usage; blocker?: never; deletable?: never }
  | { usage?: never; blocker: string | null; deletable: string };

type DeleteSectionProps = {
  kind: DeleteKind;
  id: string;
  name: string;
  action: DeleteAction;
  /** What else goes with the row, said in the confirmation (a client's logo). */
  alsoDeletes?: string;
  onDeleted: () => void;
} & DeleteReason;

function reasonOf(reason: DeleteReason): { blocker: string | null; text: string } {
  if (reason.usage) {
    const blocker = deleteBlocker(reason.usage);
    return { blocker, text: blocker ?? "Not used by any template or inspection, so it can be deleted." };
  }
  return { blocker: reason.blocker, text: reason.blocker ?? reason.deletable };
}

/**
 * The end of the edit panel. A row that something still needs cannot be
 * deleted (the database restricts it too), and the panel says why instead
 * of offering a button that can only fail.
 */
export function DeleteSection({ kind, id, name, action, alsoDeletes, onDeleted, ...reason }: DeleteSectionProps) {
  const titleId = useId();
  const reasonId = useId();
  const deleteButton = useRef<HTMLButtonElement>(null);
  const [confirming, setConfirming] = useState(false);
  const { blocker, text } = reasonOf(reason);

  return (
    <PanelSection title={`Delete ${KIND_TITLE[kind]}`} titleId={titleId}>
      <p id={reasonId} className="flex gap-2 text-sm text-muted-foreground">
        <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
        <span>{text}</span>
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
          Delete {KIND_TITLE[kind]}
        </Button>
      </div>
      {confirming && (
        <ConfirmDelete
          kind={kind}
          id={id}
          name={name}
          action={action}
          alsoDeletes={alsoDeletes}
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
  kind,
  id,
  name,
  action,
  alsoDeletes,
  opener,
  onCancel,
  onDeleted,
}: {
  kind: DeleteKind;
  id: string;
  name: string;
  action: DeleteAction;
  alsoDeletes?: string;
  /** The Delete button, which gets the focus back when this closes without deleting. */
  opener: RefObject<HTMLButtonElement | null>;
  onCancel: () => void;
  onDeleted: () => void;
}) {
  const deleted = useRef(false);
  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await action(previous, formData).catch(unreachable);
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
          // The Delete button, or the panel when the row came into use meanwhile (the button is disabled).
          focusFirst([opener.current, opener.current?.closest<HTMLElement>("[role='dialog']")]);
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
              {pending ? "Deleting…" : `Delete ${KIND_TITLE[kind]}`}
            </Button>
          </AlertDialogFooter>
        </form>
      </AlertDialogContent>
    </AlertDialog>
  );
}
