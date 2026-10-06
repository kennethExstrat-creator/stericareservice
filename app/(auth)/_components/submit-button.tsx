"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/**
 * Full-width primary submit that shows the form's pending state and blocks a
 * second submit. It is only ever disabled while pending, so it keeps its full
 * colour: the spinner and words say it is busy, and stay readable.
 */
export function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button
      type="submit"
      size="lg"
      className="w-full disabled:opacity-100"
      disabled={pending}
      aria-busy={pending || undefined}
    >
      {pending ? (
        <>
          <Spinner aria-hidden role="presentation" />
          {pendingLabel}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
