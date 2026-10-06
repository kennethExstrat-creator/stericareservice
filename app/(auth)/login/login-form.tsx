"use client";

import Link from "next/link";
import { useActionState, useEffect, useRef, type KeyboardEvent } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { INITIAL_SIGN_IN_STATE, type LoginNotice } from "@/lib/auth/forms";
import { signIn } from "../actions";
import { AuthNotice } from "../_components/auth-notice";
import { PasswordInput } from "../_components/password-input";
import { SubmitButton } from "../_components/submit-button";

/**
 * `notice` is the ?error= banner. It goes once the user tries again, so it
 * never sits above the answer to a new attempt.
 */
export function LoginForm({ next, notice }: { next?: string; notice: LoginNotice | null }) {
  const [state, formAction] = useActionState(signIn, INITIAL_SIGN_IN_STATE);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const emailError = state.fieldErrors?.email;
  const passwordError = state.fieldErrors?.password;

  // After a failed attempt, put the cursor where the fix goes: the email if it
  // was the problem, otherwise the (now empty) password.
  useEffect(() => {
    if (state.attempt === 0) return;
    (emailError ? emailRef : passwordRef).current?.focus();
  }, [state, emailError]);

  // Enter in the email field moves on to an empty password instead of submitting.
  function onEmailKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Enter" && !passwordRef.current?.value) {
      event.preventDefault();
      passwordRef.current?.focus();
    }
  }

  return (
    <form action={formAction} noValidate className="space-y-5">
      {notice && state.attempt === 0 && <AuthNotice {...notice} />}
      {state.message && <AuthNotice key={state.attempt} tone="error" title={state.message} />}
      <input type="hidden" name="next" value={next ?? ""} />

      <Field data-invalid={emailError ? true : undefined}>
        <FieldLabel htmlFor="login-email">Email</FieldLabel>
        <Input
          ref={emailRef}
          id="login-email"
          name="email"
          type="email"
          className="text-foreground"
          inputMode="email"
          autoComplete="username"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="next"
          required
          defaultValue={state.email}
          aria-invalid={emailError ? true : undefined}
          aria-describedby={emailError ? "login-email-error" : undefined}
          onKeyDown={onEmailKeyDown}
        />
        <FieldError id="login-email-error" role={undefined}>
          {emailError}
        </FieldError>
      </Field>

      <Field data-invalid={passwordError ? true : undefined}>
        <div className="flex items-center justify-between gap-4">
          <FieldLabel htmlFor="login-password">Password</FieldLabel>
          <Link
            href="/forgot-password"
            className="rounded-sm text-sm font-medium text-brand-600 underline-offset-4 outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50 touch:-my-3 touch:py-3"
          >
            Forgot password?
          </Link>
        </div>
        <PasswordInput
          ref={passwordRef}
          id="login-password"
          name="password"
          autoComplete="current-password"
          enterKeyHint="go"
          required
          aria-invalid={passwordError ? true : undefined}
          aria-describedby={passwordError ? "login-password-error" : undefined}
        />
        <FieldError id="login-password-error" role={undefined}>
          {passwordError}
        </FieldError>
      </Field>

      <SubmitButton pendingLabel="Signing in…">Sign in</SubmitButton>
    </form>
  );
}
