"use client";

// The carton list (BUILD_SPEC 6.1 carton_sampling, 8 "Speed"): per ordered
// size, the numbers of the cartons sampled, as chips in the order they were
// entered, and one field on the numeric keypad for the next. Enter or Add
// puts the typed number in the list; a pasted list (numbers between spaces,
// commas, semicolons or new lines) goes in at once. A number the size lists
// already, or text that is no carton number, is refused at the field with a
// short message and not added (edit.ts). A number above the order quantity
// is added and turns red at once, with calc's problem below the list and a
// link to its chip (6.2 rule 6). A list saved from the earlier grid shows its
// numbers only; the first edit stores it without the blanks.
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { PlusIcon, XIcon } from "lucide-react";
import {
  Figure,
  focusIssuePath,
  issueNoticeProps,
  issuePathProps,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  useRefusedEntryStore,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  initialSize,
  labelFor,
  samplingFor,
  type CaptureFocus,
  type CaptureProps,
  type ValidationIssue,
} from "@/modules/_framework";
import { useReportShownSize } from "@/modules/_framework/shown-size";
import type { CartonSamplingComputed } from "./calc";
import type { CartonSamplingConfig } from "./config";
import {
  addCartons,
  pastedCartons,
  pasteMessage,
  readTypedCarton,
  refusalMessage,
  removeCarton,
  splitCartonText,
  type AddedCartons,
  type CartonRefusal,
} from "./edit";
import type { CartonSamplingData } from "./schema";

