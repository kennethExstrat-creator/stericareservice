"use client";

// Steri-AI Settings > Inspection Settings: the Inspection Summary card
// (docs/AI.md, "Steri-AI Summary"; Kenneth, 12 October 2026). The model and
// the house style Steri-AI writes the Inspection Summary in when an
// inspector taps Steri-AI Summary on the Conclusion, for every inspector and
// client alike: essentials first, More Writing Options folded, Try It (one
// real call with the card as it stands), and its own Save
// (saveSummarySettingsAction), apart from the model form above. Steri-AI
// writes text only and never changes a result.
//
// Save runs from onSubmit, not the form's action prop: React resets a form
// after every action, and the pickers (Radix Select) would go back to empty.
// The form holds the style as it is stored (lib/schemas/summary-style.ts);
// the server trims and checks it again, and a refused field says why under
// it, by its path ("style.closingSentence").
import { ChevronDownIcon, NotebookPenIcon, PlusIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import { startTransition, useActionState, useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel, FieldLegend, FieldSet } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { SummarySettingsView } from "@/lib/ai/settings";
import type { SummaryPreviewTarget } from "@/lib/inspections/ai/summary-runner";
import type { AiPriceList } from "@/lib/schemas/ai-prices";
import {
  DEFAULT_SUMMARY_MODEL,
  DEFAULT_SUMMARY_STYLE,
  SUMMARY_DATE_FORMATS,
  SUMMARY_EMPHASIS,
  SUMMARY_FIELDS,
  SUMMARY_FORMATS,
  SUMMARY_GROUPING,
  SUMMARY_LANGUAGES,
  SUMMARY_LENGTHS,
  SUMMARY_LIMITS,
  SUMMARY_NUMBERS,
  SUMMARY_PARAGRAPHS,
  SUMMARY_PLACEHOLDERS,
  SUMMARY_POINTS_OF_VIEW,
  SUMMARY_SIZES,
  SUMMARY_TERMINOLOGY,
  SUMMARY_TONES,
  SUMMARY_VERDICT_FIELDS,
  SummaryStyleSchema,
  type SummaryLanguage,
  type SummaryStyle,
} from "@/lib/schemas/summary-style";
import { cn } from "@/lib/utils";
import { saveSummarySettingsAction, type SummarySettingsSave } from "../summary-actions";
import { ResultAlert, UNREACHABLE } from "./alerts";
import { ModelField } from "./model-field";
import { SectionCard } from "./section-card";
import { SummarySectionsField } from "./summary-sections-field";
import { SummaryTryIt } from "./summary-try-it";

/** Under the card's title: what the card is for, in one breath. */
export const SUMMARY_CARD_INTRO =
  "How Steri-AI writes the Inspection Summary when an inspector taps Steri-AI Summary on the Conclusion. It writes text only and never changes a result.";

/** The style keys inside More Writing Options: a refusal there opens it. */
const MORE_KEYS = [
  "grouping",
  "sizes",
  "mentionSuggestion",
  "pointOfView",
  "tone",
  "terminology",
  "emphasis",
  "colourResult",
  "dateFormat",
  "language",
  "languagesOffered",
  "verdictSentences",
  "closingSentence",
  "customInstruction",
  "examples",
] as const satisfies readonly (keyof SummaryStyle)[];

type FieldErrors = Readonly<Record<string, string>>;

/** The first refusal at `path` or under it ("style.examples" finds "style.examples.1"). */
export function errorAt(errors: FieldErrors, path: string): string | undefined {
  const key = Object.keys(errors).find((entry) => entry === path || entry.startsWith(`${path}.`));
  return key === undefined ? undefined : errors[key];
}

/** Which folded parts a refusal is in, so the card can open them. */
export function foldedErrors(errors: FieldErrors): { sections: boolean; more: boolean } {
  return {
    sections: errorAt(errors, "style.sections") !== undefined || errorAt(errors, "style.overview") !== undefined,
    more: MORE_KEYS.some((key) => errorAt(errors, `style.${key}`) !== undefined),
  };
}

/**
 * The card's model and style as one string, in the form the server stores
 * (trimmed, blank examples dropped), to tell saved from unsaved and a sample
 * from older settings. Null while the style would be refused.
 */
export function settingsKey(model: string, style: SummaryStyle): string | null {
  const parsed = SummaryStyleSchema.safeParse(style);
  return parsed.success ? JSON.stringify({ model: model.trim(), style: parsed.data }) : null;
}

const SAVED_DAY = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "Asia/Kuala_Lumpur" });
const SAVED_TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Asia/Kuala_Lumpur" });

