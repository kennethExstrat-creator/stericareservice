"use client";

// Force at break capture (BUILD_SPEC 6.1, 8 "Speed"): one size at a time in
// SizeTabs (swipe on iPad, arrow keys on desktop), the readings of the
// gloves tested in a MeasurementGrid (decimal keypad, Enter goes down, a
// pasted column fills down) with calc's median and verdict in its footer,
// and the lab report: whether it is attached, and the screen's file slot to
// attach it (the framework's file channel, BUILD_SPEC 8.1). Wording is the
// template's (6.2 rule 11); the median and the verdict are computed, never
// typed (6.2 rule 2). Read-only, the readings stay focusable on grey. Every
// write goes through useDataUpdater, from the latest data
// (docs/CAPTURE_KIT.md). A pasted column that runs past the gloves tested
// keeps the rest as readings past them, which calc reports, instead of
// losing them at the grid's end.
import { useEffect, useEffectEvent, useRef, useState } from "react";
import {
  AttachmentStatus,
  findIssue,
  focusIssuePath,
  issueNoticeProps,
  issuePathKey,
  issuePathProps,
  MeasurementGrid,
  SizeTabs,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type Measure,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatNumber, formatSize } from "@/lib/format";
import { initialSize, labelFor, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { ModuleFileSlot } from "@/modules/_framework/file-slot";
import { forceSpec, labReportState, plannedReadings, readingsFor, specCaption } from "./calc";
import { readingSummary } from "./capture-data";
import { MAX_READINGS } from "./config";
import {
  pastedPastGrid,
  readingsBeyond,
  withLabReport,
  withoutLabReport,
  withoutReadingsBeyond,
  withReadingChanges,
  withReadingsFrom,
} from "./edit";
import type { ForceAtBreakComputed, ForceAtBreakConfig, ForceAtBreakData } from ".";

type Props = CaptureProps<ForceAtBreakData, ForceAtBreakConfig, ForceAtBreakComputed>;

/** The grid's one measure: the readings. */
const READINGS = "values";

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

  // An issue link shows its size, then lands on the reading's cell, or on the
  // notice for a reading the grid has no cell for (past the plan, a plan too large).
  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSelected(path[1]);
    },
  });

  const reportLabel = labelFor(labels, "labReport");
  const reportState = labReportState(context, data.labReport);
  const missing = evaluation?.issues.find((issue) => issue.code === "lab_report_missing");

  return (
    // relative: screen-reader text inside never lays out against the page (docs/DESIGN.md).
    <div ref={root} data-slot="force-at-break" className="relative space-y-4">
      <section
        data-slot="lab-report"
        data-state={reportState}
        {...issuePathProps(["labReport"])}
        aria-label={reportLabel}
        className="relative space-y-2"
      >
        <AttachmentStatus label={reportLabel} attached={reportState === "attached"} />
        {missing && (
          <p
            {...issueNoticeProps(missing.path)}
            className="flex items-start gap-1.5 rounded-sm text-sm text-warn outline-none focus-ring touch:text-base"
          >
            <StatusIcon status="warn" className="mt-0.5 size-4 shrink-0 touch:mt-1" />
            <span>{missing.message}</span>
          </p>
        )}
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
            onFocusIssue={(path) => {
              if (root.current) focusIssuePath(root.current, path);
            }}
          />
        )}
      </SizeTabs>
    </div>
  );
}

type PanelProps = Pick<Props, "data" | "config" | "title" | "labels" | "context" | "evaluation" | "readOnly"> & {
  size: string;
  update: (change: DataChange<ForceAtBreakData>) => void;
  /** Focuses the cell or notice an issue path points at. */
  onFocusIssue: (path: ValidationIssue["path"]) => void;
};

