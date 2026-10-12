"use client";

// Steri-AI Cost's Price List card: what each Claude model costs per million
// tokens (USD, as Anthropic lists them), the price every new call is
// recorded with. The server renders the list as it stands (price-table.tsx);
// Edit Prices swaps it in place for a form of every price, the day the list
// was checked and an optional MYR rate. The form is read with the price
// list's own schema first (price-form.ts), then saved by an admin-only
// Server Action that checks it again. A change prices new calls only:
// recorded calls keep their cost.
import { PencilIcon, PlusIcon, RotateCcwIcon, SaveIcon } from "lucide-react";
import {
  startTransition,
  useEffect,
  useId,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
  type Ref,
} from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Spinner } from "@/components/ui/spinner";
import type { AiPriceList } from "@/lib/schemas/ai-prices";
import { CLAUDE_MODELS } from "@/lib/schemas/ai-settings";
import { cn } from "@/lib/utils";
import { saveAiPricesAction } from "../actions";
import { ResultAlert, UNREACHABLE } from "./alerts";
import {
  addModel,
  longPromptLabel,
  MAX_MODELS,
  parseDraft,
  RATE_KEYS,
  RATE_LABEL,
  removeModel,
  setModelId,
  setRate,
  toDraft,
  withDefaultPrices,
  type DraftErrors,
  type ModelDraft,
  type PriceDraft,
  type RateKey,
} from "./price-form";

type Outcome = { ok: boolean; message: string };

/** The model column and the five prices, as the read-only table lines them up from 1024 px. */
const GRID = "lg:grid-cols-[minmax(16rem,2fr)_repeat(5,minmax(0,1fr))]";

