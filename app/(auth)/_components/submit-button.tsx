"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

/** Full-width primary submit that shows the form's pending state and blocks a second submit. */
export function SubmitButton({ children, pendingLabel }: { children: ReactNode; pendingLabel: string }) {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending} aria-busy={pending || undefined}>
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
