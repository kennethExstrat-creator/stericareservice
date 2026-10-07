"use client";

// The sample grid: gloves (rows) by measures (columns) with computed footer
// rows in the template's wording (Median or Average, Spec., P/F). Enter walks
// down a column, arrows move between cells, and pasting a column of values
// fills down from the focused cell. Rejected entries are announced and listed
// under the grid as full-width buttons back to their cells (BUILD_SPEC 6.2).
// A paste longer than the grid says on screen, under it, which values did not
// fit and were not stored, unless the module kept them past its last row
// (`values` holds them there: force at break's readings past the gloves
// tested, which it reports itself). The keyboard and paste rules are pure
// functions in grid-navigation.ts.
// While the grid fits its width it leaves sideways moves to the page, so a
// swipe on it turns SizeTabs' size; a grid that has to scroll sideways keeps them.
// The footer shows calc's figures when the module passes them (a measure's
// `summary`), so it never disagrees with the module's result; without them it
// summarises the cells itself. Read-only, the readings stay focusable inputs:
// arrows and Enter still move, issue links still land, nothing can change.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { formatDecimal, formatSpec, summarizeColumn, type ColumnOutcome, type Spec, type StatisticKind } from "@/lib/stats";
import {
  applyPaste,
  caretOf,
  cellKey,
  labelColumnWidth,
  overflowNotStored,
  pasteOverflow,
  planPaste,
  targetCell,
  type CellPosition,
  type InvalidCells,
  type MeasurementCell,
  type MeasurementChange,
  type MeasurementValues,
  type OverflowCell,
} from "./grid-navigation";
import { issuePathProps, type IssuePath } from "./issue-path";
import { NumericCell, type InvalidEntry } from "./numeric-cell";
import { rejectionMessage } from "./numeric-entry";
import { PasteNotice } from "./paste-notice";
import { StatusPill } from "./status-pill";
import { useAnnouncement } from "./use-announcement";

export type { MeasurementCell, MeasurementChange, MeasurementValues } from "./grid-navigation";

/**
 * calc's figures for one column (a measure in one size), which the footer
 * shows instead of summarising the cells itself: a reading calc refuses (0 N,
 * say) then never shows a median or a verdict calc does not give.
 */
export type MeasureSummary = {
  /** The statistic over the readings calc counts (unrounded is fine); null while it has none: Not done. */
  statistic: number | null;
  /** pass or fail on the printed statistic, na with no spec to judge by, not_done while readings are missing or refused. */
  outcome: ColumnOutcome;
  /** Readings calc counts: "9 of 13" under the statistic while short of the rows. */
  count?: number;
};

export type Measure = {
  /** Canonical key, e.g. "length". */
  key: string;
  /** Column heading in the template's wording, e.g. "Finger Thickness". */
  label: string;
  unit?: string;
  /** Decimals for the statistic (and the precision P/F is judged at). */
  decimals?: number;
  spec?: Spec;
  min?: number;
  max?: number;
  /** Refuse `min` itself: a reading must be more than it ("Must be more than 0."). */
  minExclusive?: boolean;
  /** calc's figures for the footer (evaluation.computed); omit to let the grid summarise its cells. */
  summary?: MeasureSummary | null;
};

/** Row heading and footer wording, as the template words it. */
export type MeasurementGridLabels = {
  /** Heading of the glove number column: "No.". */
  row: string;
  /** "Median" or "Average". */
  statistic: string;
  spec: string;
  /** The verdict row: "P/F", "Passed / Failed", "A / Rej.". */
  result: string;
  /** Words in the verdict row: "Passed" or SAFEDON_EG's "A". */
  pass: string;
  fail: string;
  /** No spec to judge by. */
  na: string;
};

