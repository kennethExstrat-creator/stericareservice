"use client";

// Force at break capture (BUILD_SPEC 6.1, 8 "Speed"): one size at a time in
// SizeTabs (swipe on iPad, arrow keys on desktop), the readings of the
// gloves tested in a MeasurementGrid (decimal keypad, Enter goes down, a
// pasted column fills down) with the median, spec and verdict live in its
// footer, and the lab report: whether it is attached, and the screen's file
// slot to attach it (the framework's file channel, BUILD_SPEC 8.1). Wording
// is the template's (6.2 rule 11); the median and the verdict are computed,
// never typed (6.2 rule 2). Read-only shows the readings as text. Every write goes
// through useDataUpdater, from the latest data (docs/CAPTURE_KIT.md). A
// pasted column that runs past the gloves tested keeps the rest as readings
// past them, which calc reports, instead of losing them at the grid's end.
import { useEffect, useEffectEvent, useRef, useState, type RefObject } from "react";
import { FileCheckIcon, FileTextIcon, FileXIcon } from "lucide-react";
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
// The kit's touch size for small pills; not exported from @/components/qc yet.
import { SMALL_PILL_TOUCH } from "@/components/qc/status-pill";
import { Button } from "@/components/ui/button";
import { formatNumber, formatSize, formatSpec } from "@/lib/format";
import { formatReading } from "@/lib/stats";
import { cn } from "@/lib/utils";
import {
  initialSize,
  labelFor,
  type CaptureProps,
  type HeldFileState,
  type ValidationIssue,
} from "@/modules/_framework";
import { ModuleFileSlot } from "@/modules/_framework/file-slot";
import {
  forceSpec,
  labReportState,
  plannedReadings,
  readingsFor,
  specCaption,
  type ForceAtBreakSizeComputed,
} from "./calc";
import { MAX_READINGS } from "./config";
import {
  pastedPastGrid,
  readingsBeyond,
  withGridEdits,
  withLabReport,
  withoutLabReport,
  withoutReadingsBeyond,
  withReadingsFrom,
} from "./edit";
import type { ForceAtBreakComputed, ForceAtBreakConfig, ForceAtBreakData } from ".";

type Props = CaptureProps<ForceAtBreakData, ForceAtBreakConfig, ForceAtBreakComputed>;

// NumericCell's minimum is inclusive, and a force at break is always more
// than 0 N: this keeps 0 out at entry, so the grid's footer and calc agree.
const MIN_READING = 0.001;

/** The reading cells of a size's grid, glove 1 first (one measure: one cell per row). */
const GRID_CELLS = '[data-slot="measurement-grid"] tbody input';

export default function Capture({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  focus,
  onChange,
  onFocusChange,
}: Props) {
  const root = useRef<HTMLDivElement>(null);
  const update = useDataUpdater(data, onChange);
  const [selected, setSelected] = useState(() => initialSize(context, focus));
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
      <section
        data-slot="lab-report"
        {...issuePathProps(["labReport"])}
        aria-label={labelFor(labels, "labReport")}
        className="relative space-y-3 rounded-lg border border-border bg-card px-3 py-2.5"
      >
        <LabReportStatus
          label={labelFor(labels, "labReport")}
          state={labReportState(context, data.labReport)}
          message={evaluation?.issues.find((issue) => issue.code === "lab_report_missing")?.message}
        />
        <ModuleFileSlot
          moduleKey="force_at_break"
          kind="lab_report"
          focus={size === "" ? null : { size }}
          readOnly={readOnly}
          onAdded={(file) => update((current) => withLabReport(current, file.id))}
          onRemoved={(fileId) => update((current) => withoutLabReport(current, fileId))}
        />
      </section>
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
  // The part of the paste under way that runs past the grid's last row (pastedPastGrid).
  const pastGrid = useRef<(number | null)[] | null>(null);
  const n = readingsFor(context, config, size);
  // Past this many rows a grid is a typing error in the sampling plan, not a
  // test: calc says so (force_plan_too_many).
  const rows = Math.min(n, MAX_READINGS);
  const values = data.sizes[size]?.values ?? [];
  const sizeText = formatSize(size, { sizes: context.templateSizes });
  const label = labelFor(labels, "values");
  const footer = {
    statistic: labelFor(labels, "median"),
    spec: specCaption(labelFor(labels, "specRow"), config.standardLabel),
    result: labelFor(labels, "result"),
  };

  // Calc's errors on the plan and on saved readings, and readings saved past
  // the gloves tested: shown with a way to clear or reach them, also when the
  // plan gives no gloves.
  const notices = (
    <ReadingNotices
      size={size}
      sizeText={sizeText}
      n={n}
      values={values}
      evaluation={evaluation}
      readOnly={readOnly}
      onClear={() => update((current) => withoutReadingsBeyond(current, size, n))}
      // A reading past the grid has no cell: its notice instead.
      onFocusReading={(index) =>
        focusReading(panel.current, index) || focusNotice(panel.current, ["sizes", size, "values", index])
      }
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
        // MeasurementGrid stores a pasted column only as far as its last row.
        // The rest is read here before the grid takes the paste, and saved
        // with the grid's own change, as one change, past the gloves tested:
        // calc reports it there, and the notice offers to clear it.
        <div
          className="min-w-0"
          onPasteCapture={(event) => {
            const from = gridRowOf(event.currentTarget, event.target);
            pastGrid.current = from === null ? null : pastedPastGrid(event.clipboardData.getData("text"), from, rows);
          }}
          onPaste={() => {
            // The grid has taken the paste by now: nothing carries over to a later edit.
            pastGrid.current = null;
          }}
        >
          <MeasurementGrid
            caption={`${title}, size ${sizeText}`}
            measures={[measure]}
            rows={rows}
            values={{ values }}
            // The grid's column is built from `values`, the readings on screen:
            // only the cells it changed are written, over the latest readings.
            onValuesChange={(next) => {
              const past = pastGrid.current ?? [];
              pastGrid.current = null;
              update((current) =>
                withReadingsFrom(withGridEdits(current, size, values, next.values ?? [], rows), size, rows, past),
              );
            }}
            statistic="median"
            labels={footer}
          />
        </div>
      )}
      <div className="space-y-3 text-sm text-muted-foreground touch:text-base">
        <p>{glovesNote(n, plannedReadings(context, size) !== null)}</p>
        {notices}
      </div>
    </div>
  );
}

