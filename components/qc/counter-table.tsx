"use client";

// Counts by tapping (BUILD_SPEC 8 "Speed"): rows of labels in the template's
// order and wording (defects, hole locations) by columns (sizes, or boxes),
// each cell a Stepper. Like the reports, each column shows the number
// inspected and its Accept / Reject limit on top, and the computed total and
// a live accept/reject chip at the bottom (6.2 rule 2: never typed). With a
// hand split every column has Right and Left sub-columns sharing one total
// and one decision. Given `activeColumn` as SizeTabs' panel, the table shows
// the size the tabs show and follows their layout: one size at a time, or
// every size side by side from 1280 px when SizeTabs has room for this table
// (it reports the width it needs). Its header rows stick below the size bar and
// its totals to the bottom of the screen while the table is in view. The
// label column has a fixed width, so a label sits next to its steppers and
// stacked tables (defect classes) line up, and a minimum, so a table wider
// than its frame scrolls sideways instead of squeezing the labels.
import { useContext, useEffect, useId, useRef, useState, type FormEvent, type ReactNode, type RefObject } from "react";
import { FlagIcon, PlusIcon, XIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type Status } from "@/lib/design/status";
import { formatCount, formatLimitParts, formatLimits, type AcceptanceLimits } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  columnStatus,
  columnTotal,
  counterAnnouncement,
  counterTableWidth,
  countOf,
  removalFocus,
  type CounterCell,
  type CounterHand,
  type CountReader,
} from "./counter-model";
import { HAND_WORD } from "./hand-toggle";
import { issuePathProps, type IssuePath } from "./issue-path";
import { activeColumnKey } from "./selection";
import { SizeTabsContext } from "./size-tabs-context";
import { StatusPill } from "./status-pill";
import { Stepper } from "./stepper";
import { COARSE_QUERY, useMediaQuery } from "./use-media-query";

export type CounterRow = {
  /** Defect or location code; a one-off label gets a key of its own. */
  key: string;
  /** In the template's wording. */
  label: string;
  /** A one-off label with no defect code yet: flagged for an admin. */
  unmapped?: boolean;
  /** A short definition under the label, e.g. Safedon's "Cuff should be at least 2 cm out". */
  hint?: string;
  /**
   * A row the inspector added (a one-off label): with onRemoveRow it can be
   * taken off again while it counts nothing in any column, e.g. one added by
   * mistake.
   */
  removable?: boolean;
};

export type CounterColumn = {
  /** Size ("M") or box ("253"). */
  key: string;
  /** Column heading: "M", "253". */
  label: string;
  /**
   * Shown in the heading cell instead of `label`, e.g. the box's BoxPicker,
   * as the Safedon sheet has the box numbers over its columns. `label` and
   * `name` still name the column for screen readers.
   */
  heading?: ReactNode;
  /** Accessible name in each stepper's label, e.g. "Size M" or "box 253". Defaults to the label. */
  name?: string;
  /** Samples inspected (from the sampling plan). Undefined hides the row for every column. */
  n?: number | null;
  /** Accept / Reject limits from the AQL plan. Undefined hides the limit row. */
  limits?: AcceptanceLimits | null;
  /**
   * calc's result for this column of this table: a defect class's result for
   * the size, never the size's overall result (`evaluation.result.perSize`).
   * With limits the chip is the live decision (total against Ac) and only a
   * not_done from calc overrides it; without limits this is the chip.
   */
  status?: Status;
};

export type CounterTableLabels = {
  /** Heading over the row labels. */
  rowHeader: string;
  inspected: string;
  /** Caption of the limit row, e.g. "Defect Limit". */
  limits: string;
  total: string;
  result: string;
  /** The result chip's words for accept and reject, e.g. "Passed" and "Failed". */
  accept: string;
  reject: string;
  /**
   * The words before the numbers in the limit row, as the template prints
   * them: "Accept" and "Reject" give "Accept 0 / Reject 1", "Acc. =" and
   * "Rej. =" give "Acc. = 0 / Rej. = 1". Without them: "Ac 0 / Re 1".
   */
  limitAccept?: string;
  limitReject?: string;
};