/**
 * "Settings last saved 13 October 2026, 14:05 by Kenneth.": the settings row
 * every Steri-AI setting shares (only the last save is kept). Day and time
 * are formatted apart, so the server and the browser join them alike.
 */
export function lastSavedLine(updatedAt: string | null, updatedBy: string | null): string | null {
  if (updatedAt === null) return null;
  const when = new Date(updatedAt);
  if (Number.isNaN(when.getTime())) return null;
  return `Settings last saved ${SAVED_DAY.format(when)}, ${SAVED_TIME.format(when)}${updatedBy ? ` by ${updatedBy}` : ""}.`;
}

/** The languages offered with `value` ticked or not; the house language always, in SUMMARY_LANGUAGES' order. */
export function offerLanguage(style: Pick<SummaryStyle, "language" | "languagesOffered">, value: SummaryLanguage, on: boolean): SummaryLanguage[] {
  return SUMMARY_LANGUAGES.map((entry) => entry.value).filter(
    (entry) => entry === style.language || (entry === value ? on : style.languagesOffered.includes(entry)),
  );
}

/**
 * A new house language: offered from now on, and the old one leaves the
 * offer, where it was only as the house language. So changing the house
 * language alone never gives inspectors a Language menu (12 October 2026);
 * the other languages ticked stay ticked.
 */
export function switchHouseLanguage(
  style: Pick<SummaryStyle, "language" | "languagesOffered">,
  language: SummaryLanguage,
): Pick<SummaryStyle, "language" | "languagesOffered"> {
  if (language === style.language) return { language, languagesOffered: style.languagesOffered };
  return { language, languagesOffered: offerLanguage({ language, languagesOffered: style.languagesOffered }, style.language, false) };
}

type Choice<T> = { readonly value: T; readonly label: string; readonly hint: string | null };

/** More Writing Options' group titles, as the admin pages' subsection headings (h3: display face, bold). */
const LEGEND = "font-display text-base font-bold text-foreground";

