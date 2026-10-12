"use client";

// Steri-AI Cost's Cost per Day card (Cost per Month for All Time over 92
// days): one column per day, zeros included, from the later of the period's
// first day and the first recorded call, so days before tracking never read
// as free. CSS columns in --chart-1, no chart library. A single series, so no
// legend: the title names it.
//
// Two fixed lines above the plot read out one day, the highest until a
// pointer, a tap or the arrow keys pick another, and that day's jobs; nothing
// floats over the bars, it works on touch, and nothing shifts. The plot is
// one tab stop (ArrowLeft, ArrowRight, Home, End), the readout is announced,
// and a visually hidden table carries every value.
import { useId, useState, type KeyboardEvent, type PointerEvent } from "react";
import { AI_JOB, AI_USAGE_FEATURES, type AiUsageFeature } from "@/lib/schemas/ai-usage";
import { cn } from "@/lib/utils";
import { countOf, formatAxisValue, formatCost, inCurrency, type Money } from "./money";

export type TrendBar = {
  /** The day (YYYY-MM-DD, Malaysia), or the month's first day. */
  start: string;
  /** "Mon 12 Oct", or "Sept 2026" by month: the readout and the table. */
  label: string;
  /** "12 Oct", or "Sept 2026": under the axis. */
  tick: string;
  costUsd: number;
  calls: number;
  byJob: Partial<Record<AiUsageFeature, number>>;
};

/** Up to this many columns, the first and last labels sit under their columns; past it, at the plot's edges. */
const CENTRED_TICKS = 14;

/** The axis top: the smallest 1, 2, 2.5 or 5 x 10^n at or above `value`; 1 when there is nothing. */
export function niceMax(value: number): number {
  if (!(value > 0)) return 1;
  const exponent = Math.floor(Math.log10(value));
  for (const step of [1, 2, 2.5, 5, 10]) {
    const candidate = Number((step * 10 ** exponent).toPrecision(12));
    if (candidate >= value) return candidate;
  }
  return Number((10 ** (exponent + 1)).toPrecision(12));
}

/** Decimals a number is written with: 1.25 has 2, 5e-7 has 7. */
function placesOf(value: number): number {
  const [mantissa, exponent = "0"] = String(value).split("e");
  return Math.max(0, (mantissa.split(".")[1]?.length ?? 0) - Number(exponent));
}

/** Decimals for the axis labels: enough for the middle line, at least 2; none for whole amounts from 10. */
export function axisPlaces(max: number): number {
  const places = placesOf(Number((max / 2).toPrecision(12)));
  return places === 0 && max >= 10 ? 0 : Math.max(2, places);
}

/** The day the readout starts on: the costliest, then the busiest, the latest of equals. -1 when no day has a call. */
export function highestIndex(bars: readonly TrendBar[]): number {
  let best = -1;
  bars.forEach((bar, index) => {
    if (bar.calls === 0 && bar.costUsd === 0) return;
    const top = bars[best];
    if (!top || bar.costUsd > top.costUsd || (bar.costUsd === top.costUsd && bar.calls >= top.calls)) best = index;
  });
  return best;
}

