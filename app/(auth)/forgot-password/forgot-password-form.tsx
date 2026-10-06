"use client";

import { MailCheckIcon } from "lucide-react";
import { useActionState, useEffect, useRef } from "react";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { INITIAL_FORGOT_PASSWORD_STATE, MESSAGES } from "@/lib/auth/forms";
import { requestPasswordReset } from "../actions";
import { AuthHeading } from "../_components/auth-heading";
import { AuthNotice } from "../_components/auth-notice";
import { BackToSignIn } from "../_components/back-to-sign-in";
import { SubmitButton } from "../_components/submit-button";

const TITLE_ID = "forgot-password-title";

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordReset, INITIAL_FORGOT_PASSWORD_STATE);
  const emailRef = useRef<HTMLInputElement>(null);
  const emailError = state.fieldErrors?.email;
  const sent = state.status === "sent";

  // Sent: the card changes, so take focus to its new title. Otherwise back to the email.
  useEffect(() => {
    if (state.attempt === 0) return;
    if (sent) document.getElementById(TITLE_ID)?.focus();
    else emailRef.current?.focus();
  }, [state, sent]);

  if (sent) {
    return (
      <div className="space-y-6">
        <AuthHeading titleId={TITLE_ID} title="Check your email" />
        <AuthNotice
          tone="info"
          icon={MailCheckIcon}
          title={MESSAGES.resetSent}
          description={state.email ? `Email entered: ${state.email}` : undefined}
        />
        <p className="text-sm text-muted-foreground">
          The link works once. Nothing after a few minutes? Check your spam folder, or ask your SteriCare
          administrator.
        </p>
        <BackToSignIn variant="outline" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <AuthHeading
        titleId={TITLE_ID}
        title="Reset your password"
        description="Enter the email you sign in with. We will send you a link to choose a new password."
      />
      <form action={formAction} noValidate className="space-y-5">
        {state.message && <AuthNotice key={state.attempt} tone="error" title={state.message} />}
        <Field data-invalid={emailError ? true : undefined}>
          <FieldLabel htmlFor="forgot-email">Email</FieldLabel>
          <Input
            ref={emailRef}
            id="forgot-email"
            name="email"
            type="email"
            className="text-foreground"
            inputMode="email"
            autoComplete="username"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="send"
            required
            defaultValue={state.email}
            aria-invalid={emailError ? true : undefined}
            aria-describedby={emailError ? "forgot-email-error" : undefined}
          />
          <FieldError id="forgot-email-error" role={undefined}>
            {emailError}
          </FieldError>
        </Field>
        <SubmitButton pendingLabel="Sending…">Send reset link</SubmitButton>
      </form>
      <BackToSignIn />
    </div>
  );
}
