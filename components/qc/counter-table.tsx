"use client";

// Counts by tapping (BUILD_SPEC 8 "Speed"): rows of labels in the template's
// order and wording (defects, hole locations) by columns (sizes, or boxes),
// each cell a Stepper. Like the reports, each column shows the number
// inspected and its Accept / Reject limit on top, and the computed total and
// a live accept/reject chip at the bottom (6.2 rule 2: never typed). With a
// hand split every column has R and L sub-columns sharing one total and one
// decision. `activeColumn` shows one column below 1280 px (pair it with
// SizeTabs); from 1280 px all columns sit side by side. On iPad the totals
// row sticks to the bottom of the screen while the table is in view.
import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from "react";
import { FlagIcon, PlusIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type Status } from "@/lib/design/status";
import { formatCount, formatHand, formatLimits, type AcceptanceLimits } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { columnStatus, columnTotal, countOf, type CounterCell, type CounterHand, type CountReader } from "./counter-model";
import { issuePathProps, type IssuePath } from "./issue-path";
import { StatusPill } from "./status-pill";
import { Stepper } from "./stepper";

export type CounterRow = {
  /** Defect or location code; a one-off label gets a key of its own. */
  key: string;
  /** In the template's wording. */
  label: string;
  /** A one-off label with no defect code yet: flagged for an admin. */
  unmapped?: boolean;
  /** A short definition under the label, e.g. Safedon's "Cuff should be at least 2 cm out". */
  hint?: string;
};

export type CounterColumn = {
  /** Size ("M") or box ("253"). */
  key: string;
  /** Column heading: "M", "253". */
  label: string;
  /** Accessible name in each stepper's label, e.g. "size M" or "box 253". Defaults to the label. */
  name?: string;
  /** Samples inspected (from the sampling plan). Undefined hides the row for every column. */
  n?: number | null;
  /** Accept / Reject limits from the AQL plan. Undefined hides the limit row. */
  limits?: AcceptanceLimits | null;
  /** calc's result for the column (evaluation.result.perSize). Wins over the live decision. */
  status?: Status;
};

export type CounterTableLabels = {
  /** Heading over the row labels. */
  rowHeader: string;
  inspected: string;
  limits: string;
  total: string;
  result: string;
  accept: string;
  reject: string;
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
  /** Below 1280 px only this column shows; from 1280 px every column does. */
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
  /** For photo tags: the cell that has focus. */
  onCellFocus?: (cell: CounterCell) => void;
  /** Marks each cell for issue links (useIssueFocus). */
  cellIssuePath?: (cell: CounterCell) => IssuePath;
  readOnly?: boolean;
  className?: string;
};

