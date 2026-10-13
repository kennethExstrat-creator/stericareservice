"use client";

// The box/carton numbers (BUILD_SPEC 6.1 carton_sampling, 8 "Speed"; Kenneth,
// 13 October 2026: "just give a 10 row table by default to fill in, and do
// pagination, not adding 1 by 1"; box # and carton # are one number, worded
// "Box/Carton #"): per ordered size, a table of rows to fill in like a
// spreadsheet, 10 rows a page. It has a row for each case the sampling plan
// samples for the size, at least 10, more when more rows are saved, and 10
// more with each press of Add 10 Rows (the rare carton past the plan). Each
// row is a field on the numeric keypad: Enter or leaving the row stores its
// number, and Enter moves on to the next row, turning the page after a page's
// last row. A list pasted into a row fills it and the rows below. Text that
// is no box/carton number is refused at its row and kept there to correct
// (the screen's refused entries); a number another row of the size holds is
// refused at the row and not saved (edit.ts). A number above the order
// quantity is stored and turns its row red, with calc's problem below the
// table and a link to its row (6.2 rule 6). A row's clear button empties
// that row only: the data keeps each number in its row, so the rows below
// keep their place. Read-only, the table shows rows 1 to the last one filled.
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ClipboardEvent,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { flushSync } from "react-dom";
import { ChevronLeftIcon, ChevronRightIcon, PlusIcon, XIcon } from "lucide-react";
import {
  Figure,
  issueNoticeProps,
  issuePathProps,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  useRefusedEntryStore,
  type DataChange,
  type InvalidEntry,
  type IssuePath,
  type RefusedEntryStore,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { BOX_CARTON_LABEL, boxCartonNumber, formatCount, formatSize } from "@/lib/format";
import type { PerSizeResult } from "@/lib/schemas";
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
import type { CartonSamplingComputed, CartonSizeComputed } from "./calc";
import type { CartonSamplingConfig } from "./config";
import {
  ADDED_CARTON_ROWS,
  CARTONS_PER_PAGE,
  cartonPageOf,
  cartonRows,
  cartonRowsShown,
  clearCartonRow,
  nextCartonRow,
  pastedCartons,
  pasteCartons,
  pasteMessage,
  readTypedCarton,
  refusalMessage,
  setCartonRow,
  withoutTrailingBlanks,
  type CartonRefusal,
  type PastedCartons,
} from "./edit";
import { MAX_CARTONS_PER_SIZE, type CartonSamplingData } from "./schema";

type Props = CaptureProps<CartonSamplingData, CartonSamplingConfig, CartonSamplingComputed>;
type Update = (change: DataChange<CartonSamplingData>) => void;

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
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module (CaptureProps.focus).
  const [active, setActive] = useState(() => initialSize(context, focus));
  // Every write starts from the latest data, so a pasted list keeps every number (docs/CAPTURE_KIT.md).
  const update = useDataUpdater(data, onChange);
  // The page of each size's table, from 0: kept here, so an issue link can open the page its row is on.
  const [pages, setPages] = useState<Readonly<Record<string, number>>>({});
  // Rows asked for with Add 10 Rows, per size: the table shows at least this many.
  const [requested, setRequested] = useState<Readonly<Record<string, number>>>({});
  // The issue link being followed, the screen's or one under a table.
  const [linked, setLinked] = useState<IssuePath | null>(null);

  const label = (key: string) => labelFor(labels, key);
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes });
  const caption = (size: string) => label("sizeCaption").replace("{size}", sizeName(size));
  const issues = evaluation?.issues ?? [];

  // SizeTabs shows the first size when the active one is no longer ordered.
  const shown = context.sizes.includes(active) ? active : context.sizes[0];
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section opens.
  useReportShownSize(shown ?? null, onFocusChange);

  const setPage = (size: string, page: number) =>
    setPages((current) => (current[size] === page ? current : { ...current, [size]: page }));

  const reveal = (path: IssuePath) => {
    const size = path[1];
    if (path[0] !== "sizes" || typeof size !== "string" || !context.sizes.includes(size)) return;
    setActive(size);
    const index = path[3];
    if (path[2] === "cartonNumbers" && typeof index === "number") setPage(size, cartonPageOf(index));
  };
  // The size and the page are revealed in the render that hands the link to useIssueFocus, so the
  // row is on screen when it looks for its field: before the page turned, the closest marked
  // element would be the count's line, and the link would land there.
  const follow = (path: IssuePath) => {
    reveal(path);
    setLinked(path);
  };
  // The screen's link, followed as it arrives (React's "adjusting state when a prop changes"). Its
  // array as it is: a landing after a reload (revealOnlyPath) still only reveals.
  const [screenLink, setScreenLink] = useState<IssuePath | null>(null);
  if (focusPath !== screenLink) {
    setScreenLink(focusPath);
    if (focusPath) follow(focusPath);
  }
  useIssueFocus(linked, { root, reveal });

  // Before 13 October 2026 one field added the numbers, and kept the text it refused at the
  // list's own path, where no row shows it: let go, it would wait in Pending for a field gone.
  const refusedStore = useRefusedEntryStore();
  const ordered = context.sizes.join("\n");
  useEffect(() => {
    if (readOnly || !refusedStore) return;
    for (const size of ordered.split("\n")) {
      if (size !== "") refusedStore.set(["sizes", size, "cartonNumbers"], null);
    }
  }, [readOnly, refusedStore, ordered]);

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
        {(size) => (
          <CartonTable
            size={size}
            caption={caption(size)}
            samplingLabel={label("samplingQuantity")}
            rows={cartonRows(data, size)}
            planned={samplingFor(context, size).cases}
            facts={evaluation?.computed.sizes?.[size]}
            result={evaluation?.result.perSize?.[size]}
            issues={issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size)}
            readOnly={readOnly}
            update={update}
            page={pages[size] ?? 0}
            onPage={(page) => setPage(size, page)}
            requested={requested[size] ?? 0}
            onRequest={(rows) => setRequested((current) => ({ ...current, [size]: rows }))}
            // A new array for every click, so the same link twice still works.
            onIssue={(path) => follow([...path])}
            onFocusChange={onFocusChange}
          />
        )}
      </SizeTabs>
    </div>
  );
}

