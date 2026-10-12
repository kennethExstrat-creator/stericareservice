"use client";

// The Weight body. With one value per size (SAFEDON_EG) every ordered size is
// a row of one table, so Enter runs down the sizes and the whole module fits
// on one screen. With several gloves per size (the gloves for dimension, 13
// on STD_EG: glovesFor) each size is a MeasurementGrid in size tabs, its
// footer the live average. Under each, the
// size of the indicative weight shows its deviation and the warning beyond
// the threshold (BUILD_SPEC 6.2 rule 9). Every write goes through
// useDataUpdater, so a column pasted down the sizes, or two commits in one
// event, all land. Issue links focus the value, or the message for what has
// no cell (the deviation, values past n, which can be removed from their
// warning). Read-only, the values stay focusable. Photos are tagged with the
// size in focus.
import { useId, useRef, useState, type RefObject } from "react";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  findIssue,
  focusIssuePath,
  issueNoticeProps,
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
} from "@/components/qc";
import { Button } from "@/components/ui/button";
import { formatNumber, formatSpec } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ModuleStatus } from "@/lib/schemas";
import { initialSize, labelFor, sizeLabel, type CaptureProps, type Labels, type ValidationIssue } from "@/modules/_framework";
import { sizeOnTabs, useReportShownSize } from "@/modules/_framework/shown-size";
import { glovesFor, indicativeFor, specFor, type WeightComputed } from "./calc";
import {
  firstValues,
  gridSummary,
  valueChanges,
  VALUES_COLUMN,
  withoutValuesPast,
  withValues,
} from "./capture-data";
import type { WeightConfig } from "./config";
import type { WeightData } from "./schema";

type Props = CaptureProps<WeightData, WeightConfig, WeightComputed>;
/** Applies a change to the latest data (useDataUpdater). */
type Update = (change: DataChange<WeightData>) => void;

const HEAD = "border-b border-border bg-slate-50 px-3 py-2 font-semibold text-foreground";
const CELL = "border-b border-border px-3 py-1.5 align-middle touch:py-2";

/**
 * The template's label for one size, the size worded as its tab and the Size
 * column word it: "Weight (g), Size M". A heading, a cell's name and the link
 * to the cell in the problem list alike.
 */
function forSize(label: string, context: Props["context"], size: string): string {
  return `${label}, Size ${sizeLabel(context, size)}`;
}

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
  // Every ordered size is a row of the table: one is on screen alone only when it is the only one ordered.
  useReportShownSize(context.sizes.length === 1 ? context.sizes[0] : null, onFocusChange);

  // No size ordered yet: SizeTabs says so, in the kit's words (6.2 rule 4).
  if (context.sizes.length === 0) return <SizeTabs sizes={context.sizes} value="" onValueChange={() => undefined} />;
  const withSpecs = context.sizes.some((size) => specFor(config, size) !== undefined);
  const inputId = (size: string) => `${idBase}-${size}`;
  // The cell's name, which the link to it in the problem list repeats.
  const cellLabel = (size: string) => forSize(labelFor(labels, "values"), context, size);
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
    return entry && valueOf(size) === null ? [{ key: size, label: cellLabel(size), entry, inputId: inputId(size) }] : [];
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
                      label={cellLabel(size)}
                      value={valueOf(size)}
                      onValueChange={(value) => write(size, value)}
                      onInvalidChange={(entry) => track(size, entry)}
                      error={findIssue(evaluation?.issues, ["sizes", size, "values", 0])?.message}
                      decimals={config.decimals}
                      // calc refuses a weight of 0 g or less: so does the cell.
                      min={0}
                      minExclusive
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
  const { context, evaluation, focusPath, focus, onFocusChange } = props;
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module (CaptureProps.focus). SizeTabs shows the first
  // ordered size while this is not one (6.2 rule 4) and says so through show.
  const [size, setSize] = useState(() => initialSize(context, focus));
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section opens.
  useReportShownSize(sizeOnTabs(context.sizes, size), onFocusChange);

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
  // The gloves weighed: the sampling plan's for dimension, else the template's n.
  const { n } = glovesFor(context, size, config);
  const status = evaluation?.result.perSize?.[size]?.status;
  const label = labelFor(labels, "values");
  // The section's heading, and the grid's name.
  const heading = forSize(label, context, size);
  // A module whose config or data is broken comes back with no computed values.
  const computed: Partial<WeightComputed> | undefined = evaluation?.computed;

  return (
    <ModuleSection
      title={heading}
      description={`${labelFor(labels, "average")} of ${n} ${n === 1 ? "glove" : "gloves"}`}
      status={status}
      statusLabel={statusWord(status, labels)}
      // The template's caption for the size's result ("Remark"), beside it.
      actions={status && <span className="text-sm text-muted-foreground touch:text-base">{labelFor(labels, "result")}</span>}
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
          measures={[
            {
              key: VALUES_COLUMN,
              label,
              // The reports' label already names the unit: "Weight (g)".
              unit: /\(g\)/.test(label) ? undefined : "g",
              decimals: config.decimals,
              spec: specFor(config, size),
              // calc refuses a weight of 0 g or less: so does the cell.
              min: 0,
              minExclusive: true,
              summary: gridSummary(computed, size),
            },
          ]}
          rows={n}
          values={{ [VALUES_COLUMN]: firstValues(data, size, n) }}
          onCellsChange={(changes) => update((current) => withValues(current, size, valueChanges(changes)))}
          statistic="average"
          // The grid's last row is the spec's verdict alone, so it keeps the
          // kit's "P/F": the template's "Remark" is the size's result.
          labels={{
            row: labelFor(labels, "rowNo"),
            statistic: labelFor(labels, "average"),
            spec: labelFor(labels, "specRow"),
            pass: labelFor(labels, "pass"),
            fail: labelFor(labels, "fail"),
          }}
          readOnly={readOnly}
          cellIssuePath={({ row }) => ["sizes", size, "values", row]}
          // One column of weights, the gloves for dimension (13 on STD_EG): in groups side by side
          // across the width, 1 to 5, 6 to 10, 11 to 13.
          flow
        />
      </div>
      <DeviationNote size={size} config={config} labels={labels} context={context} evaluation={evaluation} />
      <IssueLinks
        issues={inlineIssues(evaluation, size)}
        root={root}
        onRemoveUncounted={readOnly ? undefined : () => update((current) => withoutValuesPast(current, size, n))}
      />
    </ModuleSection>
  );
}

