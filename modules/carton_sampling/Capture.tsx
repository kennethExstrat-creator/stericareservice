"use client";

// The carton list (BUILD_SPEC 6.1 carton_sampling, 8 "Speed"): per ordered
// size, the numbers of the cartons sampled, as a table in the order they
// were entered (15 rows a page), and one field on the numeric keypad for the
// next. Enter or Add
// puts the typed number in the list; a pasted list (numbers between spaces,
// commas, semicolons or new lines) goes in at once. A number the size lists
// already, or text that is no carton number, is refused at the field with a
// short message and not added (edit.ts). A number above the order quantity
// is added and turns red at once, with calc's problem below the list and a
// link to its row (6.2 rule 6). A list saved from the earlier grid shows its
// numbers only; the first edit stores it without the blanks.
import { useRef, useState, type ClipboardEvent, type KeyboardEvent, type MouseEvent } from "react";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, Trash2Icon } from "lucide-react";
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
  // The page of each size's carton table: kept here, so an issue link can open the one its carton is on.
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({});
  const setPage = (size: string, page: number) => setPages((current) => ({ ...current, [size]: page }));

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
      if (path[0] !== "sizes" || typeof path[1] !== "string" || !context.sizes.includes(path[1])) return;
      setActive(path[1]);
      if (path[2] === "cartonNumbers" && typeof path[3] === "number") {
        const position = entriesOf(data.sizes[path[1]]?.cartonNumbers ?? []).findIndex((entry) => entry.index === path[3]);
        if (position >= 0) setPage(path[1], pageOf(position));
      }
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
          problems={rowProblems(own, size, entries)}
          readOnly={readOnly}
          page={pages[size] ?? 0}
          onPageChange={(page) => setPage(size, page)}
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

/** Rows on one page of a size's carton table (Kenneth, 11 October 2026). */
export const CARTONS_PER_PAGE = 15;

/** The page of the table that shows the entry at `position` (its place on screen). */
export function pageOf(position: number): number {
  return Math.floor(Math.max(position, 0) / CARTONS_PER_PAGE);
}

/**
 * One size's carton numbers as a table, in the order entered, 15 rows a
 * page, each row with its delete button; then the field that adds the
 * next. Read-only, the table only. Each row takes an issue link's focus
 * itself (tabindex -1; the screen opens its page first) and tags the photos
 * taken while it has the focus with its carton. Adding a number shows the
 * last page, where it went.
 */
