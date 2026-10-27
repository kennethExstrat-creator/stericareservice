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
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import { PHONE_HINT } from "@/lib/auth/fields";
import { cn } from "@/lib/utils";
import { editUserDetails, type ActionResult } from "../actions";
import { SCROLLING_DIALOG } from "./role-fields";
import { TitleWithUid } from "./uid-badge";
import { unreachable } from "./unreachable";
import { DIALOG_TITLE, type UserActionsTarget } from "./user-menu";

const IDLE: ActionResult = { status: "idle" };

type DetailsField = "fullName" | "phone";

/**
 * Edit Details: the name the app shows for this person everywhere, and their
 * phone number, each filled as saved: empty when they have none, the name
 * never their email. The name opens selected, so typing replaces it and an
 * arrow key edits it. The phone may stay blank (accounts from before phones
 * have none); a number given is held to Account Creation's rule. Someone
 * invited who has not created their account yet can be given both, and what
 * they enter there replaces them. Their UID stays beside the title: it never
 * changes with the name. Submitted by hand (submitAction), like the screen's
 * other dialogs: a refused value stays in its field, next to the reason.
 */
export function DetailsDialog({
  user,
  onClose,
  returnFocusTo,
}: {
  user: Pick<UserActionsTarget, "id" | "uid" | "name" | "fullName" | "phone" | "status">;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState(user.fullName ?? "");
  const [phone, setPhone] = useState(user.phone ?? "");
  const [errors, setErrors] = useState<Partial<Record<DetailsField, string>>>({});

  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    const result = await editUserDetails(previous, formData).catch(unreachable);
    const fieldErrors = result.status === "error" ? (result.fieldErrors ?? {}) : {};
    setErrors({ fullName: fieldErrors.fullName, phone: fieldErrors.phone });
    // To the first field marked, in the form's order.
    if (fieldErrors.fullName) nameRef.current?.focus();
    else if (fieldErrors.phone) phoneRef.current?.focus();
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
  const clear = (field: DetailsField) => {
    if (errors[field]) setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const phoneNote = `${id}-phone-${errors.phone ? "error" : "hint"}`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <DialogContent
        // As wide as the invite: the phone hint's example number stays on one line.
        className={cn("sm:max-w-lg", SCROLLING_DIALOG)}
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
        <form onSubmit={submitAction(formAction, pending)} noValidate className="grid gap-6" data-testid="details-form">
          <DialogHeader>
            <TitleWithUid uid={user.uid}>
              <DialogTitle className="text-lg font-bold">{DIALOG_TITLE["edit-details"](user.name)}</DialogTitle>
            </TitleWithUid>
            <DialogDescription>
              The app shows the name wherever it names them, their inspections included.
              {user.status === "invited" &&
                " They have not created their account yet: the name and phone number they enter then replace these."}
            </DialogDescription>
          </DialogHeader>

          <input type="hidden" name="userId" value={user.id} />

          <FieldGroup className="gap-5">
            <Field data-invalid={errors.fullName ? true : undefined}>
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
                  clear("fullName");
                }}
                aria-invalid={errors.fullName ? true : undefined}
                aria-describedby={errors.fullName ? `${id}-name-error` : undefined}
              />
              {errors.fullName && <FieldError id={`${id}-name-error`}>{errors.fullName}</FieldError>}
            </Field>

            <Field data-invalid={errors.phone ? true : undefined}>
              <FieldLabel htmlFor={`${id}-phone`}>Phone (Optional)</FieldLabel>
              <PhoneInput
                ref={phoneRef}
                id={`${id}-phone`}
                name="phone"
                // Someone else's number: the browser's own would be the wrong one to offer.
                autoComplete="off"
                autoCorrect="off"
                spellCheck={false}
                value={phone}
                onValueChange={(next) => {
                  setPhone(next);
                  clear("phone");
                }}
                aria-invalid={errors.phone ? true : undefined}
                aria-describedby={phoneNote}
              />
              {errors.phone ? (
                <FieldError id={phoneNote}>{errors.phone}</FieldError>
              ) : (
                <FieldDescription id={phoneNote}>{PHONE_HINT}</FieldDescription>
              )}
            </Field>
          </FieldGroup>

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