type MeasurementGridProps = {
  /** Accessible table name, e.g. "Dimension - Size M". */
  caption: string;
  measures: readonly Measure[];
  /** Gloves per size (BUILD_SPEC 6.1 default 13). */
  rows?: number;
  values: MeasurementValues;
  /**
   * The cells a change touched, with their new values: one for a typed
   * reading, every pasted cell for a paste, in one call. Write them through
   * useDataUpdater, onto the latest data.
   */
  onCellsChange?: (changes: readonly MeasurementChange[]) => void;
  /**
   * Every column, built from the `values` the grid rendered.
   * @deprecated Use onCellsChange: two changes in one event (a commit as a paste lands) would each start from the same rendered values.
   */
  onValuesChange?: (values: MeasurementValues) => void;
  statistic: StatisticKind;
  /** Row and footer labels in the template's wording. */
  labels?: Partial<MeasurementGridLabels>;
  /** Approved, or not the user's to edit: readings stay focusable, nothing changes. */
  readOnly?: boolean;
  /** Marks each cell for issue links (useIssueFocus): `({ row, measure }) => ["sizes", "M", "gloves", row, measure]`. */
  cellIssuePath?: (cell: MeasurementCell) => IssuePath;
  /** A cell took the focus, e.g. for photo tags. */
  onCellFocus?: (cell: MeasurementCell) => void;
  className?: string;
};

const HEAD_CELL = "sticky top-0 z-10 border-b border-border bg-slate-50 px-2.5 py-2 align-bottom font-semibold";
const ROW_HEAD = "sticky left-0 z-[1] border-r border-b border-border px-3 text-left font-normal tabular-nums";
const FOOT_CELL = "border-b border-border bg-slate-50 px-2.5 py-1.5 text-right touch:py-2.5";

/** What a footer column shows: calc's figures, else the grid's own summary of its cells. */
type Footer = { statistic: number | null; outcome: ColumnOutcome; short: number | null };

