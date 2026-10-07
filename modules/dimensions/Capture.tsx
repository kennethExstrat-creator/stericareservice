"use client";

// The Dimension body: one MeasurementGrid per ordered size, in size tabs.
// Gloves are rows (the sampling plan's n, else the template's), the measures
// on are columns in the template's wording; the footer shows calc's median
// or average, the spec and the verdict at the printed precision, as you
// type. Enter walks down a column and a pasted column fills down (the grid's
// own rules); every write goes through useDataUpdater, so a paste or two
// commits in one event all land. Issue links switch to the size and focus
// the cell; readings past the planned gloves, which have no row, can be
// removed from their warning. Read-only, the readings stay focusable. Photos
// are tagged with the size in view.
import { useId, useRef, useState, type RefObject } from "react";
import {
  focusIssuePath,
  issueNoticeProps,
  MeasurementGrid,
  ModuleSection,
  SizeTabs,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type Measure as GridMeasure,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { labelFor, sizeLabel, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import { rowsFor, specFor, type DimensionsComputed } from "./calc";
import {
  cellPath,
  gridColumns,
  measureSummary,
  readingChanges,
  sizeHeading,
  withoutGlovesPast,
  withReadings,
} from "./capture-data";
import type { DimensionsConfig } from "./config";
import type { DimensionsData } from "./schema";

type Props = CaptureProps<DimensionsData, DimensionsConfig, DimensionsComputed>;

export default function Capture(props: Props) {
  const { data, context, evaluation, focusPath, onChange, onFocusChange } = props;
  const update = useDataUpdater(data, onChange);
  const root = useRef<HTMLDivElement>(null);
  // SizeTabs shows the first ordered size while this is not one (6.2 rule 4) and says so through show.
  const [size, setSize] = useState(context.sizes[0] ?? "");

  const show = (next: string) => {
    setSize(next);
    onFocusChange?.({ size: next });
  };

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      // size_not_ordered points at a size that is not on screen: stay put.
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSize(path[1]);
    },
  });

  return (
    <div ref={root} data-slot="dimensions-capture" className="min-w-0">
      <SizeTabs
        sizes={context.sizes}
        templateSizes={context.templateSizes}
        value={size}
        onValueChange={show}
        results={evaluation?.result.perSize}
      >
        {(current) => <SizeGrid {...props} size={current} root={root} update={update} />}
      </SizeTabs>
    </div>
  );
}

function SizeGrid({
  size,
  root,
  update,
  data,
  config,
  labels,
  context,
  evaluation,
  readOnly,
  onFocusChange,
}: Props & {
  size: string;
  root: RefObject<HTMLDivElement | null>;
  update: (change: DataChange<DimensionsData>) => void;
}) {
  const { rows } = rowsFor(context, size, config);
  const heading = sizeHeading(labelFor(labels, "sizeHeading"), sizeLabel(context, size));
  const status = evaluation?.result.perSize?.[size]?.status;
  // A module whose config or data is broken comes back with no computed values.
  const computed: Partial<DimensionsComputed> | undefined = evaluation?.computed;
  // Issues about a reading of this size; the screen's issue list carries the rest.
  const issues = (evaluation?.issues ?? []).filter(
    (issue) => issue.size === size && issue.path[0] === "sizes" && issue.path[1] === size && issue.path.length > 2,
  );

  const measures: GridMeasure[] = config.measures.map((measure) => ({
    key: measure,
    label: labelFor(labels, measure),
    unit: "mm",
    decimals: config.decimals[measure],
    spec: specFor(config, size, measure),
    // calc refuses a reading of 0 mm or less: so does the cell.
    min: 0,
    minExclusive: true,
    summary: measureSummary(computed, size, measure),
  }));

  return (
    <ModuleSection
      title={heading}
      description={`${labelFor(labels, "statistic")} of ${rows} ${rows === 1 ? "glove" : "gloves"}`}
      status={status}
      statusLabel={status === "pass" || status === "fail" ? labelFor(labels, status) : undefined}
      issuePath={["sizes", size]}
    >
      <div
        // Tag photos with the size when focus enters the grid, not on every move between its cells.
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.({ size });
        }}
      >
        <MeasurementGrid
          caption={heading}
          measures={measures}
          rows={rows}
          values={gridColumns(data, size, config.measures, rows)}
          onCellsChange={(changes) =>
            update((current) => withReadings(current, size, readingChanges(changes, config.measures)))
          }
          statistic={config.statistic}
          labels={gridLabels(labels)}
          readOnly={readOnly}
          cellIssuePath={(cell) => cellPath(size, cell)}
        />
      </div>
      <IssueLinks
        issues={issues}
        root={root}
        onRemoveUncounted={readOnly ? undefined : () => update((current) => withoutGlovesPast(current, size, rows))}
      />
    </ModuleSection>
  );
}

function gridLabels(labels: Labels) {
  return {
    row: labelFor(labels, "rowNo"),
    statistic: labelFor(labels, "statistic"),
    spec: labelFor(labels, "specRow"),
    result: labelFor(labels, "measureResult"),
    pass: labelFor(labels, "pass"),
    fail: labelFor(labels, "fail"),
  };
}

/**
 * calc's issues for the size in view: a reading's problem is a link back to
 * its cell; readings past the planned gloves have no cell, so their warning
 * is where an issue link lands, with the way to remove them.
 */
function IssueLinks({
  issues,
  root,
  onRemoveUncounted,
}: {
  issues: readonly ValidationIssue[];
  root: RefObject<HTMLElement | null>;
  /**
   * Removes the gloves past the grid's rows. The grid has no row for them
   * (the sampling plan's n went down), so this is the only way to clear
   * calc's warning that they are not counted.
   */
  onRemoveUncounted?: () => void;
}) {
  const idBase = useId();
  if (issues.length === 0) return null;
  const tone = (issue: ValidationIssue) =>
    issue.level === "error" ? "border-fail-border bg-fail-tint text-fail" : "border-warn-border bg-warn-tint text-warn";
  const icon = (issue: ValidationIssue) => (
    <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
  );
  return (
    <ul className="space-y-1.5" aria-label="Problems in this size">
      {issues.map((issue, index) =>
        issue.code === "dimension_beyond_sample" ? (
          <li key={`${issue.code}-${index}`} className={cn("relative space-y-2 rounded-md border px-3 py-2", tone(issue))}>
            <p
              {...issueNoticeProps(issue.path)}
              className="flex items-start gap-2 rounded-sm text-sm outline-none focus-ring touch:text-base"
            >
              {icon(issue)}
              <span id={`${idBase}-${index}`}>{issue.message}</span>
            </p>
            {onRemoveUncounted && (
              // Described by the warning, which names the size and the gloves.
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="text-foreground touch:text-base"
                aria-describedby={`${idBase}-${index}`}
                onClick={onRemoveUncounted}
              >
                Remove the readings that are not counted
              </Button>
            )}
          </li>
        ) : (
          <li key={`${issue.code}-${index}`}>
            <button
              type="button"
              onClick={() => root.current && focusIssuePath(root.current, issue.path)}
              className={cn(
                "flex min-h-9 w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none focus-ring-inset touch:min-h-11 touch:text-base",
                tone(issue),
              )}
            >
              {icon(issue)}
              <span id={`${idBase}-${index}`}>{issue.message}</span>
            </button>
          </li>
        ),
      )}
    </ul>
  );
}
