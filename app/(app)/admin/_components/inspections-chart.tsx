"use client";

// The dashboard's Inspections per Day card (per Month for All Time over 92
// days): one column per day from the first day counted, zeros included, each
// stacked by result in RESULT_ORDER, Passed at the foot, a 2 px gap between
// results. CSS columns and no chart library, read like Steri-AI Cost's
// chart (cost-trend-chart.tsx): two fixed lines above the plot read out one
// column, the busiest until a pointer, a tap or the arrow keys pick another;
// nothing floats over the bars, it works on touch, and nothing shifts. The
// picked column gets a light band behind it rather than another colour, so
// the results keep theirs. The legend names each colour, and a visually
// hidden table carries every value.
import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import {
  RESULT_FILL_CLASS,
  RESULT_ORDER,
  busiestIndex,
  countAxisMax,
  inspectionCount,
  resultMix,
  type ChartColumn,
  type TrendBucket,
} from "@/lib/admin/dashboard";
import { STATUS_LABEL } from "@/lib/design/status";
import { cn } from "@/lib/utils";
import { moveIndex } from "../ai/_components/cost-trend-chart";

/** Up to this many columns, the first and last labels sit under their columns; past it, at the plot's edges. */
const CENTRED_TICKS = 14;

/**
 * The readout: "Busiest: Mon 12 Oct · 3 inspections" until a column is
 * picked (then without "Busiest:"), and its results.
 */
export function readoutLines(column: ChartColumn | null, busiest: boolean): [string, string] {
  if (!column) return ["No inspections in this period.", ""];
  return [`${busiest ? "Busiest: " : ""}${column.label} · ${inspectionCount(column.counts.total)}`, resultMix(column.counts)];
}

/** The columns labelled under the axis: the first, the middle and the last. */
function tickIndexes(count: number): number[] {
  if (count === 0) return [];
  return [...new Set([0, Math.round((count - 1) / 2), count - 1])];
}

export function InspectionsChart({ bucket, columns }: { bucket: TrendBucket; columns: ChartColumn[] }) {
  const titleId = useId();
  const readoutId = useId();
  // A mouse over the plot shows its column while it stays; a tap, a touch drag or a key keeps the column picked.
  const [hovered, setHovered] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const busiest = busiestIndex(columns);
  const chosen = hovered ?? picked;
  const shown = chosen ?? (busiest >= 0 ? busiest : null);
  const [columnLine, resultsLine] = readoutLines(shown === null ? null : columns[shown], chosen === null);

  const max = countAxisMax(Math.max(0, ...columns.map((column) => column.counts.total)));
  const byMonth = bucket === "month";
  const title = byMonth ? "Inspections per Month" : "Inspections per Day";
  const name = byMonth ? "Inspections per month" : "Inspections per day";
  const centred = columns.length <= CENTRED_TICKS;

  function columnAt(event: PointerEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    const share = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    return Math.min(columns.length - 1, Math.max(0, Math.floor(share * columns.length)));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (columns.length > 0) setPicked(columnAt(event));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (columns.length === 0) return;
    if (event.pointerType === "touch") setPicked(columnAt(event));
    else setHovered(columnAt(event));
  }

  function onPointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") setHovered(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = moveIndex(event.key, shown, columns.length);
    if (next === null) return;
    event.preventDefault();
    setHovered(null);
    setPicked(next);
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid="dashboard-chart"
      className="relative flex min-w-0 flex-col gap-3 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
    >
      <div className="flex flex-col gap-1">
        <h3 id={titleId} className="text-lg leading-tight font-bold text-foreground">
          {title}
        </h3>
        <div id={readoutId} aria-live="polite" data-testid="dashboard-chart-readout" className="flex flex-col text-sm">
          <p className="min-h-5 font-medium text-foreground">{columnLine}</p>
          <p className="min-h-5 text-muted-foreground">{resultsLine}</p>
        </div>
      </div>

      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground" aria-label="Results">
        {RESULT_ORDER.map((key) => (
          <li key={key} className="flex items-center gap-1.5">
            <span aria-hidden className={cn("size-3 shrink-0 rounded-[3px]", RESULT_FILL_CLASS[key])} />
            {STATUS_LABEL[key]}
          </li>
        ))}
      </ul>

      <div className="flex pt-2">
        {/* Each label is centred on its line: the column starts half a line above the plot and ends half a line below it. */}
        <div
          aria-hidden
          className="-mt-2 flex h-[196px] shrink-0 flex-col justify-between pr-2 text-right text-xs leading-4 text-muted-foreground tabular-nums touch:-mt-2.5 touch:h-[220px] touch:text-sm touch:leading-5"
        >
          {[max, max / 2, 0].map((value) => (
            <span key={value}>{value.toLocaleString("en-US")}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            role="group"
            tabIndex={0}
            aria-label={name}
            aria-describedby={readoutId}
            data-testid="dashboard-chart-plot"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerLeave={onPointerLeave}
            onKeyDown={onKeyDown}
            className="relative h-[180px] touch-pan-y outline-none select-none focus-ring touch:h-[200px]"
          >
            <div aria-hidden className="pointer-events-none absolute inset-0">
              <div className="absolute inset-x-0 top-0 h-px bg-slate-200" />
              <div className="absolute inset-x-0 top-1/2 h-px bg-slate-200" />
              <div className="absolute inset-x-0 bottom-0 h-px bg-slate-200" />
            </div>
            <div aria-hidden className="relative flex h-full items-end">
              {columns.map((column, index) => (
                <div key={column.start} className="relative flex h-full min-w-0 flex-1 items-end justify-center">
                  {index === shown && (
                    <div
                      data-chosen
                      className="absolute inset-y-0 left-1/2 -translate-x-1/2 rounded-sm bg-slate-100"
                      style={{ width: "min(40px, calc(100% - 2px))" }}
                    />
                  )}
                  <div
                    className="relative flex flex-col-reverse gap-[2px] overflow-hidden rounded-t-[4px]"
                    style={{ height: `${(column.counts.total / max) * 100}%`, width: "min(24px, calc(100% - 2px))" }}
                  >
                    {RESULT_ORDER.map((key) =>
                      column.counts[key] > 0 ? (
                        <div key={key} className={RESULT_FILL_CLASS[key]} style={{ flexGrow: column.counts[key], flexBasis: 0, minHeight: 2 }} />
                      ) : null,
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <div aria-hidden className="relative h-6 text-xs text-muted-foreground tabular-nums touch:text-sm">
            {tickIndexes(columns.length).map((index) => {
              const edge = centred ? null : index === 0 ? "start" : index === columns.length - 1 ? "end" : null;
              return (
                <span
                  key={index}
                  className="absolute top-1.5 whitespace-nowrap"
                  style={
                    edge === "start"
                      ? { left: 0 }
                      : edge === "end"
                        ? { right: 0 }
                        : { left: `${((index + 0.5) / columns.length) * 100}%`, transform: "translateX(-50%)" }
                  }
                >
                  {columns[index].tick}
                </span>
              );
            })}
          </div>
        </div>
      </div>

      <table className="sr-only">
        <caption>{name}</caption>
        <thead>
          <tr>
            <th scope="col">{byMonth ? "Month" : "Day"}</th>
            <th scope="col">Inspections</th>
            {RESULT_ORDER.map((key) => (
              <th key={key} scope="col">
                {STATUS_LABEL[key]}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {columns.map((column) => (
            <tr key={column.start}>
              <th scope="row">{column.label}</th>
              <td>{column.counts.total}</td>
              {RESULT_ORDER.map((key) => (
                <td key={key}>{column.counts[key]}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
