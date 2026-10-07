"use client";

// Labelled decimal entry for single values (BUILD_SPEC 6.2 rule 1, 8
// "Speed"), built on NumericCell: the numeric keypad (inputmode=decimal),
// strict parsing through lib/stats ("2 42" and text are rejected and never
// stored: the value becomes null and the text stays on screen with its
// error), min/max, a unit suffix, whole numbers only with `integer`, and
// calc's error (red) or warnings (amber) below the field. Fields inside one EnterGroup (or sharing
// a `group` name) work as a run: Enter moves to the next field, Shift+Enter
// back, and pasting a column of values fills this field and the ones after.
// A paste is one change: each field stores its value by its own rules inside
// batchDataChanges, so a module that writes through useDataUpdater receives
// one onChange with every value. What a paste leaves out (values past the
// run's last field, other spreadsheet columns) shows on screen: under the
// field pasted into, or for cells in a table, across the foot of their
// EnterGroup. PercentField is the same with "%" and 0 to 100.
import {
  createContext,
  useContext,
  useEffect,
  useEffectEvent,
  useId,
  useRef,
  useState,
  type ComponentProps,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { cn } from "@/lib/utils";
import { formatReading, type ParseDecimalResult } from "@/lib/stats";
import { Label } from "@/components/ui/label";
import { batchDataChanges } from "./data-updater";
import {
  FILL_EVENT,
  fillRun,
  groupFields,
  leftOutAnything,
  neighbour,
  pasteNotice,
  planFieldPaste,
  valuesPastEnd,
  type FillRequest,
  type PasteLeftOut,
  type PasteResult,
} from "./field-navigation";
import { issuePathProps, type IssuePath } from "./issue-path";
import { NumericCell, type InvalidEntry } from "./numeric-cell";
import { readEntry } from "./numeric-entry";
import { PasteNotice } from "./paste-notice";
import { StatusIcon } from "./status-icon";
import { useAnnouncement } from "./use-announcement";

const InGroup = createContext(false);

/** What a cell's paste left out, and the cell it was pasted into (the focus goes back there on Dismiss). */
type GroupPasteNotice = { leftOut: PasteLeftOut; field: HTMLInputElement };

/** An EnterGroup's place for its cells' paste notices: null clears it (a paste that fit). */
const GroupNotices = createContext<((notice: GroupPasteNotice | null) => void) | null>(null);

/**
 * A run of fields: Enter moves through them in reading order; a pasted column
 * fills down. When a paste into one of its cells leaves values out, the notice
 * runs across the group's foot (a table's frame), after its content.
 */
export function EnterGroup({ className, children, ...props }: ComponentProps<"div">) {
  const [notice, setNotice] = useState<GroupPasteNotice | null>(null);
  return (
    <InGroup.Provider value>
      <GroupNotices.Provider value={setNotice}>
        {/* data-enter-scope: ENTER_SCOPE_ATTRIBUTE */}
        <div {...props} data-enter-scope="" data-slot="enter-group" className={className}>
          {children}
          {notice && (
            <PasteNotice
              variant="strip"
              leftOut={notice.leftOut}
              onDismiss={() => {
                if (notice.field.isConnected) notice.field.focus();
                setNotice(null);
              }}
            />
          )}
        </div>
      </GroupNotices.Provider>
    </InGroup.Provider>
  );
}

export type NumberFieldProps = {
  /** In the template's wording. Plain text gives a cell its accessible name directly. */
  label: ReactNode;
  /** Keep the label for screen readers only, e.g. in a table with column headings. */
  hideLabel?: boolean;
  value: number | null;
  onValueChange: (value: number | null) => void;
  /** Canonical unit shown in the field: "mm", "g", "N", "MPa", "%". */
  unit?: string;
  min?: number;
  max?: number;
  /** Refuse `min` itself: the value must be more than it, e.g. a weight more than 0 g. */
  minExclusive?: boolean;
  /** Reject decimals: counts typed as numbers, carton quantities. */
  integer?: boolean;
  /** Show at least this many decimals (0.1 as 0.10); never rounds what was entered. */
  decimals?: number;
  hint?: ReactNode;
  /** A problem calc found with the stored value, e.g. "Below the 70% minimum." */
  error?: string | null;
  /**
   * calc's warnings about the stored value, in amber below the field (one
   * line each) and in its description: allowed, but the reviewer must see
   * them, e.g. a packing count that does not match or a sample below the plan.
   */
  warning?: string | readonly string[] | null;
  /** "field" has its label above; "cell" sits in a table cell (label for screen readers). */
  variant?: "field" | "cell";
  /** Fields with the same name form a run inside the nearest EnterGroup, e.g. one table column. */
  group?: string;
  readOnly?: boolean;
  placeholder?: string;
  /** Marks the field for issue links (useIssueFocus). */
  issuePath?: IssuePath;
  /** For photo tags: the field has focus. */
  onFocus?: () => void;
  /**
   * Told when an entry is rejected (and when that clears), so a table of
   * cells can list its problems with EntryProblems, as MeasurementGrid does.
   */
  onInvalidChange?: (entry: InvalidEntry | null) => void;
  id?: string;
  className?: string;
};

const WHOLE_NUMBERS = "Whole numbers only, e.g. 3.";

export function NumberField({
  label,
  hideLabel = false,
  value,
  onValueChange,
  unit,
  min,
  max,
  minExclusive,
  integer = false,
  decimals,
  hint,
  error,
  warning,
  variant = "field",
  group,
  readOnly = false,
  placeholder,
  issuePath,
  onFocus,
  onInvalidChange,
  id,
  className,
}: NumberFieldProps) {
  const fallbackId = useId();
  const inputId = id ?? fallbackId;
  const hintId = `${inputId}-hint`;
  const errorId = `${inputId}-calc-error`;
  const warningId = `${inputId}-calc-warning`;
  const inGroup = useContext(InGroup) || group !== undefined;
  const groupNotices = useContext(GroupNotices);
  const input = useRef<HTMLInputElement>(null);
  // What the last paste into this field left out, where the field shows it itself.
  const [leftOut, setLeftOut] = useState<PasteLeftOut | null>(null);
  const [ownInvalid, setOwnInvalidState] = useState<InvalidEntry | null>(null);
  const setOwnInvalid = (entry: InvalidEntry | null) => {
    setOwnInvalidState(entry);
    onInvalidChange?.(entry);
  };
  // Said again when the same paste repeats.
  const [notice, announce] = useAnnouncement();
  // A rejected entry leaves the value null; a value set later (a prefill) supersedes it.
  const invalid = value === null ? ownInvalid : null;
  const calcError = !invalid && error ? error : null;
  // About the stored value, so they wait while a rejected entry shows instead.
  const warnings = invalid ? [] : (typeof warning === "string" ? [warning] : (warning ?? [])).filter((text) => text !== "");

  const read = (raw: string): ParseDecimalResult => {
    const parsed = readEntry(raw, { min, max, minExclusive });
    if (integer && parsed.ok && parsed.value !== null && !Number.isInteger(parsed.value)) {
      return { ok: false, error: WHOLE_NUMBERS };
    }
    return parsed;
  };

  /**
   * Stores raw text the way NumericCell would: a number, or null and the
   * rejected text kept on screen. True when the text was stored.
   */
  const store = (raw: string): boolean => {
    const parsed = read(raw);
    if (parsed.ok) {
      setOwnInvalid(null);
      if (parsed.value !== value) onValueChange(parsed.value);
      return true;
    }
    setOwnInvalid({ raw, error: parsed.error });
    if (value !== null) onValueChange(null);
    return false;
  };

  // NumericCell has parsed and range-checked; whole numbers are checked here.
  const onCellValue = (next: number | null) => {
    if (integer && next !== null && !Number.isInteger(next)) {
      setOwnInvalid({ raw: formatReading(next), error: WHOLE_NUMBERS });
      if (value !== null) onValueChange(null);
      return;
    }
    onValueChange(next);
  };

  // Another field of the group pasted a column and hands this one its value,
  // judged by this field's own min, max and whole-number rule.
  const onFill = useEffectEvent((request: FillRequest) => {
    request.stored = store(request.raw);
  });
  useEffect(() => {
    const element = input.current;
    if (!element) return;
    const listener = (event: Event) => onFill((event as CustomEvent<FillRequest>).detail);
    element.addEventListener(FILL_EVENT, listener);
    return () => element.removeEventListener(FILL_EVENT, listener);
  }, []);

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // NumericCell has already committed the text. Enter never submits a form.
    event.preventDefault();
    if (!inGroup) return;
    const next = neighbour(groupFields(event.currentTarget), event.currentTarget, event.shiftKey ? -1 : 1);
    next?.focus();
  };

  const fill = (field: HTMLInputElement, raw: string): boolean => {
    if (field === input.current) return store(raw);
    const request: FillRequest = { raw };
    field.dispatchEvent(new CustomEvent<FillRequest>(FILL_EVENT, { detail: request }));
    return request.stored === true;
  };

  const onPasteText = (text: string) => {
    const own = input.current;
    // A named group is one column: a spreadsheet block fills it from its first column only.
    const plan = own ? planFieldPaste(text, { column: Boolean(group) }) : null;
    if (!own || !plan) return false;
    const fields = inGroup ? groupFields(own) : [own];
    const start = fields.indexOf(own);
    let result: PasteResult = { filled: 0, rejected: 0, skipped: 0 };
    // One change for the whole paste (useDataUpdater): every value lands, not just the last.
    batchDataChanges(() => {
      result = fillRun(plan.values, fields, start, fill);
    });
    announce(pasteNotice({ ...result, leftOut: plan.leftOut }));
    // On screen too, until dismissed or the next paste: a paste that fit takes an earlier notice away.
    const left: PasteLeftOut = { pastEnd: valuesPastEnd(plan.values, fields.length, start), otherColumns: plan.leftOut };
    const shown = leftOutAnything(left) ? left : null;
    if (variant === "cell" && groupNotices) groupNotices(shown && { leftOut: shown, field: own });
    else setLeftOut(shown);
    return true;
  };

  const dismissLeftOut = () => {
    input.current?.focus();
    setLeftOut(null);
  };

  const name = labelText(label, unit);

  const describedBy = [
    hint && variant === "field" ? hintId : null,
    calcError ? errorId : null,
    warnings.length > 0 ? warningId : null,
  ]
    .filter(Boolean)
    .join(" ");

  const cell = (
    <NumericCell
      ref={input}
      id={inputId}
      variant={variant}
      value={value}
      onValueChange={onCellValue}
      invalid={invalid}
      onInvalidChange={setOwnInvalid}
      min={min}
      max={max}
      minExclusive={minExclusive}
      unit={variant === "field" ? unit : undefined}
      decimals={decimals}
      readOnly={readOnly}
      placeholder={placeholder}
      enterKeyHint={inGroup ? "next" : "done"}
      aria-label={variant === "cell" ? name : undefined}
      aria-describedby={describedBy || undefined}
      onKeyDown={onKeyDown}
      onPasteText={readOnly ? undefined : onPasteText}
      onFocus={onFocus}
      // ENTER_FIELD_ATTRIBUTE and ENTER_GROUP_ATTRIBUTE: how groupFields finds the run.
      data-enter-field=""
      data-enter-group={group ?? ""}
      className={cn(
        calcError
          ? variant === "field"
            ? "border-destructive ring-3 ring-destructive/20"
            : "bg-fail-tint text-fail ring-2 ring-fail ring-inset"
          : warnings.length > 0 && (variant === "field" ? "border-warn-solid" : "bg-warn-tint"),
      )}
    />
  );

  const live = (
    <span className="sr-only" aria-live="polite">
      {notice}
    </span>
  );

  if (variant === "cell") {
    return (
      <div
        data-slot="number-field"
        data-variant="cell"
        className={cn("relative min-w-0", className)}
        {...issuePathProps(issuePath)}
      >
        {/* A label that is not plain text cannot be an aria-label: name the cell with a hidden label. */}
        {name === undefined && (
          <label htmlFor={inputId} className="sr-only">
            {label}
            {unit && ` (${unit})`}
          </label>
        )}
        {cell}
        {calcError && (
          <span id={errorId} className="sr-only">
            {calcError}
          </span>
        )}
        {warnings.length > 0 && (
          <span id={warningId} className="sr-only">
            {warnings.join(" ")}
          </span>
        )}
        {live}
        {/* A cell outside an EnterGroup has no group foot to show it: it shows under the cell. */}
        {leftOut && <PasteNotice className="mt-1" leftOut={leftOut} onDismiss={dismissLeftOut} />}
      </div>
    );
  }

  return (
    <div data-slot="number-field" className={cn("min-w-0 space-y-1.5", className)} {...issuePathProps(issuePath)}>
      <Label htmlFor={inputId} className={cn("leading-snug touch:text-base", hideLabel && "sr-only")}>
        {label}
      </Label>
      {cell}
      {hint && (
        <p id={hintId} className="text-sm text-muted-foreground touch:text-base">
          {hint}
        </p>
      )}
      {calcError && (
        <p id={errorId} className="text-sm text-fail touch:text-base">
          {calcError}
        </p>
      )}
      {warnings.length > 0 && (
        <div id={warningId} data-slot="field-warnings" className="space-y-1 text-sm text-warn touch:text-base">
          {warnings.map((message) => (
            <p key={message} className="flex items-start gap-1.5">
              <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
              <span>{message}</span>
            </p>
          ))}
        </div>
      )}
      {leftOut && <PasteNotice leftOut={leftOut} onDismiss={dismissLeftOut} />}
      {live}
    </div>
  );
}

