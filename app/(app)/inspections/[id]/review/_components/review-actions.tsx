"use client";

import { useActionState, useId, useRef, useState, type ReactNode, type RefObject } from "react";
import { CheckIcon, OctagonXIcon, RotateCcwIcon, TriangleAlertIcon } from "lucide-react";
import { toast } from "sonner";
import { refreshInspectionMedia } from "@/components/capture/photos";
import { StatusPill } from "@/components/qc";
import { Alert, AlertDescription } from "@/components/ui/alert";
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
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import {
  allPartsLabel,
  blockedNote,
  joinWords,
  PART_VERSION_FIELD,
  partsApprovalCautions,
  partVersionValue,
  planReview,
  type PartState,
} from "@/lib/inspections/part-moves";
import { approveInspection, reopenInspection, type ReviewActionResult } from "@/lib/inspections/review/actions";
import { approvalCautions, type ApprovalFacts } from "@/lib/inspections/review/approval";
import { readReopenDraft, reopenDraftKey, useTabDraft, writeReopenDraft } from "@/lib/inspections/review/drafts";
import { RESULT_LABEL } from "@/lib/inspections/review/format";
import { REOPEN_REASON_MAX, REVIEW_MESSAGES } from "@/lib/inspections/review/schemas";
import type { InspectionResult } from "@/lib/schemas/common";
import { InspectionStatusBadge } from "../../../_components/inspection-status-badge";
import { unreachable } from "./unreachable";

/** The inspector's final result, the app's suggestion and the errors on screen (lib/inspections/review/approval). */
export type ReviewActionsProps = ApprovalFacts & {
  inspectionId: string;
  refNo: string;
  /** `updated_at` as rendered: approving applies to this version only. */
  version: string;
  /** The signed-in admin: a reason for reopening, typed and not sent, is kept in this tab under their id. */
  viewerId: string;
  /**
   * The inspection's PO parts as the page read them, first part first, this
   * one among them (loadPartStates): with several, Approve and Reopen cover
   * them all. Left out, or one part: the inspection alone.
   */
  parts?: readonly PartState[];
};

const IDLE: ReviewActionResult = { status: "idle" };

/** The parts a decision covers when there are several; null for an inspection of one. */
function severalParts(parts: readonly PartState[] | undefined): readonly PartState[] | null {
  return parts && parts.length > 1 ? parts : null;
}

/** The inspection's reference number: the first part's. */
function inspectionRef(parts: readonly PartState[], fallback: string): string {
  return (parts.find((part) => part.primary) ?? parts[0])?.refNo ?? fallback;
}

/** "Approve", or "Approve All 3 POs" for an inspection of several parts. */
function actionLabel(verb: "Approve" | "Reopen", parts: readonly PartState[] | null): string {
  return parts ? `${verb} ${allPartsLabel(parts.length)}` : verb;
}

/**
 * Approve and Reopen for an admin on a submitted inspection, each with its
 * confirmation. A success or a state that moved on (someone else acted
 * first) closes the dialog with a toast; the page refreshes with the new
 * status. An error stays in the dialog, next to what the admin was doing.
 * Of several PO parts, both cover every part ("Approve All 3 POs").
 */
export function ReviewActions(props: ReviewActionsProps) {
  const [open, setOpen] = useState<"approve" | "reopen" | null>(null);
  const approveRef = useRef<HTMLButtonElement>(null);
  const reopenRef = useRef<HTMLButtonElement>(null);
  const several = severalParts(props.parts);

  return (
    <>
      <Button ref={reopenRef} variant="outline" onClick={() => setOpen("reopen")}>
        <RotateCcwIcon aria-hidden />
        {actionLabel("Reopen", several)}
      </Button>
      <Button ref={approveRef} onClick={() => setOpen("approve")}>
        <CheckIcon aria-hidden />
        {actionLabel("Approve", several)}
      </Button>

      {open === "approve" && <ApproveDialog {...props} onClose={() => setOpen(null)} returnFocusTo={approveRef} />}
      {open === "reopen" && <ReopenDialog {...props} onClose={() => setOpen(null)} returnFocusTo={reopenRef} />}
    </>
  );
}

type DialogProps = ReviewActionsProps & {
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
};

/**
 * Toast and close on success or a warning; anything else stays in the
 * dialog. Either way the inspection's status may have moved on (a warning:
 * someone else acted first), so photos and files already loaded on this
 * device (the gallery's store, kept across client-side navigation) are read
 * again with the user's new rights: an approved inspection's are read-only.
 */
