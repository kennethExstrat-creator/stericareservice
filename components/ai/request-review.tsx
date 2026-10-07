"use client";

import { useActionState, useEffect, useRef } from "react";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { requestAiSecondOpinion } from "@/lib/inspections/ai/actions";
import { AI_ACTION_IDLE, type AiActionState } from "@/lib/inspections/ai/types";
import { cn } from "@/lib/utils";
import { focusIfLost, moveFocusTo } from "./focus-handoff";
import { AI_FOCUS } from "./focus-targets";
import { unreachable } from "./unreachable";

/** "Request AI second opinion" (admins): a pending review of the current version, written in the background. */
export function RequestReviewButton({
  inspectionId,
  label = "Request AI second opinion",
  variant = "default",
  className,
}: {
  inspectionId: string;
  label?: string;
  variant?: "default" | "outline";
  className?: string;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [state, formAction, pending] = useActionState(async (previous: AiActionState, formData: FormData) => {
    const result = await requestAiSecondOpinion(previous, formData).catch(unreachable);
    if (result.status === "success") {
      toast.success(result.message);
      // This button goes while the opinion is written: focus moves to the notice that says so.
      moveFocusTo(AI_FOCUS.attempt);
    }
    return result;
  }, AI_ACTION_IDLE);

  // Refused or unreachable: back to the button, to try again.
  useEffect(() => {
    if (state.status === "error") focusIfLost(buttonRef.current, formRef.current);
  }, [state]);

  return (
    <form ref={formRef} action={formAction} className={cn("flex flex-col items-start gap-2", className)}>
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <Button ref={buttonRef} type="submit" variant={variant} disabled={pending}>
        {pending ? <Spinner aria-hidden /> : <SparklesIcon aria-hidden />}
        {pending ? "Requesting" : label}
      </Button>
      {state.status === "error" && (
        <p role="alert" className="max-w-md text-sm text-fail">
          {state.message}
        </p>
      )}
    </form>
  );
}