type TableProps = {
  size: string;
  /** The size's caption in the template's words: "M (Box/Carton #)". */
  caption: string;
  /** The template's "Sampling Quantity". */
  samplingLabel: string;
  /** The size's rows as stored: index i is row i + 1, null an empty row. */
  rows: readonly (number | null)[];
  /** The sampling plan's cases for the size; null until it gives them. */
  planned: number | null;
  facts: CartonSizeComputed | undefined;
  result: PerSizeResult | undefined;
  /** calc's issues about this size, in row order. */
  issues: readonly ValidationIssue[];
  readOnly: boolean;
  update: Update;
  /** The page shown, from 0 (Capture keeps it, so an issue link can turn it). */
  page: number;
  onPage: (page: number) => void;
  /** Rows asked for with Add 10 Rows. */
  requested: number;
  onRequest: (rows: number) => void;
  /** Follows a link under the table: its row's page turns before the focus moves. */
  onIssue: (path: IssuePath) => void;
  onFocusChange?: (focus: CaptureFocus) => void;
};

/** What the last pasted list did, across the table's foot until dismissed or the next paste. */
type PasteNote = {
  readonly text: string;
  /** Something was left out: in red. */
  readonly leftOut: boolean;
  /** The row the paste left the focus in (the row pasted into when it filled none): Dismiss goes back there. */
  readonly row: number;
};

/** A press that leaves the focus where it is: the keyboard stays up on the iPad while numbers go in. */
const keepFocus = (event: MouseEvent) => event.preventDefault();

/**
 * One size: its caption and Sampling Quantity, the table of rows, Add 10 Rows
 * and the pages, then calc's issues with links and the size's result.
 */
