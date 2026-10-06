"use client";

// The carton grid (BUILD_SPEC 6.1 carton_sampling, 8 "Speed"): per ordered
// size, one cell per case sampled, 10 to a row as on the report. Carton
// numbers go in on the numeric keypad; Enter moves along the row and on to
// the next, and a pasted column or row of numbers fills the cells after the
// one in focus. A number entered twice or above the order quantity turns red
// at once, with the problem below the grid and a link back to the cell.
import { useLayoutEffect, useRef, useState } from "react";
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
  useIssueFocus,
  type EntryProblem,
} from "@/components/qc";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { labelFor, samplingFor, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { gridCell, type CartonSamplingComputed } from "./calc";
import { GRID_COLUMNS, REPORT_GRID_CELLS, type CartonSamplingConfig } from "./config";
import type { CartonSamplingData } from "./schema";

const COLUMN_NUMBERS = Array.from({ length: GRID_COLUMNS }, (_, column) => column);

export default function Capture({
  data,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: CaptureProps<CartonSamplingData, CartonSamplingConfig, CartonSamplingComputed>) {
  const root = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(context.sizes[0] ?? "");
  const [rejected, setRejected] = useState<Readonly<Record<string, EntryProblem>>>({});
  const write = useDataWriter(data, onChange);

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
    write((current) => {
      const cells = [...(current.sizes[size]?.cartonNumbers ?? [])];
      while (cells.length <= index) cells.push(null);
      cells[index] = value;
      // Blank cells keep the place of the numbers after them; trailing ones are not kept.
      while (cells.length > 0 && cells[cells.length - 1] === null) cells.pop();
      return { ...current, sizes: { ...current.sizes, [size]: { ...current.sizes[size], cartonNumbers: cells } } };
    });

  const setRejectedEntry = (id: string, name: string, entry: EntryProblem["entry"] | null) =>
    setRejected((current) => {
      const next = { ...current };
      delete next[id];
      if (entry !== null) next[id] = { key: id, label: name, entry, inputId: id };
      return next;
    });

  const renderSize = (size: string) => {
    const cells = data.sizes[size]?.cartonNumbers ?? [];
    const cases = samplingFor(context, size).cases;
    const facts = evaluation?.computed.sizes?.[size];
    const result = evaluation?.result.perSize?.[size];
    const own = issues.filter((issue) => issue.path[0] === "sizes" && issue.path[1] === size);
    const count = facts?.samplingQuantity ?? cells.filter((carton) => carton !== null).length;
    const total = Math.max(cases ?? REPORT_GRID_CELLS, cells.length);
    const rows = Array.from({ length: Math.ceil(total / GRID_COLUMNS) }, (_, row) => row);
    const positions = positionsOf(cells);
    const cellPath = (index: number) => ["sizes", size, "cartonNumbers", index] as const;

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
          <p className="text-sm text-muted-foreground touch:text-base">
            {label("samplingQuantity")}{" "}
            <span className="font-semibold text-foreground tabular-nums">
              <Figure value={count} grouping /> / <Figure value={cases} grouping />
            </span>
          </p>
        </div>
        {rows.length > 0 && (
          <EnterGroup
            {...issuePathProps(["sizes", size, "cartonNumbers"])}
            className="overflow-clip rounded-lg border border-border bg-card"
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
                      className="border-b border-l border-border bg-slate-50 px-1 py-1 text-center text-xs font-semibold text-muted-foreground tabular-nums touch:text-sm"
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
                      className="border-b border-border bg-slate-50 text-center text-xs font-semibold text-muted-foreground tabular-nums touch:text-sm"
                    >
                      {row + 1}
                    </th>
                    {COLUMN_NUMBERS.map((column) => {
                      const index = row * GRID_COLUMNS + column;
                      if (index >= total) {
                        return <td key={column} className="border-b border-l border-border bg-muted" />;
                      }
                      const id = cellId(size, index);
                      const name = `${caption(size)}, ${gridCell(index)}`;
                      const value = cells[index] ?? null;
                      return (
                        <td key={column} className="border-b border-l border-border p-0">
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
                            onInvalidChange={(entry) => setRejectedEntry(id, name, entry)}
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
        <EntryProblems problems={Object.values(rejected)} />
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

/**
 * onChange built on the latest data. A pasted column fills several cells in
 * one event, each reporting its value before the screen hands the new data
 * back, so each write starts from the one before, not from the last render.
 */
function useDataWriter<T>(data: T, onChange: (next: T) => void): (update: (current: T) => T) => void {
  const latest = useRef(data);
  useLayoutEffect(() => {
    latest.current = data;
  }, [data]);
  return (update) => {
    const next = update(latest.current);
    latest.current = next;
    onChange(next);
  };
}
