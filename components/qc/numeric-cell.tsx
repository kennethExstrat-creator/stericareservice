"use client";

// Numeric entry for measurements (BUILD_SPEC 6.2 rule 1). Text is parsed when
// the cell is left (blur, Enter, arrow keys): a number is committed; anything
// else, such as "2 42", stays on screen with an error while the stored value
// becomes null. Text is never stored. Escape restores the last value.
import {
  useId,
  useRef,
  useState,
  type ClipboardEvent,
  type ComponentProps,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { cn } from "@/lib/utils";
import { formatReading, readDecimal } from "@/lib/stats";

/** What was typed that is not a usable number, and why. */
export type InvalidEntry = { raw: string; error: string };

type NumericCellProps = Omit<
  ComponentProps<"input">,
  "value" | "defaultValue" | "onChange" | "type" | "inputMode" | "min" | "max"
> & {
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Controlled rejected entry; omit to let the cell keep its own. */
  invalid?: InvalidEntry | null;
  onInvalidChange?: (invalid: InvalidEntry | null) => void;
  min?: number;
  max?: number;
  /** "field" is a standalone input with its error below; "cell" sits in a grid. */
  variant?: "field" | "cell";
  /** Unit shown inside a field, e.g. "mm". */
  unit?: string;
  /** Show the stored value with at least this many decimals (0.1 as 0.10); never rounds. */
  decimals?: number;
  /** Called with pasted text that holds several values; return true if handled. */
  onPasteText?: (text: string) => boolean;
};

export function NumericCell({
  value,
  onValueChange,
  invalid: controlledInvalid,
  onInvalidChange,
  min,
  max,
  variant = "field",
  unit,
  decimals,
  onPasteText,
  className,
  id,
  onBlur,
  onFocus,
  onKeyDown,
  onMouseUp,
  readOnly,
  "aria-describedby": describedBy,
  ...props
}: NumericCellProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const errorId = `${inputId}-error`;
  const unitId = `${inputId}-unit`;

  const [ownInvalid, setOwnInvalid] = useState<InvalidEntry | null>(null);
  // A rejected entry always leaves the value null, so a value set later by the
  // parent (a prefill, say) supersedes it.
  const invalid = controlledInvalid !== undefined ? controlledInvalid : value === null ? ownInvalid : null;
  const setInvalid = (next: InvalidEntry | null) => {
    if (controlledInvalid === undefined) setOwnInvalid(next);
    onInvalidChange?.(next);
  };

  // null while not editing. The ref mirrors it so a commit on Enter is not
  // repeated by the blur that follows when focus moves on.
  const [draft, setDraft] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const updateDraft = (next: string | null) => {
    draftRef.current = next;
    setDraft(next);
  };

  const commit = () => {
    const raw = draftRef.current;
    if (raw === null) return;
    updateDraft(null);
    const result = readDecimal(raw, { min, max });
    if (!result.ok) {
      if (value !== null) onValueChange(null);
      setInvalid({ raw, error: result.error });
      return;
    }
    if (invalid) setInvalid(null);
    if (result.value !== value) onValueChange(result.value);
  };

  const display = draft ?? invalid?.raw ?? formatReading(value, decimals);
  // Reward early: the error clears as soon as the edit becomes valid.
  const showError = invalid !== null && (draft === null || !readDecimal(draft, { min, max }).ok);

  const handleKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") commit();
    if (event.key === "Escape" && draftRef.current !== null) {
      event.preventDefault();
      updateDraft(null);
    }
    onKeyDown?.(event);
  };

  // Arriving in a cell selects its text, so typing replaces the value. Safari
  // clears that selection on the mouseup of the click that focused the cell.
  const keepSelection = useRef(false);

  const handleFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
    keepSelection.current = true;
    onFocus?.(event);
  };

  const handleMouseUp = (event: MouseEvent<HTMLInputElement>) => {
    if (keepSelection.current) event.preventDefault();
    keepSelection.current = false;
    onMouseUp?.(event);
  };

  const handleBlur = (event: FocusEvent<HTMLInputElement>) => {
    keepSelection.current = false;
    commit();
    onBlur?.(event);
  };

  const handlePaste = (event: ClipboardEvent<HTMLInputElement>) => {
    if (!onPasteText) return;
    if (onPasteText(event.clipboardData.getData("text"))) {
      event.preventDefault();
      updateDraft(null);
    }
  };

  const input = (
    <input
      {...props}
      id={inputId}
      type="text"
      inputMode="decimal"
      autoComplete="off"
      spellCheck={false}
      readOnly={readOnly}
      value={display}
      onChange={(event) => updateDraft(event.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={handleFocus}
      onMouseUp={handleMouseUp}
      onBlur={handleBlur}
      onPaste={handlePaste}
      aria-invalid={showError || undefined}
      aria-describedby={
        [describedBy, variant === "field" && unit && unitId, variant === "field" && showError && errorId]
          .filter(Boolean)
          .join(" ") || undefined
      }
      data-slot="numeric-cell"
      data-variant={variant}
      className={cn(
        "w-full min-w-0 text-right tabular-nums outline-none placeholder:text-muted-foreground",
        variant === "field" &&
          "h-9 rounded-md border border-input bg-card px-2.5 text-base shadow-xs transition-[color,box-shadow] focus-visible:border-ring focus-ring-inset aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 [&[readonly]]:bg-muted [&[readonly]]:shadow-none fine:text-sm touch:h-11 touch:px-3",
        variant === "field" && unit && "pr-12 touch:pr-12",
        variant === "cell" &&
          "h-8 rounded-none bg-transparent px-2.5 text-sm focus-visible:bg-card focus-ring-inset aria-invalid:bg-fail-tint aria-invalid:text-fail aria-invalid:ring-2 aria-invalid:ring-fail aria-invalid:ring-inset touch:h-11 touch:text-base",
        className,
      )}
    />
  );

  if (variant === "cell") return input;

  return (
    <div className="space-y-1.5">
      <div className="relative">
        {input}
        {unit && (
          <span
            id={unitId}
            className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-muted-foreground"
          >
            {unit}
          </span>
        )}
      </div>
      {showError && invalid && (
        <p id={errorId} className="text-sm text-fail">
          “{invalid.raw}” is not stored. {invalid.error}
        </p>
      )}
    </div>
  );
}