/** An extra computed row under the totals, e.g. Safedon's "1/125" and 0.008 per box. */
export type CounterSummaryRow = {
  key: string;
  label: string;
  render: (column: CounterColumn, total: number) => ReactNode;
};

const DEFAULT_LABELS: CounterTableLabels = {
  rowHeader: "Defect",
  inspected: "No. inspected",
  limits: "Defect limit",
  total: "Total defects found",
  result: "Result",
  accept: "Accept",
  reject: "Reject",
};

type CounterTableProps = {
  /** Accessible table name, e.g. "Major Defects (AQL 2.5)". */
  caption: string;
  rows: readonly CounterRow[];
  columns: readonly CounterColumn[];
  getCount: CountReader;
  onCountChange: (cell: CounterCell, count: number) => void;
  /** The hands recorded apart (handSplit): ["R", "L"]. Totals always count every one. */
  hands?: readonly CounterHand[];
  /** The hands on screen (from a HandToggle). Defaults to `hands`. */
  visibleHands?: readonly CounterHand[];
  /**
   * The column on screen one at a time (the size from SizeTabs). In SizeTabs'
   * panel (passed as a node, not a per-size function) the table follows the
   * tabs: a key that is not a column shows the size the tabs show, and every
   * column shows side by side only when SizeTabs does. Elsewhere: this column
   * below 1280 px, every column from 1280 px.
   */
  activeColumn?: string;
  /** Row and footer labels in the template's wording. */
  labels?: Partial<CounterTableLabels>;
  /** Default: shown when any column has `n`. */
  showInspected?: boolean;
  /** Default: shown when any column has `limits`. */
  showLimits?: boolean;
  /** Default: shown when any column has `limits` or `status`. */
  showResult?: boolean;
  summaryRows?: readonly CounterSummaryRow[];
  /** Enables "Other defect": called with the trimmed one-off label. */
  onAddRow?: (label: string) => void;
  addRowLabel?: string;
  /** Takes a removable row off (its key), offered while the row counts nothing. */
  onRemoveRow?: (key: string) => void;
  /** For photo tags: the cell that has focus. */
  onCellFocus?: (cell: CounterCell) => void;
  /** Marks each cell for issue links (useIssueFocus). */
  cellIssuePath?: (cell: CounterCell) => IssuePath;
  readOnly?: boolean;
  className?: string;
};

const HEAD = "border-b border-border bg-slate-50 px-3 py-2 text-center align-bottom font-semibold text-foreground";
const INFO =
  "border-b border-border bg-slate-50 px-3 py-1 text-center text-sm font-medium text-muted-foreground tabular-nums touch:text-base";
const FOOT = "border-b border-border bg-slate-50 px-3 py-1.5 text-center tabular-nums touch:py-2";
// The label column has a fixed width (COUNTER_WIDTHS.label), so labels sit
// next to their steppers and stacked tables line up, and a minimum of 14rem,
// 16rem from 1280 px (a cell's width is no minimum in table auto layout; its
// min-width is): a table wider than its frame (Safedon's boxes side by side)
// scrolls sideways with its labels readable, never one letter a line. A word
// too long for it (a one-off label typed as one word) breaks rather than
// widen it. It sticks while a wide table scrolls sideways; its edge is a
// shadow, so it draws over the first value column's border instead of
// doubling it.
const LABEL_COLUMN =
  "sticky left-0 w-64 min-w-56 xl:min-w-64 text-left [overflow-wrap:anywhere] shadow-[1px_0_0_var(--border)]";
// One value column has nothing to scroll to: from 1280 px its labels wrap to
// fit instead (labelling sets two levels' tables side by side there).
const ONE_COLUMN_LABEL = "xl:min-w-0";
const ROW_HEAD = "z-[1] border-b border-border bg-card px-3 align-middle font-normal text-foreground";