export function MeasurementGrid({
  caption,
  measures,
  rows = 13,
  values,
  onCellsChange,
  onValuesChange,
  statistic,
  labels,
  readOnly = false,
  cellIssuePath,
  onCellFocus,
  className,
}: MeasurementGridProps) {
  const text: MeasurementGridLabels = {
    row: "No.",
    statistic: statistic === "median" ? "Median" : "Average",
    spec: "Spec.",
    result: "P/F",
    pass: "Passed",
    fail: "Failed",
    na: "NA",
    ...labels,
  };
  const idBase = useId();
  const [invalid, setInvalid] = useState<InvalidCells>({});
  const [notice, announce] = useAnnouncement();
  // The last paste's values past the last row or column, and the cell it started in (Dismiss goes back there).
  const [overflow, setOverflow] = useState<{ cells: readonly OverflowCell[]; from: CellPosition } | null>(null);
  const inputs = useRef(new Map<string, HTMLInputElement>());
  const size = { rows, cols: measures.length };

  // A scroll container takes horizontal touch moves even when it has nothing
  // to scroll sideways, which would stop SizeTabs' swipe on the grid. While
  // the table fits, only vertical panning (and zoom) stays with the grid.
  const scroller = useRef<HTMLDivElement>(null);
  const [fitsWidth, setFitsWidth] = useState(true);
  useEffect(() => {
    const element = scroller.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setFitsWidth(element.scrollWidth <= element.clientWidth + 1));
    observer.observe(element);
    const table = element.firstElementChild;
    if (table) observer.observe(table);
    return () => observer.disconnect();
  }, []);

  const valueAt = (measure: string, row: number) => values[measure]?.[row] ?? null;
  const columnOf = (measure: string) => Array.from({ length: rows }, (_, row) => valueAt(measure, row));
  // A rejected entry leaves its cell null; a value set later by the parent supersedes it.
  const invalidAt = (measure: string, row: number) =>
    valueAt(measure, row) === null ? invalid[cellKey(measure, row)] : undefined;
  const errorId = (measure: string, row: number) => `${idBase}-error-${measure}-${row}`;
  /** The cell's name, as its aria-label and the error list give it. */
  const cellName = (measure: Measure, row: number) => `${measure.label}, ${text.row} ${row + 1}`;

  const focusCell = ({ row, col }: CellPosition) => {
    inputs.current.get(cellKey(measures[col].key, row))?.focus();
  };

  const setValue = (measure: string, row: number, value: number | null) => {
    onCellsChange?.([{ row, measure, value }]);
    if (onValuesChange) {
      const column = columnOf(measure);
      column[row] = value;
      onValuesChange({ ...values, [measure]: column });
    }
  };

  const setInvalidAt = (measure: Measure, row: number, entry: InvalidEntry | null) => {
    setInvalid((current) => {
      const next = { ...current };
      if (entry) next[cellKey(measure.key, row)] = entry;
      else delete next[cellKey(measure.key, row)];
      return next;
    });
    // Focus has usually moved on (Enter, an arrow, a tap elsewhere), so the
    // cell's own error would go unheard: say it, with the cell's name.
    if (entry) announce(rejectionMessage(entry, cellName(measure, row)));
  };

  const onCellKeyDown = (row: number, col: number) => (event: KeyboardEvent<HTMLInputElement>) => {
    const input = event.currentTarget;
    const caret = caretOf(input.selectionStart, input.selectionEnd, input.value.length);
    const target = targetCell(event.key, event.shiftKey, { row, col }, size, caret);
    // Enter never submits a surrounding form, even from the last cell.
    if (target || event.key === "Enter") event.preventDefault();
    if (target) focusCell(target);
  };

  const onCellPaste = (row: number, col: number) => (pasted: string) => {
    const plan = planPaste(pasted, { row, col }, size);
    if (!plan) return false;
    const result = applyPaste(plan, measures, rows, values, invalid);
    onCellsChange?.(result.changes);
    onValuesChange?.(result.values);
    setInvalid(result.invalid);
    announce(result.notice);
    // On screen too, until dismissed or the next paste: a paste that fit takes an earlier notice away.
    const cells = pasteOverflow(plan);
    setOverflow(cells.length > 0 ? { cells, from: { row, col } } : null);
    return true;
  };

  // Judged against the values the module holds now: what it kept past the last row is its own to report.
  const notStored = overflow ? overflowNotStored(overflow.cells, measures, values) : [];

  const footers = measures.map((measure): Footer => {
    if (measure.summary) {
      const { statistic: value, outcome, count } = measure.summary;
      return { statistic: value, outcome, short: count !== undefined && count < rows ? count : null };
    }
    const own = summarizeColumn(columnOf(measure.key), rows, statistic, measure.spec, measure.decimals);
    return { statistic: own.statistic, outcome: own.outcome, short: own.complete ? null : own.count };
  });

  const problems = measures.flatMap((measure, col) =>
    Array.from({ length: rows }, (_, row) => ({ measure, row, col, entry: invalidAt(measure.key, row) })).filter(
      (problem) => problem.entry !== undefined,
    ),
  );

  const verdict = (outcome: Exclude<ColumnOutcome, "na">) =>
    outcome === "pass" ? text.pass : outcome === "fail" ? text.fail : undefined;

  return (
    <div
      data-slot="measurement-grid"
      data-readonly={readOnly || undefined}
      className={cn("relative overflow-hidden rounded-lg border border-border bg-card", className)}
    >
      {/* Scroll padding keeps a focused cell clear of the sticky header and footer. */}
      <div
        ref={scroller}
        className={cn(
          "max-h-[75svh] scroll-pt-16 scroll-pb-28 overflow-auto overscroll-contain touch:scroll-pb-36",
          fitsWidth && "touch-pan-y touch-pinch-zoom",
        )}
      >
        <table className="w-full min-w-[36rem] table-fixed border-separate border-spacing-0 text-sm touch:text-base">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              {/* As wide as the longest footer caption, so "Passed / Failed" stays on one line. */}
              <th
                scope="col"
                style={{ width: labelColumnWidth([text.row, text.statistic, text.spec, text.result]) }}
                className={cn(HEAD_CELL, "left-0 z-20 border-r text-left")}
              >
                {text.row}
              </th>
              {measures.map((measure) => (
                <th key={measure.key} scope="col" className={cn(HEAD_CELL, "text-right")}>
                  {measure.label}
                  {measure.unit && (
                    <span className="block text-xs font-normal text-muted-foreground touch:text-sm">{measure.unit}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {Array.from({ length: rows }, (_, row) => (
              <tr key={row} className="group/row">
                <th
                  scope="row"
                  className={cn(
                    ROW_HEAD,
                    "bg-card text-muted-foreground group-has-[input:focus]/row:bg-brand-50 group-has-[input:focus]/row:text-brand-700",
                  )}
                >
                  {row + 1}
                </th>
                {measures.map((measure, col) => {
                  const entry = invalidAt(measure.key, row);
                  const cell = { row, measure: measure.key };
                  return (
                    <td
                      key={measure.key}
                      className={cn(
                        "border-r border-b border-border p-0 last:border-r-0 group-has-[input:focus]/row:bg-brand-50/60",
                        // Read-only values sit on grey (docs/DESIGN.md), as NumberField's do.
                        readOnly && "bg-muted",
                      )}
                    >
                      <NumericCell
                        ref={(element) => {
                          if (element) inputs.current.set(cellKey(measure.key, row), element);
                          else inputs.current.delete(cellKey(measure.key, row));
                        }}
                        {...issuePathProps(cellIssuePath?.(cell))}
                        variant="cell"
                        value={valueAt(measure.key, row)}
                        onValueChange={(value) => setValue(measure.key, row, value)}
                        invalid={entry ?? null}
                        onInvalidChange={(next) => setInvalidAt(measure, row, next)}
                        min={measure.min}
                        max={measure.max}
                        minExclusive={measure.minExclusive}
                        decimals={measure.decimals}
                        readOnly={readOnly}
                        enterKeyHint="next"
                        aria-label={cellName(measure, row)}
                        aria-describedby={entry ? errorId(measure.key, row) : undefined}
                        onKeyDown={onCellKeyDown(row, col)}
                        onFocus={onCellFocus ? () => onCellFocus(cell) : undefined}
                        onPasteText={readOnly ? undefined : onCellPaste(row, col)}
                      />
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>

          <tfoot className="sticky bottom-0 z-10">
            <tr>
              <th scope="row" className={cn(ROW_HEAD, FOOT_CELL, "border-t-2 border-t-slate-300 text-left font-semibold")}>
                {text.statistic}
              </th>
              {footers.map((footer, col) => (
                <td key={measures[col].key} className={cn(FOOT_CELL, "border-t-2 border-t-slate-300")}>
                  {footer.statistic === null ? (
                    <StatusPill size="sm" status="not_done" className="ml-auto" />
                  ) : (
                    <span className="font-semibold tabular-nums">
                      {formatDecimal(footer.statistic, measures[col].decimals)}
                      {footer.short !== null && (
                        <span className="block text-xs font-normal text-muted-foreground touch:text-sm">
                          {footer.short} of {rows}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={cn(ROW_HEAD, FOOT_CELL, "text-left font-semibold")}>
                {text.spec}
              </th>
              {measures.map((measure) => (
                <td key={measure.key} className={cn(FOOT_CELL, "text-muted-foreground tabular-nums")}>
                  {measure.spec ? formatSpec(measure.spec) : text.na}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={cn(ROW_HEAD, FOOT_CELL, "border-b-0 text-left font-semibold")}>
                {text.result}
              </th>
              {footers.map((footer, col) => (
                <td key={measures[col].key} className={cn(FOOT_CELL, "border-b-0")}>
                  {footer.outcome === "na" ? (
                    <span className="text-muted-foreground">{text.na}</span>
                  ) : (
                    <StatusPill size="sm" status={footer.outcome} label={verdict(footer.outcome)} className="ml-auto" />
                  )}
                </td>
              ))}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* Each rejected entry is a full-width row button back to its cell: on
          iPad the way back to a reading must be a 44 px target. */}
      {problems.length > 0 && (
        <ul className="border-t border-fail-border bg-fail-tint px-1.5 py-1 text-sm text-fail">
          {problems.map(({ measure, row, col, entry }) => (
            <li key={cellKey(measure.key, row)} id={errorId(measure.key, row)}>
              <button
                type="button"
                onClick={() => focusCell({ row, col })}
                className="flex min-h-8 w-full items-center rounded-md px-1.5 py-1 text-left outline-none hover:bg-fail-border/25 focus-ring-inset touch:min-h-11"
              >
                <span>
                  <span className="font-semibold underline underline-offset-2">
                    {text.row} {row + 1}, {measure.label}
                  </span>
                  {entry && `: ${rejectionMessage(entry)}`}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {overflow && notStored.length > 0 && (
        <PasteNotice
          variant="strip"
          leftOut={{ pastEnd: notStored.map((cell) => cell.raw), otherColumns: 0 }}
          onDismiss={() => {
            focusCell(overflow.from);
            setOverflow(null);
          }}
        />
      )}
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}