/** A plain-text accessible name: the label with its unit, unless the label already names it. */
export function labelText(label: ReactNode, unit?: string): string | undefined {
  if (typeof label !== "string" && typeof label !== "number") return undefined;
  const text = String(label);
  if (!unit) return text;
  // As a word ("Weight (g)"), not inside one ("glove").
  const escaped = unit.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const named = unit === "%" ? text.includes("%") : new RegExp(`(^|[\\s(])${escaped}($|[\\s),.])`).test(text);
  return named ? text : `${text} (${unit})`;
}

/** A percentage, stored as the percent number (88 for 88%): "%" suffix, 0 to 100 unless set. */
export function PercentField({ min = 0, max = 100, ...props }: Omit<NumberFieldProps, "unit">) {
  return <NumberField {...props} unit="%" min={min} max={max} />;
}

export type EntryProblem = {
  key: string;
  /** Names the cell, e.g. "Item 4, Layering %". */
  label: string;
  entry: InvalidEntry;
  /** The cell's input id: the label becomes a link that focuses it. */
  inputId?: string;
};

/**
 * Rejected entries under a table of NumberField cells, worded and styled as
 * MeasurementGrid lists its own (BUILD_SPEC 6.2: each problem with a link).
 * List an entry only while its cell's stored value is null.
 */
export function EntryProblems({ problems, className }: { problems: readonly EntryProblem[]; className?: string }) {
  if (problems.length === 0) return null;
  return (
    <ul
      data-slot="entry-problems"
      className={cn(
        "space-y-1 rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-sm text-fail touch:text-base",
        className,
      )}
    >
      {problems.map(({ key, label, entry, inputId }) => (
        <li key={key}>
          {inputId ? (
            <button
              type="button"
              onClick={() => document.getElementById(inputId)?.focus()}
              className="rounded-sm font-semibold underline underline-offset-2 focus-ring touch:min-h-11"
            >
              {label}
            </button>
          ) : (
            <span className="font-semibold">{label}</span>
          )}
          : “{entry.raw}” is not stored. {entry.error}
        </li>
      ))}
    </ul>
  );
}