export function CounterTable({
  caption,
  rows,
  columns,
  getCount,
  onCountChange,
  hands,
  visibleHands,
  activeColumn,
  labels,
  showInspected,
  showLimits,
  showResult,
  summaryRows = [],
  onAddRow,
  addRowLabel = "Other defect",
  onRemoveRow,
  onCellFocus,
  cellIssuePath,
  readOnly = false,
  className,
}: CounterTableProps) {
  const tableId = useId();
  const sizeTabs = useContext(SizeTabsContext);
  const text: CounterTableLabels = { ...DEFAULT_LABELS, ...labels };
  const split = hands !== undefined && hands.length > 0;
  const shownHands = split ? (visibleHands ?? hands).filter((hand) => hands.includes(hand)) : [];
  const sides: readonly (CounterHand | undefined)[] = shownHands.length > 0 ? shownHands : [undefined];
  const span = sides.length;
  const labelColumn = cn(LABEL_COLUMN, columns.length * span === 1 && ONE_COLUMN_LABEL);

  // One column at a time, following SizeTabs when inside it.
  const active = activeColumn === undefined ? undefined : activeColumnKey(columns, activeColumn, sizeTabs?.size);
  const following = active !== undefined && sizeTabs !== null;
  const sideBySide = sizeTabs ? sizeTabs.sideBySide : true;

  // Tell SizeTabs how wide every column side by side would be, so it keeps
  // its tabs from 1280 px when they would not fit (a hand split, many sizes).
  const coarse = useMediaQuery(COARSE_QUERY);
  const needed = counterTableWidth(columns.length * span, coarse);
  const requireWidth = following ? sizeTabs.requireWidth : undefined;
  useEffect(() => {
    if (!requireWidth) return;
    requireWidth(tableId, needed);
    return () => requireWidth(tableId, null);
  }, [requireWidth, tableId, needed]);

  const withInspected = showInspected ?? columns.some((column) => column.n !== undefined);
  const withLimits = showLimits ?? columns.some((column) => column.limits !== undefined);
  const withResult = showResult ?? columns.some((column) => column.limits !== undefined || column.status !== undefined);

  const totals = new Map(columns.map((column) => [column.key, columnTotal(rows, column.key, hands, getCount)]));
  const totalOf = (column: CounterColumn) => totals.get(column.key) ?? 0;
  const statusOf = (column: CounterColumn) => columnStatus(totalOf(column), column);
  const resultLabel = (status: Status) =>
    status === "pass" ? text.accept : status === "fail" ? text.reject : STATUS_LABEL[status];

  // Inactive columns: hidden below 1280 px when sizes go side by side there, else at every width.
  const hidden = (column: CounterColumn) =>
    active !== undefined && column.key !== active ? (sideBySide ? "max-xl:hidden" : "hidden") : undefined;
  const nameOf = (column: CounterColumn) => column.name ?? column.label;
  const cellOf = (row: CounterRow, column: CounterColumn, hand: CounterHand | undefined): CounterCell =>
    hand ? { row: row.key, column: column.key, hand } : { row: row.key, column: column.key };

  // The last cell tapped. What is said about it is worked out from the props
  // rendered after the tap, so the verdict spoken is the one on the chip.
  const [touched, setTouched] = useState<CounterCell | null>(null);
  const [removed, setRemoved] = useState<string | null>(null);
  const change = (cell: CounterCell, next: number) => {
    onCountChange(cell, next);
    setTouched(cell);
    setRemoved(null);
    // Counting is being in that cell, for photo tags, however the count changed: a tap, a held
    // button (WebKit may send no click after it), a key (cellFocusProps).
    onCellFocus?.(cell);
  };
  const touchedColumn = touched ? columns.find((column) => column.key === touched.column) : undefined;
  const announcement =
    removed !== null
      ? `${removed} removed.`
      : touched && touchedColumn
        ? counterAnnouncement({
            count: countOf(getCount(touched)),
            column: nameOf(touchedColumn),
            total: totalOf(touchedColumn),
            verdict: withResult && statusOf(touchedColumn) !== "not_done" ? resultLabel(statusOf(touchedColumn)) : null,
          })
        : "";

  // A row comes off only while it counts nothing anywhere, so no tapped count is lost with it.
  const addRowButton = useRef<HTMLButtonElement | null>(null);
  const table = useRef<HTMLTableElement | null>(null);
  const body = useRef<HTMLTableSectionElement | null>(null);
  const canRemove = (row: CounterRow) =>
    row.removable === true &&
    onRemoveRow !== undefined &&
    !readOnly &&
    columns.every((column) => columnTotal([row], column.key, hands, getCount) === 0);
  const remove = (row: CounterRow, index: number) => {
    onRemoveRow?.(row.key);
    setTouched(null);
    setRemoved(row.label);
    // Its button goes with it: move the focus now, while the row is still there.
    const target = removalFocus(index, rows.length, addRowButton.current !== null);
    const next =
      target.to === "opener"
        ? addRowButton.current
        : target.to === "row"
          ? firstShownCount(body.current?.rows[target.index])
          : null;
    if (next) next.focus();
    else focusTable(table.current);
  };

  return (
    <div data-slot="counter-table" className={cn("min-w-0 space-y-3", className)}>
      {/* Following SizeTabs the table never scrolls sideways (it shows every
          size only where they fit), so its header and totals can stick to the
          screen. Elsewhere a wide table (many boxes) scrolls inside. */}
      <div
        className={cn(
          "relative w-fit max-w-full rounded-lg border border-border bg-card",
          following ? "overflow-clip" : active !== undefined ? "overflow-clip xl:overflow-x-auto" : "overflow-x-auto",
        )}
      >
        <table
          ref={table}
          className="border-separate border-spacing-0 text-sm outline-none focus-ring-inset touch:text-base"
        >
          <caption className="sr-only">{caption}</caption>
          <thead
            className={cn(
              following && "sticky top-[calc(var(--capture-sticky-top,0px)_+_var(--size-tabs-bar,0px))] z-[4]",
            )}
          >
            <tr>
              <th scope="col" rowSpan={split ? 2 : 1} className={cn(HEAD, labelColumn, "z-[2] font-semibold")}>
                {text.rowHeader}
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  colSpan={span}
                  className={cn(HEAD, "border-l whitespace-nowrap touch:text-base", hidden(column))}
                >
                  {column.heading ?? column.label}
                </th>
              ))}
            </tr>
            {split && (
              <tr>
                {columns.map((column) =>
                  sides.map((hand, index) => (
                    <th
                      key={`${column.key}:${hand}`}
                      scope="col"
                      className={cn(
                        HEAD,
                        "py-1 text-sm touch:text-base",
                        index === 0 ? "border-l" : "border-l border-l-slate-100",
                        hidden(column),
                      )}
                    >
                      {/* A word, not "L": size L can head the column above. */}
                      {hand && (
                        <>
                          {HAND_WORD[hand]}
                          <span className="sr-only"> hand</span>
                        </>
                      )}
                    </th>
                  )),
                )}
              </tr>
            )}
          </thead>

          {(withInspected || withLimits) && (
            <tbody>
              {withInspected && (
                <tr>
                  <th scope="row" className={cn(INFO, labelColumn, "z-[2]")}>
                    {text.inspected}
                  </th>
                  {columns.map((column) => (
                    <td key={column.key} colSpan={span} className={cn(INFO, "border-l", hidden(column))}>
                      {formatCount(column.n ?? null, "—")}
                    </td>
                  ))}
                </tr>
              )}
              {withLimits && (
                <tr>
                  <th scope="row" className={cn(INFO, labelColumn, "z-[2]")}>
                    {text.limits}
                  </th>
                  {columns.map((column) => {
                    const words = { accept: text.limitAccept, reject: text.limitReject };
                    const parts = formatLimitParts(column.limits, words);
                    return (
                      <td key={column.key} colSpan={span} className={cn(INFO, "border-l", hidden(column))}>
                        {parts ? (
                          // Read in one piece; shown in two halves, so long wording wraps after
                          // the slash ("Accept 10 /" over "Reject 11") and the column keeps its width.
                          <>
                            <span className="sr-only">{formatLimits(column.limits, words)}</span>
                            <span aria-hidden className="whitespace-nowrap">
                              {parts[0]}
                            </span>{" "}
                            <span aria-hidden className="whitespace-nowrap">
                              {parts[1]}
                            </span>
                          </>
                        ) : (
                          "—"
                        )}
                      </td>
                    );
                  })}
                </tr>
              )}
            </tbody>
          )}

          <tbody ref={body}>
            {rows.map((row, rowIndex) => (
              <tr key={row.key} className="group/row">
                <th
                  scope="row"
                  data-unmapped={row.unmapped || undefined}
                  className={cn(
                    labelColumn,
                    ROW_HEAD,
                    "py-1.5 group-has-[:focus-visible]/row:bg-brand-50 touch:py-2",
                    "data-unmapped:shadow-[inset_3px_0_0_var(--color-warn-border),1px_0_0_var(--border)]",
                  )}
                >
                  <span className="flex items-start gap-1.5">
                    {row.unmapped && (
                      <FlagIcon aria-hidden className="mt-0.5 size-4 shrink-0 text-warn touch:mt-1" />
                    )}
                    <span className="min-w-0">
                      {row.label}
                      {row.unmapped && <span className="sr-only"> (unmapped label)</span>}
                      {row.hint && (
                        <span className="block text-xs text-muted-foreground touch:text-sm">{row.hint}</span>
                      )}
                    </span>
                    {canRemove(row) && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-xs"
                        aria-label={`Remove ${row.label}`}
                        className="-my-0.5 ml-auto text-muted-foreground"
                        onClick={() => remove(row, rowIndex)}
                      >
                        <XIcon aria-hidden className="size-4 touch:size-5" />
                      </Button>
                    )}
                  </span>
                </th>
                {columns.map((column) =>
                  sides.map((hand, index) => {
                    const cell = cellOf(row, column, hand);
                    const count = countOf(getCount(cell));
                    const name = [row.label, nameOf(column), hand && `${HAND_WORD[hand].toLowerCase()} hand`]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <td
                        key={`${column.key}:${hand}`}
                        data-nonzero={count > 0 || undefined}
                        {...cellFocusProps(onCellFocus, cell)}
                        {...issuePathProps(cellIssuePath?.(cell))}
                        className={cn(
                          // A fixed width (COUNTER_WIDTHS.value), so stacked tables line up.
                          "w-32 border-b border-border px-2 py-px text-center align-middle data-nonzero:bg-brand-50 touch:w-40 touch:py-1.5",
                          index === 0 ? "border-l" : "border-l border-l-slate-100",
                          hidden(column),
                        )}
                      >
                        {readOnly ? (
                          <span className="font-semibold tabular-nums">{count}</span>
                        ) : (
                          <Stepper
                            label={name}
                            value={count}
                            onValueChange={(next) => change(cell, next)}
                            // The table says the count with the new total and verdict.
                            announce={false}
                          />
                        )}
                      </td>
                    );
                  }),
                )}
              </tr>
            ))}
          </tbody>

          <tfoot className="sticky bottom-[var(--capture-sticky-bottom,0px)] z-[3]">
            <tr>
              <th scope="row" className={cn(FOOT, labelColumn, "z-[2] border-t-2 border-t-slate-300 font-semibold")}>
                {text.total}
              </th>
              {columns.map((column) => (
                <td
                  key={column.key}
                  colSpan={span}
                  className={cn(FOOT, "border-t-2 border-l border-t-slate-300 text-base font-bold touch:text-lg", hidden(column))}
                >
                  {totalOf(column)}
                </td>
              ))}
            </tr>
            {summaryRows.map((summary) => (
              <tr key={summary.key}>
                <th scope="row" className={cn(FOOT, labelColumn, "z-[2] font-semibold")}>
                  {summary.label}
                </th>
                {columns.map((column) => (
                  <td key={column.key} colSpan={span} className={cn(FOOT, "border-l", hidden(column))}>
                    {summary.render(column, totalOf(column))}
                  </td>
                ))}
              </tr>
            ))}
            {withResult && (
              <tr>
                <th scope="row" className={cn(FOOT, labelColumn, "z-[2] border-b-0 font-semibold")}>
                  {text.result}
                </th>
                {columns.map((column) => {
                  const status = statusOf(column);
                  return (
                    <td key={column.key} colSpan={span} className={cn(FOOT, "border-b-0 border-l", hidden(column))}>
                      <StatusPill size="sm" status={status} label={resultLabel(status)} className="mx-auto" />
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {onAddRow && !readOnly && <AddLabel label={addRowLabel} onAdd={onAddRow} buttonRef={addRowButton} />}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/**
 * How a count's cell reports itself for photo tags (BUILD_SPEC 8.1): when
 * the focus comes in (the keyboard), and when it is pressed. Safari and
 * Chrome on the iPad (WebKit) never focus a tapped button, so a tap on + or −
 * would report nothing and the next photo would miss its size and defect.
 * The press is the click that lands, which a swipe to the next size (SizeTabs
 * drops it) or a scroll that starts on a stepper never makes. A count that
 * changes reports its cell too (CounterTable's change), for a held button.
 */
export function cellFocusProps(
  onCellFocus: ((cell: CounterCell) => void) | undefined,
  cell: CounterCell,
): { onFocus?: () => void; onClick?: () => void } {
  if (!onCellFocus) return {};
  const report = () => onCellFocus(cell);
  return { onFocus: report, onClick: report };
}

/**
 * Focuses the table itself, named by its caption, for a removed row that
 * leaves nothing else to take the focus. Its tabindex lasts until the focus
 * leaves: one kept on the table would let every tap inside it take the focus.
 */
function focusTable(table: HTMLTableElement | null) {
  if (!table) return;
  table.tabIndex = -1;
  table.addEventListener("blur", () => table.removeAttribute("tabindex"), { once: true });
  table.focus();
}

/** The first count on screen in a table row: hidden columns' steppers cannot take the focus. */
function firstShownCount(row: HTMLTableRowElement | undefined): HTMLElement | null {
  const counts = row ? Array.from(row.querySelectorAll<HTMLElement>('[role="spinbutton"]')) : [];
  return counts.find((count) => count.getClientRects().length > 0) ?? null;
}

/** "Other defect": a button that opens a one-line form for a one-off label. */
function AddLabel({
  label,
  onAdd,
  buttonRef,
}: {
  label: string;
  onAdd: (label: string) => void;
  /** The opener, for the table to hand focus to. */
  buttonRef?: RefObject<HTMLButtonElement | null>;
}) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const opener = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef(false);

  // Closing the form unmounts the focused field; hand focus back to its opener.
  useEffect(() => {
    if (adding || !returnFocus.current) return;
    returnFocus.current = false;
    opener.current?.focus();
  }, [adding]);

  const close = () => {
    returnFocus.current = true;
    setDraft("");
    setAdding(false);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = draft.trim();
    if (!value) return;
    onAdd(value);
    close();
  };

  if (!adding) {
    return (
      <Button
        ref={(node) => {
          opener.current = node;
          if (buttonRef) buttonRef.current = node;
        }}
        type="button"
        variant="ghost"
        size="sm"
        className="border border-dashed border-input text-muted-foreground"
        onClick={() => setAdding(true)}
      >
        <PlusIcon aria-hidden />
        {label}
      </Button>
    );
  }

  return (
    <form onSubmit={submit} className="flex w-full max-w-md flex-wrap items-center gap-2">
      <label htmlFor={id} className="sr-only">
        {label}
      </label>
      <Input
        id={id}
        autoFocus
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") close();
        }}
        placeholder="Describe the defect"
        maxLength={80}
        className="min-w-0 flex-1 rounded-full px-3"
      />
      <Button type="submit" size="sm" disabled={!draft.trim()}>
        Add
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={close}>
        Cancel
      </Button>
    </form>
  );
}
