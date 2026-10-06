"use client";

import { useActionState } from "react";
import { SparklesIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { requestAiSecondOpinion } from "@/lib/inspections/ai/actions";
import { AI_ACTION_IDLE, type AiActionState } from "@/lib/inspections/ai/types";
import { cn } from "@/lib/utils";

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
  const [state, formAction, pending] = useActionState(async (previous: AiActionState, formData: FormData) => {
    const result = await requestAiSecondOpinion(previous, formData);
    if (result.status === "success") toast.success(result.message);
    return result;
  }, AI_ACTION_IDLE);

  return (
    <form action={formAction} className={cn("flex flex-col items-start gap-2", className)}>
      <input type="hidden" name="inspectionId" value={inspectionId} />
      <Button type="submit" variant={variant} disabled={pending}>
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