export default function Capture({
  data,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  focus,
  onChange,
  onFocusChange,
}: CaptureProps<CartonSamplingData, CartonSamplingConfig, CartonSamplingComputed>) {
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module (CaptureProps.focus).
  const [active, setActive] = useState(() => initialSize(context, focus));
  // Every write starts from the latest data, so a pasted list keeps every number (docs/CAPTURE_KIT.md).
  const update = useDataUpdater(data, onChange);

  const label = (key: string) => labelFor(labels, key);
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes });
  const caption = (size: string) => label("sizeCaption").replace("{size}", sizeName(size));
  const issues = evaluation?.issues ?? [];

  // SizeTabs shows the first size when the active one is no longer ordered.
  const shown = context.sizes.includes(active) ? active : context.sizes[0];
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section opens.
  useReportShownSize(shown ?? null, onFocusChange);

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setActive(path[1]);
    },
  });

  const add = (size: string, entries: readonly string[]): AddedCartons => {
    // update runs the change at once, so what it added and left out is known on return.
    let outcome: AddedCartons = { data, added: [], refused: [] };
    update((current) => {
      outcome = addCartons(current, size, entries);
      return outcome.data;
    });
    return outcome;
  };

  const renderSize = (size: string) => {
    const entries = entriesOf(data.sizes[size]?.cartonNumbers ?? []);
    const cases = samplingFor(context, size).cases;
    const facts = evaluation?.computed.sizes?.[size];
    const result = evaluation?.result.perSize?.[size];
    const own = issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size);
    const count = facts?.samplingQuantity ?? entries.length;
    const captionId = `${idFor(size)}-caption`;

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 id={captionId} className="text-base font-semibold text-foreground">
            {caption(size)}
          </h3>
          <p className="relative text-sm text-muted-foreground touch:text-base">
            {label("samplingQuantity")}{" "}
            <span className="font-semibold text-foreground tabular-nums">
              <Figure value={count} grouping /> / <Figure value={cases} grouping />
            </span>
          </p>
        </div>
        <CartonList
          size={size}
          name={caption(size)}
          captionId={captionId}
          entries={entries}
          problems={chipProblems(own, size, entries)}
          readOnly={readOnly}
          onAdd={(list) => add(size, list)}
          onRemove={(index, carton) => update((current) => removeCarton(current, size, index, carton))}
          onFocusChange={onFocusChange}
        />
        {own.length > 0 && (
          <ul className="space-y-1">
            {own.map((issue) => (
              <li key={`${issue.code}-${issue.path.join("/")}`}>
                <button
                  type="button"
                  onClick={() => root.current && focusIssuePath(root.current, issue.path)}
                  className={cn(
                    "flex w-full items-start gap-1.5 rounded-sm text-left text-sm focus-ring-inset touch:min-h-11 touch:text-base",
                    issue.level === "error" ? "text-fail" : "text-warn",
                  )}
                >
                  <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
                  <span>{issue.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        {result && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground touch:text-base">
            <StatusPill size="sm" status={result.status} />
            {result.summary && <span>{result.summary}</span>}
          </p>
        )}
      </div>
    );
  };

  return (
    <div ref={root}>
      <SizeTabs
        sizes={context.sizes}
        templateSizes={context.templateSizes}
        value={active}
        onValueChange={(size) => {
          setActive(size);
          onFocusChange?.({ size });
        }}
        results={evaluation?.result.perSize}
        label={`${title}: ${label("cartonNumbers")}`}
      >
        {renderSize}
      </SizeTabs>
    </div>
  );
}

/** A carton number on screen and its place in the stored list, where calc's issue paths point. */
type CartonEntry = { readonly carton: number; readonly index: number };

/** The line under the field: a refusal (red), or what a paste added. */
type FieldMessage = {
  readonly text: string;
  readonly tone: "refused" | "done";
  /** The refused text, left in the field to correct. */
  readonly raw?: string;
};

/** A press that leaves the focus where it is: the keyboard stays up on the iPad while numbers go in. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * One size's carton numbers as chips, in the order entered, each with a
 * remove button, then the field that adds the next. Read-only, the chips
 * only. Each chip takes an issue link's focus itself (tabindex -1) and tags
 * the photos taken while it has the focus with its carton. The remove
 * buttons are one Tab stop, however long the list: the arrow keys, Home and
 * End move along it, and a chip in focus holds the stop, so Tab from a chip
 * an issue link landed on reaches its own remove button.
 */
function CartonList({
  size,
  name,
  captionId,
  entries,
  problems,
  readOnly,
  onAdd,
  onRemove,
  onFocusChange,
}: {
  size: string;
  /** The size's caption in the template's words: "M (Carton #)". */
  name: string;
  captionId: string;
  entries: readonly CartonEntry[];
  /** calc's message for each chip in trouble, by its place in the stored list. */
  problems: ReadonlyMap<number, string>;
  readOnly: boolean;
  /** Adds the entries to the size; returns what it added and what it left out. */
  onAdd: (entries: readonly string[]) => AddedCartons;
  /** The chip's place in the stored list and the carton it shows. */
  onRemove: (index: number, carton: number) => void;
  onFocusChange?: (focus: CaptureFocus) => void;
}) {
  const id = idFor(size);
  // The field's issue path: calc's count issue lands here, and so does the screen's list of entries to retype.
  const path = ["sizes", size, "cartonNumbers"] as const;
  const field = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);
  // The chip whose remove button is the list's Tab stop.
  const [stop, setStop] = useState(0);
  const tabStop = Math.min(stop, entries.length - 1);
  // Text refused here outlives the field, as a number field's does (docs/CAPTURE_KIT.md): another
  // size, another section or a reload brings it back with its message.
  const store = useRefusedEntryStore();
  const [draft, setDraft] = useState(() => (readOnly ? "" : (store?.get(path)?.raw ?? "")));
  const [message, setMessage] = useState<FieldMessage | null>(() => {
    const kept = readOnly ? undefined : store?.get(path);
    return kept ? { text: kept.error, tone: "refused", raw: kept.raw } : null;
  });
  // A polite live region; a repeat alternates a trailing no-break space, so it is said again.
  const [spoken, setSpoken] = useState("");
  const announce = (text: string) => setSpoken((current) => (current === text ? `${text}\u00a0` : text));

  const keep = (raw: string, text: string) => store?.set(path, { raw, error: text }, name);
  const letGo = () => store?.set(path, null);

  /** The refusal under the field, the text left in it to correct. */
  const refuse = (raw: string, refusal: CartonRefusal) => {
    const text = refusalMessage(refusal);
    setMessage({ text, tone: "refused", raw });
    announce(text);
    // Only text that is no number is kept to retype: a number already listed loses nothing.
    if (refusal.reason === "not_a_carton" || refusal.reason === "several") keep(raw, text);
    else letGo();
  };

  /** Enter, Add or leaving the field: adds the typed number. False when it was refused. */
  const commit = (text: string): boolean => {
    const typed = readTypedCarton(text);
    if (typed.kind === "empty") {
      if (text !== "") setDraft("");
      letGo();
      return true;
    }
    if (typed.kind === "refused") {
      refuse(text, typed.refusal);
      return false;
    }
    const outcome = onAdd([typed.raw]);
    const [refusal] = outcome.refused;
    if (refusal) {
      refuse(text, refusal);
      return false;
    }
    setDraft("");
    setMessage(null);
    letGo();
    announce(`Carton ${outcome.added[0]} added.`);
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      event.preventDefault();
      // Refused: the text stays, selected, so typing replaces it.
      if (!commit(event.currentTarget.value)) event.currentTarget.select();
    } else if (event.key === "Escape" && draft !== "") {
      // Escape drops what was typed; with nothing typed it is left alone (it may close a dialog).
      event.preventDefault();
      setDraft("");
      setMessage(null);
      letGo();
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = pastedCartons(event.clipboardData.getData("text"));
    // One number (or none) is pasted into the field as typed text, to add with Enter.
    if (!pasted) return;
    event.preventDefault();
    const input = event.currentTarget;
    // A list pasted over all of the field's text replaces it; else what was typed goes in first.
    const replaces = input.selectionStart === 0 && input.selectionEnd === input.value.length;
    const outcome = onAdd(replaces ? pasted : [...splitCartonText(input.value), ...pasted]);
    const text = pasteMessage(outcome.added.length, outcome.refused);
    setDraft("");
    setMessage({ text, tone: outcome.refused.length > 0 ? "refused" : "done" });
    letGo();
    announce(text);
  };

  /** The remove button of the chip at `position` on screen. */
  const removeButton = (position: number): HTMLButtonElement | undefined =>
    position < 0 ? undefined : list.current?.querySelectorAll<HTMLButtonElement>(":scope > li > button")[position];

  const remove = (entry: CartonEntry, position: number, event: MouseEvent<HTMLButtonElement>) => {
    // A chip taken off from the keyboard hands its focus on: to the next chip's button, else the one before, else the field.
    const button = event.currentTarget;
    if (button.ownerDocument.activeElement === button) {
      const after = removeButton(position + 1);
      const before = removeButton(position - 1);
      (after ?? before ?? field.current)?.focus();
      // The chip that takes this one's place holds the Tab stop.
      setStop(after ? position : Math.max(position - 1, 0));
    }
    onRemove(entry.index, entry.carton);
    announce(`Carton ${entry.carton} removed.`);
  };

  const moveAlong = (event: KeyboardEvent<HTMLButtonElement>, position: number) => {
    const next = stepAlong(event.key, position, entries.length);
    if (next === null) return;
    event.preventDefault();
    removeButton(next)?.focus();
  };

  const keys = chipKeys(entries);
  const messageId = `${id}-message`;
  const hintId = `${id}-hint`;
  const hint = !readOnly && entries.length === 0 && message === null;
  const describedBy = [message ? messageId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="relative space-y-2">
      {entries.length > 0 ? (
        <ol
          ref={list}
          aria-labelledby={captionId}
          // Read-only there is no field: calc's count issue lands on the list.
          {...(readOnly ? issueNoticeProps(path) : {})}
          className="flex flex-wrap gap-1.5 rounded-lg outline-none focus-ring-inset touch:gap-2"
        >
          {entries.map((entry, position) => {
            const problem = problems.get(entry.index);
            const problemId = `${id}-${entry.index}-problem`;
            return (
              <li
                key={keys[position]}
                id={`${id}-${entry.index}`}
                tabIndex={-1}
                {...issuePathProps([...path, entry.index])}
                data-carton={entry.carton}
                aria-describedby={problem ? problemId : undefined}
                // The chip itself or its button: it holds the Tab stop, and tags new photos with its carton.
                onFocus={() => {
                  setStop(position);
                  onFocusChange?.({ size, box: entry.carton });
                }}
                className={cn(
                  "relative inline-flex h-8 max-w-full items-center rounded-full border pl-3 text-sm tabular-nums outline-none focus-ring-inset touch:h-11 touch:pl-3.5 touch:text-base",
                  problem ? "border-fail bg-fail-tint text-fail" : "border-border bg-secondary text-secondary-foreground",
                  readOnly && "pr-3 touch:pr-3.5",
                )}
              >
                {problem && <StatusIcon status="fail" className="mr-1 size-3.5 shrink-0 touch:size-4" />}
                {entry.carton}
                {problem && (
                  <span id={problemId} className="sr-only">
                    {problem}
                  </span>
                )}
                {!readOnly && (
                  <button
                    type="button"
                    aria-label={`Remove Carton ${entry.carton}`}
                    aria-describedby={problem ? problemId : undefined}
                    tabIndex={position === tabStop ? 0 : -1}
                    onMouseDown={keepFocus}
                    onClick={(event) => remove(entry, position, event)}
                    onKeyDown={(event) => moveAlong(event, position)}
                    className={cn(
                      "ml-0.5 flex size-8 shrink-0 items-center justify-center rounded-full outline-none focus-ring-inset touch:size-11",
                      problem ? "hover:bg-card" : "hover:bg-brand-200 active:bg-brand-300",
                    )}
                  >
                    <XIcon aria-hidden className="size-3.5 touch:size-4" />
                  </button>
                )}
              </li>
            );
          })}
        </ol>
      ) : (
        readOnly && (
          <p
            {...issueNoticeProps(path)}
            className="rounded-sm text-sm text-muted-foreground outline-none focus-ring-inset touch:text-base"
          >
            No carton numbers entered.
          </p>
        )
      )}
      {!readOnly && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <Input
              ref={field}
              id={`${id}-entry`}
              type="text"
              inputMode="numeric"
              enterKeyHint="enter"
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              placeholder="Carton number"
              aria-label={`${name}: add`}
              aria-invalid={message?.raw !== undefined || undefined}
              aria-describedby={describedBy || undefined}
              {...issuePathProps(path)}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                // What the message said was about the text before.
                setMessage(null);
              }}
              onKeyDown={onKeyDown}
              onPaste={onPaste}
              // Leaving the field adds what was typed, as a number field stores it (before a size
              // switch too); text refused and left as it was is not refused again.
              onBlur={(event) => {
                if (message?.raw !== event.currentTarget.value) commit(event.currentTarget.value);
              }}
              onFocus={() => onFocusChange?.({ size })}
              className="w-40 tabular-nums touch:w-48"
            />
            <Button
              type="button"
              variant="outline"
              onMouseDown={keepFocus}
              onClick={() => {
                const added = commit(draft);
                field.current?.focus();
                if (!added) field.current?.select();
              }}
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              Add
            </Button>
          </div>
          {message && (
            <p
              id={messageId}
              className={cn(
                "flex items-start gap-1.5 text-sm touch:text-base",
                message.tone === "refused" ? "text-fail" : "text-muted-foreground",
              )}
            >
              {message.tone === "refused" && <StatusIcon status="fail" className="mt-0.5 size-4 shrink-0 touch:mt-1" />}
              <span>{message.text}</span>
            </p>
          )}
          {hint && (
            <p id={hintId} className="text-sm text-muted-foreground touch:text-base">
              Type a carton number and press Enter, or paste a list to add several at once.
            </p>
          )}
        </div>
      )}
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}