const HEAD = "border-b border-border bg-slate-50 px-3 py-2 text-center align-bottom font-semibold text-foreground";
const INFO = "border-b border-border bg-slate-50 px-3 py-1 text-center text-sm font-medium text-muted-foreground tabular-nums";
const FOOT = "border-b border-border bg-slate-50 px-3 py-1.5 text-center tabular-nums touch:py-2";
// The label column sticks while wide tables scroll sideways. Its edge is a
// shadow, so it draws over the first value column's border instead of doubling it.
const LABEL_COLUMN = "sticky left-0 text-left shadow-[1px_0_0_var(--border)]";
const ROW_HEAD = cn(LABEL_COLUMN, "z-[1] border-b border-border bg-card px-3 align-middle font-normal text-foreground");

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
  onCellFocus,
  cellIssuePath,
  readOnly = false,
  className,
}: CounterTableProps) {
  const text: CounterTableLabels = { ...DEFAULT_LABELS, ...labels };
  const split = hands !== undefined && hands.length > 0;
  const shownHands = split ? (visibleHands ?? hands).filter((hand) => hands.includes(hand)) : [];
  const sides: readonly (CounterHand | undefined)[] = shownHands.length > 0 ? shownHands : [undefined];
  const span = sides.length;

  const withInspected = showInspected ?? columns.some((column) => column.n !== undefined);
  const withLimits = showLimits ?? columns.some((column) => column.limits !== undefined);
  const withResult = showResult ?? columns.some((column) => column.limits !== undefined || column.status !== undefined);

  const [announcement, setAnnouncement] = useState("");

  const totals = new Map(columns.map((column) => [column.key, columnTotal(rows, column.key, hands, getCount)]));
  const totalOf = (column: CounterColumn) => totals.get(column.key) ?? 0;
  const statusOf = (column: CounterColumn) => columnStatus(totalOf(column), column);
  const resultLabel = (status: Status) =>
    status === "pass" ? text.accept : status === "fail" ? text.reject : STATUS_LABEL[status];

  // Below 1280 px only the active column shows (SizeTabs picks it).
  const hidden = (column: CounterColumn) =>
    activeColumn !== undefined && column.key !== activeColumn ? "max-xl:hidden" : undefined;
  const nameOf = (column: CounterColumn) => column.name ?? column.label;
  const cellOf = (row: CounterRow, column: CounterColumn, hand: CounterHand | undefined): CounterCell =>
    hand ? { row: row.key, column: column.key, hand } : { row: row.key, column: column.key };

  const change = (cell: CounterCell, column: CounterColumn, next: number, previous: number) => {
    onCountChange(cell, next);
    const total = totalOf(column) - previous + next;
    const status = columnStatus(total, column);
    setAnnouncement(
      `${nameOf(column)}: total ${total}${withResult && status !== "not_done" ? `, ${resultLabel(status)}` : ""}.`,
    );
  };

  return (
    <div data-slot="counter-table" className={cn("min-w-0 space-y-3", className)}>
      {/* One column fits any iPad, so below 1280 px nothing scrolls sideways and
          the totals can stick to the screen; wider tables scroll inside. */}
      <div
        className={cn(
          "relative rounded-lg border border-border bg-card",
          activeColumn !== undefined ? "overflow-clip xl:overflow-x-auto" : "overflow-x-auto",
        )}
      >
        <table className="w-full border-separate border-spacing-0 text-sm touch:text-base">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>
              <th
                scope="col"
                rowSpan={split ? 2 : 1}
                className={cn(HEAD, LABEL_COLUMN, "z-[2] min-w-44 font-semibold")}
              >
                {text.rowHeader}
              </th>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  colSpan={span}
                  className={cn(HEAD, "border-l whitespace-nowrap touch:text-base", hidden(column))}
                >
                  {column.label}
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
                        "py-1 text-xs touch:text-sm",
                        index === 0 ? "border-l" : "border-l border-l-slate-100",
                        hidden(column),
                      )}
                    >
                      <span aria-hidden>{hand}</span>
                      <span className="sr-only">{hand ? formatHand(hand) : ""}</span>
                    </th>
                  )),
                )}
              </tr>
            )}
            {withInspected && (
              <tr>
                <th scope="row" className={cn(INFO, LABEL_COLUMN, "z-[2]")}>
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
                <th scope="row" className={cn(INFO, LABEL_COLUMN, "z-[2]")}>
                  {text.limits}
                </th>
                {columns.map((column) => (
                  <td key={column.key} colSpan={span} className={cn(INFO, "border-l whitespace-nowrap", hidden(column))}>
                    {formatLimits(column.limits, { empty: "—" })}
                  </td>
                ))}
              </tr>
            )}
          </thead>

          <tbody>
            {rows.map((row) => (
              <tr key={row.key} className="group/row">
                <th
                  scope="row"
                  data-unmapped={row.unmapped || undefined}
                  className={cn(
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
                  </span>
                </th>
                {columns.map((column) =>
                  sides.map((hand, index) => {
                    const cell = cellOf(row, column, hand);
                    const count = countOf(getCount(cell));
                    const name = [row.label, nameOf(column), hand && formatHand(hand).toLowerCase()]
                      .filter(Boolean)
                      .join(", ");
                    return (
                      <td
                        key={`${column.key}:${hand}`}
                        data-nonzero={count > 0 || undefined}
                        onFocus={onCellFocus ? () => onCellFocus(cell) : undefined}
                        {...issuePathProps(cellIssuePath?.(cell))}
                        className={cn(
                          // A fixed width, so stacked tables (defect classes) line up.
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
                            onValueChange={(next) => change(cell, column, next, count)}
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
              <th scope="row" className={cn(FOOT, LABEL_COLUMN, "z-[2] border-t-2 border-t-slate-300 font-semibold")}>
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
                <th scope="row" className={cn(FOOT, LABEL_COLUMN, "z-[2] font-semibold")}>
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
                <th scope="row" className={cn(FOOT, LABEL_COLUMN, "z-[2] border-b-0 font-semibold")}>
                  {text.result}
                </th>
                {columns.map((column) => {
                  const status = statusOf(column);
                  return (
                    <td key={column.key} colSpan={span} className={cn(FOOT, "border-b-0 border-l", hidden(column))}>
                      <StatusPill
                        size="sm"
                        status={status}
                        label={resultLabel(status)}
                        className="mx-auto touch:h-8 touch:gap-1.5 touch:px-3 touch:text-base touch:[&>svg]:size-4"
                      />
                    </td>
                  );
                })}
              </tr>
            )}
          </tfoot>
        </table>
      </div>

      {onAddRow && !readOnly && <AddLabel label={addRowLabel} onAdd={onAddRow} />}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}

/** "Other defect": a button that opens a one-line form for a one-off label. */
function AddLabel({ label, onAdd }: { label: string; onAdd: (label: string) => void }) {
  const id = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const opener = useRef<HTMLButtonElement>(null);
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
        ref={opener}
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