function CartonList({
  size,
  name,
  captionId,
  entries,
  problems,
  readOnly,
  page,
  onPageChange,
  onAdd,
  onRemove,
  onFocusChange,
}: {
  size: string;
  /** The size's caption in the template's words: "M (Carton #)". */
  name: string;
  captionId: string;
  entries: readonly CartonEntry[];
  /** calc's message for each row in trouble, by its place in the stored list. */
  problems: ReadonlyMap<number, string>;
  readOnly: boolean;
  /** The page shown, from 0 (the screen keeps it, so an issue link can open a page). */
  page: number;
  onPageChange: (page: number) => void;
  /** Adds the entries to the size; returns what it added and what it left out. */
  onAdd: (entries: readonly string[]) => AddedCartons;
  /** The row's place in the stored list and the carton it shows. */
  onRemove: (index: number, carton: number) => void;
  onFocusChange?: (focus: CaptureFocus) => void;
}) {
  const id = idFor(size);
  // The field's issue path: calc's count issue lands here, and so does the screen's list of entries to retype.
  const path = ["sizes", size, "cartonNumbers"] as const;
  const field = useRef<HTMLInputElement>(null);
  const body = useRef<HTMLTableSectionElement>(null);
  const pages = Math.max(1, Math.ceil(entries.length / CARTONS_PER_PAGE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const first = current * CARTONS_PER_PAGE;
  const shown = entries.slice(first, first + CARTONS_PER_PAGE);
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
  /** After an add: the last page, where the new numbers went. */
  const showLast = (added: number) => {
    if (added > 0) onPageChange(pageOf(entries.length + added - 1));
  };

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
    showLast(outcome.added.length);
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
    showLast(outcome.added.length);
    announce(text);
  };

  const remove = (entry: CartonEntry, row: number, event: MouseEvent<HTMLButtonElement>) => {
    // A row deleted from the keyboard hands its focus on: to the next row's button, else the one before, else the field.
    const button = event.currentTarget;
    if (button.ownerDocument.activeElement === button) {
      const buttons = body.current?.querySelectorAll<HTMLButtonElement>("button[data-remove]") ?? [];
      (buttons[row + 1] ?? buttons[row - 1] ?? field.current)?.focus();
    }
    onRemove(entry.index, entry.carton);
    announce(`Carton ${entry.carton} removed.`);
  };

  const messageId = `${id}-message`;
  const hintId = `${id}-hint`;
  const hint = !readOnly && entries.length === 0 && message === null;
  const describedBy = [message ? messageId : null, hint ? hintId : null].filter(Boolean).join(" ");

  return (
    <div className="relative space-y-2">
      {entries.length > 0 ? (
        <div className="space-y-2">
          <div
            // Read-only there is no field: calc's count issue lands on the table.
            {...(readOnly ? issueNoticeProps(path) : {})}
            className="overflow-hidden rounded-lg bg-card ring-1 ring-border outline-none focus-ring-inset"
          >
            <table aria-labelledby={captionId} className="w-full text-sm tabular-nums touch:text-base">
              <thead className="bg-muted/60 text-left text-muted-foreground">
                <tr>
                  <th scope="col" className="w-16 px-3 py-2 font-medium">
                    No.
                  </th>
                  <th scope="col" className="px-3 py-2 font-medium">
                    Carton Number
                  </th>
                  {!readOnly && (
                    <th scope="col" className="w-14 px-2 py-2">
                      <span className="sr-only">Delete</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody ref={body}>
                {shown.map((entry, row) => {
                  const problem = problems.get(entry.index);
                  const problemId = `${id}-${entry.index}-problem`;
                  return (
                    <tr
                      key={`${entry.index}-${entry.carton}`}
                      id={`${id}-${entry.index}`}
                      tabIndex={-1}
                      {...issuePathProps([...path, entry.index])}
                      data-carton={entry.carton}
                      aria-describedby={problem ? problemId : undefined}
                      // Tags new photos with its carton while it, or its button, has the focus.
                      onFocus={() => onFocusChange?.({ size, box: entry.carton })}
                      className={cn("border-t border-border outline-none focus-ring-inset", problem && "bg-fail-tint text-fail")}
                    >
                      <td className="px-3 py-1.5 text-muted-foreground touch:py-1">{first + row + 1}</td>
                      <td className="px-3 py-1.5 font-medium touch:py-1">
                        <span className="inline-flex items-center gap-1.5">
                          {problem && <StatusIcon status="fail" className="size-3.5 shrink-0 touch:size-4" />}
                          {entry.carton}
                        </span>
                        {problem && (
                          <span id={problemId} className="block text-xs font-normal touch:text-sm">
                            {problem}
                          </span>
                        )}
                      </td>
                      {!readOnly && (
                        <td className="px-2 py-0.5 text-right">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            data-remove=""
                            title="Delete"
                            aria-label={`Delete Carton ${entry.carton}`}
                            aria-describedby={problem ? problemId : undefined}
                            onMouseDown={keepFocus}
                            onClick={(event) => remove(entry, row, event)}
                            className="text-destructive hover:bg-fail-tint hover:text-destructive"
                          >
                            <Trash2Icon aria-hidden />
                          </Button>
                        </td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {pages > 1 && (
            <nav aria-label={`${name}: pages`} className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted-foreground touch:text-base">
              <p className="tabular-nums">
                {first + 1}–{first + shown.length} of {entries.length}
              </p>
              <div className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Previous Page"
                  aria-label="Previous Page"
                  disabled={current === 0}
                  onClick={() => onPageChange(current - 1)}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                {Array.from({ length: pages }, (_, number) => (
                  <Button
                    key={number}
                    type="button"
                    variant={number === current ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={`Page ${number + 1}`}
                    aria-current={number === current ? "page" : undefined}
                    onClick={() => onPageChange(number)}
                    className="tabular-nums"
                  >
                    {number + 1}
                  </Button>
                ))}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Next Page"
                  aria-label="Next Page"
                  disabled={current === pages - 1}
                  onClick={() => onPageChange(current + 1)}
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
              </div>
            </nav>
          )}
        </div>
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

/**
 * calc's message for each chip in trouble, by its place in the stored list:
 * its own (above the order quantity, the repeat of a number), else that of
 * the number it repeats, so every chip of a carton entered twice is red.
 */
function rowProblems(own: readonly ValidationIssue[], size: string, entries: readonly CartonEntry[]): Map<number, string> {
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