/** The carton numbers with their place in the stored list, blanks (from the earlier grid) left out. */
function entriesOf(cells: readonly (number | null)[]): CartonEntry[] {
  return cells.flatMap((carton, index) => (carton === null ? [] : [{ carton, index }]));
}

/** Where the arrow keys, Home and End move along the chips (no wrapping); null for any other key. */
function stepAlong(key: string, position: number, count: number): number | null {
  if (key === "ArrowRight" || key === "ArrowDown") return Math.min(position + 1, count - 1);
  if (key === "ArrowLeft" || key === "ArrowUp") return Math.max(position - 1, 0);
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

/** A number and its occurrence: a chip keeps its element, and its focus, when one before it comes off. */
function chipKeys(entries: readonly CartonEntry[]): string[] {
  const seen = new Map<number, number>();
  return entries.map(({ carton }) => {
    const nth = seen.get(carton) ?? 0;
    seen.set(carton, nth + 1);
    return `${carton}-${nth}`;
  });
}

/**
 * calc's message for each chip in trouble, by its place in the stored list:
 * its own (above the order quantity, the repeat of a number), else that of
 * the number it repeats, so every chip of a carton entered twice is red.
 */
function chipProblems(own: readonly ValidationIssue[], size: string, entries: readonly CartonEntry[]): Map<number, string> {
  const at = (index: number) => ["sizes", size, "cartonNumbers", index];
  const places = new Map<number, number[]>();
  for (const { carton, index } of entries) places.set(carton, [...(places.get(carton) ?? []), index]);
  const problems = new Map<number, string>();
  for (const { carton, index } of entries) {
    const repeats = places.get(carton) ?? [];
    const issue =
      own.find((candidate) => candidate.level === "error" && samePath(candidate.path, at(index))) ??
      (repeats.length > 1
        ? own.find((candidate) => candidate.code === "carton_duplicate" && samePath(candidate.path, at(repeats[1])))
        : undefined);
    if (issue) problems.set(index, issue.message);
  }
  return problems;
}

function idFor(size: string): string {
  return `carton-sampling-${size}`;
}

function samePath(path: readonly (string | number)[], target: readonly (string | number)[]): boolean {
  return path.length === target.length && path.every((segment, index) => segment === target[index]);
}