/** Where a key moves the chosen day from `index` (null: none chosen yet); null for a key the plot leaves alone. */
export function moveIndex(key: string, index: number | null, count: number): number | null {
  if (count === 0) return null;
  switch (key) {
    case "ArrowLeft":
      return index === null ? count - 1 : Math.max(0, index - 1);
    case "ArrowRight":
      return index === null ? 0 : Math.min(count - 1, index + 1);
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}

/**
 * The readout: "Highest: Mon 12 Oct · $0.84 · 23 calls" until a day is
 * picked (then without "Highest:"), and that day's jobs, costliest first.
 */
export function readoutLines(bar: TrendBar | null, money: Money, highest: boolean): [string, string] {
  if (!bar) return ["No calls in this period.", ""];
  const day = `${highest ? "Highest: " : ""}${bar.label} · ${formatCost(bar.costUsd, money)} · ${countOf(bar.calls, "call", "calls")}`;
  const jobs = AI_USAGE_FEATURES.flatMap((feature) => {
    const cost = bar.byJob[feature];
    return typeof cost === "number" ? [{ feature, cost }] : [];
  })
    .sort((a, b) => b.cost - a.cost)
    .map(({ feature, cost }) => `${AI_JOB[feature].label} ${formatCost(cost, money)}`)
    .join(" · ");
  return [day, jobs];
}

/** The columns labelled under the axis: the first, the middle and the last. */
function tickIndexes(count: number): number[] {
  if (count === 0) return [];
  return [...new Set([0, Math.round((count - 1) / 2), count - 1])];
}

export function CostTrendChart({ bucket, bars, money }: { bucket: "day" | "month"; bars: TrendBar[]; money: Money }) {
  const titleId = useId();
  const readoutId = useId();
  // A mouse over the plot shows its day while it stays; a tap, a touch drag or a key keeps the day picked.
  const [hovered, setHovered] = useState<number | null>(null);
  const [picked, setPicked] = useState<number | null>(null);

  const highest = highestIndex(bars);
  const chosen = hovered ?? picked;
  const shown = chosen ?? (highest >= 0 ? highest : null);
  const [dayLine, jobsLine] = readoutLines(shown === null ? null : bars[shown], money, chosen === null);

  const values = bars.map((bar) => inCurrency(bar.costUsd, money));
  const max = niceMax(Math.max(0, ...values));
  const places = axisPlaces(max);
  const byMonth = bucket === "month";
  const title = byMonth ? "Cost per Month" : "Cost per Day";
  const name = byMonth ? "Cost per month" : "Cost per day";
  const centred = bars.length <= CENTRED_TICKS;

  function dayAt(event: PointerEvent<HTMLDivElement>): number {
    const box = event.currentTarget.getBoundingClientRect();
    const share = box.width > 0 ? (event.clientX - box.left) / box.width : 0;
    return Math.min(bars.length - 1, Math.max(0, Math.floor(share * bars.length)));
  }

  function onPointerDown(event: PointerEvent<HTMLDivElement>) {
    if (bars.length > 0) setPicked(dayAt(event));
  }

  function onPointerMove(event: PointerEvent<HTMLDivElement>) {
    if (bars.length === 0) return;
    if (event.pointerType === "touch") setPicked(dayAt(event));
    else setHovered(dayAt(event));
  }

  function onPointerLeave(event: PointerEvent<HTMLDivElement>) {
    if (event.pointerType !== "touch") setHovered(null);
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const next = moveIndex(event.key, shown, bars.length);
    if (next === null) return;
    event.preventDefault();
    setHovered(null);
    setPicked(next);
  }

  return (
    <section
      aria-labelledby={titleId}
      data-testid="cost-trend"
      className="relative flex min-w-0 flex-col gap-3 rounded-xl bg-card p-5 shadow-sm ring-1 ring-border touch:p-6"
    >
      <div className="flex flex-col gap-1">
        <h2 id={titleId} className="text-lg leading-tight font-bold text-foreground">
          {title}
        </h2>
        <div id={readoutId} aria-live="polite" data-testid="cost-trend-readout" className="flex flex-col text-sm">
          <p className="min-h-5 font-medium text-foreground">{dayLine}</p>
          <p className="min-h-5 text-muted-foreground">{jobsLine}</p>
        </div>
      </div>

      <div className="flex pt-2">
        {/* Each label is centred on its line: the column starts half a line above the plot and ends half a line below it. */}
        <div
          aria-hidden
          className="-mt-2 flex h-[196px] shrink-0 flex-col justify-between pr-2 text-right text-xs leading-4 text-muted-foreground tabular-nums touch:-mt-2.5 touch:h-[220px] touch:text-sm touch:leading-5"
        >
          {[max, max / 2, 0].map((value, index) => (
            <span key={index}>{formatAxisValue(value, money, places)}</span>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div
            role="group"
            tabIndex={0}
            aria-label={name}
            aria-describedby={readoutId}
            data-testid="cost-trend-plot"
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
              {bars.map((bar, index) => {
                const value = values[index];
                const isShown = index === shown;
                return (
                  <div key={bar.start} className="flex h-full min-w-0 flex-1 items-end justify-center">
                    <div
                      data-chosen={isShown || undefined}
                      className={cn("rounded-t-[4px]", isShown ? "bg-brand-700" : "bg-chart-1")}
                      style={{
                        height: `${(value / max) * 100}%`,
                        // A day that cost something always shows; the chosen day shows on a free day too.
                        minHeight: value > 0 || isShown ? 2 : 0,
                        width: "min(24px, calc(100% - 2px))",
                      }}
                    />
                  </div>
                );
              })}
            </div>
          </div>
          <div aria-hidden className="relative h-6 text-xs text-muted-foreground tabular-nums touch:text-sm">
            {tickIndexes(bars.length).map((index) => {
              const edge = centred ? null : index === 0 ? "start" : index === bars.length - 1 ? "end" : null;
              return (
                <span
                  key={index}
                  className="absolute top-1.5 whitespace-nowrap"
                  style={
                    edge === "start"
                      ? { left: 0 }
                      : edge === "end"
                        ? { right: 0 }
                        : { left: `${((index + 0.5) / bars.length) * 100}%`, transform: "translateX(-50%)" }
                  }
                >
                  {bars[index].tick}
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
            <th scope="col">Cost</th>
            <th scope="col">Calls</th>
          </tr>
        </thead>
        <tbody>
          {bars.map((bar) => (
            <tr key={bar.start}>
              <th scope="row">{bar.label}</th>
              <td>{formatCost(bar.costUsd, money)}</td>
              <td>{bar.calls}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
