"use client";

// Try It on the Inspection Summary card (docs/AI.md, "Steri-AI Summary";
// Kenneth, 12 October 2026: kept, one real call per click): a sample summary
// of a recent inspection, written with the card's settings as they stand,
// saved or not (previewSummaryAction). Nothing is written to the inspection,
// so no audit row; the call counts in Steri-AI Cost as an Inspection Summary,
// in the admin's name. The sample shows what the inspector would see: the
// draft as the field shows it read-only, its length, Steri-AI's notes and the
// figures it could not find in the inspection.
import { SparklesIcon, TriangleAlertIcon } from "lucide-react";
import { useId, useState, useTransition } from "react";
// The button's own spacing, so the sample reads as the field will (no React, no app code).
import { spacedDraft } from "@/components/ai/steri-ai-summary-state";
// By its path: the components/qc index would bring every capture primitive along.
import { RichTextView } from "@/components/qc/rich-text-view";
import { Button } from "@/components/ui/button";
import { FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { SummaryPreviewTarget } from "@/lib/inspections/ai/summary-runner";
import { CLAUDE_MODELS } from "@/lib/schemas/ai-settings";
import type { SummaryLanguage, SummaryPreviewResult, SummaryStyle } from "@/lib/schemas/summary-style";
import { previewSummaryAction } from "../summary-actions";
import { ResultAlert, UNREACHABLE } from "./alerts";

/** What a try costs, said before the click (the prompt lab's first drafts cost 0.017 to 0.042 USD). */
export const TRY_IT_COST = "Each try is one Steri-AI call, about 0.02 to 0.05 USD, counted in Steri-AI Cost.";

/** No key yet: the admin is on the page that takes one, so say where rather than "ask an admin". */
const NOT_CONNECTED = "Steri-AI is not connected yet. Add the Anthropic API key under General, then try again.";

/** A model's name on screen: its label when the app lists it, else its id. */
export function modelName(model: string): string {
  return CLAUDE_MODELS.find((entry) => entry.id === model)?.label ?? model;
}

/** Which settings the sample was written with, against the card as it stands now. */
export function sampleSettingsLine({ sameAsTried, saved }: { sameAsTried: boolean; saved: boolean }): string {
  if (!sameAsTried) return "Written with earlier settings: try again to see the change.";
  return saved ? "Written with the settings above." : "Written with the settings above, not saved yet.";
}

type Sample = {
  result: SummaryPreviewResult;
  refNo: string;
  /** The card's settings when the try was made (settingsKey in the card), to say when they have changed since. */
  settings: string | null;
  /** Chinese is counted in characters. */
  language: SummaryLanguage;
};

export function SummaryTryIt({
  targets,
  model,
  style,
  settings,
  saved,
  disabled,
}: {
  /** The admin's 10 most recently updated inspections with a conclusion (loadSummaryPreviewTargets). */
  targets: SummaryPreviewTarget[];
  model: string;
  style: SummaryStyle;
  /** The card's settings as one string, null while something on it cannot be read (settingsKey). */
  settings: string | null;
  /** The card's settings are the saved ones. */
  saved: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const [targetId, setTargetId] = useState(targets[0]?.id ?? "");
  const [sample, setSample] = useState<Sample | null>(null);
  const [trying, startTrying] = useTransition();
  // The most recent one until another is chosen, also when a save brings a new list without the one chosen.
  const target = targets.find((entry) => entry.id === targetId) ?? targets[0] ?? null;
  const none = targets.length === 0;

  function tryIt() {
    if (!target || trying) return;
    const tried = { refNo: target.refNo, settings, language: style.language };
    startTrying(async () => {
      let result: SummaryPreviewResult;
      try {
        result = await previewSummaryAction({ inspectionId: target.id, model: model.trim(), style });
      } catch (error) {
        console.error(error);
        result = { ok: false, reason: "error", message: UNREACHABLE };
      }
      setSample({ ...tried, result });
    });
  }

  return (
    <div className="grid gap-4" data-testid="summary-try-it">
      <div className="grid gap-3">
        <FieldLabel htmlFor={`${id}-target`}>Try It On</FieldLabel>
        <div className="flex flex-wrap items-center gap-3">
          <Select value={target?.id ?? ""} onValueChange={setTargetId} disabled={disabled || none || trying}>
            <SelectTrigger id={`${id}-target`} className="w-full min-w-0 sm:w-96" aria-describedby={`${id}-hint`}>
              <SelectValue placeholder="No inspection with a conclusion yet">{target?.label}</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {targets.map((entry) => (
                <SelectItem key={entry.id} value={entry.id}>
                  {entry.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {/* Greyed but focusable while it writes (aria-disabled), so the focus stays on it. */}
          <Button
            type="button"
            variant="outline"
            onClick={tryIt}
            disabled={disabled || !target}
            aria-disabled={trying || undefined}
            aria-busy={trying || undefined}
            className="aria-disabled:cursor-progress aria-disabled:hover:border-input aria-disabled:hover:bg-card aria-disabled:hover:text-foreground"
          >
            {trying ? <Spinner aria-hidden /> : <SparklesIcon aria-hidden className="text-brand-600" />}
            {trying ? "Writing…" : "Try It"}
          </Button>
        </div>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground touch:text-base">
          {none ? "Try It needs an inspection with a conclusion: there is none yet." : TRY_IT_COST}
        </p>
      </div>
      {sample && (
        <SummarySample
          result={sample.result}
          refNo={sample.refNo}
          unit={sample.language === "zh-Hans" ? "characters" : "words"}
          settingsLine={sampleSettingsLine({ sameAsTried: sample.settings !== null && sample.settings === settings, saved })}
        />
      )}
      <p role="status" aria-live="polite" className="sr-only">
        {trying ? "Steri-AI is writing a sample summary." : sample?.result.ok ? "Steri-AI wrote the sample summary." : ""}
      </p>
    </div>
  );
}

/** A try's answer: the sample as the field shows it read-only, or why there is none. */
export function SummarySample({
  result,
  refNo,
  unit,
  settingsLine,
}: {
  result: SummaryPreviewResult;
  refNo: string;
  unit: "words" | "characters";
  settingsLine: string;
}) {
  const id = useId();
  if (!result.ok) {
    const message = result.reason === "not_connected" ? NOT_CONNECTED : result.message;
    return <ResultAlert ok={false} message={message} role="status" data-testid="summary-sample-error" />;
  }
  return (
    <section aria-labelledby={`${id}-title`} className="grid max-w-4xl gap-3" data-testid="summary-sample">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 id={`${id}-title`} className="text-base font-bold text-foreground">
          Sample Summary
        </h3>
        <p className="text-sm text-muted-foreground tabular-nums touch:text-base">
          {refNo} · {result.words.toLocaleString("en-GB")} {result.words === 1 ? unit.slice(0, -1) : unit} · {modelName(result.model)}
        </p>
      </div>
      {/* The field's read-only box (RichTextEditor read-only), without its writing area's height; the
          draft spaced as the button puts it in (a blank line between its blocks). */}
      <div className="rounded-md border border-input bg-muted px-4 py-3 touch:px-5 touch:py-4">
        <RichTextView doc={spacedDraft(result.doc)} className="text-base text-foreground [overflow-wrap:anywhere]" />
      </div>
      {result.notes.length > 0 && (
        <div className="grid gap-1 text-sm text-foreground touch:text-base">
          <p className="font-medium">Before you sign:</p>
          <ul className="list-disc space-y-0.5 pl-5">
            {result.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </div>
      )}
      {result.figures.length > 0 && (
        <p className="flex gap-2 text-sm text-warn touch:text-base">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0 touch:mt-1" />
          <span>
            Check these figures before you sign: {result.figures.join(", ")}. Steri-AI did not find them in the inspection.
          </span>
        </p>
      )}
      <p className="text-sm text-muted-foreground touch:text-base">{settingsLine}</p>
    </section>
  );
}
