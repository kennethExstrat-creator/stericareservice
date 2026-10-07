"use client";

import { CircleCheckIcon, CircleIcon } from "lucide-react";
import { useActionState, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { INITIAL_RESET_PASSWORD_STATE, PASSWORD_RULES, type PasswordFlow } from "@/lib/auth/forms";
import { cn } from "@/lib/utils";
import { updatePassword } from "../actions";
import { AuthNotice } from "../_components/auth-notice";
import { PasswordInput } from "../_components/password-input";
import { SubmitButton } from "../_components/submit-button";

const POLICY_ID = "reset-password-policy";

export function ResetPasswordForm({ flow, email }: { flow: PasswordFlow; email: string }) {
  const [state, formAction] = useActionState(updatePassword, INITIAL_RESET_PASSWORD_STATE);
  const [password, setPassword] = useState("");
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const passwordError = state.fieldErrors?.password;
  const confirmError = state.fieldErrors?.confirm;
  // Focus goes back to the first field after a failed save (below), so its
  // description carries both fields' errors: a screen reader then hears why,
  // even when only the confirmation was wrong ("The passwords do not match.").
  const passwordDescribedBy = [
    passwordError && "reset-password-error",
    confirmError && "reset-confirm-error",
    POLICY_ID,
  ]
    .filter(Boolean)
    .join(" ");

  // A failed save clears both fields (React resets the form): start again at the first.
  useEffect(() => {
    if (state.attempt === 0 || state.expired) return;
    passwordRef.current?.focus();
  }, [state]);

  // Enter in the new password moves on to an empty confirmation instead of submitting.
  function onPasswordKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !confirmRef.current?.value) {
      event.preventDefault();
      confirmRef.current?.focus();
    }
  }

  return (
    <form action={formAction} onReset={() => setPassword("")} noValidate className="space-y-5">
      {state.message && (
        <AuthNotice
          key={state.attempt}
          tone="error"
          title={state.message}
          action={state.expired ? { href: "/forgot-password", label: "Get a New Link" } : undefined}
        />
      )}

      {/* Tells password managers which account the new password belongs to. */}
      <input type="email" autoComplete="username" value={email} readOnly hidden />

      <Field data-invalid={passwordError ? true : undefined}>
        <FieldLabel htmlFor="reset-password">New Password</FieldLabel>
        <PasswordInput
          ref={passwordRef}
          id="reset-password"
          name="password"
          autoComplete="new-password"
          enterKeyHint="next"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordDescribedBy}
          onChange={(event) => setPassword(event.currentTarget.value)}
          onKeyDown={onPasswordKeyDown}
        />
        <PasswordRules id={POLICY_ID} value={password} />
        <FieldError id="reset-password-error" role={undefined}>
          {passwordError}
        </FieldError>
      </Field>

      <Field data-invalid={confirmError ? true : undefined}>
        <FieldLabel htmlFor="reset-confirm">Confirm New Password</FieldLabel>
        <PasswordInput
          ref={confirmRef}
          id="reset-confirm"
          name="confirm"
          autoComplete="new-password"
          enterKeyHint="done"
          required
          aria-invalid={confirmError ? true : undefined}
          aria-describedby={confirmError ? "reset-confirm-error" : undefined}
        />
        <FieldError id="reset-confirm-error" role={undefined}>
          {confirmError}
        </FieldError>
      </Field>

      <SubmitButton pendingLabel="Saving…">{flow === "invite" ? "Set Password" : "Save New Password"}</SubmitButton>
    </form>
  );
}

/**
 * The password policy, shown before anything is typed and ticked off live.
 * The server applies the same rules (lib/auth/forms.ts).
 */
function PasswordRules({ id, value }: { id: string; value: string }) {
  return (
    <ul id={id} className="space-y-1.5 text-sm">
      {PASSWORD_RULES.map((rule) => {
        const met = rule.test(value);
        const Icon = met ? CircleCheckIcon : CircleIcon;
        return (
          <li
            key={rule.key}
            data-met={met}
            className={cn("flex items-center gap-2", met ? "text-pass" : "text-muted-foreground")}
          >
            <Icon aria-hidden className="size-4 shrink-0" />
            <span>
              {rule.label}
              <span className="sr-only">{met ? " (done)" : " (not yet)"}</span>
            </span>
          </li>
        );
      })}
    </ul>
  );
}
