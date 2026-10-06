"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { CheckIcon, ThumbsDownIcon, ThumbsUpIcon, WrenchIcon, type LucideIcon } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, FieldError, FieldLabel } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { recordAiFindingDecision } from "@/lib/inspections/ai/actions";
import { DECISION_LABEL, DECISION_VERB } from "@/lib/inspections/ai/format";
import { AI_ACTION_IDLE, type AiActionState, type DecisionModel } from "@/lib/inspections/ai/types";
import { AI_REVIEW_ACTIONS, type AiReviewActionKind } from "@/lib/schemas/ai-review";
import { cn } from "@/lib/utils";

const DECISION_ICON: Readonly<Record<AiReviewActionKind, LucideIcon>> = {
  agree: ThumbsUpIcon,
  disagree: ThumbsDownIcon,
  fixed: WrenchIcon,
};

/**
 * The admin's decision on one finding (BUILD_SPEC 9.2): agree, disagree (a
 * note is required) or fixed. The latest decision shows with who made it;
 * "Change" records a new one and keeps the old in the history.
 */
export function DecisionControl({
  reviewId,
  findingId,
  decision,
  history,
}: {
  reviewId: string;
  findingId: string;
  decision: DecisionModel | null;
  history: DecisionModel[];
}) {
  const [editing, setEditing] = useState(false);
  const changeRef = useRef<HTMLButtonElement>(null);

  if (decision && !editing) {
    return (
      <div className="space-y-2" data-testid={`decision-${findingId}`}>
        <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
          <DecisionLine decision={decision} />
          <Button
            ref={changeRef}
            type="button"
            variant="outline"
            size="sm"
            onClick={() => setEditing(true)}
            aria-label={`Change your decision on finding ${findingId}`}
          >
            Change
          </Button>
        </div>
        {history.length > 0 && (
          <details className="group text-sm">
            <summary className="inline-flex min-h-8 cursor-pointer items-center rounded-sm font-medium text-brand-600 focus-ring touch:min-h-11">
              Earlier decisions ({history.length})
            </summary>
            <ul className="mt-2 space-y-2 border-l-2 border-border pl-3">
              {history.map((earlier, index) => (
                <li key={`${earlier.at}-${index}`}>
                  <DecisionLine decision={earlier} />
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>
    );
  }

  return (
    <DecisionForm
      reviewId={reviewId}
      findingId={findingId}
      // Opened with "Change": focus moves into the form, and back to "Change" on cancel.
      focusOnMount={editing}
      onCancel={
        decision
          ? () => {
              setEditing(false);
              requestAnimationFrame(() => changeRef.current?.focus());
            }
          : undefined
      }
      onSaved={() => setEditing(false)}
    />
  );
}

function DecisionLine({ decision }: { decision: DecisionModel }) {
  const Icon = DECISION_ICON[decision.action];
  return (
    <div className="min-w-0 space-y-1 text-sm">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 rounded-full border border-brand-200 bg-brand-50 px-2.5 py-0.5 font-semibold text-brand-700">
          <Icon aria-hidden className="size-3.5" />
          {DECISION_LABEL[decision.action]}
        </span>
        <span className="text-muted-foreground">
          {decision.actor} · {decision.at}
        </span>
      </p>
      {decision.note && <p className="break-words text-foreground">{decision.note}</p>}
    </div>
  );
}

function DecisionForm({
  reviewId,
  findingId,
  focusOnMount,
  onCancel,
  onSaved,
}: {
  reviewId: string;
  findingId: string;
  focusOnMount: boolean;
  onCancel?: () => void;
  onSaved: () => void;
}) {
  const id = useId();
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const groupRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (focusOnMount) groupRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [focusOnMount]);
  const [choice, setChoice] = useState<AiReviewActionKind | "">("");
  const [note, setNote] = useState("");
  const [noteError, setNoteError] = useState<string | null>(null);

  const [state, formAction, pending] = useActionState(async (previous: AiActionState, formData: FormData) => {
    const result = await recordAiFindingDecision(previous, formData);
    if (result.status === "success") {
      toast.success(result.message);
      setNoteError(null);
      onSaved();
    } else if (result.status === "error") {
      setNoteError(result.fieldErrors?.note ?? null);
      if (result.fieldErrors?.note) noteRef.current?.focus();
    }
    return result;
  }, AI_ACTION_IDLE);

  const formError = state.status === "error" && !state.fieldErrors?.note ? state.message : null;
  const noteRequired = choice === "disagree";

  return (
    <form action={formAction} noValidate className="space-y-3" aria-label={`Your decision on finding ${findingId}`}>
      <input type="hidden" name="reviewId" value={reviewId} />
      <input type="hidden" name="findingId" value={findingId} />
      <input type="hidden" name="action" value={choice} />

      <ToggleGroup
        ref={groupRef}
        type="single"
        variant="outline"
        size="sm"
        spacing={2}
        value={choice}
        onValueChange={(value) => {
          setChoice(value as AiReviewActionKind | "");
          setNoteError(null);
        }}
        aria-label={`Decision on finding ${findingId}`}
        className="flex-wrap"
        disabled={pending}
      >
        {AI_REVIEW_ACTIONS.map((action) => {
          const Icon = DECISION_ICON[action];
          return (
            <ToggleGroupItem
              key={action}
              value={action}
              className={cn(
                "rounded-full px-3.5 font-semibold touch:px-4",
                "data-[state=on]:border-brand-500 data-[state=on]:bg-brand-50 data-[state=on]:text-brand-700",
              )}
            >
              <Icon aria-hidden />
              {DECISION_VERB[action]}
            </ToggleGroupItem>
          );
        })}
      </ToggleGroup>

      {choice && (
        <Field data-invalid={noteError ? true : undefined} className="gap-1.5">
          <FieldLabel htmlFor={`${id}-note`}>
            {noteRequired ? "Why do you disagree?" : "Note (optional)"}
          </FieldLabel>
          <Textarea
            ref={noteRef}
            id={`${id}-note`}
            name="note"
            rows={2}
            maxLength={2000}
            value={note}
            onChange={(event) => {
              setNote(event.target.value);
              if (noteError) setNoteError(null);
            }}
            aria-required={noteRequired || undefined}
            aria-invalid={noteError ? true : undefined}
            aria-describedby={noteError ? `${id}-note-error` : undefined}
            className="min-h-16"
            disabled={pending}
          />
          {noteError && <FieldError id={`${id}-note-error`}>{noteError}</FieldError>}
        </Field>
      )}

      {formError && (
        <p role="alert" className="text-sm text-fail">
          {formError}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" size="sm" disabled={!choice || pending}>
          {pending ? <Spinner aria-hidden /> : <CheckIcon aria-hidden />}
          {pending ? "Saving" : "Save decision"}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={pending}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}