export function SummarySettingsCard({
  view,
  targets,
  prices,
  myrPerUsd,
}: {
  view: SummarySettingsView;
  /** Try It's inspections (loadSummaryPreviewTargets). */
  targets: SummaryPreviewTarget[];
  /** The price list, to say when the chosen model has no price. */
  prices: AiPriceList;
  /** Steri-AI Cost's rate (lib/ai/myr-rate.ts), for what a try costs in ringgit. */
  myrPerUsd: number;
}) {
  const id = useId();
  const [model, setModel] = useState(view.model);
  const [style, setStyle] = useState<SummaryStyle>(view.style);
  // Reset to Defaults remounts the model picker, which keeps whether Other Claude Model… is open.
  const [modelPicker, setModelPicker] = useState(0);
  const [sectionsOpen, setSectionsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [outcome, saveAction, saving] = useActionState(
    async (_previous: SummarySettingsSave | null, input: { model: string; style: SummaryStyle }): Promise<SummarySettingsSave> => {
      try {
        const result = await saveSummarySettingsAction(input);
        const folded = foldedErrors(result.fieldErrors ?? {});
        if (folded.sections) setSectionsOpen(true);
        if (folded.more) setMoreOpen(true);
        return result;
      } catch (error) {
        console.error(error);
        return { ok: false, message: UNREACHABLE };
      }
    },
    null,
  );
  const canSave = view.storage === "ready";
  const disabled = !canSave;
  const errors: FieldErrors = outcome && !outcome.ok ? (outcome.fieldErrors ?? {}) : {};
  const current = useMemo(() => settingsKey(model, style), [model, style]);
  const saved = useMemo(() => settingsKey(view.model, view.style), [view.model, view.style]);
  const savedLine = lastSavedLine(view.updatedAt, view.updatedBy);

  const update = (patch: Partial<SummaryStyle>) => setStyle((previous) => ({ ...previous, ...patch }));

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || !canSave) return;
    startTransition(() => saveAction({ model, style }));
  }

  function resetToDefaults() {
    setModel(DEFAULT_SUMMARY_MODEL);
    setStyle(DEFAULT_SUMMARY_STYLE);
    setModelPicker((count) => count + 1);
  }

  return (
    <SectionCard icon={NotebookPenIcon} title="Inspection Summary" data-testid="ai-summary-settings">
      <p className="-mt-2 text-sm text-muted-foreground touch:text-base">{SUMMARY_CARD_INTRO}</p>
      <form onSubmit={save} noValidate aria-busy={saving || undefined} className="flex flex-col gap-5">
        <div className="max-w-md">
          <ModelField
            key={modelPicker}
            id={`${id}-model`}
            name="summaryModel"
            scope="Inspection Summary"
            hint={SUMMARY_FIELDS.model.hint}
            value={model}
            onChange={setModel}
            prices={prices}
            error={errorAt(errors, "model")}
            disabled={disabled}
          />
        </div>

        <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
          <ChoiceField
            id={`${id}-length`}
            label={SUMMARY_FIELDS.length.label}
            choices={SUMMARY_LENGTHS}
            value={style.length}
            onChange={(length) => update({ length })}
            hint={SUMMARY_FIELDS.length.hint}
            error={errorAt(errors, "style.length")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-paragraphs`}
            label={SUMMARY_FIELDS.paragraphs.label}
            choices={SUMMARY_PARAGRAPHS}
            value={style.paragraphs}
            onChange={(paragraphs) => update({ paragraphs })}
            hint={SUMMARY_FIELDS.paragraphs.hint}
            error={errorAt(errors, "style.paragraphs")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-format`}
            label={SUMMARY_FIELDS.format.label}
            choices={SUMMARY_FORMATS}
            value={style.format}
            onChange={(format) => update({ format })}
            error={errorAt(errors, "style.format")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-numbers`}
            label={SUMMARY_FIELDS.numbers.label}
            choices={SUMMARY_NUMBERS}
            value={style.numbers}
            onChange={(numbers) => update({ numbers })}
            error={errorAt(errors, "style.numbers")}
            disabled={disabled}
          />
        </div>

        <SummarySectionsField
          sections={style.sections}
          overview={style.overview}
          onSectionsChange={(sections) => update({ sections })}
          onOverviewChange={(overview) => update({ overview })}
          open={sectionsOpen}
          onOpenChange={setSectionsOpen}
          error={errorAt(errors, "style.sections") ?? errorAt(errors, "style.overview")}
          disabled={disabled}
        />

        <SwitchRow
          id={`${id}-adjust`}
          label={SUMMARY_FIELDS.inspectorsCanAdjust.label}
          hint={SUMMARY_FIELDS.inspectorsCanAdjust.hint}
          checked={style.inspectorsCanAdjust}
          onChange={(inspectorsCanAdjust) => update({ inspectorsCanAdjust })}
          disabled={disabled}
        />

        <div className="grid gap-5 border-t border-border pt-5">
          <button
            type="button"
            aria-expanded={moreOpen}
            aria-controls={moreOpen ? `${id}-more` : undefined}
            onClick={() => setMoreOpen((open) => !open)}
            className="-mx-2 flex min-h-11 w-fit items-center gap-2 rounded-md px-2 text-left text-base font-semibold text-foreground hover:bg-muted focus-ring-inset fine:min-h-9"
            data-testid="summary-more-toggle"
          >
            <ChevronDownIcon aria-hidden className={cn("size-4 text-slate-500 transition-transform", moreOpen && "rotate-180")} />
            More Writing Options
          </button>
          {moreOpen && (
            <MoreWritingOptions id={`${id}-more`} style={style} update={update} errors={errors} disabled={disabled} />
          )}
        </div>

        <div className="border-t border-border pt-5">
          <SummaryTryIt
            targets={targets}
            model={model}
            style={style}
            settings={current}
            saved={current !== null && current === saved}
            myrPerUsd={myrPerUsd}
            disabled={disabled}
          />
        </div>

        {outcome && <ResultAlert ok={outcome.ok} message={outcome.message} role="status" data-testid="summary-outcome" />}

        <div className="flex flex-col gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted-foreground touch:text-base" data-testid="summary-saved">
            {savedLine}
          </p>
          <div className="flex flex-wrap items-center justify-end gap-3">
            <Button type="button" variant="outline" onClick={resetToDefaults} disabled={saving || disabled}>
              <RotateCcwIcon aria-hidden />
              Reset to Defaults
            </Button>
            <Button type="submit" disabled={saving || disabled} className="min-w-32">
              {saving ? <Spinner aria-hidden /> : <SaveIcon aria-hidden />}
              {saving ? "Saving…" : "Save Summary Settings"}
            </Button>
          </div>
        </div>
      </form>
    </SectionCard>
  );
}

/** Content, Voice, Formatting and House Wording: shown only once opened (exported for its test). */
export function MoreWritingOptions({
  id,
  style,
  update,
  errors,
  disabled,
}: {
  id: string;
  style: SummaryStyle;
  update: (patch: Partial<SummaryStyle>) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  const grid = "grid gap-5 sm:grid-cols-2 lg:grid-cols-3";
  return (
    <div id={id} className="grid gap-8" data-testid="summary-more">
      <FieldSet className="gap-5">
        <FieldLegend className={LEGEND}>Content</FieldLegend>
        <div className={grid}>
          <ChoiceField
            id={`${id}-grouping`}
            label={SUMMARY_FIELDS.grouping.label}
            choices={SUMMARY_GROUPING}
            value={style.grouping}
            onChange={(grouping) => update({ grouping })}
            error={errorAt(errors, "style.grouping")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-sizes`}
            label={SUMMARY_FIELDS.sizes.label}
            choices={SUMMARY_SIZES}
            value={style.sizes}
            onChange={(sizes) => update({ sizes })}
            error={errorAt(errors, "style.sizes")}
            disabled={disabled}
          />
        </div>
        <SwitchRow
          id={`${id}-suggestion`}
          label={SUMMARY_FIELDS.mentionSuggestion.label}
          hint={SUMMARY_FIELDS.mentionSuggestion.hint}
          checked={style.mentionSuggestion}
          onChange={(mentionSuggestion) => update({ mentionSuggestion })}
          disabled={disabled}
        />
      </FieldSet>

      <FieldSet className="gap-5">
        <FieldLegend className={LEGEND}>Voice</FieldLegend>
        <div className={grid}>
          <ChoiceField
            id={`${id}-voice`}
            label={SUMMARY_FIELDS.pointOfView.label}
            choices={SUMMARY_POINTS_OF_VIEW}
            value={style.pointOfView}
            onChange={(pointOfView) => update({ pointOfView })}
            error={errorAt(errors, "style.pointOfView")}
            disabled={disabled}
            quoteHint
          />
          <ChoiceField
            id={`${id}-tone`}
            label={SUMMARY_FIELDS.tone.label}
            choices={SUMMARY_TONES}
            value={style.tone}
            onChange={(tone) => update({ tone })}
            error={errorAt(errors, "style.tone")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-terminology`}
            label={SUMMARY_FIELDS.terminology.label}
            choices={SUMMARY_TERMINOLOGY}
            value={style.terminology}
            onChange={(terminology) => update({ terminology })}
            error={errorAt(errors, "style.terminology")}
            disabled={disabled}
          />
        </div>
      </FieldSet>

      <FieldSet className="gap-5">
        <FieldLegend className={LEGEND}>Formatting</FieldLegend>
        <div className={grid}>
          <ChoiceField
            id={`${id}-bold`}
            label={SUMMARY_FIELDS.emphasis.label}
            choices={SUMMARY_EMPHASIS}
            value={style.emphasis}
            onChange={(emphasis) => update({ emphasis })}
            error={errorAt(errors, "style.emphasis")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-dates`}
            label={SUMMARY_FIELDS.dateFormat.label}
            choices={SUMMARY_DATE_FORMATS}
            value={style.dateFormat}
            onChange={(dateFormat) => update({ dateFormat })}
            error={errorAt(errors, "style.dateFormat")}
            disabled={disabled}
          />
          <ChoiceField
            id={`${id}-language`}
            label={SUMMARY_FIELDS.language.label}
            choices={SUMMARY_LANGUAGES}
            value={style.language}
            onChange={(language) => update(switchHouseLanguage(style, language))}
            error={errorAt(errors, "style.language")}
            disabled={disabled}
          />
        </div>
        <SwitchRow
          id={`${id}-colour`}
          label={SUMMARY_FIELDS.colourResult.label}
          hint={SUMMARY_FIELDS.colourResult.hint}
          checked={style.colourResult}
          onChange={(colourResult) => update({ colourResult })}
          disabled={disabled}
        />
        <div role="group" aria-labelledby={`${id}-offered`} aria-describedby={`${id}-offered-hint`} className="grid gap-3">
          <span id={`${id}-offered`} className="text-sm leading-snug font-medium text-foreground">
            {SUMMARY_FIELDS.languagesOffered.label}
          </span>
          <div className="flex flex-wrap gap-x-6 gap-y-3">
            {SUMMARY_LANGUAGES.map((language) => {
              const house = language.value === style.language;
              return (
                <div key={language.value} className="flex items-center gap-3">
                  <Checkbox
                    id={`${id}-offered-${language.value}`}
                    checked={house || style.languagesOffered.includes(language.value)}
                    onCheckedChange={(checked) => update({ languagesOffered: offerLanguage(style, language.value, checked === true) })}
                    disabled={disabled || house}
                  />
                  <Label htmlFor={`${id}-offered-${language.value}`} className="leading-snug font-normal touch:text-base">
                    {language.label}
                  </Label>
                </div>
              );
            })}
          </div>
          {errorAt(errors, "style.languagesOffered") ? (
            <FieldError>{errorAt(errors, "style.languagesOffered")}</FieldError>
          ) : (
            <p id={`${id}-offered-hint`} className="text-sm text-muted-foreground touch:text-base">
              {SUMMARY_FIELDS.languagesOffered.hint}
            </p>
          )}
        </div>
      </FieldSet>

      <FieldSet className="gap-5">
        <FieldLegend className={LEGEND}>House Wording</FieldLegend>
        <fieldset className="grid gap-3" aria-describedby={`${id}-verdict-hint`}>
          <legend className="sr-only">{SUMMARY_FIELDS.verdictSentences.label}</legend>
          <div className="grid gap-5 lg:grid-cols-3">
            {SUMMARY_VERDICT_FIELDS.map((field) => (
              <TextField
                key={field.key}
                id={`${id}-verdict-${field.key}`}
                label={field.label}
                value={style.verdictSentences[field.key]}
                onChange={(text) => update({ verdictSentences: { ...style.verdictSentences, [field.key]: text } })}
                max={SUMMARY_LIMITS.sentence}
                describedBy={`${id}-verdict-hint`}
                error={errorAt(errors, `style.verdictSentences.${field.key}`)}
                disabled={disabled}
              />
            ))}
          </div>
          <p id={`${id}-verdict-hint`} className="text-sm text-muted-foreground touch:text-base">
            {SUMMARY_FIELDS.verdictSentences.hint}
          </p>
        </fieldset>
        <div className="grid max-w-3xl gap-5">
          <TextField
            id={`${id}-closing`}
            label={SUMMARY_FIELDS.closingSentence.label}
            hint={SUMMARY_FIELDS.closingSentence.hint}
            placeholder={SUMMARY_PLACEHOLDERS.closingSentence}
            value={style.closingSentence}
            onChange={(closingSentence) => update({ closingSentence })}
            max={SUMMARY_LIMITS.sentence}
            error={errorAt(errors, "style.closingSentence")}
            disabled={disabled}
          />
          <TextAreaField
            id={`${id}-instruction`}
            label={SUMMARY_FIELDS.customInstruction.label}
            placeholder={SUMMARY_PLACEHOLDERS.customInstruction}
            value={style.customInstruction}
            onChange={(customInstruction) => update({ customInstruction })}
            max={SUMMARY_LIMITS.instruction}
            rows={2}
            error={errorAt(errors, "style.customInstruction")}
            disabled={disabled}
          />
          <ExampleSummaries id={`${id}-examples`} examples={style.examples} onChange={(examples) => update({ examples })} errors={errors} disabled={disabled} />
        </div>
      </FieldSet>
    </div>
  );
}

