// A computed value next to its specification and result, as the reports set
// them out: "Tensile Strength (Average) 15.20 MPa · ≥ 14.00 MPa · Passed",
// "Weight 2.90 g · NA", "3 / 625 (0.48%) · ≤ 5% · Passed". RequirementList is
// the table form for a module's summary; SpecValue the inline form. The
// value is judged at the precision it is shown (as MeasurementGrid does);
// a missing value is Not done, never Passed (BUILD_SPEC 6.2 rule 5).
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { STATUS_LABEL, type Status } from "@/lib/design/status";
import { checkSpec, roundTo, type Spec } from "@/lib/stats";
import { formatSpec, hasLimit } from "@/lib/format";
import { Figure } from "./figure";
import { issuePathProps, type IssuePath } from "./issue-path";
import { SMALL_PILL_TOUCH, StatusPill } from "./status-pill";

/** A result, or "na" when the spec sets no limit (shown as NA, no verdict). */
export type RequirementOutcome = Status | "na";

/** The outcome of a value against its spec, judged at `decimals` (the shown precision). */
export function specOutcome(value: number | null | undefined, spec: Spec | null | undefined, decimals?: number): RequirementOutcome {
  if (value === null || value === undefined || !Number.isFinite(value)) return "not_done";
  if (!hasLimit(spec)) return "na";
  return checkSpec(decimals === undefined ? value : roundTo(value, decimals), spec);
}

export type Requirement = {
  key: string;
  /** In the template's wording, e.g. "Tensile Strength (Average) (MPa)". */
  label: ReactNode;
  /** The computed value; null until there is one. */
  value: number | null;
  /** Shown instead of the number, e.g. "3 / 625 (0.48%)"; `value` is still the one judged. */
  valueText?: ReactNode;
  unit?: string;
  /** Decimals the value and spec are printed at; the value is judged at this precision. */
  decimals?: number;
  spec?: Spec | null;
  /** Printed instead of the formatted spec, e.g. the template's own wording. */
  specText?: ReactNode;
  /** calc's verdict; wins over the outcome worked out here. */
  status?: Status;
  /** Small print under the label, e.g. "9 of 13 gloves entered". */
  note?: ReactNode;
  /** Marks the row for issue links (useIssueFocus). */
  issuePath?: IssuePath;
};

export type RequirementLabels = {
  requirement: string;
  value: string;
  spec: string;
  result: string;
  /** Result text for pass and fail, e.g. "Accept" / "Reject" or "P" / "F". */
  pass: string;
  fail: string;
};

const DEFAULT_LABELS: RequirementLabels = {
  requirement: "Requirement",
  value: "Value",
  spec: "Spec.",
  result: "Result",
  pass: STATUS_LABEL.pass,
  fail: STATUS_LABEL.fail,
};

function outcomeOf(item: Pick<Requirement, "value" | "spec" | "decimals" | "status">): RequirementOutcome {
  return item.status ?? specOutcome(item.value, item.spec, item.decimals);
}

function Outcome({ outcome, labels }: { outcome: RequirementOutcome; labels: RequirementLabels }) {
  if (outcome === "na") return <span className="font-medium text-muted-foreground">NA</span>;
  const label = outcome === "pass" ? labels.pass : outcome === "fail" ? labels.fail : undefined;
  return <StatusPill size="sm" status={outcome} label={label} className={SMALL_PILL_TOUCH} />;
}

function specLine(item: Pick<Requirement, "spec" | "specText" | "unit" | "decimals">): ReactNode {
  return item.specText ?? formatSpec(item.spec, { unit: item.unit, decimals: item.decimals });
}

type RequirementListProps = {
  items: readonly Requirement[];
  /** Accessible table name, e.g. "Physical Properties average, size M". */
  caption: string;
  /** Column headings and result words in the template's wording. */
  labels?: Partial<RequirementLabels>;
  className?: string;
};

