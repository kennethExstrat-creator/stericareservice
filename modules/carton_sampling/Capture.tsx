"use client";

// The carton grid (BUILD_SPEC 6.1 carton_sampling, 8 "Speed"): per ordered
// size, one cell per case sampled, 10 to a row as on the report, then a
// shaded spare row. Carton numbers go in on the numeric keypad; Enter moves
// along the row and on to the next, and a pasted column or row of numbers
// fills the cells after the one in focus. A number entered twice or above the
// order quantity turns red at once, with the problem below the grid and a
// link back to the cell.
import { useRef, useState } from "react";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  focusIssuePath,
  issuePathProps,
  NumberField,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type EntryProblem,
} from "@/components/qc";
import { formatCount, formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { initialSize, labelFor, samplingFor, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { gridCell, type CartonSamplingComputed } from "./calc";
import { GRID_COLUMNS, REPORT_GRID_CELLS, type CartonSamplingConfig } from "./config";
import { MAX_CARTONS_PER_SIZE, withCartonNumber, type CartonSamplingData } from "./schema";

const COLUMN_NUMBERS = Array.from({ length: GRID_COLUMNS }, (_, column) => column);

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
  const [rejected, setRejected] = useState<Readonly<Record<string, RejectedEntry>>>({});
  // Every write starts from the latest data, so a pasted run of numbers keeps every value (docs/CAPTURE_KIT.md).
  const update = useDataUpdater(data, onChange);

  const label = (key: string) => labelFor(labels, key);
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes });
  const caption = (size: string) => label("sizeCaption").replace("{size}", sizeName(size));
  const issues = evaluation?.issues ?? [];

  // SizeTabs shows the first size when the active one is no longer ordered.
  const shown = context.sizes.includes(active) ? active : context.sizes[0];
  // The panel of the size left behind unmounts, and with it any rejected text.
  const show = (size: string) => {
    if (size !== shown) setRejected({});
    setActive(size);
  };

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) show(path[1]);
    },
  });

  const setCarton = (size: string, index: number, value: number | null) =>
    update((current) => withCartonNumber(current, size, index, value));

  const setRejectedEntry = (size: string, index: number, name: string, entry: EntryProblem["entry"] | null) =>
    setRejected((current) => {
      const id = cellId(size, index);
      const next = { ...current };
      delete next[id];
      if (entry !== null) next[id] = { key: id, label: name, entry, inputId: id, size, index };
      return next;
    });

  const renderSize = (size: string) => {
    const cells = data.sizes[size]?.cartonNumbers ?? [];
    const cases = samplingFor(context, size).cases;
    const facts = evaluation?.computed.sizes?.[size];
    const result = evaluation?.result.perSize?.[size];
    const own = issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size);
    const count = facts?.samplingQuantity ?? cells.filter((carton) => carton !== null).length;
    // The spare row takes a list longer than the plan; a read-only grid takes nothing.
    const rows = Array.from({ length: gridRows(cases, cells.length, !readOnly) }, (_, row) => row);
    // Cells past the plan's cases: shaded, and named so for screen readers.
    const spare = (index: number) => cases !== null && index >= cases;
    const beyond = cases === null ? "" : `, beyond the ${formatCount(cases)} ${cases === 1 ? "case" : "cases"} sampled`;
    const positions = positionsOf(cells);
    const cellPath = (index: number) => ["sizes", size, "cartonNumbers", index] as const;
    // Text that was not stored, listed with a link while its cell is still empty.
    const problems = Object.values(rejected).filter(
      (problem) => problem.size === size && (cells[problem.index] ?? null) === null,
    );

    // The cell's own problem, else the problem of a number it shares with another cell.
    const problemAt = (index: number): ValidationIssue | undefined => {
      const exact = own.find((issue) => issue.level === "error" && samePath(issue.path, cellPath(index)));
      if (exact) return exact;
      const carton = cells[index];
      const at = carton === null || carton === undefined ? undefined : positions.get(carton);
      if (!at || at.length < 2) return undefined;
      return own.find((issue) => issue.code === "carton_duplicate" && samePath(issue.path, cellPath(at[1])));
    };

    return (
      <div className="space-y-3">
        <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
          <h3 className="text-base font-semibold text-foreground">{caption(size)}</h3>
          <p className="relative text-sm text-muted-foreground touch:text-base">
            {label("samplingQuantity")}{" "}
            <span className="font-semibold text-foreground tabular-nums">
              <Figure value={count} grouping /> / <Figure value={cases} grouping />
            </span>
          </p>
        </div>
        {rows.length > 0 && (
          <EnterGroup
            {...issuePathProps(["sizes", size, "cartonNumbers"])}
            className="relative overflow-clip rounded-lg border border-border bg-card"
          >
            <table className="w-full table-fixed border-separate border-spacing-0 text-sm touch:text-base">
              <caption className="sr-only">{`${title}, ${caption(size)}`}</caption>
              <thead>
                <tr>
                  <td className="w-8 border-b border-border bg-slate-50 touch:w-10" />
                  {COLUMN_NUMBERS.map((column) => (
                    <th
                      key={column}
                      scope="col"
                      className="border-b border-l border-border bg-slate-50 px-1 py-1 text-center text-sm font-semibold text-muted-foreground tabular-nums touch:text-base"
                    >
                      {column + 1}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row} className="[&:last-child>*]:border-b-0">
                    <th
                      scope="row"
                      className="border-b border-border bg-slate-50 text-center text-sm font-semibold text-muted-foreground tabular-nums touch:text-base"
                    >
                      {row + 1}
                    </th>
                    {COLUMN_NUMBERS.map((column) => {
                      const index = row * GRID_COLUMNS + column;
                      const id = cellId(size, index);
                      const name = `${caption(size)}, ${gridCell(index)}${spare(index) ? beyond : ""}`;
                      const value = cells[index] ?? null;
                      return (
                        <td
                          key={column}
                          className={cn("border-b border-l border-border p-0", spare(index) && "bg-slate-50")}
                        >
                          <NumberField
                            variant="cell"
                            id={id}
                            label={name}
                            value={value}
                            onValueChange={(next) => setCarton(size, index, next)}
                            integer
                            min={1}
                            error={problemAt(index)?.message ?? null}
                            issuePath={cellPath(index)}
                            onFocus={() => onFocusChange?.(value === null ? { size } : { size, box: value })}
                            onInvalidChange={(entry) => setRejectedEntry(size, index, name, entry)}
                            readOnly={readOnly}
                          />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </EnterGroup>
        )}
        <EntryProblems problems={problems} />
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
          show(size);
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

type RejectedEntry = EntryProblem & { size: string; index: number };

/** Whole rows the data can hold. */
const MAX_ROWS = Math.floor(MAX_CARTONS_PER_SIZE / GRID_COLUMNS);

/**
 * Rows of a size's grid: room for the plan's cases (the report's 50 until
 * the plan gives them) or for the numbers stored, if more, then the spare
 * row. A paste fills only the cells there are: the spare row keeps a list
 * longer than the plan from being cut down to the plan and passing. What is
 * past the plan is stored, and the size fails (6.2 rule 6). Never more rows
 * than the data can hold.
 */
function gridRows(cases: number | null, stored: number, spare: boolean): number {
  const needed = Math.ceil(Math.max(cases ?? REPORT_GRID_CELLS, stored) / GRID_COLUMNS);
  return Math.min(MAX_ROWS, needed + (spare ? 1 : 0));
}

/** The cells each carton number sits in, in grid order. */
function positionsOf(cells: readonly (number | null)[]): Map<number, number[]> {
  const positions = new Map<number, number[]>();
  cells.forEach((carton, index) => {
    if (carton !== null) positions.set(carton, [...(positions.get(carton) ?? []), index]);
  });
  return positions;
}

function cellId(size: string, index: number): string {
  return `carton-sampling-${size}-${index}`;
}

function samePath(path: readonly (string | number)[], target: readonly (string | number)[]): boolean {
  return path.length === target.length && path.every((segment, index) => segment === target[index]);
}

