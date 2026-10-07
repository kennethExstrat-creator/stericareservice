"use client";

// The leaf controls of a generated form. Each one shows what is stored and
// hands back a whole new value. A number field stores what is typed even when
// it is not a number ("2 42" stays "2 42"): the schema's check then names it
// on the field and in the page's problems, where it stays until it is fixed,
// also while the field is closed. Half-written JSON cannot be stored like
// that: it stays on screen with its reason and is reported through
// onDraftError, so the page can refuse to save it and hand it back
// (`restore`) when the field opens again.
import { useEffect, useRef, useState } from "react";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { parseDecimal } from "@/lib/stats";
import { cn } from "@/lib/utils";
import type { FormScalar } from "./describe";
import { deepEqual } from "./values";

type CommonProps = {
  id: string;
  /** Ids of the description and error texts. */
  describedBy?: string;
  invalid?: boolean;
  readOnly?: boolean;
  className?: string;
};

/** What an emptied field stores: nothing (an optional setting), null (a nullable or a required one) or "" (required text). */
export type EmptyAs = "missing" | "null" | "empty";

function emptyValueFor(emptyAs: EmptyAs): undefined | null | "" {
  return emptyAs === "missing" ? undefined : emptyAs === "null" ? null : "";
}

/**
 * What is typed, shown as typed ("2,5" stays "2,5" while it is stored as 2.5).
 * An emptied optional setting falls back to what it inherits; shown under the
 * caret, that value would take the next keys (13 emptied, then 5, reads 135).
 * So an emptied field stays empty until it loses focus, and only then shows
 * what it inherits. A value changed from outside (a reset, Discard) shows at once.
 */