export function RequirementList({ items, caption, labels, className }: RequirementListProps) {
  const text: RequirementLabels = { ...DEFAULT_LABELS, ...labels };
  // Narrow containers (a size panel beside others on desktop) fold the spec
  // under the value instead of giving it a column, so nothing is cut off.
  const head = "border-b border-border bg-slate-50 px-3 py-2 font-semibold text-foreground @max-md:px-2";
  const cell = "border-b border-border px-3 py-2 align-middle touch:py-2.5 @max-md:px-2";
  return (
    <div
      data-slot="requirement-list"
      // Clipped, not scrolled: inside SizeTabs a horizontal scroller would take
      // the swipes on iPad, even when its content fits.
      className={cn("@container relative overflow-clip rounded-lg border border-border bg-card", className)}
    >
      <table className="w-full border-separate border-spacing-0 text-sm touch:text-base">
        <caption className="sr-only">{caption}</caption>
        <thead>
          <tr>
            <th scope="col" className={cn(head, "text-left")}>
              {text.requirement}
            </th>
            <th scope="col" className={cn(head, "text-right")}>
              {text.value}
            </th>
            <th scope="col" className={cn(head, "text-right @max-md:hidden")}>
              {text.spec}
            </th>
            <th scope="col" className={cn(head, "text-right")}>
              {text.result}
            </th>
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const outcome = outcomeOf(item);
            return (
              <tr key={item.key} data-outcome={outcome} {...issuePathProps(item.issuePath)} className="[&:last-child>*]:border-b-0">
                <th scope="row" className={cn(cell, "text-left font-normal text-foreground")}>
                  {item.label}
                  {item.note && (
                    <span className="block text-xs text-muted-foreground touch:text-sm">{item.note}</span>
                  )}
                </th>
                <td className={cn(cell, "bg-slate-50 text-right font-semibold whitespace-nowrap tabular-nums")}>
                  {item.valueText ?? <Figure value={item.value} decimals={item.decimals} unit={item.unit} />}
                  <span className="block text-xs font-normal whitespace-normal text-muted-foreground @md:hidden touch:text-sm">
                    {text.spec} {specLine(item)}
                  </span>
                </td>
                <td className={cn(cell, "text-right whitespace-nowrap text-muted-foreground tabular-nums @max-md:hidden")}>
                  {specLine(item)}
                </td>
                <td className={cn(cell, "text-right")}>
                  <span className="inline-flex justify-end">
                    <Outcome outcome={outcome} labels={text} />
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

type SpecValueProps = Omit<Requirement, "key" | "label" | "note" | "issuePath"> & {
  /** A short name before the value, e.g. "Average". */
  label?: ReactNode;
  /** Word before the spec. Default "Spec.". */
  specLabel?: string;
  labels?: Partial<Pick<RequirementLabels, "pass" | "fail">>;
  className?: string;
};

/** The inline form: value, spec and result on one line, for a footer or summary. */
export function SpecValue({
  label,
  specLabel = "Spec.",
  labels,
  className,
  ...item
}: SpecValueProps) {
  const text: RequirementLabels = { ...DEFAULT_LABELS, ...labels };
  const outcome = outcomeOf(item);
  return (
    <span
      data-slot="spec-value"
      data-outcome={outcome}
      className={cn("inline-flex flex-wrap items-center gap-x-3 gap-y-1 text-sm touch:text-base", className)}
    >
      {label && <span className="text-muted-foreground">{label}</span>}
      <span className="font-semibold text-foreground">
        {item.valueText ?? <Figure value={item.value} decimals={item.decimals} unit={item.unit} />}
      </span>
      <span className="whitespace-nowrap text-muted-foreground tabular-nums">
        {specLabel} {specLine(item)}
      </span>
      {/* "Spec. NA" already says there is no verdict. */}
      {outcome !== "na" && <Outcome outcome={outcome} labels={text} />}
    </span>
  );
}
