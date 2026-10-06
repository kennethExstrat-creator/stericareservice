"use client";

// The Dimension body: one MeasurementGrid per ordered size, in size tabs.
// Gloves are rows (the sampling plan's n, else the template's), the measures
// on are columns in the template's wording; the footer shows the median or
// average, the spec and the verdict at the printed precision, live as you
// type. Enter walks down a column and a pasted column fills down (the grid's
// own rules); every write goes through useDataUpdater, so a paste or two
// commits in one event all land. Issue links switch to the size and focus
// the cell; readings past the planned gloves, which have no row, can be
// removed from their warning. Photos are tagged with the size in view.
import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  focusIssuePath,
  issuePathProps,
  MeasurementGrid,
  ModuleSection,
  SizeTabs,
  StatusIcon,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type Measure as GridMeasure,
  type MeasurementValues,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { labelFor, sizeLabel, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import { rowsFor, specFor, type DimensionsComputed } from "./calc";
import { cellPath, gridChanges, gridColumns, sizeHeading, withoutGlovesPast, withReadings } from "./capture-data";
import type { DimensionsConfig, Measure } from "./config";
import type { DimensionsData } from "./schema";

type Props = CaptureProps<DimensionsData, DimensionsConfig, DimensionsComputed>;

// MeasurementGrid has no read-only mode yet: a disabled fieldset stops every
// edit, and the readings keep full contrast instead of greying out.
const READ_ONLY_FRAME = cn(
  "m-0 min-w-0 border-0 p-0",
  "[&_input:disabled]:text-foreground [&_input:disabled]:opacity-100 [&_input:disabled]:[-webkit-text-fill-color:currentColor]",
);

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
  const grid = useRef<HTMLDivElement>(null);
  const { rows } = rowsFor(context, size, config);
  const heading = sizeHeading(labelFor(labels, "sizeHeading"), sizeLabel(context, size));
  const status = evaluation?.result.perSize?.[size]?.status;
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
    min: 0,
  }));
  const columns = gridColumns(data, size, config.measures, rows);

  useCellIssuePaths(grid, size, config.measures);

  // Only the readings the grid changed are written, on the latest data.
  const write = (next: MeasurementValues) => {
    if (readOnly) return;
    const changes = gridChanges(columns, next, config.measures, rows);
    update((current) => withReadings(current, size, changes));
  };

  return (
    <ModuleSection
      title={heading}
      description={`${labelFor(labels, "statistic")} of ${rows} ${rows === 1 ? "glove" : "gloves"}`}
      status={status}
      statusLabel={status === "pass" || status === "fail" ? labelFor(labels, status) : undefined}
      issuePath={["sizes", size]}
    >
      <div
        ref={grid}
        // Tag photos with the size when focus enters the grid, not on every move between its cells.
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.({ size });
        }}
        {...issuePathProps(["sizes", size, "gloves"])}
      >
        <fieldset disabled={readOnly} className={READ_ONLY_FRAME}>
          <MeasurementGrid
            caption={heading}
            measures={measures}
            rows={rows}
            values={columns}
            onValuesChange={write}
            statistic={config.statistic}
            labels={gridLabels(labels)}
          />
        </fieldset>
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
  };
}

/**
 * Marks each grid cell with its data path (`["sizes", "M", "gloves", 3,
 * "width"]`), so an issue link reaches the exact cell. MeasurementGrid takes
 * no path per cell yet; its cells are row by row, a column per measure.
 */
function useCellIssuePaths(grid: RefObject<HTMLElement | null>, size: string, measures: readonly Measure[]) {
  useLayoutEffect(() => {
    const cells = grid.current?.querySelectorAll<HTMLInputElement>("tbody input") ?? [];
    cells.forEach((cell, index) => {
      for (const [name, value] of Object.entries(issuePathProps(cellPath(size, measures, index)))) {
        if (value !== undefined) cell.setAttribute(name, value);
      }
    });
  });
}

/** calc's issues for the size in view, each a link back to its cell. */
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
  return (
    <ul className="space-y-1.5" aria-label="Problems in this size">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`} className="space-y-1.5">
          <button
            type="button"
            onClick={() => root.current && focusIssuePath(root.current, issue.path)}
            className={cn(
              "flex min-h-9 w-full items-start gap-2 rounded-md border px-3 py-2 text-left text-sm outline-none focus-ring-inset touch:min-h-11 touch:text-base",
              issue.level === "error"
                ? "border-fail-border bg-fail-tint text-fail"
                : "border-warn-border bg-warn-tint text-warn",
            )}
          >
            <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
            <span id={`${idBase}-${index}`}>{issue.message}</span>
          </button>
          {issue.code === "dimension_beyond_sample" && onRemoveUncounted && (
            // Described by the warning, which names the size and the gloves.
            <Button
              type="button"
              variant="outline"
              size="sm"
              aria-describedby={`${idBase}-${index}`}
              onClick={onRemoveUncounted}
            >
              Remove the readings that are not counted
            </Button>
          )}
        </li>
      ))}
    </ul>
  );
}
