"use client";

// The sample grid: gloves (rows) by measures (columns) with computed footer
// rows in the template's wording (Median or Average, Spec., P/F). Enter walks
// down a column, arrows move between cells, and pasting a column of values
// fills down from the focused cell. Rejected entries are announced and listed
// under the grid as full-width buttons back to their cells (BUILD_SPEC 6.2).
// The keyboard and paste rules are pure functions in grid-navigation.ts.
// While the grid fits its width it leaves sideways moves to the page, so a
// swipe on it turns SizeTabs' size; a grid that has to scroll sideways keeps them.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "@/lib/utils";
import { formatDecimal, formatSpec, summarizeColumn, type Spec, type StatisticKind } from "@/lib/stats";
import {
  applyPaste,
  caretOf,
  cellKey,
  planPaste,
  targetCell,
  type CellPosition,
  type InvalidCells,
  type MeasurementValues,
} from "./grid-navigation";
import { NumericCell, type InvalidEntry } from "./numeric-cell";
import { rejectionMessage } from "./numeric-entry";
import { StatusPill } from "./status-pill";
import { useAnnouncement } from "./use-announcement";

export type { MeasurementValues } from "./grid-navigation";

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
};

type GridLabels = { row: string; statistic: string; spec: string; result: string };

type MeasurementGridProps = {
  /** Accessible table name, e.g. "Dimension - Size M". */
  caption: string;
  measures: readonly Measure[];
  /** Gloves per size (BUILD_SPEC 6.1 default 13). */
  rows?: number;
  values: MeasurementValues;
  onValuesChange: (values: MeasurementValues) => void;
  statistic: StatisticKind;
  /** Row and footer labels in the template's wording. */
  labels?: Partial<GridLabels>;
  className?: string;
};

const HEAD_CELL = "sticky top-0 z-10 border-b border-border bg-slate-50 px-2.5 py-2 align-bottom font-semibold";
const ROW_HEAD = "sticky left-0 z-[1] border-r border-b border-border px-3 text-left font-normal tabular-nums";
const FOOT_CELL = "border-b border-border bg-slate-50 px-2.5 py-1.5 text-right touch:py-2.5";

export function MeasurementGrid({
  caption,
  measures,
  rows = 13,
  values,
  onValuesChange,
  statistic,
  labels,
  className,
}: MeasurementGridProps) {
  const text: GridLabels = {
    row: "No.",
    statistic: statistic === "median" ? "Median" : "Average",
    spec: "Spec.",
    result: "P/F",
    ...labels,
  };
  const idBase = useId();
  const [invalid, setInvalid] = useState<InvalidCells>({});
  const [notice, announce] = useAnnouncement();
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
    const column = columnOf(measure);
    column[row] = value;
    onValuesChange({ ...values, [measure]: column });
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
    onValuesChange(result.values);
    setInvalid(result.invalid);
    announce(result.notice);
    return true;
  };

  const summaries = measures.map((measure) =>
    summarizeColumn(columnOf(measure.key), rows, statistic, measure.spec, measure.decimals),
  );

  const problems = measures.flatMap((measure, col) =>
    Array.from({ length: rows }, (_, row) => ({ measure, row, col, entry: invalidAt(measure.key, row) })).filter(
      (problem) => problem.entry !== undefined,
    ),
  );

  return (
    <div
      data-slot="measurement-grid"
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
              <th scope="col" className={cn(HEAD_CELL, "left-0 z-20 w-14 border-r text-left")}>
                {text.row}
              </th>
              {measures.map((measure) => (
                <th key={measure.key} scope="col" className={cn(HEAD_CELL, "text-right")}>
                  {measure.label}
                  {measure.unit && (
                    <span className="block text-xs font-normal text-muted-foreground">{measure.unit}</span>
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
                  return (
                    <td
                      key={measure.key}
                      className="border-r border-b border-border p-0 last:border-r-0 group-has-[input:focus]/row:bg-brand-50/60"
                    >
                      <NumericCell
                        ref={(element) => {
                          if (element) inputs.current.set(cellKey(measure.key, row), element);
                          else inputs.current.delete(cellKey(measure.key, row));
                        }}
                        variant="cell"
                        value={valueAt(measure.key, row)}
                        onValueChange={(value) => setValue(measure.key, row, value)}
                        invalid={entry ?? null}
                        onInvalidChange={(next) => setInvalidAt(measure, row, next)}
                        min={measure.min}
                        max={measure.max}
                        decimals={measure.decimals}
                        enterKeyHint="next"
                        aria-label={cellName(measure, row)}
                        aria-describedby={entry ? errorId(measure.key, row) : undefined}
                        onKeyDown={onCellKeyDown(row, col)}
                        onPasteText={onCellPaste(row, col)}
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
              {summaries.map((summary, col) => (
                <td key={measures[col].key} className={cn(FOOT_CELL, "border-t-2 border-t-slate-300")}>
                  {summary.statistic === null ? (
                    <StatusPill size="sm" status="not_done" className="ml-auto" />
                  ) : (
                    <span className="font-semibold tabular-nums">
                      {formatDecimal(summary.statistic, measures[col].decimals)}
                      {!summary.complete && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {summary.count} of {rows}
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
                  {measure.spec ? formatSpec(measure.spec) : "NA"}
                </td>
              ))}
            </tr>
            <tr>
              <th scope="row" className={cn(ROW_HEAD, FOOT_CELL, "border-b-0 text-left font-semibold")}>
                {text.result}
              </th>
              {summaries.map((summary, col) => (
                <td key={measures[col].key} className={cn(FOOT_CELL, "border-b-0")}>
                  {summary.outcome === "na" ? (
                    <span className="text-muted-foreground">NA</span>
                  ) : (
                    <StatusPill size="sm" status={summary.outcome} className="ml-auto" />
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
      <p className="sr-only" aria-live="polite">
        {notice}
      </p>
    </div>
  );
}