function useTyped(value: unknown) {
  const [typed, setTyped] = useState<{ text: string; value: unknown } | null>(null);
  const [focused, setFocused] = useState(false);
  const current =
    typed !== null && (Object.is(typed.value, value) || (focused && typed.value === undefined)) ? typed : null;
  return {
    text: current?.text,
    type: (text: string, stored: unknown) => setTyped({ text, value: stored }),
    focusProps: {
      onFocus: () => setFocused(true),
      onBlur: () => {
        setFocused(false);
        setTyped(null);
      },
    },
  };
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

/**
 * What typing `raw` into a number field stores (BUILD_SPEC 6.2 rule 1, the
 * parser NumericCell uses): the number; the emptied value; or, for text that
 * is not one number ("2 42", "3.5 g"), that text, which the schema refuses in
 * plain words (issues.ts) until it is fixed.
 */
export function numberFromText(raw: string, emptyAs: "missing" | "null"): number | string | null | undefined {
  const parsed = parseDecimal(raw);
  if (!parsed.ok) return raw.trim();
  if (parsed.value === null) return emptyAs === "null" ? null : undefined;
  return parsed.value;
}

/** How a stored value reads in a number field: a number, text that is not one yet, or nothing. */
export function numberText(value: unknown): string {
  if (typeof value === "number") return String(value);
  return typeof value === "string" ? value : "";
}

type NumberInputProps = CommonProps & {
  value: unknown;
  /** A number, the emptied value, or text that is not a number (the schema says why). */
  onChange: (next: number | string | null | undefined) => void;
  integer?: boolean;
  unit?: string;
  /**
   * Emptied: "missing" leaves an optional setting out (it inherits again);
   * "null" keeps it the template's own, empty, for a required or nullable
   * number, so an inherited value never comes back in its place.
   */
  emptyAs: "missing" | "null";
  placeholder?: string;
};

/** Numbers only (BUILD_SPEC 6.2 rule 1): what is typed is stored as it is, and the schema judges it. */
export function NumberInput({
  id,
  value,
  onChange,
  integer = false,
  unit,
  emptyAs,
  placeholder,
  describedBy,
  invalid,
  readOnly,
  className,
}: NumberInputProps) {
  const typed = useTyped(value);
  return (
    <div className={cn("grid gap-1.5", className)}>
      <InputGroup className={cn("w-full max-w-56", readOnly && "bg-muted")}>
        <InputGroupInput
          id={id}
          inputMode={integer ? "numeric" : "decimal"}
          autoComplete="off"
          enterKeyHint="next"
          value={typed.text ?? numberText(value)}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-invalid={invalid ? true : undefined}
          aria-describedby={describedBy}
          onChange={(event) => {
            const raw = event.target.value;
            const next = numberFromText(raw, emptyAs);
            typed.type(raw, next);
            if (!Object.is(next, value)) onChange(next);
          }}
          {...typed.focusProps}
          className="tabular-nums"
        />
        {unit && <InputGroupAddon align="inline-end">{unit}</InputGroupAddon>}
      </InputGroup>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Text
 * ------------------------------------------------------------------ */

type TextInputProps = CommonProps & {
  value: unknown;
  onChange: (next: string | null | undefined) => void;
  emptyAs: EmptyAs;
  placeholder?: string;
  maxLength?: number;
  /** Suggestions offered while typing (a datalist). */
  suggestions?: readonly { value: string; label?: string }[];
  monospace?: boolean;
};

export function TextInput({
  id,
  value,
  onChange,
  emptyAs,
  placeholder,
  maxLength,
  suggestions,
  monospace,
  describedBy,
  invalid,
  readOnly,
  className,
}: TextInputProps) {
  const typed = useTyped(value);
  const listId = suggestions && suggestions.length > 0 ? `${id}-suggestions` : undefined;
  return (
    <>
      <Input
        id={id}
        value={typed.text ?? (typeof value === "string" ? value : "")}
        placeholder={placeholder}
        maxLength={maxLength}
        readOnly={readOnly}
        autoComplete="off"
        spellCheck={false}
        list={listId}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(event) => {
          const text = event.target.value;
          const next = text === "" ? emptyValueFor(emptyAs) : text;
          typed.type(text, next);
          if (!Object.is(next, value)) onChange(next);
        }}
        {...typed.focusProps}
        className={cn(monospace && "font-mono", className)}
      />
      {listId && (
        <datalist id={listId}>
          {suggestions?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </datalist>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ *
 * Options
 * ------------------------------------------------------------------ */

export type SelectOption = { value: FormScalar; label: string };

type OptionSelectProps = CommonProps & {
  value: unknown;
  options: readonly SelectOption[];
  onChange: (next: FormScalar) => void;
  placeholder?: string;
  /** Accessible name when no visible label points at the trigger. */
  ariaLabel?: string;
};

/** A select over any scalar values: options are matched by value, so numbers stay numbers. */
export function OptionSelect({
  id,
  value,
  options,
  onChange,
  placeholder = "Choose…",
  ariaLabel,
  describedBy,
  invalid,
  readOnly,
  className,
}: OptionSelectProps) {
  const index = options.findIndex((option) => option.value === value);
  if (readOnly) {
    return (
      <Input
        id={id}
        readOnly
        value={index === -1 ? (value === undefined ? "" : String(value)) : options[index].label}
        aria-describedby={describedBy}
        aria-label={ariaLabel}
        className={cn("max-w-80", className)}
      />
    );
  }
  return (
    <Select
      // "" shows the placeholder: a value that is none of the options (missing, or saved wrong).
      value={index === -1 ? "" : String(index)}
      onValueChange={(next) => {
        const option = options[Number(next)];
        if (option) onChange(option.value);
      }}
    >
      <SelectTrigger
        id={id}
        aria-label={ariaLabel}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        className={cn("w-full max-w-80", className)}
      >
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {options.map((option, position) => (
          <SelectItem key={`${position}-${String(option.value)}`} value={String(position)}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

/* ------------------------------------------------------------------ *
 * JSON
 * ------------------------------------------------------------------ */

/** Text a field holds that is not a value yet, and why. */
export type DraftText = { text: string; message: string };

type JsonInputProps = CommonProps & {
  value: unknown;
  onChange: (next: unknown) => void;
  rows?: number;
  /**
   * Text that is not a value yet, or null once it is. Not withdrawn when the
   * field closes: the page keeps it, so it still stops a save.
   */
  onDraftError?: (draft: DraftText | null) => void;
  /** The text the page kept from when this field was last open. */
  restore?: DraftText;
};

/** Any JSON value as text. Until the text is valid JSON the stored value stays as it was. */
export function JsonInput({
  id,
  value,
  onChange,
  rows = 4,
  describedBy,
  invalid,
  readOnly,
  onDraftError,
  restore,
  className,
}: JsonInputProps) {
  const formatted = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState<{ text: string; value: unknown; error: string | null } | null>(() =>
    restore ? { text: restore.text, value, error: restore.message } : null,
  );
  const latest = useRef(onDraftError);
  useEffect(() => {
    latest.current = onDraftError;
  });
  const reported = useRef<DraftText | null>(restore ?? null);
  const report = (next: DraftText | null) => {
    const last = reported.current;
    if (next === null ? last === null : last !== null && last.text === next.text && last.message === next.message) return;
    reported.current = next;
    latest.current?.(next);
  };
  // By content: the page may hand back an equal copy of what was typed.
  const current = draft !== null && deepEqual(draft.value, value) ? draft : null;
  const text = current?.text ?? formatted;
  const error = current?.error ?? null;

  // The stored value changed from outside (a reset, Discard): the text gives way, and so does its problem.
  useEffect(() => {
    if (current === null && reported.current !== null) {
      reported.current = null;
      latest.current?.(null);
    }
  });

  const errorId = `${id}-draft`;
  return (
    <div className={cn("grid gap-1.5", className)}>
      <Textarea
        id={id}
        value={text}
        rows={rows}
        readOnly={readOnly}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        aria-invalid={invalid || error !== null ? true : undefined}
        aria-describedby={[describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined}
        className="font-mono"
        onChange={(event) => {
          const raw = event.target.value;
          if (raw.trim() === "") {
            setDraft({ text: raw, value: undefined, error: null });
            report(null);
            onChange(undefined);
            return;
          }
          try {
            const parsed: unknown = JSON.parse(raw);
            setDraft({ text: raw, value: parsed, error: null });
            report(null);
            onChange(parsed);
          } catch (problem) {
            const message = `Not valid JSON yet: ${problem instanceof Error ? problem.message : String(problem)}`;
            setDraft({ text: raw, value, error: message });
            report({ text: raw, message });
          }
        }}
        onBlur={() => {
          if (current && current.error === null) setDraft(null);
        }}
      />
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
