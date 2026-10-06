"use client";

// The leaf controls of a generated form. Each one shows what is stored and
// hands back a whole new value; text that is not yet a value (a number
// typed as "2 42", half-written JSON) stays on screen with its reason and is
// reported through onDraftError, so the page can refuse to save it.
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
  /** Text that is not a value yet, or null once it is (or the field goes away). */
  onDraftError?: (message: string | null) => void;
  className?: string;
};

/** What an emptied field stores: nothing (an optional setting), null (a nullable one) or "" (required text). */
export type EmptyAs = "missing" | "null" | "empty";

function emptyValueFor(emptyAs: EmptyAs): undefined | null | "" {
  return emptyAs === "missing" ? undefined : emptyAs === "null" ? null : "";
}

/** Reports a draft error to the page, and withdraws it when the field goes away. */
function useDraftError(onDraftError: ((message: string | null) => void) | undefined) {
  const latest = useRef(onDraftError);
  useEffect(() => {
    latest.current = onDraftError;
  });
  const reported = useRef<string | null>(null);
  useEffect(
    () => () => {
      if (reported.current !== null) latest.current?.(null);
    },
    [],
  );
  return (message: string | null) => {
    if (reported.current === message) return;
    reported.current = message;
    latest.current?.(message);
  };
}

/* ------------------------------------------------------------------ *
 * Numbers
 * ------------------------------------------------------------------ */

type NumberInputProps = CommonProps & {
  value: unknown;
  onChange: (next: number | null | undefined) => void;
  integer?: boolean;
  unit?: string;
  emptyAs: EmptyAs;
  placeholder?: string;
};

/**
 * Numbers only (BUILD_SPEC 6.2 rule 1, the same parser as NumericCell): "2 42"
 * or "3.5 g" is not stored. The text stays with its reason, the stored value
 * stays as it was, and the page is told, so it will not save.
 */
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
  onDraftError,
  className,
}: NumberInputProps) {
  // The text being typed, with the stored value it belongs to: once the stored
  // value changes from outside (a reset), the text gives way to it.
  const [draft, setDraft] = useState<{ text: string; value: unknown; error: string | null } | null>(null);
  const report = useDraftError(onDraftError);
  const current = draft !== null && Object.is(draft.value, value) ? draft : null;
  const text = current?.text ?? (typeof value === "number" ? String(value) : "");
  const error = current?.error ?? null;

  useEffect(() => {
    if (current === null) report(null);
  });

  const handle = (raw: string) => {
    const parsed = parseDecimal(raw);
    if (!parsed.ok) {
      setDraft({ text: raw, value, error: parsed.error });
      report(parsed.error);
      return;
    }
    const next = parsed.value === null ? emptyValueFor(emptyAs) : parsed.value;
    setDraft({ text: raw, value: next, error: null });
    report(null);
    if (!Object.is(next, value)) onChange(next as number | null | undefined);
  };

  const errorId = `${id}-draft`;
  const describedByAll = [describedBy, error ? errorId : null].filter(Boolean).join(" ") || undefined;
  const input = (
    <InputGroupInput
      id={id}
      inputMode={integer ? "numeric" : "decimal"}
      autoComplete="off"
      enterKeyHint="next"
      value={text}
      placeholder={placeholder}
      readOnly={readOnly}
      aria-invalid={invalid || error !== null ? true : undefined}
      aria-describedby={describedByAll}
      onChange={(event) => handle(event.target.value)}
      onBlur={() => {
        if (current && current.error === null) setDraft(null);
      }}
      className="tabular-nums"
    />
  );

  return (
    <div className={cn("grid gap-1.5", className)}>
      <InputGroup className={cn("w-full max-w-56", readOnly && "bg-muted")}>
        {input}
        {unit && <InputGroupAddon align="inline-end">{unit}</InputGroupAddon>}
      </InputGroup>
      {error && (
        <p id={errorId} className="text-sm text-destructive">
          “{text}” is not stored. {error}
        </p>
      )}
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
  const listId = suggestions && suggestions.length > 0 ? `${id}-suggestions` : undefined;
  return (
    <>
      <Input
        id={id}
        value={typeof value === "string" ? value : ""}
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
          onChange(text === "" ? emptyValueFor(emptyAs) : text);
        }}
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

type JsonInputProps = CommonProps & {
  value: unknown;
  onChange: (next: unknown) => void;
  rows?: number;
};

/** Any JSON value as text. Until the text is valid JSON the stored value stays as it was. */
export function JsonInput({ id, value, onChange, rows = 4, describedBy, invalid, readOnly, onDraftError, className }: JsonInputProps) {
  const formatted = value === undefined ? "" : JSON.stringify(value, null, 2);
  const [draft, setDraft] = useState<{ text: string; value: unknown; error: string | null } | null>(null);
  const report = useDraftError(onDraftError);
  // By content: the page may hand back an equal copy of what was typed.
  const current = draft !== null && deepEqual(draft.value, value) ? draft : null;
  const text = current?.text ?? formatted;
  const error = current?.error ?? null;

  useEffect(() => {
    if (current === null) report(null);
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
        className="font-mono text-sm"
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
            report(message);
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
