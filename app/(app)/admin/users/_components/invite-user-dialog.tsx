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
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSet,
  FieldTitle,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Spinner } from "@/components/ui/spinner";
import { submitAction } from "@/lib/admin/submit";
import type { InviteField, UserRole } from "@/lib/auth/users";
import { inviteUser, type ActionResult } from "../actions";
import { unreachable } from "./unreachable";

const ROLE_OPTIONS: { value: UserRole; label: string; description: string }[] = [
  { value: "inspector", label: "Inspector", description: "Records inspections and sees their own." },
  {
    value: "admin",
    label: "Admin",
    description: "Also manages users, templates and reference data, and approves inspections.",
  },
];

type FieldErrors = Partial<Record<InviteField, string>>;

/**
 * "Invite user": the button and its dialog. Disabled, with the reason shown on
 * the page, when the server has no secret key to send invites with.
 */
export function InviteUserDialog({ disabled = false, label = "Invite user" }: { disabled?: boolean; label?: string }) {
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
        className="sm:max-w-lg"
        onInteractOutside={(event) => {
          if (pending.current) event.preventDefault();
        }}
      >
        <InviteForm
          key={formKey}
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

function InviteForm({ onDone, onPendingChange }: { onDone: () => void; onPendingChange: (pending: boolean) => void }) {
  const id = useId();
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  // Controlled, and submitted by hand (submitAction): React resets a form after its action, and the role's
  // RadioGroup would go back to Inspector on that reset, so a failed invite keeps everything the admin chose.
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<UserRole>("inspector");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});

  const [state, formAction, pending] = useActionState(async (previous: ActionResult, formData: FormData) => {
    onPendingChange(true);
    try {
      const result = await inviteUser(previous, formData).catch(unreachable);
      const errors = result.status === "error" ? (result.fieldErrors ?? {}) : {};
      setFieldErrors(errors);
      if (errors.fullName) nameRef.current?.focus();
      else if (errors.email) emailRef.current?.focus();

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
  const roleError = fieldErrors.role;

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

        <FieldSet className="gap-3" aria-describedby={roleError ? `${id}-role-error` : undefined}>
          <FieldLegend variant="label" className="mb-0">
            Role
          </FieldLegend>
          <RadioGroup
            name="role"
            value={role}
            onValueChange={(value) => setRole(value as UserRole)}
            className="grid gap-3 sm:grid-cols-2"
            aria-invalid={roleError ? true : undefined}
          >
            {ROLE_OPTIONS.map((option) => (
              <FieldLabel key={option.value} htmlFor={`${id}-role-${option.value}`}>
                <Field orientation="horizontal">
                  <RadioGroupItem value={option.value} id={`${id}-role-${option.value}`} />
                  <FieldContent>
                    <FieldTitle>{option.label}</FieldTitle>
                    <FieldDescription>{option.description}</FieldDescription>
                  </FieldContent>
                </Field>
              </FieldLabel>
            ))}
          </RadioGroup>
          {roleError && <FieldError id={`${id}-role-error`}>{roleError}</FieldError>}
        </FieldSet>
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
