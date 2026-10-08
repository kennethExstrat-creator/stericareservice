"use client";

import { useActionState, useId, useRef, useState, type RefObject } from "react";
import { OctagonXIcon } from "lucide-react";
import { toast } from "sonner";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import { cn } from "@/lib/utils";
import { renameUser, type ActionResult } from "../actions";
import { SCROLLING_DIALOG } from "./role-fields";
import { TitleWithUid } from "./uid-badge";
import { unreachable } from "./unreachable";
import { DIALOG_TITLE, type UserActionsTarget } from "./user-menu";

const IDLE: ActionResult = { status: "idle" };

/**
 * Change Name: one field, the name the app shows for this person everywhere,
 * filled with their name as saved (empty when they have none, never their
 * email) and selected, so typing replaces it and an arrow key edits it. Their
 * UID stays beside the title: it never changes with the name.
 * Submitted by hand (submitAction), like the screen's other dialogs: a
 * refused name stays in the field, next to the reason.
 */
export function RenameDialog({
  user,
  onClose,
  returnFocusTo,
}: {
  user: Pick<UserActionsTarget, "id" | "uid" | "name" | "fullName">;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.fullName ?? "");
  const [nameError, setNameError] = useState<string | undefined>(undefined);

  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await renameUser(previous, formData).catch(unreachable);
    const error = result.status === "error" ? result.fieldErrors?.fullName : undefined;
    setNameError(error);
    if (error) nameRef.current?.focus();
    if (result.status === "success") {
      toast.success(result.message);
      onClose();
    } else if (result.status === "warning") {
      toast.warning(result.message, { duration: 12_000 });
      onClose();
    }
    return result;
  }, IDLE);

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        className={cn("sm:max-w-md", SCROLLING_DIALOG)}
        onOpenAutoFocus={(event) => {
          // Into the name, all of it selected: typing replaces it, an arrow key keeps it to edit.
          event.preventDefault();
          nameRef.current?.focus();
          nameRef.current?.select();
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
        onInteractOutside={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form onSubmit={submitAction(formAction, pending)} noValidate className="grid gap-6" data-testid="rename-form">
          <DialogHeader>
            <TitleWithUid uid={user.uid}>
              <DialogTitle className="text-lg font-bold">{DIALOG_TITLE["change-name"](user.name)}</DialogTitle>
            </TitleWithUid>
            <DialogDescription>The app shows the new name wherever it names them, their inspections included.</DialogDescription>
          </DialogHeader>

          <input type="hidden" name="userId" value={user.id} />

          <Field data-invalid={nameError ? true : undefined}>
            <FieldLabel htmlFor={`${id}-name`}>Name</FieldLabel>
            <Input
              ref={nameRef}
              id={`${id}-name`}
              name="fullName"
              autoComplete="off"
              autoCapitalize="words"
              // The iPad's autocorrect would "fix" a name it does not know.
              autoCorrect="off"
              value={name}
              onChange={(event) => {
                setName(event.target.value);
                if (nameError) setNameError(undefined);
              }}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${id}-name-error` : undefined}
            />
            {nameError && <FieldError id={`${id}-name-error`}>{nameError}</FieldError>}
          </Field>

          {formError && (
            <Alert variant="destructive">
              <OctagonXIcon aria-hidden />
              <AlertDescription className="text-destructive">{formError}</AlertDescription>
            </Alert>
          )}

          <DialogFooter>
            <DialogClose asChild>
              <Button type="button" variant="outline" disabled={pending}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="submit" disabled={pending}>
              {pending && <Spinner aria-hidden />}
              {pending ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