/**
 * What needs the inspector beside the grid: a sampling plan asking for more
 * readings than the grid takes, readings saved past the n gloves tested
 * (calc's error, the values, a way to clear them) and calc's errors on saved
 * readings, each a way back to its cell. An issue link lands on a notice's
 * message (noticeProps), never on the button that clears readings.
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
  const errors = (evaluation?.issues ?? []).filter((issue) => issue.level === "error" && issue.size === size);
  const planErrors = errors.filter((issue) => issue.code === "force_plan_too_many");
  const readingErrors = errors.filter((issue) => issue.code === "force_reading_not_positive");
  if (beyond.length === 0 && planErrors.length === 0 && readingErrors.length === 0) return null;
  return (
    <div className="space-y-3 text-sm touch:text-base">
      {planErrors.map((issue) => (
        <p
          key={issue.code}
          {...noticeProps(["sizes", size])}
          className="rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-fail outline-none focus-ring"
        >
          {issue.message}
        </p>
      ))}
      {beyond.length > 0 && (
        <div className="space-y-2 rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-fail">
          <p {...noticeProps(["sizes", size, "values"])} className="rounded-sm outline-none focus-ring">
            {findIssue(evaluation?.issues, ["sizes", size, "values", beyond[0].index])?.message ??
              `Size ${sizeText}: readings past the ${n} gloves tested.`}
          </p>
          <p className="tabular-nums">
            {beyond.map(({ index, value }) => `No. ${index + 1}: ${formatNumber(value, { unit: "N" })}`).join(", ")}
          </p>
          {!readOnly && (
            <Button type="button" variant="outline" size="sm" onClick={onClear} className="touch:text-base">
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
 * optional here). The file slot below it attaches the file and the module
 * keeps its id (edit.ts withLabReport); one added in the gallery counts once
 * the inspection's files are known, and a kept file they do not hold is
 * missing, with calc's message.
 */
function LabReportStatus({ label, state, message }: { label: string; state: HeldFileState; message?: string }) {
  const attached = state === "attached";
  const Icon = attached ? FileCheckIcon : state === "missing" ? FileXIcon : FileTextIcon;
  return (
    <div
      data-attached={attached || undefined}
      data-state={state}
      className="relative flex flex-wrap items-center gap-x-3 gap-y-1 text-sm touch:text-base"
    >
      <Icon aria-hidden className="size-5 shrink-0 text-muted-foreground" />
      <span className="font-medium text-foreground">{label}</span>
      <span className={attached ? "text-foreground" : "text-muted-foreground"}>{attached ? "Attached" : "Not attached"}</span>
      {message && <span className="text-warn">{message}</span>}
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
              <StatusPill size="sm" status={computed?.result ?? "not_done"} className={cn("ml-auto", SMALL_PILL_TOUCH)} />
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
 * mark, and onto a notice's message (tabIndex -1), which the kit's
 * focusIssuePath never focuses: shows its size, then focuses the cell in that
 * size's grid, else the notice for the path (a reading past the grid, a plan
 * too large), else the closest control marked for the path. Runs once for
 * every new focusPath array, so a second click on the same issue works; the
 * size renders on a later frame, so it keeps trying for about half a second.
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
    if (focusNotice(panel, path)) return true;
  }
  return focusIssuePath(root, path);
}

/** Focuses the grid cell of a reading; false when the grid has no such row. */
function focusReading(panel: HTMLElement | null, index: number): boolean {
  const cell = panel?.querySelectorAll<HTMLInputElement>(GRID_CELLS)[index];
  if (!cell) return false;
  cell.scrollIntoView({ block: "center", inline: "nearest" });
  cell.focus({ preventScroll: true });
  return true;
}

/** The grid row of a reading's cell, or null for anything else. */
function gridRowOf(scope: HTMLElement, target: EventTarget): number | null {
  if (!(target instanceof HTMLInputElement)) return null;
  const row = Array.from(scope.querySelectorAll(GRID_CELLS)).indexOf(target);
  return row === -1 ? null : row;
}

/**
 * Marks a notice's message for issue links: it takes the focus itself, so a
 * screen reader reads it and Tab goes on to its button, instead of the link
 * landing on a button that would clear readings.
 */
function noticeProps(path: IssuePath) {
  return { "data-slot": "size-notice", tabIndex: -1, ...issuePathProps(path) };
}

/** Focuses the notice marked with the path, else with its nearest parent path; false when there is none. */
function focusNotice(panel: HTMLElement | null, path: IssuePath): boolean {
  const notices = Array.from(panel?.querySelectorAll<HTMLElement>('[data-slot="size-notice"]') ?? []);
  for (let length = path.length; length > 0; length -= 1) {
    const key = issuePathKey(path.slice(0, length));
    const notice = notices.find((element) => element.dataset.issuePath === key);
    if (!notice) continue;
    notice.scrollIntoView({ block: "center", inline: "nearest" });
    notice.focus({ preventScroll: true });
    return true;
  }
  return false;
}