export function settle(inspectionId: string, result: ReviewActionResult, onClose: () => void): ReviewActionResult {
  if (result.status === "success") {
    toast.success(result.message);
    onClose();
  } else if (result.status === "warning") {
    toast.warning(result.message, { duration: 12_000 });
    onClose();
  }
  if (result.status === "success" || result.status === "warning") {
    refreshInspectionMedia(inspectionId).catch((error: unknown) => console.error("Inspection review: reading the photos again failed", error));
  }
  return result;
}

function ApproveDialog({
  inspectionId,
  refNo,
  version,
  parts,
  finalResult,
  suggestedResult,
  errors,
  onClose,
  returnFocusTo,
}: DialogProps) {
  const [state, formAction, pending] = useActionState(
    async (previous: ReviewActionResult, formData: FormData) =>
      settle(inspectionId, await approveInspection(previous, formData).catch(unreachable), onClose),
    IDLE,
  );
  const several = severalParts(parts);
  // A part that is a draft or reopened keeps the inspection from being approved: the description says which.
  const blocked = several !== null && planReview(several, "approve").blocked.length > 0;

  return (
    <ReviewDialog pending={pending} onClose={onClose} returnFocusTo={returnFocusTo}>
      <form action={formAction} className="grid gap-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">
            {several ? `${actionLabel("Approve", several)} of ${inspectionRef(several, refNo)}?` : `Approve ${refNo}?`}
          </AlertDialogTitle>
          {several ? (
            <PartsApproveDescription
              parts={several}
              currentId={inspectionId}
              finalResult={finalResult}
              suggestedResult={suggestedResult}
              errors={errors}
            />
          ) : (
            <ApproveDescription finalResult={finalResult} suggestedResult={suggestedResult} errors={errors} />
          )}
        </AlertDialogHeader>

        <input type="hidden" name="inspectionId" value={inspectionId} />
        <input type="hidden" name="version" value={version} />
        {/* Every part with the version shown: the server approves only those, at those versions (this page's part at the version its review shows). */}
        {several?.map((part) => (
          <input
            key={part.id}
            type="hidden"
            name={PART_VERSION_FIELD}
            value={partVersionValue(part.id === inspectionId ? { id: part.id, version } : part)}
          />
        ))}

        {state.status === "error" && <ActionError message={state.message} />}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <Button type="submit" disabled={pending || blocked}>
            {pending ? <Spinner aria-hidden /> : <CheckIcon aria-hidden />}
            {pending ? "Approving…" : actionLabel("Approve", several)}
          </Button>
        </AlertDialogFooter>
      </form>
    </ReviewDialog>
  );
}

function FinalResultPill({ result }: { result: InspectionResult | null }) {
  return result ? (
    <StatusPill status={result} variant="solid" size="sm" label={RESULT_LABEL[result]} />
  ) : (
    <StatusPill status="not_done" size="sm" label="Not Chosen" />
  );
}

function SuggestedResultPill({ result }: { result: InspectionResult | null }) {
  return result ? (
    <StatusPill status={result} size="sm" label={RESULT_LABEL[result]} />
  ) : (
    <span className="text-muted-foreground">Could not be worked out</span>
  );
}

/**
 * Everything the admin weighs before approving, all of it the dialog's
 * description: what approving means, the final and the suggested result,
 * and the cautions. A screen reader reads it out with the title as the
 * dialog opens, while focus waits on Cancel, so the cautions are heard
 * before Approve can be reached. Spaces keep the words apart when read or
 * copied; the layout spaces them on screen.
 */
export function ApproveDescription({ finalResult, suggestedResult, errors }: ApprovalFacts) {
  const cautions = approvalCautions({ finalResult, suggestedResult, errors });
  return (
    <AlertDialogDescription asChild>
      <div className="grid gap-5 justify-self-stretch">
        <p>
          An approved inspection is final: nobody can change its results, photos or files afterwards. Only the choice
          of report photos stays open.
        </p>{" "}
        <dl className="grid gap-2 rounded-lg border border-border bg-slate-50 px-4 py-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">Final Result</dt>{" "}
            <dd>
              <FinalResultPill result={finalResult} />
            </dd>
          </div>{" "}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <dt className="text-muted-foreground">Suggested Result</dt>{" "}
            <dd>
              <SuggestedResultPill result={suggestedResult} />
            </dd>
          </div>
        </dl>{" "}
        <Cautions cautions={cautions} />
      </div>
    </AlertDialogDescription>
  );
}