function SizePanel({ size, data, config, title, labels, context, evaluation, readOnly, update, onFocusIssue }: PanelProps) {
  // The cell that has the focus, where a paste starts.
  const focusedRow = useRef<number | null>(null);
  // The part of the paste under way that runs past the grid's last row (pastedPastGrid).
  const pastGrid = useRef<(number | null)[] | null>(null);
  const n = readingsFor(context, config, size);
  // Past this many rows a grid is a typing error in the sampling plan, not a
  // test: calc says so (force_plan_too_many).
  const rows = Math.min(n, MAX_READINGS);
  const values = data.sizes[size]?.values ?? [];
  const sizeText = formatSize(size, { sizes: context.templateSizes });
  const label = labelFor(labels, READINGS);
  // A module whose config or data is broken comes back with no computed values.
  const computed: Partial<ForceAtBreakComputed> | undefined = evaluation?.computed;

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
      onFocusIssue={onFocusIssue}
    />
  );

  if (n === 0) {
    return (
      <div data-panel-size={size} {...issuePathProps(["sizes", size])} className="space-y-3">
        <p className="rounded-lg border border-dashed border-not-done-border bg-not-done-tint px-4 py-3 text-sm text-not-done touch:text-base">
          No gloves to test in the sampling plan for size {sizeText}.
        </p>
        {notices}
      </div>
    );
  }

  const measure: Measure = {
    key: READINGS,
    label,
    // The label usually names the unit already: "Force at break (N)".
    unit: /\(N\)/.test(label) ? undefined : "N",
    decimals: config.decimals,
    spec: forceSpec(config),
    // calc refuses a reading of 0 N or less: so does the cell ("Must be more than 0.").
    min: 0,
    minExclusive: true,
    summary: readingSummary(computed?.sizes?.[size]),
  };

  return (
    <div
      data-panel-size={size}
      {...issuePathProps(["sizes", size])}
      className="grid gap-3 xl:grid-cols-[minmax(36rem,42rem)_minmax(0,1fr)] xl:items-start xl:gap-6"
    >
      <div
        className="min-w-0"
        // MeasurementGrid takes a pasted column only as far as its last row.
        // The rest is read here before the grid takes the paste, and saved
        // with the grid's own change, as one change, past the gloves tested:
        // calc reports it there, and the notice offers to clear it.
        onPasteCapture={
          readOnly
            ? undefined
            : (event) => {
                const from = focusedRow.current;
                pastGrid.current =
                  from === null || !(event.target instanceof HTMLInputElement)
                    ? null
                    : pastedPastGrid(event.clipboardData.getData("text"), from, rows);
              }
        }
        onPaste={() => {
          // The grid has taken the paste by now: nothing carries over to a later edit.
          pastGrid.current = null;
        }}
      >
        <MeasurementGrid
          caption={`${title}, size ${sizeText}`}
          measures={[measure]}
          rows={rows}
          values={{ [READINGS]: values }}
          onCellsChange={(changes) => {
            const past = pastGrid.current ?? [];
            pastGrid.current = null;
            const readings = changes.filter((change) => change.measure === READINGS);
            update((current) => withReadingsFrom(withReadingChanges(current, size, readings), size, rows, past));
          }}
          onCellFocus={({ row }) => {
            focusedRow.current = row;
          }}
          statistic="median"
          labels={{
            row: labelFor(labels, "rowNo"),
            statistic: labelFor(labels, "median"),
            spec: specCaption(labelFor(labels, "specRow"), config.standardLabel),
            result: labelFor(labels, "result"),
          }}
          cellIssuePath={({ row }) => ["sizes", size, READINGS, row]}
          readOnly={readOnly}
        />
      </div>
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
 * message (issueNoticeProps), never on the button that clears readings.
 */
function ReadingNotices({
  size,
  sizeText,
  n,
  values,
  evaluation,
  readOnly,
  onClear,
  onFocusIssue,
}: {
  size: string;
  sizeText: string;
  n: number;
  values: readonly (number | null)[];
  evaluation: Props["evaluation"];
  readOnly: boolean;
  onClear: () => void;
  onFocusIssue: (path: ValidationIssue["path"]) => void;
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
          data-slot="size-notice"
          {...issueNoticeProps(["sizes", size])}
          className="rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-fail outline-none focus-ring"
        >
          {issue.message}
        </p>
      ))}
      {beyond.length > 0 && (
        <div className="space-y-2 rounded-lg border border-fail-border bg-fail-tint px-3 py-2.5 text-fail">
          <p data-slot="size-notice" {...issueNoticeProps(["sizes", size, READINGS])} className="rounded-sm outline-none focus-ring">
            {findIssue(evaluation?.issues, ["sizes", size, READINGS, beyond[0].index])?.message ??
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
      {readingErrors.length > 0 && <ReadingErrors issues={readingErrors} onFocusIssue={onFocusIssue} />}
    </div>
  );
}

function glovesNote(n: number, planned: boolean): string {
  const gloves = `${n} ${n === 1 ? "glove" : "gloves"} tested`;
  return planned ? `${gloves}, from the sampling plan.` : `${gloves}: the template's number until the sampling plan gives one.`;
}

/**
 * Errors on saved readings (0 N or less), each a way back to its cell, read
 * only too: the readings stay focusable there.
 */
function ReadingErrors({
  issues,
  onFocusIssue,
}: {
  issues: readonly ValidationIssue[];
  onFocusIssue: (path: ValidationIssue["path"]) => void;
}) {
  return (
    <ul className="space-y-1 rounded-lg border border-fail-border bg-fail-tint px-1.5 py-1 text-fail">
      {issues.map((issue) => (
        <li key={issuePathKey(issue.path)}>
          <button
            type="button"
            onClick={() => onFocusIssue(issue.path)}
            className="flex min-h-8 w-full items-center rounded-md px-1.5 py-1 text-left underline underline-offset-2 outline-none hover:bg-fail-border/25 focus-ring-inset touch:min-h-11"
          >
            {issue.message}
          </button>
        </li>
      ))}
    </ul>
  );
}
