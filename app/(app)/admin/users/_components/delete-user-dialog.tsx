"use client";

// Delete Permanently (user-menu.ts), for an account that is deactivated, or
// pending and never let in (Kenneth, 27 October 2026: "admin should be able
// to permanently delete deactivated users"). QC records keep the names on
// them: the database will not delete a profile that an inspection, a photo
// or file, a Steri-AI decision, a history entry, a template's coverage or a
// team member still points at. So the dialog asks the server first, as it
// opens (checkUserDeletion), and shows what it found before anything can be
// deleted: what deleting removes, with a box for their UID (their email on a
// project without UIDs) that Delete Permanently waits for; or why they stay,
// with Close alone. The action checks it all again when it runs, and a
// refusal then turns the dialog to why.
import { startTransition, useActionState, useEffect, useId, useState, type FormEvent, type RefObject } from "react";
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
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import { checkUserDeletion, deleteUserPermanently, type DeleteUserResult, type DeletionCheck } from "../actions";
import { confirmsDeletion, deletionWord } from "../_lib/delete-user";
import { TitleWithUid } from "./uid-badge";
import { unreachable } from "./unreachable";
import { DIALOG_TITLE, type UserActionsTarget } from "./user-menu";

type Person = Pick<UserActionsTarget, "id" | "uid" | "name" | "email">;

const IDLE: DeleteUserResult = { status: "idle" };

export function DeleteUserDialog({
  user,
  onClose,
  returnFocusTo,
}: {
  user: Person;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
}) {
  const [check, setCheck] = useState<DeletionCheck | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    // Strict Mode checks twice in development: only the answer for the dialog still open counts.
    let current = true;
    startTransition(async () => {
      const answer = await checkUserDeletion(user.id).catch(unreachable);
      if (current) setCheck(answer);
    });
    return () => {
      current = false;
    };
  }, [user.id]);

  const [state, formAction, pending] = useActionState(async (previous: DeleteUserResult, formData: FormData) => {
    const result = await deleteUserPermanently(previous, formData).catch(unreachable);
    if (result.status === "refused") {
      // They stay after all (a QC record made since the check): why, with Close alone.
      setCheck(result);
    } else if (result.status === "success") {
      toast.success(result.message);
      onClose();
    } else if (result.status === "warning") {
      toast.warning(result.message, { duration: 12_000 });
      onClose();
    }
    return result;
  }, IDLE);

  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          returnFocusTo.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <DeleteUserForm
          user={user}
          check={check}
          typed={typed}
          onTyped={setTyped}
          error={state.status === "error" ? state.message : null}
          pending={pending}
          onSubmit={submitAction(formAction, pending)}
        />
      </AlertDialogContent>
    </AlertDialog>
  );
}

/**
 * The dialog's content for the check's answer: checking, with Keep alone;
 * what deleting removes, the box for their UID, and Delete Permanently,
 * which works once the UID is typed; or why they stay (or why the check
 * could not be made), with Close alone. Submitted by hand (submitAction),
 * so a failed deletion leaves the typed UID in its box. DeleteUserDialog
 * holds the state.
 */
export function DeleteUserForm({
  user,
  check,
  typed,
  onTyped,
  error,
  pending,
  onSubmit,
}: {
  user: Person;
  /** The check's answer; null while the server checks. */
  check: DeletionCheck | null;
  /** What the admin typed in the box. */
  typed: string;
  onTyped: (typed: string) => void;
  /** Why the last Delete Permanently failed, when it did. */
  error: string | null;
  pending: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const id = useId();
  const word = deletionWord(user);
  const deletable = check?.status === "deletable";
  const confirmed = deletable && confirmsDeletion(typed, word);

  return (
    <form
      onSubmit={(event) => {
        // Enter in the box does nothing until the UID is typed.
        if (confirmed) onSubmit(event);
        else event.preventDefault();
      }}
      noValidate
      className="grid gap-6"
      data-testid="delete-user-form"
    >
      <AlertDialogHeader>
        <TitleWithUid uid={user.uid}>
          <AlertDialogTitle>{DIALOG_TITLE.delete(user.name)}</AlertDialogTitle>
        </TitleWithUid>
        {/* Read out again when the check's answer replaces "Checking". */}
        <AlertDialogDescription aria-live="polite">
          {check === null ? (
            <span className="inline-flex items-center gap-2">
              <Spinner aria-hidden />
              Checking whether QC records still name them…
            </span>
          ) : check.status === "deletable" ? (
            `This removes ${user.uid ?? user.name} for good: their login and profile. This cannot be undone.`
          ) : check.status === "refused" ? (
            check.message
          ) : (
            "Nothing was deleted."
          )}
        </AlertDialogDescription>
      </AlertDialogHeader>

      <input type="hidden" name="userId" value={user.id} />

      {deletable && (
        <Field>
          <FieldLabel htmlFor={`${id}-confirm`}>{`Type ${word} to Confirm`}</FieldLabel>
          <Input
            id={`${id}-confirm`}
            name="confirm"
            value={typed}
            onChange={(event) => onTyped(event.target.value)}
            readOnly={pending}
            // A UID or an address, never words: nothing to fill in, capitalise or correct.
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
          />
        </Field>
      )}

      {/* role="alert": read out as soon as it appears. */}
      {check?.status === "error" && <ErrorAlert message={check.message} />}
      {error && <ErrorAlert message={error} />}

      <AlertDialogFooter>
        {/* First, and the same button in every state: the dialog opens with focus on it, and keeps it. */}
        <AlertDialogCancel type="button" disabled={pending}>
          {check === null || deletable ? "Keep" : "Close"}
        </AlertDialogCancel>
        {deletable && (
          <Button type="submit" variant="destructive" disabled={!confirmed || pending}>
            {pending && <Spinner aria-hidden />}
            {pending ? "Deleting…" : "Delete Permanently"}
          </Button>
        )}
      </AlertDialogFooter>
    </form>
  );
}

function ErrorAlert({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <OctagonXIcon aria-hidden />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}
