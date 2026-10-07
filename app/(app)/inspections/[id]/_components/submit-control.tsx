"use client";

// Submit (BUILD_SPEC 6.2, 8 and 8.1). With errors on screen the button opens
// the issues panel instead: errors block submit, each with a link. Without,
// it asks for confirmation; confirming waits for photos to finish
// uploading, saves what is not saved yet, and asks the server to move the
// inspection to submitted, which checks the saved data once more and opens
// the review.
import { useActionState, useState } from "react";
import { OctagonXIcon, SendIcon } from "lucide-react";
import { StatusPill } from "@/components/qc";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import type { ModuleOverrides } from "@/lib/schemas/template";
import type { SuggestedResult, ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { submitInspection, type SubmitResult } from "../actions";
import { unreachable } from "./unreachable";

const IDLE: SubmitResult = { status: "idle" };

/** What the screen does before the server is asked: photos uploaded, everything saved. */
export type SubmitPreparation = { ok: true; dataHash: string } | { ok: false; message: string };

/** Why submit was refused for errors. */
export type SubmitBlocked = {
  message: string;
  /** The errors the server found in the saved data; null when the screen's own errors stopped it. */
  errors: ValidationIssue[] | null;
  /** The module overrides the server checked with, which may be newer than the screen's. */
  overrides: ModuleOverrides | null;
};

type SubmitControlProps = {
  inspectionId: string;
  refNo: string;
  /** Errors on screen: the button opens the issues panel instead of submitting. */
  errorCount: number;
  warningCount: number;
  suggested: Pick<SuggestedResult, "result" | "summary">;
  /** Waits for uploads and saves; resolves with the hash of the data that was saved. */
  prepare: () => Promise<SubmitPreparation>;
  /** Submit was refused for errors (on screen, or found by the server in the saved data). */
  onBlocked: (blocked: SubmitBlocked) => void;
  disabled?: boolean;
  className?: string;
};

const SUGGESTED_LABEL = { pass: "Pass", fail: "Fail", hold: "Hold" } as const;

export function SubmitControl({
  inspectionId,
  refNo,
  errorCount,
  warningCount,
  suggested,
  prepare,
  onBlocked,
  disabled = false,
  className,
}: SubmitControlProps) {
  const [open, setOpen] = useState(false);

  const [state, formAction, pending] = useActionState(async (): Promise<SubmitResult> => {
    const prepared = await prepare();
    if (!prepared.ok) return { status: "error", message: prepared.message };
    const result = await submitInspection({ inspectionId, dataHash: prepared.dataHash }).catch(unreachable);
    if (result.status === "blocked") {
      setOpen(false);
      onBlocked({ message: result.message, errors: result.errors, overrides: result.overrides });
    }
    return result;
  }, IDLE);

  const openOrBlock = () => {
    if (errorCount > 0) {
      onBlocked({
        message: `Fix ${errorCount === 1 ? "this error" : `these ${errorCount} errors`} before submitting.`,
        errors: null,
        overrides: null,
      });
      return;
    }
    setOpen(true);
  };

  return (
    <>
      <Button
        type="button"
        onClick={openOrBlock}
        disabled={disabled || pending}
        className={className}
        data-action="submit"
        aria-haspopup="dialog"
      >
        {pending ? <Spinner aria-hidden /> : <SendIcon aria-hidden />}
        {pending ? "Submitting…" : "Submit"}
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!next && pending) return;
          setOpen(next);
        }}
      >
        <AlertDialogContent>
          <form action={formAction} className="grid gap-6">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-lg font-bold">Submit {refNo} for review?</AlertDialogTitle>
              <AlertDialogDescription>
                Once it is submitted it can no longer be changed here. An admin reviews it and can send it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <dl className="grid gap-3 text-sm touch:text-base">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                <dt className="text-muted-foreground">Suggested result</dt>
                <dd>
                  <StatusPill status={suggested.result} label={SUGGESTED_LABEL[suggested.result]} />
                </dd>
              </div>
              <div>
                <dt className="sr-only">Why</dt>
                <dd className="text-foreground">{suggested.summary}</dd>
              </div>
              {warningCount > 0 && (
                <div>
                  <dt className="sr-only">Warnings</dt>
                  <dd className="text-foreground">
                    {warningCount === 1 ? "1 warning goes" : `${warningCount} warnings go`} into the report.
                  </dd>
                </div>
              )}
            </dl>
            {state.status === "error" && (
              <p role="alert" className="flex items-start gap-2 text-sm font-medium text-fail touch:text-base">
                <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {state.message}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button type="submit" disabled={pending} className={cn(pending && "cursor-progress")}>
                {pending ? <Spinner aria-hidden /> : <SendIcon aria-hidden />}
                {pending ? "Submitting…" : "Submit for review"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
