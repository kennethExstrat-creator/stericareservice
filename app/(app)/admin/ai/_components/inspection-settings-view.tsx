"use client";

// Steri-AI Settings, Inspection Settings: the Claude model for each job
// Steri-AI does on an inspection, and the second opinion's effort and photos,
// the two settings that most change what a review costs. The form sends no
// API key, so saving keeps the key in use. Save runs from onSubmit, not the
// form's action prop: React resets a form after every action, and the
// pickers (Radix Select) would go back to empty. Under the form, the
// Inspection Summary card (summary-settings-card.tsx, 12 October 2026) with
// its own form and Save.
import { BookAIcon, InfoIcon, SaveIcon, ScanTextIcon, SparklesIcon } from "lucide-react";
import Link from "next/link";
import { startTransition, useActionState, useId, useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { SummarySettingsView } from "@/lib/ai/settings";
import type { SummaryPreviewTarget } from "@/lib/inspections/ai/summary-runner";
import type { AiPriceList } from "@/lib/schemas/ai-prices";
import {
  MAX_REVIEW_PHOTOS,
  REVIEW_EFFORT_OPTIONS,
  SERVER_REVIEW_EFFORT,
  type AiSettingsView,
  type ReviewProvider,
} from "@/lib/schemas/ai-settings";
import { saveInspectionSettingsAction, type InspectionSettingsState } from "../actions";
import { ResultAlert, StorageAlert, UNREACHABLE } from "./alerts";
import { ModelField } from "./model-field";
import { SectionCard } from "./section-card";
import { SummarySettingsCard } from "./summary-settings-card";

/** SHORTFORMS_PATH in lib/admin/defects.ts (server code, so not imported here): what inspectors write on paper. */
const SHORTFORMS_PATH = "/admin/defects/shortforms";

const IDLE: InspectionSettingsState = { status: "idle" };

/** Why the second opinion's settings are not used: AI_REVIEW_PROVIDER sends reviews elsewhere. Null when they are. */
function providerNote(provider: ReviewProvider): string | null {
  switch (provider) {
    case "webhook":
      return "Second opinions come from the review webhook (a server setting), so these are not used.";
    case "mock":
      return "Second opinions come from the mock reviewer (a server setting), so these are not used.";
    case "off":
      return "Second opinions are switched off on the server.";
    default:
      return null;
  }
}

/** The effort picker's value: a saved effort, or the server's xhigh or max (kept, never saved over). */
function effortValue(effort: AiSettingsView["reviewEffort"]): string {
  return effort === "xhigh" || effort === "max" ? SERVER_REVIEW_EFFORT : effort;
}

export function InspectionSettingsView({
  view,
  prices,
  summary,
  targets,
}: {
  view: AiSettingsView;
  prices: AiPriceList;
  /** The Inspection Summary card's settings (readSummarySettingsView). */
  summary: SummarySettingsView;
  /** The inspections Try It can run on (loadSummaryPreviewTargets). */
  targets: SummaryPreviewTarget[];
}) {
  const id = useId();
  const [documentModel, setDocumentModel] = useState(view.documentModel);
  const [reviewModel, setReviewModel] = useState(view.reviewModel);
  const [reviewEffort, setReviewEffort] = useState(effortValue(view.reviewEffort));
  const [reviewMaxPhotos, setReviewMaxPhotos] = useState(String(view.reviewMaxPhotos));
  const [state, formAction, saving] = useActionState(async (previous: InspectionSettingsState, formData: FormData) => {
    try {
      return await saveInspectionSettingsAction(previous, formData);
    } catch (error) {
      console.error(error);
      return { status: "error", message: UNREACHABLE } satisfies InspectionSettingsState;
    }
  }, IDLE);
  const canSave = view.storage === "ready";
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const note = providerNote(view.reviewProvider);
  // AI_REVIEW_EFFORT's xhigh or max, listed so the screen tells the truth.
  const serverEffort = view.reviewEffort === "xhigh" ? "Extra High (Server Setting)" : view.reviewEffort === "max" ? "Max (Server Setting)" : null;

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const formData = new FormData(event.currentTarget);
    startTransition(() => formAction(formData));
  }

  return (
    <div className="flex flex-col gap-6" data-testid="ai-inspection-settings">
      {/* One notice for both forms: they save to the same settings row. */}
      <StorageAlert storage={view.storage === "ready" ? summary.storage : view.storage} />
      <form onSubmit={save} noValidate aria-busy={saving || undefined} className="flex flex-col gap-6">
        <div className="grid gap-6 lg:grid-cols-2">
          <SectionCard icon={ScanTextIcon} title="Reading Documents">
            <ModelField
              id={`${id}-document-model`}
              name="documentModel"
              scope="Reading Documents"
              hint="For New Inspection, Source Documents and Auto-Sort."
              value={documentModel}
              onChange={setDocumentModel}
              prices={prices}
              error={errors.documentModel}
              disabled={!canSave}
            />
            <p className="mt-auto flex items-center gap-2 text-sm text-muted-foreground touch:text-base">
              <BookAIcon aria-hidden className="size-4 shrink-0" />
              <span>
                Shortforms moved to{" "}
                <Link
                  href={SHORTFORMS_PATH}
                  className="rounded-sm font-medium text-brand-600 underline-offset-4 hover:underline focus-ring touch:inline-flex touch:min-h-11 touch:items-center"
                >
                  {"Defects > Shortforms"}
                </Link>
                .
              </span>
            </p>
          </SectionCard>

          <SectionCard icon={SparklesIcon} title="Second Opinion">
            {note && (
              <p className="-mt-2 flex gap-2 text-sm text-muted-foreground touch:text-base" data-testid="ai-review-provider">
                <InfoIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
                {note}
              </p>
            )}
            <ModelField
              id={`${id}-review-model`}
              name="reviewModel"
              scope="Second Opinion"
              hint="For Steri-AI's review of an inspection."
              value={reviewModel}
              onChange={setReviewModel}
              prices={prices}
              error={errors.reviewModel}
              disabled={!canSave}
            />
            <div className="grid gap-5 sm:grid-cols-2">
              <Field data-invalid={errors.reviewEffort ? true : undefined}>
                <FieldLabel htmlFor={`${id}-effort`}>Effort</FieldLabel>
                <Select value={reviewEffort} onValueChange={setReviewEffort} disabled={!canSave}>
                  <SelectTrigger
                    id={`${id}-effort`}
                    className="w-full"
                    aria-invalid={errors.reviewEffort ? true : undefined}
                    aria-describedby={`${id}-effort-${errors.reviewEffort ? "error" : "hint"}`}
                  >
                    <SelectValue>{REVIEW_EFFORT_OPTIONS.find((option) => option.value === reviewEffort)?.label ?? serverEffort}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {REVIEW_EFFORT_OPTIONS.map((option) => (
                      <SelectItem key={option.value} value={option.value}>
                        {option.label}
                      </SelectItem>
                    ))}
                    {serverEffort && <SelectItem value={SERVER_REVIEW_EFFORT}>{serverEffort}</SelectItem>}
                  </SelectContent>
                </Select>
                <input type="hidden" name="reviewEffort" value={reviewEffort} />
                {errors.reviewEffort ? (
                  <FieldError id={`${id}-effort-error`}>{errors.reviewEffort}</FieldError>
                ) : (
                  <FieldDescription id={`${id}-effort-hint`} className="touch:text-base">
                    Higher effort thinks longer and costs more.
                  </FieldDescription>
                )}
              </Field>
              <Field data-invalid={errors.reviewMaxPhotos ? true : undefined}>
                <FieldLabel htmlFor={`${id}-photos`}>Photos per Review</FieldLabel>
                <Input
                  id={`${id}-photos`}
                  name="reviewMaxPhotos"
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={MAX_REVIEW_PHOTOS}
                  step={1}
                  value={reviewMaxPhotos}
                  onChange={(event) => setReviewMaxPhotos(event.target.value)}
                  disabled={!canSave}
                  className="tabular-nums"
                  aria-invalid={errors.reviewMaxPhotos ? true : undefined}
                  aria-describedby={`${id}-photos-${errors.reviewMaxPhotos ? "error" : "hint"}`}
                />
                {errors.reviewMaxPhotos ? (
                  <FieldError id={`${id}-photos-error`}>{errors.reviewMaxPhotos}</FieldError>
                ) : (
                  <FieldDescription id={`${id}-photos-hint`} className="touch:text-base">
                    Each photo adds to the cost.
                  </FieldDescription>
                )}
              </Field>
            </div>
          </SectionCard>
        </div>

        {state.status !== "idle" && (
          <ResultAlert ok={state.status === "saved"} message={state.message} role="status" data-testid="ai-inspection-outcome" />
        )}
        <div className="flex justify-end">
          <Button type="submit" disabled={saving || !canSave} className="min-w-32">
            {saving ? <Spinner aria-hidden /> : <SaveIcon aria-hidden />}
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </form>
      <SummarySettingsCard view={summary} targets={targets} prices={prices} />
    </div>
  );
}
