"use client";

// Submit (BUILD_SPEC 6.2, 8 and 8.1). With errors on screen the button opens
// the issues panel instead: errors block submit, each with a link. Without,
// it asks for confirmation. While photos or files wait on this device the
// confirmation says so and cannot be given (8.1: submit is blocked until the
// queue is empty); confirming checks the queue once more, other tabs
// included, saves what is not saved yet, and asks the server to move the
// inspection to submitted, which checks the saved data once more and opens
// the review. The suggested result is a pill in DESIGN.md's words (Passed,
// Failed, On Hold), with the reasons under it only when there are any
// (suggestion.ts): a clean pass says nothing twice.
import { useActionState, useState } from "react";
import { unstable_rethrow } from "next/navigation";
import { CloudUploadIcon, OctagonXIcon, SendIcon } from "lucide-react";
import { refreshInspectionMedia } from "@/components/capture/photos";
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
import { blockedSubmitMessage } from "@/lib/inspections/capture/issues";
import type { InspectionResult } from "@/lib/schemas/common";
import type { ModuleOverrides } from "@/lib/schemas/template";
import type { ValidationIssue } from "@/lib/validation";
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
  /** The suggested result, and why (suggestionReasons): no reasons for a clean pass. */
  suggested: { result: InspectionResult; reasons: readonly string[] };
  /** Waits for uploads and saves; resolves with the hash of the data that was saved. */
  prepare: () => Promise<SubmitPreparation>;
  /** Submit was refused for errors (on screen, or found by the server in the saved data). */
  onBlocked: (blocked: SubmitBlocked) => void;
  /** Submitted: the server is opening the review. */
  onSubmitted?: () => void;
  /** Why photos or files on this device hold the submit up ("Waiting for 2 photos to upload."); null when nothing does. */
  uploadsWaiting: string | null;
  disabled?: boolean;
  className?: string;
};

export function SubmitControl({
  inspectionId,
  refNo,
  errorCount,
  warningCount,
  suggested,
  prepare,
  onBlocked,
  onSubmitted,
  uploadsWaiting,
  disabled = false,
  className,
}: SubmitControlProps) {
  const [open, setOpen] = useState(false);

  const [state, formAction, pending] = useActionState(async (): Promise<SubmitResult> => {
    const prepared = await prepare();
    if (!prepared.ok) return { status: "error", message: prepared.message };
    const result = await submitInspection({ inspectionId, dataHash: prepared.dataHash }).catch((error: unknown) => {
      try {
        unstable_rethrow(error);
      } catch (signal) {
        // The redirect to the review: submitted. The page's photo store reads the inspection's new rights.
        void refreshInspectionMedia(inspectionId);
        onSubmitted?.();
        throw signal;
      }
      return unreachable(error);
    });
    if (result.status === "blocked") {
      setOpen(false);
      onBlocked({ message: result.message, errors: result.errors, overrides: result.overrides });
    }
    return result;
  }, IDLE);

  const openOrBlock = () => {
    if (errorCount > 0) {
      onBlocked({
        message: blockedSubmitMessage(errorCount),
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
              <AlertDialogTitle className="text-lg font-bold">Submit {refNo} for Review?</AlertDialogTitle>
              <AlertDialogDescription>
                Once it is submitted it can no longer be changed here. An admin reviews it and can send it back.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <SubmitSummary suggested={suggested} warningCount={warningCount} />
            {uploadsWaiting && !pending && (
              <p
                role="status"
                data-slot="submit-uploads"
                className="flex items-start gap-2 rounded-lg border border-brand-200 bg-brand-50 px-3 py-2 text-sm font-medium text-brand-700 touch:text-base"
              >
                <CloudUploadIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
                <span>{uploadsWaiting}</span>
              </p>
            )}
            {state.status === "error" && (
              <p role="alert" className="flex items-start gap-2 text-sm font-medium text-fail touch:text-base">
                <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {state.message}
              </p>
            )}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button
                type="submit"
                disabled={pending || uploadsWaiting !== null}
                className={cn(pending && "cursor-progress")}
              >
                {pending ? <Spinner aria-hidden /> : <SendIcon aria-hidden />}
                {pending ? "Submitting…" : "Submit for Review"}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The confirmation's summary: the suggested result as a pill in DESIGN.md's
 * words (Passed, Failed, On Hold, as every pill outside the Conclusion
 * section), why in a line each only when there is something to say (none for
 * a clean pass: the pill says it), and how many warnings go into the report.
 */
export function SubmitSummary({
  suggested,
  warningCount,
}: {
  suggested: SubmitControlProps["suggested"];
  warningCount: number;
}) {
  return (
    <dl className="grid gap-3 text-sm touch:text-base">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">Suggested Result</dt>
        <dd>
          <StatusPill status={suggested.result} />
        </dd>
      </div>
      {suggested.reasons.length > 0 && (
        <div>
          <dt className="sr-only">Why</dt>
          <dd data-slot="suggested-reasons" className="space-y-0.5 text-foreground">
            {suggested.reasons.map((reason) => (
              <span key={reason} className="block">
                {reason}
              </span>
            ))}
          </dd>
        </div>
      )}
      {warningCount > 0 && (
        <div>
          <dt className="sr-only">Warnings</dt>
          <dd className="text-foreground">
            {warningCount === 1 ? "1 warning goes" : `${warningCount} warnings go`} into the report.
          </dd>
        </div>
      )}
    </dl>
  );
}