/* Shared pieces ---------------------------------------------------------- */

/** The template's word for a result: "Passed" or "A"; Warning and Not Done as the app says them. */
function statusWord(status: ModuleStatus | undefined, labels: Labels): string | undefined {
  return status === "pass" || status === "fail" || status === "info" ? labelFor(labels, status) : undefined;
}

function ResultPill({ status, labels }: { status: ModuleStatus | undefined; labels: Labels }) {
  const shown = status ?? "not_done";
  return <StatusPill size="sm" status={shown} label={statusWord(shown, labels)} />;
}

/**
 * "Deviation from indicative weight, Size M −17.1% · Indicative 3.5 g,
 * Threshold 10% · Warning", for that size only: the template's label, then
 * the app's own in Title Case. Within the threshold the note says so in a
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
      // Where the deviation warning's issue link lands: it has no field of its own.
      {...issueNoticeProps(["sizes", size, "values"])}
      className="relative flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg border border-border bg-slate-50 px-3 py-2 text-sm outline-none focus-ring touch:text-base"
    >
      <span className="text-muted-foreground">{forSize(labelFor(labels, "deviationPct"), context, size)}</span>
      <Figure value={deviation} decimals={1} unit="%" className="font-semibold text-foreground" />
      <span className="text-muted-foreground tabular-nums">
        {`Indicative ${formatNumber(indicative.grams, { unit: "g" })}, Threshold ${threshold}`}
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
  const tone = (issue: ValidationIssue) =>
    issue.level === "error" ? "border-fail-border bg-fail-tint text-fail" : "border-warn-border bg-warn-tint text-warn";
  const icon = (issue: ValidationIssue) => (
    <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
  );
  return (
    <ul className="space-y-1.5" aria-label="Problems with the weights">
      {issues.map((issue, index) => {
        const size = issue.size;
        const messageId = `${idBase}-${index}`;
        // Values past n have no cell: their warning is where an issue link lands, with the way to remove them.
        if (issue.code === "weight_beyond_n") {
          return (
            <li key={`${issue.code}-${index}`} className={cn("relative space-y-2 rounded-md border px-3 py-2", tone(issue))}>
              <p
                {...issueNoticeProps(issue.path)}
                className="flex items-start gap-2 rounded-sm text-sm outline-none focus-ring touch:text-base"
              >
                {icon(issue)}
                <span id={messageId}>{issue.message}</span>
              </p>
              {size !== undefined && onRemoveUncounted && (
                // Described by the warning, which names the size and the values.
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="text-foreground touch:text-base"
                  aria-describedby={messageId}
                  onClick={() => onRemoveUncounted(size)}
                >
                  Remove the Values That Are Not Counted
                </Button>
              )}
            </li>
          );
        }
        return (
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
              <span id={messageId}>{issue.message}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
