"use client";

// The Dimension body: one MeasurementGrid per ordered size, in size tabs.
// Gloves are rows (the sampling plan's n, else the template's), the measures
// on are columns in the template's wording; the footer shows the median or
// average, the spec and the verdict at the printed precision, live as you
// type. Enter walks down a column and a pasted column fills down (the grid's
// own rules). Issue links switch to the size and focus the cell; photos are
// tagged with the size in view.
import { useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  focusIssuePath,
  issuePathProps,
  MeasurementGrid,
  ModuleSection,
  SizeTabs,
  StatusIcon,
  useIssueFocus,
  type Measure as GridMeasure,
  type MeasurementValues,
} from "@/components/qc";
import { cn } from "@/lib/utils";
import { labelFor, sizeLabel, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import { rowsFor, specFor, type DimensionsComputed } from "./calc";
import { cellPath, gridColumns, sizeHeading, withGridColumns } from "./capture-data";
import type { DimensionsConfig, Measure } from "./config";
import type { DimensionsData } from "./schema";

type Props = CaptureProps<DimensionsData, DimensionsConfig, DimensionsComputed>;

// MeasurementGrid has no read-only mode yet: a disabled fieldset stops every
// edit, and these keep the readings at full contrast instead of greyed out.
const READ_ONLY_GRID =
  "m-0 min-w-0 border-0 p-0 [&_input:disabled]:text-foreground [&_input:disabled]:opacity-100 [&_input:disabled]:[-webkit-text-fill-color:currentColor]";

export default function Capture(props: Props) {
  const { context, evaluation, focusPath, onFocusChange } = props;
  const root = useRef<HTMLDivElement>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  // Only ordered sizes (6.2 rule 4); a size taken out of the order falls back to the first.
  const size = chosen !== null && context.sizes.includes(chosen) ? chosen : (context.sizes[0] ?? "");

  const show = (next: string) => {
    setChosen(next);
    onFocusChange?.({ size: next });
  };

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      const target = path[0] === "sizes" ? path[1] : undefined;
      if (typeof target === "string" && context.sizes.includes(target)) setChosen(target);
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
        {(current) => <SizeGrid {...props} size={current} root={root} />}
      </SizeTabs>
    </div>
  );
}

function SizeGrid({
  size,
  root,
  data,
  config,
  labels,
  context,
  evaluation,
  readOnly,
  onChange,
  onFocusChange,
}: Props & { size: string; root: RefObject<HTMLDivElement | null> }) {
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

  useCellIssuePaths(grid, size, config.measures);

  const write = (next: MeasurementValues) => {
    if (!readOnly) onChange(withGridColumns(data, size, next, config.measures, rows));
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
        <fieldset disabled={readOnly} className={READ_ONLY_GRID}>
          <MeasurementGrid
            caption={heading}
            measures={measures}
            rows={rows}
            values={gridColumns(data, size, config.measures, rows)}
            onValuesChange={write}
            statistic={config.statistic}
            labels={gridLabels(labels)}
          />
        </fieldset>
      </div>
      <IssueLinks issues={issues} root={root} />
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
function IssueLinks({ issues, root }: { issues: readonly ValidationIssue[]; root: RefObject<HTMLElement | null> }) {
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Problems in this size">
      {issues.map((issue, index) => (
        <li key={`${issue.code}-${index}`}>
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
            <span>{issue.message}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}
