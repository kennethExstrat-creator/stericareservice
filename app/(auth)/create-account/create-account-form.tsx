"use client";

import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NAME_MAX_LENGTH, PHONE_HINT, PHONE_MAX_LENGTH } from "@/lib/auth/fields";
import { INITIAL_CREATE_ACCOUNT_STATE, MESSAGES } from "@/lib/auth/forms";
import { LOGIN_PATH } from "@/lib/auth/routes";
import { createAccount } from "../actions";
import { AuthNotice } from "../_components/auth-notice";
import { PasswordInput } from "../_components/password-input";
import { PasswordRules } from "../_components/password-rules";
import { SubmitButton } from "../_components/submit-button";

const POLICY_ID = "create-password-policy";

/**
 * Full Name (the name the admin typed in the invitation, if any), Email (the
 * invitation's, read-only), Phone, then the password twice, held to the reset
 * form's rules. The email is shown, never sent: the session says whose
 * account it is, and another address takes a new invitation.
 */
export function CreateAccountForm({ fullName, email }: { fullName: string; email: string }) {
  const [state, formAction] = useActionState(createAccount, INITIAL_CREATE_ACCOUNT_STATE);
  const [password, setPassword] = useState("");
  const nameRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const nameError = state.fieldErrors?.fullName;
  const phoneError = state.fieldErrors?.phone;
  const passwordError = state.fieldErrors?.password;
  const confirmError = state.fieldErrors?.confirm;
  // As the reset form: when focus comes back to the (cleared) password, its
  // description carries the confirmation's error too.
  const passwordDescribedBy = [
    passwordError && "create-password-error",
    confirmError && "create-confirm-error",
    POLICY_ID,
  ]
    .filter(Boolean)
    .join(" ");

  // React resets the form after a failed attempt: the name and phone come
  // back from the state, the passwords are cleared. Focus goes to the first
  // field to fix, else to the password, to type again.
  useEffect(() => {
    if (state.attempt === 0 || state.expired) return;
    const errors = state.fieldErrors;
    (errors?.fullName ? nameRef : errors?.phone ? phoneRef : passwordRef).current?.focus();
  }, [state]);

  return (
    <form action={formAction} onReset={() => setPassword("")} noValidate className="space-y-5">
      {state.message && (
        <AuthNotice
          key={state.attempt}
          tone="error"
          title={state.message}
          description={state.expired ? MESSAGES.invitationExpired : undefined}
          action={state.expired ? { href: LOGIN_PATH, label: "Back to Sign In" } : undefined}
        />
      )}

      <Field data-invalid={nameError ? true : undefined}>
        <FieldLabel htmlFor="create-name">Full Name</FieldLabel>
        <Input
          ref={nameRef}
          id="create-name"
          name="fullName"
          className="text-foreground"
          autoComplete="name"
          autoCapitalize="words"
          // The iPad's autocorrect would "fix" a name it does not know.
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          maxLength={NAME_MAX_LENGTH}
          required
          defaultValue={state.fullName ?? fullName}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={nameError ? "create-name-error" : undefined}
          onKeyDown={(event) => moveOnEnter(event, phoneRef.current)}
        />
        <FieldError id="create-name-error" role={undefined}>
          {nameError}
        </FieldError>
      </Field>

      <Field>
        <FieldLabel htmlFor="create-email">Email</FieldLabel>
        {/* No name, so it is never sent; autoComplete tells password managers whose password this is. */}
        <Input
          id="create-email"
          type="email"
          className="text-foreground"
          autoComplete="username"
          readOnly
          defaultValue={email}
          aria-describedby="create-email-hint"
        />
        <FieldDescription id="create-email-hint">
          Your invitation was sent here. To use another address, ask your SteriCare administrator for a new invitation.
        </FieldDescription>
      </Field>

      <Field data-invalid={phoneError ? true : undefined}>
        <FieldLabel htmlFor="create-phone">Phone</FieldLabel>
        <Input
          ref={phoneRef}
          id="create-phone"
          name="phone"
          type="tel"
          inputMode="tel"
          className="text-foreground"
          autoComplete="tel"
          enterKeyHint="next"
          maxLength={PHONE_MAX_LENGTH}
          required
          defaultValue={state.phone}
          aria-invalid={phoneError ? true : undefined}
          aria-describedby={phoneError ? "create-phone-error create-phone-hint" : "create-phone-hint"}
          onKeyDown={(event) => moveOnEnter(event, passwordRef.current)}
        />
        <FieldDescription id="create-phone-hint">
          <PhoneHint />
        </FieldDescription>
        <FieldError id="create-phone-error" role={undefined}>
          {phoneError}
        </FieldError>
      </Field>

      <Field data-invalid={passwordError ? true : undefined}>
        <FieldLabel htmlFor="create-password">Password</FieldLabel>
        <PasswordInput
          ref={passwordRef}
          id="create-password"
          name="password"
          autoComplete="new-password"
          enterKeyHint="next"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordDescribedBy}
          onChange={(event) => setPassword(event.currentTarget.value)}
          onKeyDown={(event) => moveOnEnter(event, confirmRef.current)}
        />
        <PasswordRules id={POLICY_ID} value={password} />
        <FieldError id="create-password-error" role={undefined}>
          {passwordError}
        </FieldError>
      </Field>

      <Field data-invalid={confirmError ? true : undefined}>
        <FieldLabel htmlFor="create-confirm">Confirm Password</FieldLabel>
        <PasswordInput
          ref={confirmRef}
          id="create-confirm"
          name="confirm"
          autoComplete="new-password"
          enterKeyHint="done"
          required
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? "create-confirm-error" : undefined}
        />
        <FieldError id="create-confirm-error" role={undefined}>
          {confirmError}
        </FieldError>
      </Field>

      <SubmitButton pendingLabel="Creating Account…">Create Account</SubmitButton>
    </form>
  );
}

/** PHONE_HINT with its example number on one line: the card is narrow enough to break it at the hyphen. */
function PhoneHint() {
  const parts = /^(.*?)(\+[\d ()-]*\d)(.*)$/.exec(PHONE_HINT);
  if (!parts) return PHONE_HINT;
  const [, before, example, after] = parts;
  return (
    <>
      {before}
      <span className="whitespace-nowrap">{example}</span>
      {after}
    </>
  );
}

/**
 * Enter moves on to the next field while that one is empty, instead of
 * sending a half-filled form (the iPad keyboard's Next key is an Enter too).
 * Not while an input method is composing: there Enter picks the characters.
 */
function moveOnEnter(event: KeyboardEvent<HTMLInputElement>, next: HTMLInputElement | null) {
  if (event.key !== "Enter" || event.nativeEvent.isComposing || !next || next.value) return;
  event.preventDefault();
  next.focus();
}
