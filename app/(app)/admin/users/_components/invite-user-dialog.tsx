"use client";

import { useActionState, useId, useRef, useState } from "react";
import { OctagonXIcon, UserPlusIcon } from "lucide-react";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import { needsLead, type RoleChoice } from "@/lib/auth/org";
import type { LeadOption, UserField } from "@/lib/auth/users";
import { inviteUser, type ActionResult } from "../actions";
import { cn } from "@/lib/utils";
import { focusRole, LeadField, RoleField, roleChoicesFor, SCROLLING_DIALOG } from "./role-fields";
import { unreachable } from "./unreachable";

type FieldErrors = Partial<Record<UserField, string>>;

/**
 * "Invite user": the button and its dialog. Disabled, with the reason shown on
 * the page, when the server has no secret key to send invites with.
 */
export function InviteUserDialog({
  disabled = false,
  label = "Invite user",
  teams = true,
  leads = [],
}: {
  disabled?: boolean;
  label?: string;
  /** False until the project has lead inspectors (migration 20261007170000): roles only. */
  teams?: boolean;
  /** Active lead inspectors, for an inspector's lead. */
  leads?: readonly LeadOption[];
}) {
  const [open, setOpen] = useState(false);
  // A fresh form, with empty fields and no old errors, every time it opens.
  const [formKey, setFormKey] = useState(0);
  const pending = useRef(false);

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && pending.current) return;
        if (next) setFormKey((key) => key + 1);
        setOpen(next);
      }}
    >
      <DialogTrigger asChild>
        <Button disabled={disabled}>
          <UserPlusIcon aria-hidden />
          {label}
        </Button>
      </DialogTrigger>
      <DialogContent
        className={cn("sm:max-w-lg", SCROLLING_DIALOG)}
        onInteractOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <InviteForm
          key={formKey}
          teams={teams}
          leads={leads}
          onPendingChange={(value) => {
            pending.current = value;
          }}
          onDone={() => setOpen(false)}
        />
      </DialogContent>
    </Dialog>
  );
}

const IDLE: ActionResult = { status: "idle" };

function InviteForm({
  teams,
  leads,
  onDone,
  onPendingChange,
}: {
  teams: boolean;
  leads: readonly LeadOption[];
  onDone: () => void;
  onPendingChange: (pending: boolean) => void;
}) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const roleRef = useRef<HTMLDivElement>(null);
  const leadRef = useRef<HTMLButtonElement>(null);
  // Controlled, and submitted by hand (submitAction): React resets a form after its action, and the role's
  // RadioGroup and the lead's Select would go back to their first values on that reset, so a failed invite
  // keeps everything the admin chose.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<RoleChoice>("inspector");
  const [leadId, setLeadId] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    onPendingChange(true);
    try {
      const result = await inviteUser(previous, formData).catch(unreachable);
      const errors = result.status === "error" ? (result.fieldErrors ?? {}) : {};
      setFieldErrors(errors);
      // To the first field marked, in the form's order. With nobody to lead
      // them the action marks the role, not the empty, disabled picker.
      if (errors.fullName) nameRef.current?.focus();
      else if (errors.email) emailRef.current?.focus();
      else if (errors.role) focusRole(roleRef.current);
      else if (errors.leadId) leadRef.current?.focus();

      if (result.status === "success") {
        toast.success(result.message);
        onDone();
      } else if (result.status === "warning") {
        toast.warning(result.message, { duration: 12_000 });
        onDone();
      }
      return result;
    } finally {
      onPendingChange(false);
    }
  }, IDLE);

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const nameError = fieldErrors.fullName;
  const emailError = fieldErrors.email;

  return (
    <form onSubmit={submitAction(formAction, pending)} noValidate className="grid gap-6">
      <DialogHeader>
        <DialogTitle className="text-lg font-bold">Invite a user</DialogTitle>
        <DialogDescription>They get an email with a link to choose a password and sign in.</DialogDescription>
      </DialogHeader>

      <FieldGroup className="gap-5">
        <Field data-invalid={nameError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-name`}>Full name</FieldLabel>
          <Input
            ref={nameRef}
            id={`${id}-name`}
            name="fullName"
            autoComplete="off"
            autoCapitalize="words"
            value={fullName}
            onChange={(event) => {
              setFullName(event.target.value);
              if (nameError) setFieldErrors((errors) => ({ ...errors, fullName: undefined }));
            }}
            aria-invalid={nameError ? true : undefined}
            aria-describedby={nameError ? `${id}-name-error` : undefined}
          />
          {nameError && <FieldError id={`${id}-name-error`}>{nameError}</FieldError>}
        </Field>

        <Field data-invalid={emailError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-email`}>Email</FieldLabel>
          <Input
            ref={emailRef}
            id={`${id}-email`}
            name="email"
            type="email"
            inputMode="email"
            autoComplete="off"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            value={email}
            onChange={(event) => {
              setEmail(event.target.value);
              if (emailError) setFieldErrors((errors) => ({ ...errors, email: undefined }));
            }}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? `${id}-email-error` : undefined}
          />
          {emailError && <FieldError id={`${id}-email-error`}>{emailError}</FieldError>}
        </Field>

        <RoleField
          id={id}
          value={role}
          choices={roleChoicesFor(teams)}
          error={fieldErrors.role}
          groupRef={roleRef}
          onChange={(next) => {
            setRole(next);
            if (fieldErrors.role) setFieldErrors((errors) => ({ ...errors, role: undefined }));
          }}
        />

        {teams && needsLead(role) && (
          <LeadField
            id={id}
            value={leadId}
            leads={leads}
            error={fieldErrors.leadId}
            triggerRef={leadRef}
            onChange={(next) => {
              setLeadId(next);
              if (fieldErrors.leadId) setFieldErrors((errors) => ({ ...errors, leadId: undefined }));
            }}
          />
        )}
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
          {pending ? "Sending invite…" : "Send invite"}
        </Button>
      </DialogFooter>
    </form>
  );
}
