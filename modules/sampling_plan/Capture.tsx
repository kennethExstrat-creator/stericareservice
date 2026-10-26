"use client";

// The Sampling Plan body (BUILD_SPEC 6.1, 8 "Speed"): one table with a
// column per ordered size (Kenneth, 26 October 2026: design B, "Sizes as
// Columns", "just give the total column more width"). Each label once down
// the left: the order quantity and the lot in gloves, read-only; the
// template's counts under their headings (rows.ts), each a whole-number cell
// on the numeric keypad; then each size's result. A Total column, wider than
// a size's, sums every row while more than one size is ordered. The
// inspection level is said once, above the table.
//
// The table is a CSS grid written size by size, so the cells keep the run
// they had as one panel per size: Enter moves down the size's column and on
// to the top of the next, and a pasted row or column fills the counts after
// the cell pasted into (EnterGroup, as before). Where the sizes do not fit,
// the grid scrolls sideways in its own box with the labels pinned at the
// left, never the page. Each cell is named with its count and size ("Case,
// Size M"), so the labels down the left are for the eye only. A warning or an
// error marks its cell, and every issue is listed under the table, naming
// its size.
import { useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  NumberField,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type EntryProblem,
} from "@/components/qc";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { labelFor, lotSizeGloves, type CaptureProps } from "@/modules/_framework";
import { useReportShownSize } from "@/modules/_framework/shown-size";
import type { SamplingPlanComputed } from "./calc";
import type { SamplingColumn, SamplingPlanConfig } from "./config";
import { countGroups, type CountRow } from "./rows";
import { withCount, type SamplingPlanData } from "./schema";

/** The rows of the grid, top to bottom. */
type Line =
  | { kind: "head" }
  | { kind: "fact"; key: "orderQty" | "lotSizeGloves" }
  | { kind: "heading"; key: string; text: string | null }
  | { kind: "count"; row: CountRow }
  | { kind: "result" };

// The labels' column at its narrowest is the box's scroll padding: a cell
// brought into view never sits under the pinned labels.
const LABEL_MIN_REM = 10;
const SIZE_MIN_REM = 6;
const TOTAL_MIN_REM = 10;

const CELL = "flex min-w-0 items-center border-b border-border text-sm touch:text-base";
const LABEL_CELL = "sticky left-0 z-10 bg-card px-3 py-1.5 text-left touch:py-2";
const VALUE_CELL = "justify-end border-l border-border px-2.5 py-1.5 text-right tabular-nums touch:py-2";