function CartonTable({
  size,
  caption,
  samplingLabel,
  rows: stored,
  planned,
  facts,
  result,
  issues,
  readOnly,
  update,
  page,
  onPage,
  requested,
  onRequest,
  onIssue,
  onFocusChange,
}: TableProps) {
  const id = idFor(size);
  const captionId = `${id}-caption`;
  const beyondId = `${id}-beyond`;
  const noteId = `${id}-paste`;
  // calc's count issue lands on the Sampling Quantity line, the count it is about.
  const countPath = ["sizes", size, "cartonNumbers"] as const;
  // Rows up to the last one filled: empty rows at the end, which the screen never stores, are not counted.
  const filledRows = withoutTrailingBlanks(stored).length;
  // Read-only: rows 1 to the last one filled. To fill in: the plan's rows, at least 10.
  const total = readOnly ? filledRows : cartonRowsShown(planned, filledRows, requested);
  const pageCount = Math.max(1, Math.ceil(total / CARTONS_PER_PAGE));
  // The page asked for, the last one when rows have gone since it was turned.
  const shownPage = Math.min(Math.max(page, 0), pageCount - 1);
  const first = shownPage * CARTONS_PER_PAGE;
  const indices = Array.from({ length: Math.max(0, Math.min(CARTONS_PER_PAGE, total - first)) }, (_, offset) => first + offset);
  const count = facts?.samplingQuantity ?? stored.filter((carton) => carton !== null).length;
  const problems = rowProblems(issues, size, stored);
  // The screen's refused entries, by each row's path (null read-only, or outside the capture screen).
  const store = useRefusedEntryStore();
  const frame = useRef<HTMLDivElement>(null);
  // A polite live region; a repeat alternates a trailing no-break space, so it is said again.
  const [spoken, setSpoken] = useState("");
  const announce = (text: string) => setSpoken((current) => (current === text ? `${text}\u00a0` : text));
  const [note, setNote] = useState<PasteNote | null>(null);
  // A row to focus once it is on screen, should a paste's rows not be rendered yet when its page turned.
  const pendingFocus = useRef<number | null>(null);

  const inputId = (index: number) => `${id}-${index}`;
  /** Puts the focus in row `index` when it is on screen, its text selected (also when it had the focus already). */
  const focusRow = (index: number): boolean => {
    const input = document.getElementById(inputId(index));
    if (!(input instanceof HTMLInputElement)) return false;
    input.focus();
    input.select();
    return true;
  };
  useLayoutEffect(() => {
    const index = pendingFocus.current;
    if (index === null) return;
    pendingFocus.current = null;
    focusRow(index);
  });

  /** Stores what is half typed in a row (its blur) before the rows on screen change. */
  const leaveRow = () => {
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && frame.current?.contains(focused)) focused.blur();
  };

  /** Puts the focus in row `index`, its page turned within the press, so the iPad keeps its keypad up. */
  const goToRow = (index: number) => {
    const target = cartonPageOf(index);
    if (target !== shownPage) flushSync(() => onPage(target));
    focusRow(index);
  };

  const turn = (next: number) => {
    leaveRow();
    onPage(next);
  };

  /** Stores `carton` in row `index` (null empties it); the refusal when another row holds it. */
  const write = (index: number, carton: number | null): CartonRefusal | null => {
    const outcome: { refusal: CartonRefusal | null } = { refusal: null };
    // update runs the change at once, so the refusal is known on return.
    update((current) => {
      const change = setCartonRow(current, size, index, carton);
      outcome.refusal = change.refusal;
      return change.data;
    });
    return outcome.refusal;
  };

  const clear = (index: number) => {
    update((current) => clearCartonRow(current, size, index));
    announce(`Row ${index + 1} cleared.`);
  };

  const move = (index: number, step: 1 | -1) => {
    // Never past the rows shown: Add 10 Rows makes more.
    const target = nextCartonRow(index, total, step);
    if (target !== null) goToRow(target);
  };

  /**
   * A list pasted into row `index`: it fills that row and the rows below. The page holding the last
   * row filled shows, and the focus goes to the row after it, ready for the next number; where that
   * row starts another page, or there is none, to the last row filled, its number selected.
   */
  const paste = (index: number, entries: readonly string[]) => {
    const outcome: { pasted?: PastedCartons } = {};
    update((current) => {
      outcome.pasted = pasteCartons(current, size, index, entries);
      return outcome.pasted.data;
    });
    const pasted = outcome.pasted;
    if (!pasted) return;
    const text = pasteMessage(pasted);
    const leftOut = pasted.refused.length > 0;
    announce(text);
    const last = pasted.placed.at(-1)?.index;
    if (last === undefined) {
      // Nothing filled: the row pasted into keeps the focus and what it held.
      setNote({ text, leftOut, row: index });
      return;
    }
    const lastPage = cartonPageOf(last);
    // The rows once the paste is stored: the table grows to hold the last row filled.
    const next = nextCartonRow(last, cartonRowsShown(planned, Math.max(filledRows, last + 1), requested), 1);
    const target = next !== null && cartonPageOf(next) === lastPage ? next : last;
    setNote({ text, leftOut, row: target });
    // The paste's rows on screen within the press, so the focus moves there and the keypad stays up.
    flushSync(() => {
      if (lastPage !== shownPage) onPage(lastPage);
    });
    if (!focusRow(target)) pendingFocus.current = target;
  };

  /** Ten more rows, for the rare carton past the plan; the focus goes to the first of them. */
  const addRows = () => {
    const index = total;
    const rows = Math.min(MAX_CARTONS_PER_SIZE, total + ADDED_CARTON_ROWS);
    if (rows <= index) return;
    leaveRow();
    flushSync(() => {
      onRequest(rows);
      onPage(cartonPageOf(index));
    });
    focusRow(index);
    announce(`Rows ${formatCount(index + 1)} to ${formatCount(rows)} added.`);
  };

  const dismissNote = () => {
    const row = note?.row;
    setNote(null);
    // Back where the paste went, else into the page shown.
    if (row === undefined || !focusRow(row)) focusRow(first);
  };

  return (
    <div className="relative space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 id={captionId} className="text-base font-semibold text-foreground">
          {caption}
        </h3>
        <p
          {...issueNoticeProps(countPath)}
          className="relative rounded-sm text-sm text-muted-foreground outline-none focus-ring touch:text-base"
        >
          {samplingLabel}{" "}
          <span className="font-semibold text-foreground tabular-nums">
            <Figure value={count} grouping /> / <Figure value={planned} grouping />
          </span>
        </p>
      </div>

      {total > 0 ? (
        <div ref={frame} className="relative overflow-hidden rounded-lg bg-card ring-1 ring-border">
          <table aria-labelledby={captionId} className="w-full text-sm tabular-nums touch:text-base">
            <thead className="bg-muted/60 text-left text-muted-foreground">
              <tr>
                <th scope="col" className="w-16 px-3 py-2 font-medium">
                  No.
                </th>
                {/* Lined up with the numbers: 10 px in, as the row's field has its text; 12 px read-only. */}
                <th scope="col" className={cn("py-2 font-medium", readOnly ? "px-3" : "px-2.5")}>
                  {BOX_CARTON_LABEL}
                </th>
                {!readOnly && (
                  <th scope="col" className="w-14 px-2 py-2">
                    <span className="sr-only">Clear</span>
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {indices.map((index) =>
                readOnly ? (
                  <ReadOnlyRow
                    key={index}
                    id={inputId(index)}
                    index={index}
                    carton={stored[index] ?? null}
                    problem={problems.get(index)}
                    path={[...countPath, index]}
                  />
                ) : (
                  <CartonRow
                    key={index}
                    size={size}
                    index={index}
                    value={stored[index] ?? null}
                    inputId={inputId(index)}
                    name={`${caption}, No. ${index + 1}`}
                    problem={problems.get(index)}
                    beyondId={planned !== null && index >= planned ? beyondId : undefined}
                    last={index === total - 1}
                    store={store}
                    onWrite={write}
                    onClear={clear}
                    onPaste={paste}
                    onMove={move}
                    onAnnounce={announce}
                    onFocusChange={onFocusChange}
                  />
                ),
              )}
            </tbody>
          </table>
          {note && !readOnly && (
            <div
              data-slot="carton-paste-note"
              className={cn(
                "flex items-start gap-2 border-t px-3 py-1.5 text-sm touch:text-base",
                note.leftOut ? "border-fail-border bg-fail-tint text-fail" : "border-border bg-slate-50 text-muted-foreground",
              )}
            >
              {note.leftOut && <StatusIcon status="fail" className="mt-0.5 size-4 shrink-0 touch:mt-1" />}
              <p id={noteId} className="min-w-0 flex-1 self-center">
                {note.text}
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-describedby={noteId}
                onClick={dismissNote}
                className={cn(
                  "-my-1 shrink-0 touch:-my-1.5 touch:text-base",
                  note.leftOut && "text-fail hover:bg-fail-border/40 hover:text-fail",
                )}
              >
                Dismiss
              </Button>
            </div>
          )}
        </div>
      ) : (
        <p className="text-sm text-muted-foreground touch:text-base">No box/carton numbers entered.</p>
      )}
      {!readOnly && planned !== null && total > planned && (
        <span id={beyondId} className="sr-only">
          Beyond the {formatCount(planned)} {planned === 1 ? "case" : "cases"} sampled.
        </span>
      )}

      {(!readOnly || pageCount > 1) && total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          {!readOnly && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="border border-dashed border-input"
              disabled={total >= MAX_CARTONS_PER_SIZE}
              onClick={addRows}
            >
              <PlusIcon aria-hidden data-icon="inline-start" />
              Add 10 Rows
            </Button>
          )}
          {pageCount > 1 && (
            <nav
              aria-label={`${caption}: pages`}
              className="ml-auto flex flex-wrap items-center gap-2 text-sm text-muted-foreground touch:text-base"
            >
              <p className="tabular-nums">
                {formatCount(first + 1)}–{formatCount(first + indices.length)} of {formatCount(total)}
              </p>
              <div className="flex flex-wrap items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  title="Previous Page"
                  aria-label="Previous Page"
                  disabled={shownPage === 0}
                  onClick={() => turn(shownPage - 1)}
                >
                  <ChevronLeftIcon aria-hidden />
                </Button>
                {Array.from({ length: pageCount }, (_, number) => (
                  <Button
                    key={number}
                    type="button"
                    variant={number === shownPage ? "secondary" : "ghost"}
                    size="icon-sm"
                    aria-label={`Page ${number + 1}`}
                    aria-current={number === shownPage ? "page" : undefined}
                    onClick={() => turn(number)}
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
                  disabled={shownPage === pageCount - 1}
                  onClick={() => turn(shownPage + 1)}
                >
                  <ChevronRightIcon aria-hidden />
                </Button>
              </div>
            </nav>
          )}
        </div>
      )}

      {!readOnly && count === 0 && (
        <p className="text-sm text-muted-foreground touch:text-base">
          Type each box/carton number in its row; Enter moves to the next. Paste a list into a row to fill the rows below.
        </p>
      )}

      {issues.length > 0 && (
        <ul className="space-y-1">
          {issues.map((issue) => (
            <li key={`${issue.code}-${issue.path.join("/")}`}>
              <button
                type="button"
                onClick={() => {
                  leaveRow();
                  onIssue(issue.path);
                }}
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
      <span className="sr-only" aria-live="polite">
        {spoken}
      </span>
    </div>
  );
}

type RowProps = {
  size: string;
  /** The row's place, from 0: row `index + 1`, its place in the stored list. */
  index: number;
  /** The box/carton number the row holds; null while it is empty. */
  value: number | null;
  inputId: string;
  /** "M (Box/Carton #), No. 5": the field's name, and its refused text's in the Pending panel. */
  name: string;
  /** calc's message about the number the row holds. */
  problem: string | undefined;
  /** Past the sampling plan's cases: shaded, and described so. */
  beyondId: string | undefined;
  /** The last row shown: Enter has no row to go to. */
  last: boolean;
  store: RefusedEntryStore | null;
  onWrite: (index: number, carton: number | null) => CartonRefusal | null;
  onClear: (index: number) => void;
  onPaste: (index: number, entries: readonly string[]) => void;
  onMove: (index: number, step: 1 | -1) => void;
  onAnnounce: (text: string) => void;
  onFocusChange?: (focus: CaptureFocus) => void;
};

/**
 * One row to fill in: its No., its field on the numeric keypad and, while
 * it holds something, its clear button. The field takes an issue link's
 * focus (its path is the row's), tags the photos taken while it has the
 * focus with its carton, and says under itself why text was refused.
 */
function CartonRow({
  size,
  index,
  value,
  inputId,
  name,
  problem,
  beyondId,
  last,
  store,
  onWrite,
  onClear,
  onPaste,
  onMove,
  onAnnounce,
  onFocusChange,
}: RowProps) {
  const input = useRef<HTMLInputElement>(null);
  const path = ["sizes", size, "cartonNumbers", index] as const;
  // What is being typed; null while the row shows what it holds. The ref keeps a commit on Enter
  // from being repeated by the blur that follows.
  const [draft, setDraftState] = useState<string | null>(null);
  const draftRef = useRef<string | null>(null);
  const setDraft = (next: string | null) => {
    draftRef.current = next;
    setDraftState(next);
  };
  // A number another row holds: refused and not saved, said under the row, never kept.
  const [notice, setNotice] = useState<{ readonly raw: string; readonly text: string } | null>(null);
  // It is about the row as it stood: the row's number changing since (a list pasted from a row above) ends it.
  const [noticeValue, setNoticeValue] = useState(value);
  if (value !== noticeValue) {
    setNoticeValue(value);
    if (notice) setNotice(null);
  }
  // Text that is no box/carton number: kept in the screen's store, so it outlives the row (another
  // page, size or section, a reload), else the row's own.
  const [ownKept, setOwnKept] = useState<InvalidEntry | null>(null);
  const stored = store ? (store.get(path) ?? null) : ownKept;
  // Shown only while the row holds no number: a number stored since replaces it.
  const kept = value === null ? stored : null;
  const keep = (entry: InvalidEntry) => (store ? store.set(path, entry, name) : setOwnKept(entry));
  const letGo = () => (store ? store.set(path, null) : setOwnKept(null));
  // Arriving in a row selects its text, so typing replaces it; Safari clears that on the click's mouseup.
  const keepSelection = useRef(false);

  /** Stores the typed text (Enter, or leaving the row). False when it was refused. */
  const commit = (raw: string, leaving: boolean): boolean => {
    const typed = readTypedCarton(raw);
    if (typed.kind === "refused") {
      const text = refusalMessage(typed.refusal);
      keep({ raw, error: text });
      setNotice(null);
      setDraft(null);
      // Refused text never leaves a number behind it, as a number field's: the row is empty.
      onWrite(index, null);
      onAnnounce(`${name}: ${text}`);
      return false;
    }
    const carton = typed.kind === "carton" ? typed.carton : null;
    const refusal = onWrite(index, carton);
    if (refusal) {
      const text = refusalMessage(refusal);
      setNotice({ raw, text });
      // Enter keeps the text to correct; leaving the row puts back what it holds.
      setDraft(leaving ? null : raw);
      onAnnounce(text);
      return false;
    }
    letGo();
    setNotice(null);
    setDraft(null);
    if (carton !== null) onFocusChange?.({ size, box: carton });
    return true;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Enter") {
      // Enter never submits a form.
      event.preventDefault();
      const raw = draftRef.current;
      if (raw !== null && !commit(raw, false)) {
        // Refused: the text stays, selected, so typing replaces it.
        event.currentTarget.select();
        return;
      }
      onMove(index, event.shiftKey ? -1 : 1);
    } else if (event.key === "Escape" && (draftRef.current !== null || notice !== null)) {
      // Escape drops what was typed; with nothing typed it is left alone (it may close a dialog).
      event.preventDefault();
      setDraft(null);
      setNotice(null);
    }
  };

  const onFocus = (event: FocusEvent<HTMLInputElement>) => {
    event.currentTarget.select();
    keepSelection.current = true;
    // New photos are tagged with the row's carton, else with the size.
    onFocusChange?.(value === null ? { size } : { size, box: value });
  };

  const onBlur = () => {
    keepSelection.current = false;
    const raw = draftRef.current;
    if (raw === null) return;
    // A number refused as it stands is not refused again: the row puts back what it holds.
    if (notice !== null && raw === notice.raw) {
      setDraft(null);
      return;
    }
    commit(raw, true);
  };

  const onPasteText = (event: ClipboardEvent<HTMLInputElement>) => {
    const entries = pastedCartons(event.clipboardData.getData("text"));
    // One number (or none) goes in as typed text, stored with Enter or on leaving the row.
    if (!entries) return;
    event.preventDefault();
    setDraft(null);
    setNotice(null);
    onPaste(index, entries);
  };

  const clearRow = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const fromKeyboard = button.ownerDocument.activeElement === button;
    setDraft(null);
    setNotice(null);
    letGo();
    onClear(index);
    // The button goes with what the row held. From the keyboard the focus moves into the row,
    // ready to type; a press leaves it where it was (keepFocus).
    if (fromKeyboard) {
      input.current?.focus();
      onFocusChange?.({ size });
    }
  };

  const display = draft ?? kept?.raw ?? (value === null ? "" : String(value));
  // Refused text's reason shows until what is typed over it is a box/carton number, as a number field's.
  const keptError = kept !== null && (draft === null || readTypedCarton(draft).kind !== "carton") ? kept.error : null;
  const refused = keptError !== null || (notice !== null && draft === notice.raw);
  // calc's problem is about the number the row holds: that number turns red, under a refusal's reason.
  const calcProblem = keptError === null && notice === null && value !== null ? problem : undefined;
  const message = keptError ?? notice?.text ?? calcProblem;
  const messageId = `${inputId}-message`;
  const describedBy = [message ? messageId : null, beyondId ?? null].filter(Boolean).join(" ");
  const filled = value !== null || kept !== null;

  return (
    <tr className={cn("border-t border-border", message ? "bg-fail-tint" : beyondId && "bg-slate-50")}>
      {/* Its line as tall as the field, so the No. sits level with the number when a message grows the row. */}
      <td className="w-16 px-3 align-top leading-9 text-muted-foreground touch:leading-11">{index + 1}</td>
      <td className="p-0 align-top">
        <input
          ref={input}
          id={inputId}
          type="text"
          inputMode="numeric"
          enterKeyHint={last ? "done" : "next"}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          aria-label={name}
          aria-invalid={refused || undefined}
          aria-describedby={describedBy || undefined}
          {...issuePathProps(path)}
          value={display}
          onChange={(event) => {
            setDraft(event.target.value);
            // What the notice said was about the text before.
            if (notice) setNotice(null);
          }}
          onKeyDown={onKeyDown}
          onFocus={onFocus}
          onMouseUp={(event) => {
            if (keepSelection.current) event.preventDefault();
            keepSelection.current = false;
          }}
          onBlur={onBlur}
          onPaste={onPasteText}
          data-slot="carton-cell"
          className={cn(
            // A spreadsheet cell, as the kit's numeric cells: no frame of its own, the inset ring on focus.
            "block h-9 w-full min-w-0 rounded-none bg-transparent px-2.5 text-sm font-medium tabular-nums outline-none focus-visible:bg-card focus-ring-inset touch:h-11 touch:text-base",
            "aria-invalid:bg-fail-tint aria-invalid:text-fail aria-invalid:ring-2 aria-invalid:ring-fail aria-invalid:ring-inset",
            calcProblem && "text-fail",
          )}
        />
        {message && (
          <p id={messageId} className="flex items-start gap-1.5 px-2.5 pb-1.5 text-xs text-fail touch:text-sm">
            <StatusIcon status="fail" className="mt-px size-3.5 shrink-0 touch:size-4" />
            <span>{message}</span>
          </p>
        )}
      </td>
      <td className="w-14 px-2 py-0.5 text-right align-top touch:py-0">
        {filled && (
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            data-clear=""
            title="Clear"
            aria-label={value !== null ? `Clear ${boxCartonNumber(value)}` : `Clear No. ${index + 1}`}
            aria-describedby={message ? messageId : undefined}
            onMouseDown={keepFocus}
            onClick={clearRow}
            className="text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <XIcon aria-hidden />
          </Button>
        )}
      </td>
    </tr>
  );
}

/**
 * A row read-only: its No. and its box/carton number, a dash for a row left
 * empty. It takes an issue link's focus itself (tabindex -1; the screen
 * opens its page first).
 */
function ReadOnlyRow({
  id,
  index,
  carton,
  problem,
  path,
}: {
  id: string;
  index: number;
  carton: number | null;
  problem: string | undefined;
  path: IssuePath;
}) {
  const problemId = `${id}-problem`;
  return (
    <tr
      id={id}
      tabIndex={-1}
      {...issuePathProps(path)}
      data-carton={carton ?? undefined}
      aria-describedby={problem ? problemId : undefined}
      className={cn("border-t border-border outline-none focus-ring-inset", problem && "bg-fail-tint text-fail")}
    >
      <td className="w-16 px-3 py-2 text-muted-foreground touch:py-2.5">{index + 1}</td>
      <td className="px-3 py-2 font-medium touch:py-2.5">
        {carton === null ? (
          <Figure value={null} />
        ) : (
          <span className="inline-flex items-center gap-1.5">
            {problem && <StatusIcon status="fail" className="size-3.5 shrink-0 touch:size-4" />}
            {carton}
          </span>
        )}
        {problem && (
          <span id={problemId} className="block text-xs font-normal touch:text-sm">
            {problem}
          </span>
        )}
      </td>
    </tr>
  );
}

/**
 * calc's message for each row in trouble, by its row: its own (above the
 * order quantity, the repeat of a number), else that of the number it
 * repeats, so every row of a carton entered twice is red.
 */
function rowProblems(own: readonly ValidationIssue[], size: string, rows: readonly (number | null)[]): Map<number, string> {
  const at = (index: number) => ["sizes", size, "cartonNumbers", index];
  const places = new Map<number, number[]>();
  rows.forEach((carton, index) => {
    if (carton !== null) places.set(carton, [...(places.get(carton) ?? []), index]);
  });
  const problems = new Map<number, string>();
  rows.forEach((carton, index) => {
    if (carton === null) return;
    const repeats = places.get(carton) ?? [];
    const issue =
      own.find((candidate) => candidate.level === "error" && samePath(candidate.path, at(index))) ??
      (repeats.length > 1
        ? own.find((candidate) => candidate.code === "carton_duplicate" && samePath(candidate.path, at(repeats[1])))
        : undefined);
    if (issue) problems.set(index, issue.message);
  });
  return problems;
}

function idFor(size: string): string {
  return `carton-sampling-${size}`;
}

function samePath(path: readonly (string | number)[], target: readonly (string | number)[]): boolean {
  return path.length === target.length && path.every((segment, index) => segment === target[index]);
}
