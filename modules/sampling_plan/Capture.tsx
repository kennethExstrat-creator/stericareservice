"use client";

// The Sampling Plan body (BUILD_SPEC 6.1, 8 "Speed"): per ordered size, the
// counts on the numeric keypad, in the template's columns and wording. Enter
// moves to the next count and a pasted row or column fills the counts after
// it. Beside them: the order quantity, the lot in gloves and the inspection
// level's plan, and the size's result as the counts change.
import { useRef, useState, type ReactNode } from "react";
import {
  EnterGroup,
  EntryProblems,
  Figure,
  ModuleSection,
  NumberField,
  SizeTabs,
  StatusIcon,
  StatusPill,
  useDataUpdater,
  useIssueFocus,
  type EntryProblem,
} from "@/components/qc";
import { formatSize } from "@/lib/format";
import { cn } from "@/lib/utils";
import { initialSize, labelFor, lotSizeGloves, type CaptureProps, type ValidationIssue } from "@/modules/_framework";
import { useReportShownSize, useSizeShownAlone } from "@/modules/_framework/shown-size";
import type { SamplingPlanComputed } from "./calc";
import { columnGroups, shownColumns, type SamplingColumn, type SamplingPlanConfig } from "./config";
import { withCount, type SamplingPlanData } from "./schema";

const COUNT_FRAME = "relative min-w-0 overflow-clip rounded-lg border border-border bg-card";
// The frame draws the last row's edge.
const COUNT_TABLE = "w-full border-separate border-spacing-0 text-sm touch:text-base [&>tbody>tr:last-child>*]:border-b-0";

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
}: CaptureProps<SamplingPlanData, SamplingPlanConfig, SamplingPlanComputed>) {
  const root = useRef<HTMLDivElement>(null);
  // Opens on the size chosen in the last module (CaptureProps.focus).
  const [active, setActive] = useState(() => initialSize(context, focus));
  // The size on the tabs tags the photos taken now (BUILD_SPEC 8.1), from the moment the section
  // opens; from 1280 px every size is on screen and none is.
  useReportShownSize(useSizeShownAlone(context.sizes, active), onFocusChange);
  const [rejected, setRejected] = useState<Readonly<Record<string, RejectedEntry>>>({});
  // Every write starts from the latest data, so a pasted run of counts keeps every value (docs/CAPTURE_KIT.md).
  const update = useDataUpdater(data, onChange);

  const label = (key: string) => labelFor(labels, key);
  // "Size M", as the size tabs word it.
  const sizeName = (size: string) => formatSize(size, { sizes: context.templateSizes, prefix: true });
  const groups = columnGroups(config);
  const computed = evaluation?.computed;
  const level = computed?.inspectionLevel ?? config.inspectionLevel ?? context.aql.inspectionLevel;
  const issues = evaluation?.issues ?? [];

  useIssueFocus(focusPath, {
    root,
    reveal: (path) => {
      if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setActive(path[1]);
    },
  });

  const setCount = (size: string, column: SamplingColumn, value: number | null) =>
    update((current) => withCount(current, size, column, value));

  // Names the cell with its size: from 1280 px every size is on screen at once. The
  // link to a cell in the problem list repeats it, so it reads "Case, Size M".
  const cellName = (size: string, column: SamplingColumn) => `${label(column)}, ${sizeName(size)}`;

  const setRejectedEntry = (size: string, column: SamplingColumn, entry: EntryProblem["entry"] | null) =>
    setRejected((current) => {
      const id = fieldId(size, column);
      const next = { ...current };
      delete next[id];
      if (entry !== null) next[id] = { key: id, label: cellName(size, column), entry, inputId: id, size, column };
      return next;
    });
  // Text that was not stored, listed with a link while its cell is still empty.
  const problemsOf = (size: string) =>
    Object.values(rejected).filter(
      (problem) => problem.size === size && (data.sizes[size]?.[problem.column] ?? null) === null,
    );

  const countRows = (size: string, columns: readonly SamplingColumn[], indent: boolean) =>
    columns.map((column) => {
      const path = ["sizes", size, column] as const;
      const own = issues.filter((issue) => samePath(issue.path, path));
      return (
        <CountRow
          key={column}
          label={label(column)}
          indent={indent}
          issues={own}
          field={
            <NumberField
              variant="cell"
              id={fieldId(size, column)}
              label={cellName(size, column)}
              value={data.sizes[size]?.[column] ?? null}
              onValueChange={(value) => setCount(size, column, value)}
              integer
              min={0}
              error={own.find((issue) => issue.level === "error")?.message ?? null}
              issuePath={path}
              onFocus={() => onFocusChange?.({ size })}
              onInvalidChange={(entry) => setRejectedEntry(size, column, entry)}
              readOnly={readOnly}
            />
          }
        />
      );
    });

  const renderSize = (size: string) => {
    const plan = computed?.sizes?.[size];
    const result = evaluation?.result.perSize?.[size];
    const facts: Fact[] = [
      {
        key: "orderQty",
        label: label("orderQty"),
        value: <Figure value={context.order[size]?.qtyCases ?? null} grouping />,
      },
      {
        key: "lotSizeGloves",
        label: label("lotSizeGloves"),
        value: <Figure value={plan?.lotSizeGloves ?? lotSizeGloves(context, size)} grouping />,
      },
    ];
    if (level !== null) {
      facts.push(
        { key: "inspectionLevel", label: label("inspectionLevel"), value: level },
        { key: "codeLetter", label: label("codeLetter"), value: plan?.codeLetter ?? <Figure value={null} /> },
        {
          key: "planSampleSize",
          label: label("planSampleSize"),
          value: (
            <>
              <Figure value={plan?.planSampleSize ?? null} grouping />
              {plan?.planCodeLetter && plan.planCodeLetter !== plan.codeLetter && (
                <span className="font-normal text-muted-foreground"> ({plan.planCodeLetter})</span>
              )}
            </>
          ),
        },
      );
    }
    const both = groups.quantity.length > 0 && groups.tests.length > 0;
    return (
      // The panel's own width decides the layout (a size alone, or beside the others from 1280 px).
      <div className="@container space-y-3">
        <FactList facts={facts} />
        {/* The Sampling Quantity group and the counts after it side by side where the panel has room,
            each count near its label, row against row (the group's heading is a row's height). In
            reading order, as Enter and a paste go: the group first. */}
        <div className={cn("grid items-start gap-3", both && "@2xl:grid-cols-2")}>
          {groups.quantity.length > 0 && (
            <div className={COUNT_FRAME}>
              <table className={COUNT_TABLE}>
                <caption className="sr-only">
                  {both ? `${title}, ${sizeName(size)}: ${label("samplingQuantity")}` : `${title}, ${sizeName(size)}`}
                </caption>
                <tbody>
                  <tr>
                    <th
                      scope="rowgroup"
                      colSpan={2}
                      className="border-b border-border bg-slate-50 px-3 py-1.5 text-left font-semibold text-foreground touch:py-2.5"
                    >
                      {label("samplingQuantity")}
                    </th>
                  </tr>
                  {countRows(size, groups.quantity, true)}
                </tbody>
              </table>
            </div>
          )}
          {groups.tests.length > 0 && (
            <div className={COUNT_FRAME}>
              <table className={COUNT_TABLE}>
                <caption className="sr-only">{`${title}, ${sizeName(size)}`}</caption>
                <tbody>{countRows(size, groups.tests, false)}</tbody>
              </table>
            </div>
          )}
        </div>
        <EntryProblems problems={problemsOf(size)} />
        {result && (
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground touch:text-base">
            <StatusPill size="sm" status={result.status} />
            {result.summary && <span>{result.summary}</span>}
          </p>
        )}
      </div>
    );
  };

  const shown = shownColumns(config);
  const orderTotal = sumOf(context.sizes.map((size) => context.order[size]?.qtyCases ?? null));

  return (
    <div ref={root} className="space-y-6">
      <EnterGroup>
        <SizeTabs
          sizes={context.sizes}
          templateSizes={context.templateSizes}
          value={active}
          onValueChange={(size) => {
            setActive(size);
            onFocusChange?.({ size });
          }}
          results={evaluation?.result.perSize}
          label={`${title}: ${label("gloveSize")}`}
          wide="all"
        >
          {renderSize}
        </SizeTabs>
      </EnterGroup>
      {context.sizes.length > 1 && (
        <ModuleSection title={label("totals")}>
          <FactList
            facts={[
              { key: "orderQty", label: label("orderQty"), value: <Figure value={orderTotal} grouping /> },
              ...shown.map((column) => ({
                key: column,
                label: label(column),
                value: <Figure value={computed?.totals?.[column] ?? null} grouping />,
              })),
            ]}
          />
        </ModuleSection>
      )}
    </div>
  );
}