export default function Capture({
  data,
  config,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<SamplingPlanData, SamplingPlanConfig, SamplingPlanComputed>) {
  const root = useRef<HTMLDivElement>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const sizes = context.sizes;
  // Every size is on screen at once: only a single ordered size is on screen
  // alone and tags the photos taken now (BUILD_SPEC 8.1); a focused cell
  // reports its own size.
  useReportShownSize(sizes.length === 1 ? sizes[0] : null, onFocusChange);
  const [rejected, setRejected] = useState<Readonly<Record<string, RejectedEntry>>>({});
  // Every write starts from the latest data, so a pasted run of counts keeps every value (docs/CAPTURE_KIT.md).
  const update = useDataUpdater(data, onChange);

  useIssueFocus(focusPath, {
    root,
    // Every size is on screen; where the grid scrolls sideways, the size's column comes into the box.
    reveal: (path) => {
      const size = path[0] === "sizes" ? path[1] : undefined;
      const box = scroller.current;
      if (typeof size !== "string" || !box) return;
      const head = Array.from(box.querySelectorAll<HTMLElement>("[data-size-head]")).find(
        (cell) => cell.dataset.sizeHead === size,
      );
      if (!head) return;
      const pinned = box.querySelector<HTMLElement>("[data-label-head]")?.offsetWidth ?? 0;
      const left = head.offsetLeft - pinned;
      const right = head.offsetLeft + head.offsetWidth - box.clientWidth;
      if (box.scrollLeft > left) box.scrollLeft = left;
      else if (box.scrollLeft < right) box.scrollLeft = right;
    },
  });

  const label = (key: string) => labelFor(labels, key);
  // "Size M", as the cells and the problem list word it; "M" over its column.
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes, prefix: true });
  const sizeHead = (size: string) => formatSize(size, { sizes: context.templateSizes });
  const computed = evaluation?.computed;
  const level = computed?.inspectionLevel ?? config.inspectionLevel ?? context.aql.inspectionLevel;
  const groups = countGroups(config, label);
  // The issues of the cells on screen, size by size: the screen lists the module's own (not done) elsewhere.
  const cells = new Set(sizes.flatMap((size) => groups.flatMap((group) => group.rows.map((row) => cellKey(size, row.column)))));
  const issues = (evaluation?.issues ?? []).filter(
    (issue) => issue.path.length === 3 && issue.path[0] === "sizes" && cells.has(cellKey(String(issue.path[1]), String(issue.path[2]))),
  );

  const setCount = (size: string, column: SamplingColumn, value: number | null) =>
    update((current) => withCount(current, size, column, value));

  // Names the cell with its size: every size is on screen at once. The link
  // to a cell in the problem list repeats it, so it reads "Case, Size M".
  const cellName = (size: string, column: SamplingColumn) => `${label(column)}, ${sizeName(size)}`;

  const setRejectedEntry = (size: string, column: SamplingColumn, entry: EntryProblem["entry"] | null) =>
    setRejected((current) => {
      const id = fieldId(size, column);
      const next = { ...current };
      delete next[id];
      if (entry !== null) next[id] = { key: id, label: cellName(size, column), entry, inputId: id, size, column };
      return next;
    });
  // Text that was not stored, listed with a link while its cell is still empty.
  const problems = Object.values(rejected).filter(
    (problem) => sizes.includes(problem.size) && (data.sizes[problem.size]?.[problem.column] ?? null) === null,
  );

  if (sizes.length === 0) {
    return (
      <p ref={root} className="text-sm text-muted-foreground touch:text-base">
        No sizes ordered yet. Add them to the order table first.
      </p>
    );
  }

  const lines: Line[] = [
    { kind: "head" },
    { kind: "fact", key: "orderQty" },
    { kind: "fact", key: "lotSizeGloves" },
    ...groups.flatMap((group, index): Line[] => [
      { kind: "heading", key: `group-${index}`, text: group.heading },
      ...group.rows.map((row): Line => ({ kind: "count", row })),
    ]),
    { kind: "result" },
  ];
  const lastRow = lines.length;
  const showTotal = sizes.length > 1;
  const totalColumn = sizes.length + 2;
  const gridStyle: CSSProperties = {
    // The Total column grows faster than a size's, so it is always the wider (Kenneth, 26 October 2026).
    gridTemplateColumns: [
      `minmax(${LABEL_MIN_REM}rem, 16rem)`,
      `repeat(${sizes.length}, minmax(${SIZE_MIN_REM}rem, 1fr))`,
      showTotal ? `minmax(${TOTAL_MIN_REM}rem, 1.4fr)` : null,
    ]
      .filter(Boolean)
      .join(" "),
    minWidth: `${LABEL_MIN_REM + sizes.length * SIZE_MIN_REM + (showTotal ? TOTAL_MIN_REM : 0)}rem`,
  };
  const at = (row: number, column: number | string): CSSProperties => ({ gridRow: row, gridColumn: column });
  const edge = (row: number) => row === lastRow && "border-b-0";

  const lot = (size: string) => computed?.sizes?.[size]?.lotSizeGloves ?? lotSizeGloves(context, size);
  const order = (size: string) => context.order[size]?.qtyCases ?? null;
  const factValue = (key: "orderQty" | "lotSizeGloves", size: string) => (key === "orderQty" ? order(size) : lot(size));
  const factTotal = (key: "orderQty" | "lotSizeGloves") => sumOf(sizes.map((size) => factValue(key, size)));
  const totalsLabel = label("totals").replace(/:\s*$/, "");

  const labelCells = lines.map((line, index): ReactNode => {
    const row = index + 1;
    switch (line.kind) {
      case "head":
        return (
          <div
            key="head"
            data-label-head=""
            style={at(row, 1)}
            className={cn(CELL, LABEL_CELL, "bg-slate-50 font-semibold text-muted-foreground")}
          >
            {label("gloveSize")}
          </div>
        );
      case "fact":
        return (
          <div key={line.key} style={at(row, 1)} className={cn(CELL, LABEL_CELL, "text-muted-foreground")}>
            {label(line.key)}
          </div>
        );
      case "heading":
        // Across the whole grid; its words stay at the left while the sizes scroll.
        return (
          <div
            key={line.key}
            data-slot="count-heading"
            style={at(row, "1 / -1")}
            className={cn(
              "border-b border-border bg-slate-100 text-sm font-semibold text-slate-700 touch:text-base",
              line.text === null ? "h-1.5" : "px-3 py-1.5 touch:py-2",
            )}
          >
            {line.text !== null && <span className="sticky left-3">{line.text}</span>}
          </div>
        );
      case "count":
        return (
          <div
            key={line.row.column}
            style={at(row, 1)}
            title={line.row.shown === line.row.label ? undefined : line.row.label}
            className={cn(CELL, LABEL_CELL, "text-foreground", edge(row))}
          >
            {line.row.shown}
          </div>
        );
      case "result":
        return (
          <div key="result" style={at(row, 1)} className={cn(CELL, LABEL_CELL, "text-muted-foreground", edge(row))}>
            Result
          </div>
        );
    }
  });

  const sizeCells = (size: string, column: number) =>
    lines.map((line, index): ReactNode => {
      const row = index + 1;
      switch (line.kind) {
        case "head":
          return (
            <div
              key="head"
              aria-hidden
              data-size-head={size}
              data-size={size}
              style={at(row, column)}
              className={cn(CELL, VALUE_CELL, "bg-slate-50 text-base font-semibold text-foreground touch:text-lg")}
            >
              {sizeHead(size)}
            </div>
          );
        case "fact":
          return (
            <div key={line.key} style={at(row, column)} className={cn(CELL, VALUE_CELL, "text-muted-foreground")}>
              <span className="sr-only">{label(line.key)}: </span>
              <Figure value={factValue(line.key, size)} grouping />
            </div>
          );
        case "heading":
          return null;
        case "count": {
          const { column: count } = line.row;
          const path = ["sizes", size, count] as const;
          const own = issues.filter((issue) => samePath(issue.path, path));
          return (
            <div key={count} style={at(row, column)} className={cn(CELL, "border-l border-border p-0", edge(row))}>
              <NumberField
                variant="cell"
                id={fieldId(size, count)}
                label={cellName(size, count)}
                value={data.sizes[size]?.[count] ?? null}
                onValueChange={(value) => setCount(size, count, value)}
                integer
                min={0}
                error={own.find((issue) => issue.level === "error")?.message ?? null}
                warning={own.filter((issue) => issue.level === "warning").map((issue) => issue.message)}
                issuePath={path}
                onFocus={() => onFocusChange?.({ size })}
                onInvalidChange={(entry) => setRejectedEntry(size, count, entry)}
                readOnly={readOnly}
                className="w-full"
              />
            </div>
          );
        }
        case "result": {
          const result = evaluation?.result.perSize?.[size];
          return (
            <div key="result" style={at(row, column)} className={cn(CELL, VALUE_CELL, edge(row))}>
              {result && (
                <>
                  <StatusPill size="sm" status={result.status} />
                  {/* The size's few words ("Not started."): the issues under the grid say the rest. */}
                  {result.summary && <span className="sr-only">{result.summary}</span>}
                </>
              )}
            </div>
          );
        }
      }
    });

  const totalCells = lines.map((line, index): ReactNode => {
    const row = index + 1;
    const cell = cn(CELL, VALUE_CELL, "bg-slate-50 font-semibold text-foreground", edge(row));
    switch (line.kind) {
      case "head":
        return (
          <div key="head" aria-hidden style={at(row, totalColumn)} className={cell}>
            {totalsLabel}
          </div>
        );
      case "fact":
        return (
          <div key={line.key} style={at(row, totalColumn)} className={cell}>
            <span className="sr-only">{label(line.key)}: </span>
            <Figure value={factTotal(line.key)} grouping />
          </div>
        );
      case "heading":
        return null;
      case "count":
        return (
          <div key={line.row.column} style={at(row, totalColumn)} className={cell}>
            <span className="sr-only">{line.row.label}: </span>
            <Figure value={computed?.totals?.[line.row.column] ?? null} grouping />
          </div>
        );
      case "result":
        return <div key="result" aria-hidden style={at(row, totalColumn)} className={cell} />;
    }
  });

  return (
    <div ref={root} className="space-y-3">
      {level !== null && (
        <p className="text-sm text-muted-foreground touch:text-base">
          {label("inspectionLevel")} <span className="font-semibold text-foreground">{level}</span>
        </p>
      )}
      <EnterGroup>
        <div data-slot="sampling-table" className="overflow-hidden rounded-lg border border-border bg-card">
          <div ref={scroller} className="relative overflow-x-auto overscroll-x-contain scroll-pl-40">
            <div className="grid" style={gridStyle}>
              {/* For the eye: every cell names its count and size itself. */}
              <div aria-hidden className="contents">
                {labelCells}
              </div>
              {/* Size by size, top to bottom: the cells' run for Enter and a paste. */}
              {sizes.map((size, index) => (
                <div key={size} role="group" aria-label={sizeName(size)} data-size-column={size} className="contents">
                  {sizeCells(size, index + 2)}
                </div>
              ))}
              {showTotal && (
                <div role="group" aria-label={totalsLabel} className="contents">
                  {totalCells}
                </div>
              )}
            </div>
          </div>
        </div>
      </EnterGroup>
      {issues.length > 0 && (
        <ul data-slot="sampling-issues" className="space-y-2">
          {issues.map((issue) => (
            <li
              key={`${issue.code}-${issue.message}`}
              className={cn(
                "flex items-start gap-2 rounded-lg border px-3 py-2 text-sm touch:text-base",
                issue.level === "error" ? "border-fail-border bg-fail-tint text-fail" : "border-warn-border bg-warn-tint text-warn",
              )}
            >
              <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}
      <EntryProblems problems={problems} />
    </div>
  );
}

type RejectedEntry = EntryProblem & { size: string; column: SamplingColumn };

/** A cell's key in a set: a size and a count. */
function cellKey(size: string, column: string): string {
  return JSON.stringify([size, column]);
}

/** The input's id: sizes such as "7.0" are fine in an id, never in a selector built from it. */
function fieldId(size: string, column: SamplingColumn): string {
  return `sampling-plan-${size}-${column}`;
}

function samePath(path: readonly (string | number)[], target: readonly (string | number)[]): boolean {
  return path.length === target.length && path.every((segment, index) => segment === target[index]);
}

function sumOf(values: readonly (number | null)[]): number | null {
  const entered = values.filter((value): value is number => value !== null);
  return entered.length === 0 ? null : entered.reduce((sum, value) => sum + value, 0);
}