/**
 * ApproveDescription for an inspection of several PO parts: the final and
 * the suggested result of each PO, and the cautions, each naming its PO.
 * The part on this page is weighed with its checks, as its review shows it;
 * the others by the results their rows repeat (partsApprovalCautions). A
 * part that keeps the inspection from being approved comes first.
 */
export function PartsApproveDescription({
  parts,
  currentId,
  finalResult,
  suggestedResult,
  errors,
}: ApprovalFacts & { parts: readonly PartState[]; currentId: string }) {
  const blocked = planReview(parts, "approve").blocked;
  const cautions = [
    ...(blocked.length > 0 ? [blockedNote("approve", blocked)] : []),
    ...partsApprovalCautions(parts, currentId, { finalResult, suggestedResult, errors }),
  ];
  const rows = parts.map((part) => (part.id === currentId ? { ...part, result: finalResult, suggestedResult } : part));
  return (
    <AlertDialogDescription asChild>
      <div className="grid gap-5 justify-self-stretch">
        <p>
          An approved inspection is final: nobody can change its results, photos or files afterwards. Only the choice
          of report photos stays open.
        </p>{" "}
        <div className="rounded-lg border border-border bg-slate-50 px-4 py-1 text-sm">
          {/* Each row's last cell ends with a space, so the rows stay apart when read or copied. */}
          <table data-slot="approve-parts" className="w-full text-left">
            <thead>
              <tr className="text-muted-foreground">
                <th scope="col" className="py-2 pr-3 font-normal">
                  PO
                </th>{" "}
                <th scope="col" className="py-2 pr-3 font-normal">
                  Final Result
                </th>{" "}
                <th scope="col" className="py-2 font-normal">
                  Suggested Result{" "}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((part) => (
                <tr key={part.id} className="border-t border-border">
                  <th scope="row" className="py-2 pr-3 font-semibold text-foreground">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      {part.label}
                      {part.status !== "submitted" && (
                        <>
                          {" "}
                          <InspectionStatusBadge status={part.status} />
                        </>
                      )}
                    </span>
                  </th>{" "}
                  <td className="py-2 pr-3">
                    <FinalResultPill result={part.result} />
                  </td>{" "}
                  <td className="py-2">
                    <SuggestedResultPill result={part.suggestedResult} />{" "}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>{" "}
        <Cautions cautions={cautions} />
      </div>
    </AlertDialogDescription>
  );
}

function ReopenDialog({ inspectionId, refNo, viewerId, parts, onClose, returnFocusTo }: DialogProps) {
  const several = severalParts(parts);
  // An approved part keeps the inspection from being reopened.
  const blocked = several ? planReview(several, "reopen").blocked : [];
  const id = useId();
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  // Controlled, so a failed attempt keeps what the admin wrote; kept in the
  // tab as it is typed, so a reload does not lose it either. Sent, or the
  // dialog cancelled, it goes.
  const [draft, setDraft] = useTabDraft(reopenDraftKey(viewerId, inspectionId), readReopenDraft, writeReopenDraft);
  const reason = draft ?? "";
  const close = () => {
    setDraft(null);
    onClose();
  };
  const [reasonError, setReasonError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(async (previous: ReviewActionResult, formData: FormData) => {
    // An empty reason needs no round trip; the server checks everything again.
    const result: ReviewActionResult =
      String(formData.get("reason") ?? "").trim() === ""
        ? { status: "error", message: REVIEW_MESSAGES.reasonMissing, fieldErrors: { reason: REVIEW_MESSAGES.reasonMissing } }
        : await reopenInspection(previous, formData).catch(unreachable);
    const fieldError = result.status === "error" ? (result.fieldErrors?.reason ?? null) : null;
    setReasonError(fieldError);
    if (fieldError) reasonRef.current?.focus();
    return settle(inspectionId, result, close);
  }, IDLE);

  const formError = state.status === "error" && !state.fieldErrors ? state.message : null;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;

  return (
    <ReviewDialog
      pending={pending}
      // Cancelled (the button, Escape, outside): the reason goes with it.
      onClose={close}
      returnFocusTo={returnFocusTo}
      // Straight to the reason: it is the one thing to fill in. A reason
      // brought back from before a reload goes on where it stopped.
      onOpenAutoFocus={(event) => {
        event.preventDefault();
        const field = reasonRef.current;
        field?.focus();
        field?.setSelectionRange(field.value.length, field.value.length);
      }}
    >
      <form action={formAction} noValidate className="grid gap-5">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-lg font-bold">
            {several ? `${actionLabel("Reopen", several)} of ${inspectionRef(several, refNo)}?` : `Reopen ${refNo}?`}
          </AlertDialogTitle>
          {several ? (
            <AlertDialogDescription asChild>
              <div className="grid gap-3 justify-self-stretch">
                <p>
                  {joinWords(several.map((part) => part.label))} go back to the inspector, who can change them and must
                  submit them again before they can be approved.
                </p>{" "}
                <Cautions cautions={blocked.length > 0 ? [blockedNote("reopen", blocked)] : []} />
              </div>
            </AlertDialogDescription>
          ) : (
            <AlertDialogDescription>
              It goes back to the inspector, who can change it and must submit it again before it can be approved.
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>

        <Field data-invalid={reasonError ? true : undefined}>
          <FieldLabel htmlFor={`${id}-reason`}>What Should the Inspector Change?</FieldLabel>
          <Textarea
            ref={reasonRef}
            id={`${id}-reason`}
            name="reason"
            rows={4}
            maxLength={REOPEN_REASON_MAX}
            value={reason}
            onChange={(event) => {
              setDraft(event.target.value === "" ? null : event.target.value);
              if (reasonError) setReasonError(null);
            }}
            aria-invalid={reasonError ? true : undefined}
            aria-describedby={reasonError ? `${errorId} ${hintId}` : hintId}
            className="min-h-24"
          />
          <FieldDescription id={hintId}>
            The inspector sees this on {several ? "each PO" : "the inspection"}. Up to {REOPEN_REASON_MAX} characters.
          </FieldDescription>
          {reasonError && <FieldError id={errorId}>{reasonError}</FieldError>}
        </Field>

        <input type="hidden" name="inspectionId" value={inspectionId} />

        {formError && <ActionError message={formError} />}

        <AlertDialogFooter>
          <AlertDialogCancel type="button" disabled={pending}>
            Cancel
          </AlertDialogCancel>
          <Button type="submit" disabled={pending || blocked.length > 0}>
            {pending ? <Spinner aria-hidden /> : <RotateCcwIcon aria-hidden />}
            {pending ? "Reopening…" : actionLabel("Reopen", several)}
          </Button>
        </AlertDialogFooter>
      </form>
    </ReviewDialog>
  );
}

/** The confirmation frame: closes only when nothing is pending, and gives focus back to its button. */
function ReviewDialog({
  pending,
  onClose,
  returnFocusTo,
  onOpenAutoFocus,
  children,
}: {
  pending: boolean;
  onClose: () => void;
  returnFocusTo: RefObject<HTMLButtonElement | null>;
  onOpenAutoFocus?: (event: Event) => void;
  children: ReactNode;
}) {
  return (
    <AlertDialog
      open
      onOpenChange={(open) => {
        if (!open && !pending) onClose();
      }}
    >
      <AlertDialogContent
        className="sm:max-w-lg"
        onOpenAutoFocus={onOpenAutoFocus}
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          // After a success the page no longer shows the button: focus moves to the new status instead.
          if (returnFocusTo.current?.isConnected) returnFocusTo.current.focus();
        }}
        onEscapeKeyDown={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        {children}
      </AlertDialogContent>
    </AlertDialog>
  );
}

function Cautions({ cautions }: { cautions: readonly string[] }) {
  if (cautions.length === 0) return null;
  return (
    <ul className="grid gap-2 text-left">
      {cautions.map((caution) => (
        <Caution key={caution}>{caution}</Caution>
      ))}
    </ul>
  );
}

function Caution({ children }: { children: ReactNode }) {
  return (
    <li className="flex gap-2 rounded-lg border border-warn-border bg-warn-tint px-3 py-2 text-sm text-warn">
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <span>{children}</span>{" "}
    </li>
  );
}

/** role="alert" (Alert): read out as soon as it appears. */
function ActionError({ message }: { message: string }) {
  return (
    <Alert variant="destructive">
      <OctagonXIcon aria-hidden />
      <AlertDescription className="text-destructive">{message}</AlertDescription>
    </Alert>
  );
}