type RejectedEntry = EntryProblem & { size: string; column: SamplingColumn };

type Fact = { key: string; label: string; value: ReactNode };

/**
 * Read-only values beside the counts: computed or entered elsewhere, never typed here (6.2 rules 2
 * and 10). Spread over the box's width, each label on one line: as many on a row as fit.
 */
function FactList({ facts }: { facts: readonly Fact[] }) {
  return (
    <dl className="relative flex flex-wrap gap-x-6 gap-y-2 rounded-lg bg-muted px-3 py-2 text-sm touch:text-base">
      {facts.map((fact) => (
        <div key={fact.key} className="min-w-0 flex-auto">
          <dt className="text-muted-foreground">{fact.label}</dt>
          <dd className="font-semibold text-foreground tabular-nums">{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function CountRow({
  label,
  indent,
  field,
  issues,
}: {
  label: string;
  indent: boolean;
  field: ReactNode;
  issues: readonly ValidationIssue[];
}) {
  return (
    <>
      <tr>
        <th
          scope="row"
          className={cn(
            "border-b border-border py-1.5 pr-3 text-left font-normal text-foreground touch:py-0",
            indent ? "pl-6" : "pl-3",
          )}
        >
          {label}
        </th>
        <td className="w-28 border-b border-l border-border p-0 touch:w-32">{field}</td>
      </tr>
      {issues.map((issue) => (
        <tr key={`${issue.code}-${issue.message}`}>
          <td colSpan={2} className="border-b border-border px-3 py-2">
            <p
              className={cn(
                "flex items-start gap-1.5 text-sm touch:text-base",
                issue.level === "error" ? "text-fail" : "text-warn",
              )}
            >
              <StatusIcon status={issue.level === "error" ? "fail" : "warn"} className="mt-0.5 size-4 shrink-0" />
              <span>{issue.message}</span>
            </p>
          </td>
        </tr>
      ))}
    </>
  );
}

/** The input's id: sizes such as "7.0" are fine in an id, never in a selector built from it. */
function fieldId(size: string, column: SamplingColumn): string {
  return `sampling-plan-${size}-${column}`;
}

function samePath(path: readonly (string | number)[], target: readonly (string | number)[]): boolean {
  return path.length === target.length && path.every((segment, index) => segment === target[index]);
}

function sumOf(values: readonly (number | null)[]): number | null {
  const entered = values.filter((value): value is number => value !== null);
  return entered.length === 0 ? null : entered.reduce((sum, value) => sum + value, 0);
}

