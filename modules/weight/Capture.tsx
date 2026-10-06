"use client";

// The Weight body. With one value per size (SAFEDON_EG) every ordered size is
// a row of one table, so Enter runs down the sizes and the whole module fits
// on one screen. With several gloves per size (13 on STD_EG) each size is a
// MeasurementGrid in size tabs, its footer the live average. Under each, the
// size of the indicative weight shows its deviation and the warning beyond
// the threshold (BUILD_SPEC 6.2 rule 9). Every write goes through
// useDataUpdater, so a column pasted down the sizes, or two commits in one
// event, all land. Issue links focus the value; values past n, which have
// no cell, can be removed from their warning. Photos are tagged with the
// size in focus.
import { useId, useLayoutEffect, useRef, useState, type RefObject } from "react";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  findIssue,
  focusIssuePath,
  issuePathProps,
  MeasurementGrid,
  ModuleSection,
  NumberField,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type DataChange,
  type EntryProblem,
  type InvalidEntry,
  type MeasurementValues,
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatNumber, formatSpec } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ModuleStatus } from "@/lib/schemas";
import { labelFor, sizeLabel, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import { indicativeFor, specFor, type WeightComputed } from "./calc";
import { firstValues, valueChanges, withoutValuesPast, withValues } from "./capture-data";
import type { WeightConfig } from "./config";
import type { WeightData } from "./schema";

type Props = CaptureProps<WeightData, WeightConfig, WeightComputed>;
/** Applies a change to the latest data (useDataUpdater). */
type Update = (change: DataChange<WeightData>) => void;

// MeasurementGrid has no read-only mode yet: a disabled fieldset stops every
// edit, and the weights keep full contrast instead of greying out.
const READ_ONLY_FRAME = cn(
  "m-0 min-w-0 border-0 p-0",
  "[&_input:disabled]:text-foreground [&_input:disabled]:opacity-100 [&_input:disabled]:[-webkit-text-fill-color:currentColor]",
);

// MeasurementGrid's table is at least 36rem wide, room for five measures. One
// column of weights needs far less: without that floor the grid stays beside
// its glove numbers instead of spreading across a desktop screen.
const ONE_COLUMN_GRID = "max-w-md [&_table]:min-w-0";

const HEAD = "border-b border-border bg-slate-50 px-3 py-2 font-semibold text-foreground";
const CELL = "border-b border-border px-3 py-1.5 align-middle touch:py-2";

export default function Capture(props: Props) {
  const update = useDataUpdater(props.data, props.onChange);
  return props.config.n === 1 ? (
    <OneValuePerSize {...props} update={update} />
  ) : (
    <GlovesPerSize {...props} update={update} />
  );
}

/* One value per size: a table of the ordered sizes ---------------------- */

function OneValuePerSize({
  data,
  config,
  title,
  labels,
  context,
  evaluation,
  focusPath,
  readOnly,
  onFocusChange,
  update,
}: Props & { update: Update }) {
  const root = useRef<HTMLDivElement>(null);
  const idBase = useId();
  const [rejected, setRejected] = useState<Readonly<Record<string, InvalidEntry>>>({});
  useIssueFocus(focusPath, { root });

  // No size ordered yet: SizeTabs says so, in the kit's words (6.2 rule 4).
  if (context.sizes.length === 0) return <SizeTabs sizes={context.sizes} value="" onValueChange={() => undefined} />;
  const withSpecs = context.sizes.some((size) => specFor(config, size) !== undefined);
  const inputId = (size: string) => `${idBase}-${size}`;
  const valueOf = (size: string) => data.sizes[size]?.values[0] ?? null;

  const write = (size: string, value: number | null) => {
    if (!readOnly) update((current) => withValues(current, size, [{ index: 0, value }]));
  };
  const track = (size: string, entry: InvalidEntry | null) =>
    setRejected((current) => {
      const next = { ...current };
      if (entry) next[size] = entry;
      else delete next[size];
      return next;
    });

  const problems: EntryProblem[] = context.sizes.flatMap((size) => {
    const entry = rejected[size];
    return entry && valueOf(size) === null
      ? [{ key: size, label: `${labelFor(labels, "values")}, size ${sizeLabel(context, size)}`, entry, inputId: inputId(size) }]
      : [];
  });

  return (
    <div ref={root} data-slot="weight-capture" className="min-w-0 space-y-3">
      <EnterGroup className="relative overflow-clip rounded-lg border border-border bg-card">
        <table className="w-full border-separate border-spacing-0 text-sm touch:text-base">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr>
              <th scope="col" className={cn(HEAD, "w-24 text-left")}>
                Size
              </th>
              <th scope="col" className={cn(HEAD, "text-right")}>
                {labelFor(labels, "values")}
              </th>
              {withSpecs && (
                <th scope="col" className={cn(HEAD, "text-right")}>
                  {labelFor(labels, "specRow")}
                </th>
              )}
              <th scope="col" className={cn(HEAD, "text-right")}>
                {labelFor(labels, "result")}
              </th>
            </tr>
          </thead>
          <tbody>
            {context.sizes.map((size) => {
              const spec = specFor(config, size);
              return (
                <tr key={size} {...issuePathProps(["sizes", size, "values"])} className="[&:last-child>*]:border-b-0">
                  <th scope="row" className={cn(CELL, "text-left font-semibold tabular-nums")}>
                    {sizeLabel(context, size)}
                  </th>
                  {/* Edged like MeasurementGrid's cells, so an empty value still shows where it goes. */}
                  <td className={cn(CELL, "w-40 border-x p-0 touch:py-0")}>
                    <NumberField
                      variant="cell"
                      // One column: Enter runs down the sizes, a pasted column fills them.
                      group="values"
                      id={inputId(size)}
                      label={`${labelFor(labels, "values")}, size ${sizeLabel(context, size)}`}
                      value={valueOf(size)}
                      onValueChange={(value) => write(size, value)}
                      onInvalidChange={(entry) => track(size, entry)}
                      error={findIssue(evaluation?.issues, ["sizes", size, "values", 0])?.message}
                      decimals={config.decimals}
                      min={0}
                      readOnly={readOnly}
                      issuePath={["sizes", size, "values", 0]}
                      onFocus={() => onFocusChange?.({ size })}
                    />
                  </td>
                  {withSpecs && (
                    <td className={cn(CELL, "text-right whitespace-nowrap text-muted-foreground tabular-nums")}>
                      {spec ? formatSpec(spec, { unit: "g" }) : "—"}
                    </td>
                  )}
                  <td className={cn(CELL, "text-right")}>
                    <span className="inline-flex justify-end">
                      <ResultPill status={evaluation?.result.perSize?.[size]?.status} labels={labels} />
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </EnterGroup>
      <EntryProblems problems={problems} />
      {context.sizes.map((size) => (
        <DeviationNote key={size} size={size} config={config} labels={labels} context={context} evaluation={evaluation} />
      ))}
      <IssueLinks
        issues={context.sizes.flatMap((size) => inlineIssues(evaluation, size))}
        root={root}
        onRemoveUncounted={readOnly ? undefined : (size) => update((current) => withoutValuesPast(current, size, config.n))}
      />
    </div>
  );
}

/* Several gloves per size: a grid per size, in size tabs ---------------- */

function GlovesPerSize(props: Props & { update: Update }) {
  const { context, evaluation, focusPath, onFocusChange } = props;
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
    <div ref={root} data-slot="weight-capture" className="min-w-0">
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
  update,
  data,
  config,
  labels,
  context,
  evaluation,
  readOnly,
  onFocusChange,
}: Props & { size: string; root: RefObject<HTMLDivElement | null>; update: Update }) {
  const grid = useRef<HTMLDivElement>(null);
  const name = sizeLabel(context, size);
  const status = evaluation?.result.perSize?.[size]?.status;
  const label = labelFor(labels, "values");
  const shown = firstValues(data, size, config.n);

  useCellIssuePaths(grid, size);

  // Only the weights the grid changed are written, on the latest data.
  const write = (next: MeasurementValues) => {
    if (readOnly || !next.values) return;
    const changes = valueChanges(shown, next.values, config.n);
    update((current) => withValues(current, size, changes));
  };

  return (
    <ModuleSection
      title={`${label}, size ${name}`}
      description={`${labelFor(labels, "average")} of ${config.n} gloves`}
      status={status}
      statusLabel={statusWord(status, labels)}
      // The template's caption for the size's result ("Remark"), beside it.
      actions={status && <span className="text-sm text-muted-foreground touch:text-base">{labelFor(labels, "result")}</span>}
      issuePath={["sizes", size]}
    >
      <div
        ref={grid}
        // Tag photos with the size when focus enters the grid, not on every move between its cells.
        onFocus={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange?.({ size });
        }}
        {...issuePathProps(["sizes", size, "values"])}
      >
        <fieldset disabled={readOnly} className={READ_ONLY_FRAME}>
          <MeasurementGrid
            caption={`${label}, size ${name}`}
            measures={[
              {
                key: "values",
                label,
                // The reports' label already names the unit: "Weight (g)".
                unit: /\(g\)/.test(label) ? undefined : "g",
                decimals: config.decimals,
                spec: specFor(config, size),
                min: 0,
              },
            ]}
            rows={config.n}
            values={{ values: shown }}
            onValuesChange={write}
            statistic="average"
            // The grid's last row is the spec's verdict alone, so it keeps the
            // kit's "P/F": the template's "Remark" is the size's result.
            labels={{
              row: labelFor(labels, "rowNo"),
              statistic: labelFor(labels, "average"),
              spec: labelFor(labels, "specRow"),
            }}
            className={ONE_COLUMN_GRID}
          />
        </fieldset>
      </div>
      <DeviationNote size={size} config={config} labels={labels} context={context} evaluation={evaluation} />
      <IssueLinks
        issues={inlineIssues(evaluation, size)}
        root={root}
        onRemoveUncounted={readOnly ? undefined : () => update((current) => withoutValuesPast(current, size, config.n))}
      />
    </ModuleSection>
  );
}

/** Marks each grid cell with its data path (`["sizes", "M", "values", 3]`), so an issue link reaches it. */
function useCellIssuePaths(grid: RefObject<HTMLElement | null>, size: string) {
  useLayoutEffect(() => {
    const cells = grid.current?.querySelectorAll<HTMLInputElement>("tbody input") ?? [];
    cells.forEach((cell, row) => {
      for (const [name, value] of Object.entries(issuePathProps(["sizes", size, "values", row]))) {
        if (value !== undefined) cell.setAttribute(name, value);
      }
    });
  });
}

/* Shared pieces ---------------------------------------------------------- */

/** The template's word for a result: "Passed" or "A"; Warning and Not done as the app says them. */
function statusWord(status: ModuleStatus | undefined, labels: Labels): string | undefined {
  return status === "pass" || status === "fail" || status === "info" ? labelFor(labels, status) : undefined;
}

function ResultPill({ status, labels }: { status: ModuleStatus | undefined; labels: Labels }) {
  const shown = status ?? "not_done";
  return <StatusPill size="sm" status={shown} label={statusWord(shown, labels)} />;
}

/**
 * "Deviation from indicative weight −17.1% · indicative 3.5 g, threshold 10% ·
 * Warning", for that size only. Within the threshold the note says so in a
 * neutral pill: the deviation is no verdict on the weight, only a spec is.
 */
function DeviationNote({
  size,
  config,
  labels,
  context,
  evaluation,
}: Pick<Props, "config" | "labels" | "context" | "evaluation"> & { size: string }) {
  const indicative = indicativeFor(context, size);
  const deviation = evaluation?.computed.deviationPct?.[size];
  if (!indicative || deviation === undefined) return null;
  const beyond = Math.abs(deviation) > config.warnThresholdPct;
  const threshold = formatNumber(config.warnThresholdPct, { unit: "%" });
  return (
    <p
      data-slot="weight-deviation"
      className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm touch:text-base"
    >
      <span className="text-muted-foreground">
        {labelFor(labels, "deviationPct")}, size {sizeLabel(context, size)}
      </span>
      <Figure value={deviation} decimals={1} unit="%" className="font-semibold text-foreground" />
      <span className="text-muted-foreground tabular-nums">
        {`indicative ${formatNumber(indicative.grams, { unit: "g" })}, threshold ${threshold}`}
      </span>
      <StatusPill size="sm" status={beyond ? "warn" : "info"} label={beyond ? undefined : `Within ${threshold}`} />
    </p>
  );
}

/**
 * calc's issues about a value of this size, listed under it as links: the
 * screen's issue list carries the rest, and the deviation has its own line.
 */
function inlineIssues(evaluation: Props["evaluation"], size: string): ValidationIssue[] {
  return (evaluation?.issues ?? []).filter(
    (issue) =>
      issue.code !== "weight_deviation" &&
      issue.size === size &&
      issue.path[0] === "sizes" &&
      issue.path[1] === size &&
      issue.path.length > 2,
  );
}

function IssueLinks({
  issues,
  root,
  onRemoveUncounted,
}: {
  issues: readonly ValidationIssue[];
  root: RefObject<HTMLElement | null>;
  /**
   * Removes a size's values past n. The screen has no cell for them, so this
   * is the only way to clear calc's warning that they are not counted.
   */
  onRemoveUncounted?: (size: string) => void;
}) {
  const idBase = useId();
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1.5" aria-label="Problems with the weights">
      {issues.map((issue, index) => {
        const size = issue.size;
        const messageId = `${idBase}-${index}`;
        return (
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
              <span id={messageId}>{issue.message}</span>
            </button>
            {issue.code === "weight_beyond_n" && size !== undefined && onRemoveUncounted && (
              // Described by the warning, which names the size and the values.
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-describedby={messageId}
                onClick={() => onRemoveUncounted(size)}
              >
                Remove the values that are not counted
              </Button>
            )}
          </li>
        );
      })}
    </ul>
  );
}
