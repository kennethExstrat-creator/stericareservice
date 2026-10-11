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
//
// An inspection of several PO parts (lib/inspections/parts.ts) is submitted
// as a whole: the button says so ("Submit All 3 POs"), confirming also
// checks what this device holds of the other parts (other-parts.ts), and
// the server submits every part or none. When another part keeps it back,
// the confirmation names that PO with a link to it.
import { useActionState, useContext, useState } from "react";
import Link from "next/link";
import { unstable_rethrow } from "next/navigation";
import { CloudUploadIcon, OctagonXIcon, SendIcon } from "lucide-react";
import { refreshInspectionMedia } from "@/components/capture/photos";
import { PhotoUserContext } from "@/components/capture/photos/hooks";
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
import { allPartsLabel, joinWords, type SubmitPartProblem } from "@/lib/inspections/part-moves";
import { groupRefNo, partLabel, type InspectionPart } from "@/lib/inspections/parts";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import type { InspectionResult } from "@/lib/schemas/common";
import type { ModuleOverrides } from "@/lib/schemas/template";
import type { ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";
import { submitInspection, type SubmitResult } from "../actions";
import { otherPartsHeldUp } from "./other-parts";
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
  /**
   * The inspection's PO parts, first part first, this one among them
   * (loadParts): with several, Submit covers them all. Left out, or one
   * part: the inspection alone.
   */
  parts?: readonly InspectionPart[];
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
  parts,
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
  // The user the capture page names for its photo queue: their local copies of the other parts.
  const userId = useContext(PhotoUserContext);
  const several = parts !== undefined && parts.length > 1 ? parts : null;
  const scope = several ? submitScope(several, inspectionId, refNo) : null;

  const [state, formAction, pending] = useActionState(async (): Promise<SubmitResult> => {
    const prepared = await prepare();
    if (!prepared.ok) return { status: "error", message: prepared.message };
    if (several) {
      const held = await otherPartsHeldUp(several, inspectionId, userId).catch((error: unknown) => {
        console.error("[capture] the other POs could not be checked", error);
        return { message: "Could not check this device's photo uploads for the other POs. Try again.", parts: [] };
      });
      if (held) return { status: "error", message: held.message, parts: held.parts };
    }
    const result = await submitInspection({
      inspectionId,
      dataHash: prepared.dataHash,
      // The POs the confirmation named: the server submits them only while they are the inspection's.
      ...(several ? { partIds: several.map((part) => part.id) } : {}),
    }).catch((error: unknown) => {
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
        {pending ? "Submitting…" : (scope?.action ?? "Submit")}
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
              <AlertDialogTitle className="text-lg font-bold">{scope?.title ?? `Submit ${refNo} for Review?`}</AlertDialogTitle>
              <AlertDialogDescription>
                {scope
                  ? `${scope.list} go together. Once they are submitted they can no longer be changed here. An admin reviews them and can send them back.`
                  : "Once it is submitted it can no longer be changed here. An admin reviews it and can send it back."}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <SubmitSummary suggested={suggested} warningCount={warningCount} poLabel={scope?.current} />
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
            {state.status === "error" && <SubmitError message={state.message} parts={state.parts} />}
            <AlertDialogFooter>
              <AlertDialogCancel disabled={pending}>Cancel</AlertDialogCancel>
              <Button
                type="submit"
                disabled={pending || uploadsWaiting !== null}
                className={cn(pending && "cursor-progress")}
              >
                {pending ? <Spinner aria-hidden /> : <SendIcon aria-hidden />}
                {pending ? "Submitting…" : (scope?.action ?? "Submit for Review")}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

/**
 * The words of a submit that covers several parts: the action ("Submit All
 * 3 POs"), the dialog's title under the inspection's reference number (the
 * first part's), the POs it names, and this part's PO, whose suggestion the
 * summary shows.
 */
export function submitScope(parts: readonly InspectionPart[], currentId: string, refNo: string) {
  const labels = parts.map((part, index) => partLabel(part, index));
  const index = parts.findIndex((part) => part.id === currentId);
  const action = `Submit ${allPartsLabel(parts.length)}`;
  return {
    action,
    title: `${action} of ${groupRefNo(parts) ?? refNo} for Review?`,
    list: joinWords(labels),
    current: index >= 0 ? labels[index] : undefined,
  };
}

/**
 * Why the submit did not go, read out as it appears. When other parts keep
 * the inspection back, each with what it needs and a link to open it.
 */
export function SubmitError({ message, parts }: { message: string; parts?: readonly SubmitPartProblem[] }) {
  const line = (
    <>
      <OctagonXIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      {message}
    </>
  );
  if (!parts || parts.length === 0) {
    return (
      <p role="alert" className="flex items-start gap-2 text-sm font-medium text-fail touch:text-base">
        {line}
      </p>
    );
  }
  return (
    <div role="alert" data-slot="submit-parts" className="grid gap-2 text-sm touch:text-base">
      <p className="flex items-start gap-2 font-medium text-fail">{line}</p>
      <ul className="grid gap-1 pl-6">
        {parts.map((part) => (
          <li key={part.id} className="flex flex-wrap items-center gap-x-3">
            <span className="text-foreground">{part.message}</span>
            <Button asChild variant="link" className="h-auto px-0 py-1 touch:h-11 touch:px-0">
              <Link href={`${INSPECTIONS_PATH}/${part.id}`}>Open {part.label}</Link>
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * The confirmation's summary: the suggested result as a pill in DESIGN.md's
 * words (Passed, Failed, On Hold, as every pill outside the Conclusion
 * section), why in a line each only when there is something to say (none for
 * a clean pass: the pill says it), and how many warnings go into the report.
 * Of several parts, the summary is this part's, and says which PO it is.
 */
export function SubmitSummary({
  suggested,
  warningCount,
  poLabel,
}: {
  suggested: SubmitControlProps["suggested"];
  warningCount: number;
  /** "PO 2680276": the part this screen shows, when the submit covers several. */
  poLabel?: string;
}) {
  return (
    <dl className="grid gap-3 text-sm touch:text-base">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">{poLabel ? `Suggested Result for ${poLabel}` : "Suggested Result"}</dt>
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
