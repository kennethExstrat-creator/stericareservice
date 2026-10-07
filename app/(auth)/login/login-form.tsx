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
        {/*
          "Forgot Password?" is drawn in the label row but comes after the field
          in the DOM, so Tab goes Email, Password, Show Password, Forgot
          Password?, Sign In. Placed before the field, it would take the Tab
          from the email: the password typed next would go nowhere, and Enter
          would open the link.
        */}
        <div className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-3">
          <FieldLabel htmlFor="login-password" className="col-start-1 row-start-1">
            Password
          </FieldLabel>
          <div className="col-span-2 row-start-2">
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
          </div>
          <Link
            href="/forgot-password"
            className="col-start-2 row-start-1 rounded-sm text-sm font-medium text-brand-600 underline-offset-4 hover:underline focus-ring touch:-my-3 touch:py-3"
          >
            Forgot Password?
          </Link>
        </div>
        <FieldError id="login-password-error" role={undefined}>
          {passwordError}
        </FieldError>
      </Field>

      <SubmitButton pendingLabel="Signing In…">Sign In</SubmitButton>
    </form>
  );
}
