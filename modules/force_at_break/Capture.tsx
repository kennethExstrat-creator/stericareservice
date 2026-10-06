"use client";

// Force at break capture (BUILD_SPEC 6.1, 8 "Speed"): one size at a time in
// SizeTabs (swipe on iPad, arrow keys on desktop), the readings of the
// gloves tested in a MeasurementGrid (decimal keypad, Enter goes down, a
// pasted column fills down) with the median, spec and verdict live in its
// footer, and whether the lab report is attached. Wording is the template's
// (6.2 rule 11); the median and the verdict are computed, never typed
// (6.2 rule 2). Read-only shows the readings as text. Every write goes
// through useDataUpdater, from the latest data (docs/CAPTURE_KIT.md).
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { FileCheckIcon, FileTextIcon } from "lucide-react";
import {
  Figure,
  focusIssuePath,
  findIssue,
  issuePathKey,
  issuePathProps,
  MeasurementGrid,
  SizeTabs,
  StatusPill,
  useDataUpdater,
  type DataChange,
  type IssuePath,
  type Measure,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatNumber, formatSize, formatSpec } from "@/lib/format";
import { formatReading } from "@/lib/stats";
import { cn } from "@/lib/utils";
import { labelFor, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { forceSpec, plannedReadings, readingsFor, specCaption, type ForceAtBreakSizeComputed } from "./calc";
import { MAX_READINGS } from "./config";
import { readingsBeyond, withGridEdits, withoutReadingsBeyond } from "./edit";
import type { ForceAtBreakComputed, ForceAtBreakConfig, ForceAtBreakData } from ".";

type Props = CaptureProps<ForceAtBreakData, ForceAtBreakConfig, ForceAtBreakComputed>;

// NumericCell's minimum is inclusive, and a force at break is always more
// than 0 N: this keeps 0 out at entry, so the grid's footer and calc agree.
const MIN_READING = 0.001;

export default function Capture({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onChange,
  onFocusChange,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const update = useDataUpdater(data, onChange);
  const [selected, setSelected] = useState(context.sizes[0] ?? "");
  // A size taken out of the order falls back to the first one ordered.
  const size = context.sizes.includes(selected) ? selected : (context.sizes[0] ?? "");

  // The size on screen tags the photos taken now (BUILD_SPEC 8.1).
  const reportSize = useEffectEvent((shown: string) => onFocusChange?.({ size: shown }));
  useEffect(() => {
    if (size !== "") reportSize(size);
  }, [size]);

  useFollowIssue(focusPath, root, (path) => {
    if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSelected(path[1]);
  });

  return (
    // relative: screen-reader text inside never lays out against the page (docs/DESIGN.md).
    <div ref={root} data-slot="force-at-break" className="relative space-y-4">
      <LabReportStatus label={labelFor(labels, "labReport")} attached={data.labReport !== null} />
      <SizeTabs
        sizes={context.sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={setSelected}
        results={evaluation?.result.perSize}
        label={`${title}: sizes`}
      >
        {(shown) => (
          <SizePanel
            size={shown}
            data={data}
            config={config}
            title={title}
            labels={labels}
            context={context}
            evaluation={evaluation}
            readOnly={readOnly}
            update={update}
          />
        )}
      </SizeTabs>
    </div>
  );
}

type PanelProps = Pick<Props, "data" | "config" | "title" | "labels" | "context" | "evaluation" | "readOnly"> & {
  size: string;
  update: (change: DataChange<ForceAtBreakData>) => void;
};

function SizePanel({ size, data, config, title, labels, context, evaluation, readOnly, update }: PanelProps) {
  const panel = useRef<HTMLDivElement>(null);
  const n = readingsFor(context, config, size);
  // Past this many rows a grid is a typing error in the sampling plan, not a test.
  const rows = Math.min(n, MAX_READINGS);
  const values = data.sizes[size]?.values ?? [];
  const sizeText = formatSize(size, { sizes: context.templateSizes });
  const label = labelFor(labels, "values");
  const footer = {
    statistic: labelFor(labels, "median"),
    spec: specCaption(labelFor(labels, "specRow"), config.standardLabel),
    result: labelFor(labels, "result"),
  };

  // Readings saved past the gloves tested, and calc's errors on saved readings:
  // shown with a way to clear or reach them, also when the plan gives no gloves.
  const notices = (
    <ReadingNotices
      size={size}
      sizeText={sizeText}
      n={n}
      values={values}
      evaluation={evaluation}
      readOnly={readOnly}
      onClear={() => update((current) => withoutReadingsBeyond(current, size, n))}
      onFocusReading={(index) => focusReading(panel.current, index)}
    />
  );

  if (n === 0) {
    return (
      <div ref={panel} data-panel-size={size} {...issuePathProps(["sizes", size])} className="space-y-3">
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          No gloves to test in the sampling plan for size {sizeText}.
        </p>
        {notices}
      </div>
    );
  }

  const measure: Measure = {
    key: "values",
    label,
    // The label usually names the unit already: "Force at break (N)".
    unit: /\(N\)/.test(label) ? undefined : "N",
    decimals: config.decimals,
    spec: forceSpec(config),
    min: MIN_READING,
  };

  return (
    <div
      ref={panel}
      data-panel-size={size}
      {...issuePathProps(["sizes", size])}
      className="grid gap-3 xl:grid-cols-[minmax(36rem,42rem)_minmax(0,1fr)] xl:items-start xl:gap-6"
    >
      {readOnly ? (
        <ReadingsTable
          caption={`${title}, size ${sizeText}`}
          label={label}
          rows={rows}
          values={values}
          decimals={config.decimals}
          footer={footer}
          specText={formatSpec(forceSpec(config))}
          computed={evaluation?.computed.sizes?.[size]}
        />
      ) : (
        <MeasurementGrid
          caption={`${title}, size ${sizeText}`}
          measures={[measure]}
          rows={rows}
          values={{ values }}
          // The grid's column is built from `values`, the readings on screen:
          // only the cells it changed are written, over the latest readings.
          onValuesChange={(next) => update((current) => withGridEdits(current, size, values, next.values ?? [], rows))}
          statistic="median"
          labels={footer}
        />
      )}
      <div className="space-y-3 text-sm text-muted-foreground touch:text-base">
        <p>{glovesNote(n, plannedReadings(context, size) !== null)}</p>
        {notices}
      </div>
    </div>
  );
}

/**
 * What needs the inspector beside the grid: readings saved past the n gloves
 * tested (calc's error, the values, a way to clear them) and calc's errors on
 * saved readings, each a way back to its cell.
 */
function ReadingNotices({
  size,
  sizeText,
  n,
  values,
  evaluation,
  readOnly,
  onClear,
  onFocusReading,
}: {
  size: string;
  sizeText: string;
  n: number;
  values: readonly (number | null)[];
  evaluation: Props["evaluation"];
  readOnly: boolean;
  onClear: () => void;
  onFocusReading: (index: number) => void;
}) {
  const beyond = readingsBeyond(values, n);
  const readingErrors = (evaluation?.issues ?? []).filter(
    (issue) => issue.level === "error" && issue.size === size && issue.code === "force_reading_not_positive",
  );
  if (beyond.length === 0 && readingErrors.length === 0) return null;
  return (
    <div className="space-y-3 text-sm touch:text-base">
      {beyond.length > 0 && (
        <div
          {...issuePathProps(["sizes", size, "values"])}
          className="space-y-2 rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-fail"
        >
          <p>
            {findIssue(evaluation?.issues, ["sizes", size, "values", beyond[0].index])?.message ??
              `Size ${sizeText}: readings past the ${n} gloves tested.`}
          </p>
          <p className="tabular-nums">
            {beyond.map(({ index, value }) => `No. ${index + 1}: ${formatNumber(value, { unit: "N" })}`).join(", ")}
          </p>
          {!readOnly && (
            <Button type="button" variant="outline" size="sm" onClick={onClear}>
              {beyond.length === 1 ? "Clear the extra reading" : `Clear the ${beyond.length} extra readings`}
            </Button>
          )}
        </div>
      )}
      {readingErrors.length > 0 && (
        <ReadingErrors issues={readingErrors} readOnly={readOnly} onFocusReading={onFocusReading} />
      )}
    </div>
  );
}

/**
 * Whether the lab report is attached ('Refer to attached where applicable':
 * optional here). The capture screen uploads it and records its file id
 * (edit.ts withLabReport); this line only shows the state.
 */
function LabReportStatus({ label, attached }: { label: string; attached: boolean }) {
  const Icon = attached ? FileCheckIcon : FileTextIcon;
  return (
    <div
      data-slot="lab-report"
      data-attached={attached || undefined}
      {...issuePathProps(["labReport"])}
      className="relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-card px-3 py-2 text-sm touch:py-2.5 touch:text-base"
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      <span className={attached ? "text-foreground" : "text-muted-foreground"}>{attached ? "Attached" : "Not attached"}</span>
    </div>
  );
}

function glovesNote(n: number, planned: boolean): string {
  const gloves = `${n} ${n === 1 ? "glove" : "gloves"} tested`;
  return planned ? `${gloves}, from the sampling plan.` : `${gloves}: the template's number until the sampling plan gives one.`;
}

/** Errors on saved readings (0 N or less), each a way back to its cell. */
function ReadingErrors({
  issues,
  readOnly,
  onFocusReading,
}: {
  issues: readonly ValidationIssue[];
  readOnly: boolean;
  onFocusReading: (index: number) => void;
}) {
  return (
    <ul className="space-y-1 rounded-lg border border-fail-border bg-fail-tint px-1.5 py-1 text-fail">
      {issues.map((issue) => {
        const index = issue.path[3];
        return (
          <li key={issuePathKey(issue.path)}>
            {readOnly || typeof index !== "number" ? (
              <p className="px-1.5 py-1">{issue.message}</p>
            ) : (
              <button
                type="button"
                onClick={() => onFocusReading(index)}
                className="flex min-h-8 w-full items-center rounded-md px-1.5 py-1 text-left underline underline-offset-2 outline-none hover:bg-fail-border/25 focus-ring-inset touch:min-h-11"
              >
                {issue.message}
              </button>
            )}
          </li>
        );
      })}
    </ul>
  );
}

const HEAD = "border-b border-border bg-slate-50 px-2.5 py-2 align-bottom font-semibold";
const ROW_HEAD = "border-r border-b border-border px-3 text-left font-normal tabular-nums";
const CELL = "border-b border-border px-2.5 py-1.5 text-right tabular-nums touch:py-2.5";
const FOOT = "border-b border-border bg-slate-50 px-2.5 py-1.5 text-right touch:py-2.5";

/** The readings as text, with the computed footer, for an inspection that cannot be edited. */
function ReadingsTable({
  caption,
  label,
  rows,
  values,
  decimals,
  footer,
  specText,
  computed,
}: {
  caption: string;
  label: string;
  rows: number;
  values: readonly (number | null)[];
  decimals: number;
  footer: { statistic: string; spec: string; result: string };
  specText: string;
  computed: ForceAtBreakSizeComputed | undefined;
}) {
  return (
    <div data-slot="readings-table" className="relative overflow-clip rounded-lg border border-border bg-card">
      <table className="w-full border-separate border-spacing-0 text-sm touch:text-base">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(HEAD, "w-14 border-r text-left")}>
              No.
            </th>
            <th scope="col" className={cn(HEAD, "text-right")}>
              {label}
            </th>
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, row) => {
            const value = values[row] ?? null;
            return (
              <tr key={row}>
                <th scope="row" className={cn(ROW_HEAD, "text-muted-foreground")}>
                  {row + 1}
                </th>
                <td className={CELL}>{value === null ? <Figure value={null} /> : formatReading(value, decimals)}</td>
              </tr>
            );
          })}
        </tbody>
        <tfoot>
          <tr>
            <th scope="row" className={cn(ROW_HEAD, FOOT, "border-t-2 border-t-slate-300 text-left font-semibold")}>
              {footer.statistic}
            </th>
            <td className={cn(FOOT, "border-t-2 border-t-slate-300 font-semibold")}>
              <Figure value={computed?.median ?? null} decimals={decimals} />
            </td>
          </tr>
          <tr>
            <th scope="row" className={cn(ROW_HEAD, FOOT, "text-left font-semibold")}>
              {footer.spec}
            </th>
            <td className={cn(FOOT, "text-muted-foreground")}>{specText}</td>
          </tr>
          <tr>
            <th scope="row" className={cn(ROW_HEAD, FOOT, "border-b-0 text-left font-semibold")}>
              {footer.result}
            </th>
            <td className={cn(FOOT, "border-b-0")}>
              <StatusPill size="sm" status={computed?.result ?? "not_done"} className="ml-auto" />
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

/**
 * Follows the screen's focusPath (an issue link) as the kit's useIssueFocus
 * does, but down to the reading's own cell, which MeasurementGrid does not
 * mark: shows its size, then focuses the cell in that size's grid, or the
 * closest control marked for the path (a reading past the grid goes to its
 * notice). Runs once for every new focusPath array, so a second click on the
 * same issue works; the size renders on a later frame, so it keeps trying for
 * about half a second.
 */
function useFollowIssue(
  focusPath: IssuePath | null,
  root: RefObject<HTMLElement | null>,
  reveal: (path: IssuePath) => void,
): void {
  const follow = useEffectEvent((path: IssuePath) => {
    reveal(path);
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (root.current && focusTarget(root.current, path)) return;
      tries += 1;
      if (tries < 30) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  });
  useEffect(() => {
    if (!focusPath || focusPath.length === 0) return;
    return follow(focusPath);
  }, [focusPath]);
}

function focusTarget(root: HTMLElement, path: IssuePath): boolean {
  const [head, size, field, index] = path;
  if (head === "sizes" && typeof size === "string") {
    const panel = Array.from(root.querySelectorAll<HTMLElement>("[data-panel-size]")).find(
      (element) => element.dataset.panelSize === size,
    );
    // Not on screen yet: the size tab is still switching.
    if (!panel) return false;
    if (field === "values" && typeof index === "number" && focusReading(panel, index)) return true;
  }
  return focusIssuePath(root, path);
}

/** Focuses the grid cell of a reading; false when the grid has no such row. */
function focusReading(panel: HTMLElement | null, index: number): boolean {
  const cell = panel?.querySelectorAll<HTMLInputElement>('[data-slot="measurement-grid"] input')[index];
  if (!cell) return false;
  cell.scrollIntoView({ block: "center", inline: "nearest" });
  cell.focus({ preventScroll: true });
  return true;
}