function TextField({
  id,
  label,
  error,
  className,
  labelClassName,
  inputRef,
  ...input
}: {
  id: string;
  label: string;
  error?: string;
  className?: string;
  labelClassName?: string;
  inputRef?: Ref<HTMLInputElement>;
} & Omit<ComponentProps<typeof Input>, "id" | "ref">) {
  return (
    <div className={cn("relative flex min-w-0 flex-col gap-1.5", className)}>
      <Label htmlFor={id} className={labelClassName}>
        {label}
      </Label>
      <Input
        id={id}
        ref={inputRef}
        autoComplete="off"
        spellCheck={false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        {...input}
      />
      {error && (
        <p id={`${id}-error`} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function ModelFields({
  entry,
  index,
  idBase,
  errors,
  disabled,
  firstRef,
  onChange,
}: {
  entry: ModelDraft;
  index: number;
  idBase: string;
  errors: DraftErrors;
  disabled: boolean;
  /** The form's first field, focused when the form opens. */
  firstRef?: Ref<HTMLInputElement>;
  onChange: (change: (draft: PriceDraft) => PriceDraft) => void;
}) {
  const base = `${idBase}-${entry.key}`;
  const label = CLAUDE_MODELS.find((model) => model.id === entry.model)?.label;
  const name = entry.own ? (label ?? entry.model) : entry.model.trim() || "New Model";
  const modelError = errors[`models.${index}.model`];

  function rateFields(longPrompt: boolean) {
    return RATE_KEYS.map((rate: RateKey, position) => {
      const path = longPrompt ? `models.${index}.longPrompt.${rate}` : `models.${index}.${rate}`;
      const rates = longPrompt ? entry.longPrompt?.rates : entry.rates;
      return (
        <TextField
          key={rate}
          id={`${base}${longPrompt ? "-long" : ""}-${rate}`}
          label={RATE_LABEL[rate]}
          // Each column has its heading from 1024 px.
          labelClassName="lg:sr-only"
          inputMode="decimal"
          value={rates?.[rate] ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange((draft) => setRate(draft, entry.key, rate, value, longPrompt));
          }}
          error={errors[path]}
          disabled={disabled}
          inputRef={!longPrompt && position === 0 ? firstRef : undefined}
          className="tabular-nums"
        />
      );
    });
  }

  return (
    <div
      role="group"
      aria-labelledby={`${base}-name`}
      className="flex flex-col gap-3 rounded-lg border border-border p-3 lg:rounded-none lg:border-0 lg:border-b lg:px-0"
    >
      <div className={cn("grid grid-cols-2 gap-3 lg:items-start", GRID)}>
        <div className="relative col-span-2 flex min-w-0 lg:col-span-1">
          {entry.own ? (
            <p id={`${base}-name`} className="font-medium lg:flex lg:min-h-9 lg:items-center lg:touch:min-h-11">
              {name}
            </p>
          ) : (
            <>
              <span id={`${base}-name`} className="sr-only">
                {name}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                <Label htmlFor={`${base}-model`} className="lg:sr-only">
                  Model ID
                </Label>
                <div className="flex gap-2">
                  <Input
                    id={`${base}-model`}
                    placeholder="claude-…"
                    autoComplete="off"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={entry.model}
                    onChange={(event) => {
                      const value = event.target.value;
                      onChange((draft) => setModelId(draft, entry.key, value));
                    }}
                    aria-invalid={modelError ? true : undefined}
                    aria-describedby={modelError ? `${base}-model-error` : undefined}
                    disabled={disabled}
                    className="font-mono"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={`Remove ${name}`}
                    onClick={() => onChange((draft) => removeModel(draft, entry.key))}
                    disabled={disabled}
                  >
                    Remove
                  </Button>
                </div>
                {modelError && (
                  <p id={`${base}-model-error`} className="text-sm text-destructive">
                    {modelError}
                  </p>
                )}
              </div>
            </>
          )}
        </div>
        {rateFields(false)}
      </div>
      {entry.longPrompt && (
        <div role="group" aria-labelledby={`${base}-long`} className={cn("grid grid-cols-2 gap-3 lg:items-start", GRID)}>
          <p
            id={`${base}-long`}
            className="col-span-2 text-sm font-medium text-muted-foreground lg:col-span-1 lg:flex lg:min-h-9 lg:items-center lg:pl-4 lg:touch:min-h-11"
          >
            <span className="sr-only">{name}, </span>
            {longPromptLabel(entry.longPrompt.aboveTokens)}
          </p>
          {rateFields(true)}
        </div>
      )}
    </div>
  );
}

/** The form of Edit Prices; exported for its test. */
export function PriceForm({
  draft,
  errors,
  saving,
  firstRef,
  onChange,
  onCancel,
  onSubmit,
}: {
  draft: PriceDraft;
  errors: DraftErrors;
  saving: boolean;
  firstRef?: Ref<HTMLInputElement>;
  onChange: (change: (draft: PriceDraft) => PriceDraft) => void;
  onCancel: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const id = useId();
  const added = useRef(0);

  return (
    <form onSubmit={onSubmit} noValidate aria-busy={saving || undefined} className="flex flex-col gap-5" data-testid="price-form">
      <div className="flex flex-col gap-3 lg:gap-0">
        <div aria-hidden className={cn("hidden gap-3 border-b border-border pb-2 text-sm font-medium text-muted-foreground lg:grid", GRID)}>
          <span>Model</span>
          {RATE_KEYS.map((rate) => (
            <span key={rate}>{RATE_LABEL[rate]}</span>
          ))}
        </div>
        {draft.models.map((entry, index) => (
          <ModelFields
            key={entry.key}
            entry={entry}
            index={index}
            idBase={id}
            errors={errors}
            disabled={saving}
            firstRef={index === 0 ? firstRef : undefined}
            onChange={onChange}
          />
        ))}
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <TextField
          id={`${id}-checked-on`}
          label="Checked On"
          type="date"
          value={draft.checkedOn}
          onChange={(event) => {
            const value = event.target.value;
            onChange((current) => ({ ...current, checkedOn: value }));
          }}
          error={errors.checkedOn}
          disabled={saving}
        />
        <TextField
          id={`${id}-myr`}
          label="MYR per USD (Optional)"
          inputMode="decimal"
          value={draft.myrPerUsd}
          onChange={(event) => {
            const value = event.target.value;
            onChange((current) => ({ ...current, myrPerUsd: value }));
          }}
          error={errors.myrPerUsd}
          disabled={saving}
          className="tabular-nums"
        />
        <TextField
          id={`${id}-rate-on`}
          label="Rate Date"
          type="date"
          value={draft.myrRateOn}
          onChange={(event) => {
            const value = event.target.value;
            onChange((current) => ({ ...current, myrRateOn: value }));
          }}
          error={errors.myrRateOn}
          disabled={saving}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant="outline"
          disabled={saving || draft.models.length >= MAX_MODELS}
          onClick={() => {
            added.current += 1;
            const key = `added-${added.current}`;
            onChange((current) => addModel(current, key));
          }}
        >
          <PlusIcon aria-hidden />
          Add Model
        </Button>
        <Button type="button" variant="outline" disabled={saving} onClick={() => onChange(withDefaultPrices)}>
          <RotateCcwIcon aria-hidden />
          Use Default Prices
        </Button>
        <div className="ml-auto flex flex-wrap gap-2">
          <Button type="button" variant="outline" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
          <Button type="submit" disabled={saving} className="min-w-32">
            {saving ? <Spinner aria-hidden /> : <SaveIcon aria-hidden />}
            {saving ? "Saving…" : "Save Prices"}
          </Button>
        </div>
      </div>
    </form>
  );
}

export function PriceList({
  prices,
  canEdit,
  table,
  notes,
}: {
  prices: AiPriceList;
  /** The server can save settings (SUPABASE_SECRET_KEY). */
  canEdit: boolean;
  /** The list as it stands (price-table.tsx), rendered by the server. */
  table: ReactNode;
  /** When it was checked, and the MYR rate. */
  notes: ReactNode;
}) {
  const titleId = useId();
  const [draft, setDraft] = useState<PriceDraft | null>(null);
  const [errors, setErrors] = useState<DraftErrors>({});
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [saving, startSaving] = useTransition();
  // Focus follows the swap: into the form when it opens, back to Edit Prices when it closes.
  const [focusOn, setFocusOn] = useState<"form" | "edit" | null>(null);
  const firstField = useRef<HTMLInputElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (focusOn === "form") firstField.current?.focus();
    else if (focusOn === "edit") editButton.current?.focus();
  }, [focusOn]);

  function edit() {
    setDraft(toDraft(prices));
    setErrors({});
    setOutcome(null);
    setFocusOn("form");
  }

  function cancel() {
    setDraft(null);
    setErrors({});
    setOutcome(null);
    setFocusOn("edit");
  }

  function change(update: (current: PriceDraft) => PriceDraft) {
    setDraft((current) => (current ? update(current) : current));
  }

  function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!draft || saving) return;
    const result = parseDraft(draft);
    if (!result.ok) {
      setErrors(result.errors);
      setOutcome({ ok: false, message: result.message });
      return;
    }
    setErrors({});
    setOutcome(null);
    startSaving(async () => {
      let answer: Outcome;
      try {
        answer = await saveAiPricesAction(result.list);
      } catch (error) {
        console.error(error);
        answer = { ok: false, message: UNREACHABLE };
      }
      startTransition(() => {
        setOutcome(answer);
        if (answer.ok) {
          setDraft(null);
          setFocusOn("edit");
        }
      });
    });
  }

  return (
    <section
      id="price-list"
      aria-labelledby={titleId}
      data-testid="price-list"
      className="relative flex min-w-0 flex-col gap-4 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-lg leading-tight font-bold text-foreground">
          Price List
        </h2>
        <p className="text-sm text-muted-foreground">USD per million tokens, as Anthropic lists them. Changes apply to new calls.</p>
      </div>

      {draft ? (
        <PriceForm
          draft={draft}
          errors={errors}
          saving={saving}
          firstRef={firstField}
          onChange={change}
          onCancel={cancel}
          onSubmit={save}
        />
      ) : (
        <>
          {table}
          <div className="flex flex-wrap items-center justify-between gap-3">
            {notes}
            <Button ref={editButton} type="button" variant="outline" onClick={edit} disabled={!canEdit}>
              <PencilIcon aria-hidden />
              Edit Prices
            </Button>
          </div>
        </>
      )}

      {outcome && <ResultAlert ok={outcome.ok} message={outcome.message} role="status" data-testid="price-outcome" />}
    </section>
  );
}