/**
 * Up to two example summaries, each with Remove; Add Example while there is
 * room. The focus follows: into the example just added, and to Add Example
 * after a Remove (the button pressed is gone either way).
 */
function ExampleSummaries({
  id,
  examples,
  onChange,
  errors,
  disabled,
}: {
  id: string;
  examples: string[];
  onChange: (examples: string[]) => void;
  errors: FieldErrors;
  disabled: boolean;
}) {
  // "style.examples" alone: too many.
  const listError = errors["style.examples"];
  const addButton = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<"add" | number | null>(null);
  useEffect(() => {
    const target = focusNext.current;
    if (target === null) return;
    focusNext.current = null;
    if (target === "add") addButton.current?.focus();
    else document.getElementById(`${id}-${target}`)?.focus();
  });
  return (
    <div role="group" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`} className="grid gap-3" data-testid="summary-examples">
      <span id={`${id}-label`} className="text-sm leading-snug font-medium text-foreground">
        {SUMMARY_FIELDS.examples.label}
      </span>
      <p id={`${id}-hint`} className="-mt-1 text-sm text-muted-foreground touch:text-base">
        {SUMMARY_FIELDS.examples.hint}
      </p>
      {examples.map((example, index) => (
        <TextAreaField
          key={index}
          id={`${id}-${index}`}
          label={`Example ${index + 1}`}
          value={example}
          onChange={(text) => onChange(examples.map((entry, at) => (at === index ? text : entry)))}
          max={SUMMARY_LIMITS.example}
          rows={5}
          error={errorAt(errors, `style.examples.${index}`)}
          disabled={disabled}
          action={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => {
                focusNext.current = "add";
                onChange(examples.filter((_, at) => at !== index));
              }}
              disabled={disabled}
              className="relative"
            >
              Remove<span className="sr-only"> Example {index + 1}</span>
            </Button>
          }
        />
      ))}
      {listError && <FieldError>{listError}</FieldError>}
      {examples.length < SUMMARY_LIMITS.examples && (
        <Button
          ref={addButton}
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            focusNext.current = examples.length;
            onChange([...examples, ""]);
          }}
          disabled={disabled}
          className="w-fit"
        >
          <PlusIcon aria-hidden />
          Add Example
        </Button>
      )}
    </div>
  );
}

/**
 * A picker of fixed choices. The chosen option's own line (a format's,
 * a point of view's example sentence) shows under it, then the field's.
 * The words are given to the trigger too, so they show before the browser
 * has the picker's items (server render).
 */
function ChoiceField<T extends string | number>({
  id,
  label,
  choices,
  value,
  onChange,
  hint,
  error,
  disabled,
  quoteHint = false,
}: {
  id: string;
  label: string;
  choices: readonly Choice<T>[];
  value: T;
  onChange: (value: T) => void;
  hint?: string | null;
  error?: string;
  disabled?: boolean;
  /** The option's line is an example sentence: shown in quotes. */
  quoteHint?: boolean;
}) {
  const chosen = choices.find((choice) => choice.value === value);
  const ownHint = chosen?.hint ? (quoteHint ? `“${chosen.hint}”` : chosen.hint) : null;
  const line = [ownHint, hint].filter(Boolean).join(" ");
  const describedBy = error ? `${id}-error` : line ? `${id}-hint` : undefined;
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Select
        value={String(value)}
        onValueChange={(next) => {
          const choice = choices.find((entry) => String(entry.value) === next);
          if (choice) onChange(choice.value);
        }}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-invalid={error ? true : undefined} aria-describedby={describedBy}>
          <SelectValue>{chosen?.label ?? String(value)}</SelectValue>
        </SelectTrigger>
        <SelectContent>
          {choices.map((choice) => (
            <SelectItem key={String(choice.value)} value={String(choice.value)}>
              {choice.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : line ? (
        <FieldDescription id={`${id}-hint`} className="touch:text-base">
          {line}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/** A switch with its label and line, the switch first (as the template editor's). */
function SwitchRow({
  id,
  label,
  hint,
  checked,
  onChange,
  disabled,
}: {
  id: string;
  label: string;
  hint: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-start gap-3">
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} aria-describedby={`${id}-hint`} className="mt-0.5 touch:mt-0" />
      <div className="grid min-w-0 flex-1 gap-1">
        <Label htmlFor={id} className="min-h-5 leading-snug touch:min-h-7 touch:text-base">
          {label}
        </Label>
        <p id={`${id}-hint`} className="text-sm text-muted-foreground touch:text-base">
          {hint}
        </p>
      </div>
    </div>
  );
}

/** A sentence typed word for word (house wording): one line, at most `max` characters. */
function TextField({
  id,
  label,
  hint,
  placeholder,
  value,
  onChange,
  max,
  describedBy,
  error,
  disabled,
}: {
  id: string;
  label: string;
  hint?: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  /** A line shared with other fields (the verdict sentences' hint), in place of its own. */
  describedBy?: string;
  error?: string;
  disabled?: boolean;
}) {
  return (
    <Field data-invalid={error ? true : undefined}>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <Input
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        maxLength={max}
        placeholder={placeholder}
        autoComplete="off"
        disabled={disabled}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : hint ? `${id}-hint` : describedBy}
      />
      {error ? (
        <FieldError id={`${id}-error`}>{error}</FieldError>
      ) : hint ? (
        <FieldDescription id={`${id}-hint`} className="touch:text-base">
          {hint}
        </FieldDescription>
      ) : null}
    </Field>
  );
}

/**
 * Longer text (the instruction, an example). No maxLength, which would cut
 * a pasted example short without a word: a count shows how much is used and
 * turns red past the limit, and the save says what to shorten.
 */
function TextAreaField({
  id,
  label,
  placeholder,
  value,
  onChange,
  max,
  rows,
  error,
  disabled,
  action,
}: {
  id: string;
  label: string;
  placeholder?: string;
  value: string;
  onChange: (value: string) => void;
  max: number;
  rows: number;
  error?: string;
  disabled?: boolean;
  /** A button at the label's end (an example's Remove). */
  action?: ReactNode;
}) {
  const over = value.trim().length > max;
  return (
    <Field data-invalid={error || over ? true : undefined}>
      {action ? (
        <div className="flex min-h-8 items-center justify-between gap-3 touch:min-h-11">
          <FieldLabel htmlFor={id}>{label}</FieldLabel>
          {action}
        </div>
      ) : (
        <FieldLabel htmlFor={id}>{label}</FieldLabel>
      )}
      <Textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        rows={rows}
        disabled={disabled}
        aria-invalid={error || over ? true : undefined}
        aria-describedby={`${id}-count${error ? ` ${id}-error` : ""}`}
        className="max-h-96"
      />
      <div className="-mt-1 flex items-start justify-between gap-3">
        {error ? <FieldError id={`${id}-error`}>{error}</FieldError> : <span />}
        <p id={`${id}-count`} className={cn("shrink-0 text-xs tabular-nums touch:text-sm", over ? "text-destructive" : "text-muted-foreground")}>
          {value.trim().length.toLocaleString("en-GB")} / {max.toLocaleString("en-GB")}
        </p>
      </div>
    </Field>
  );
}
