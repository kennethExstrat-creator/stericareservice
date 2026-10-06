// Per size: the average of the gloves weighed, printed at the template's
// decimals. With a spec the printed average passes or fails; without one it
// is a record (info). The size the indicative weight is given for (glove_info,
// through the context) is compared with it, and a deviation beyond the
// threshold is a warning (BUILD_SPEC 6.2 rule 9). Not done until all n
// gloves are weighed (rule 5).
import type { ModuleStatus } from "@/lib/schemas";
import { checkSpec, formatDecimal, formatSpec, mean, roundTo, type Spec } from "@/lib/stats";
import {
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  sizeLabel,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type IndicativeWeight,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import type { WeightConfig } from "./config";
import type { WeightData } from "./schema";

type BySize<T> = { [size: string]: T };

export type WeightComputed = {
  /** Gloves weighed per size. */
  n: number;
  /** Values counted per size: the first n, each more than 0 g. */
  count: BySize<number>;
  /** Mean of the values counted, unrounded; null until there is one. */
  average: BySize<number | null>;
  /** The average at the template's decimals: what is printed, judged and compared. */
  shown: BySize<number | null>;
  /** The size's spec; null when the template has none for it. */
  spec: BySize<Spec | null>;
  /**
   * For the indicative weight's size only, once every glove is weighed:
   * (printed average − indicative) / indicative × 100, at 1 decimal.
   */
  deviationPct: BySize<number>;
  /** The indicative weight the deviation is taken from (glove_info); null without one. */
  indicative: IndicativeWeight | null;
  warnThresholdPct: number;
  /** pass, fail, warn, info or not_done per size, as in the result. */
  result: BySize<ModuleStatus>;
};

/** The template's spec for one size; undefined when it has none. */
export function specFor(config: Pick<WeightConfig, "specs">, size: string): Spec | undefined {
  return config.specs.find((row) => row.size === size)?.spec;
}

/** The indicative weight when it is given for this size, else null (only that size is compared). */
export function indicativeFor(context: InspectionContext, size: string): IndicativeWeight | null {
  const indicative = context.indicativeWeight;
  return indicative && indicative.size === size && indicative.grams > 0 ? indicative : null;
}

/** (average − indicative) / indicative in %, at 1 decimal, as printed and compared with the threshold. */
export function deviationPct(average: number, indicativeGrams: number): number {
  return roundTo(((average - indicativeGrams) / indicativeGrams) * 100, 1);
}

type SizeOutcome = {
  size: string;
  count: number;
  shown: number | null;
  spec: Spec | undefined;
  deviation: number | null;
  status: ModuleStatus;
};

export function calcWeight({
  data,
  config,
  labels,
  context,
}: CalcInput<WeightData, WeightConfig>): CalcOutput<WeightComputed> {
  const issues: CalcIssue[] = [];
  const computed: WeightComputed = {
    n: config.n,
    count: {},
    average: {},
    shown: {},
    spec: {},
    deviationPct: {},
    indicative: context.indicativeWeight,
    warnThresholdPct: config.warnThresholdPct,
    result: {},
  };
  const outcomes: SizeOutcome[] = [];

  const perSize = perSizeResults(context.sizes, (size) => {
    const values = data.sizes[size]?.values ?? [];
    issues.push(...valueIssues(size, values, config.n, labels, context));
    const counted = Array.from({ length: config.n }, (_, index) => values[index] ?? null).filter(
      (value): value is number => value !== null && value > 0,
    );
    const average = mean(counted);
    const shown = average === null ? null : roundTo(average, config.decimals);
    const spec = specFor(config, size);
    computed.count[size] = counted.length;
    computed.average[size] = average;
    computed.shown[size] = shown;
    computed.spec[size] = spec ?? null;

    const outcome: SizeOutcome = { size, count: counted.length, shown, spec, deviation: null, status: "not_done" };
    if (counted.length === config.n && shown !== null) {
      const judged = spec ? checkSpec(shown, spec) : "na";
      outcome.status = judged === "na" ? "info" : judged;
      const indicative = indicativeFor(context, size);
      if (indicative) {
        outcome.deviation = deviationPct(shown, indicative.grams);
        computed.deviationPct[size] = outcome.deviation;
        if (Math.abs(outcome.deviation) > config.warnThresholdPct) {
          issues.push(
            warningIssue(
              "weight_deviation",
              `Average weight ${formatDecimal(shown)} g is ${deviationText(outcome.deviation, indicative)} (threshold ${formatDecimal(config.warnThresholdPct)}%).`,
              { size, path: ["sizes", size, "values"] },
            ),
          );
          if (outcome.status !== "fail") outcome.status = "warn";
        }
      }
    }
    computed.result[size] = outcome.status;
    outcomes.push(outcome);
    return { status: outcome.status, summary: sizeSummary(outcome, config, labels, context) };
  });

  return { result: resultFromSizes(perSize, moduleSummary(outcomes, config, labels, context)), computed, issues };
}

function valueIssues(
  size: string,
  values: readonly (number | null)[],
  n: number,
  labels: Labels,
  context: InspectionContext,
): CalcIssue[] {
  const issues: CalcIssue[] = [];
  const name = sizeLabel(context, size);
  const rowNo = labelFor(labels, "rowNo");
  const beyond: number[] = [];
  values.forEach((value, index) => {
    if (value === null) return;
    if (index >= n) {
      beyond.push(index + 1);
      return;
    }
    if (value <= 0) {
      const cell = n === 1 ? labelFor(labels, "values") : `${labelFor(labels, "values")} ${rowNo} ${index + 1}`;
      issues.push(
        errorIssue("weight_not_positive", `Size ${name}, ${cell}: must be more than 0 g.`, {
          size,
          path: ["sizes", size, "values", index],
        }),
      );
    }
  });
  if (beyond.length > 0) {
    const which = beyond.length === 1 ? `${beyond[0]}` : `${beyond[0]} to ${beyond.at(-1)}`;
    issues.push(
      warningIssue(
        "weight_beyond_n",
        `Size ${name}: values for ${rowNo} ${which} are not counted; the template weighs ${n} ${n === 1 ? "glove" : "gloves"} per size.`,
        { size, path: ["sizes", size, "values", n] },
      ),
    );
  }
  return issues;
}

/** "17.1% below the indicative 3.5 g". */
function deviationText(deviation: number, indicative: IndicativeWeight): string {
  const grams = `the indicative ${formatDecimal(indicative.grams)} g`;
  if (deviation === 0) return `the same as ${grams}`;
  return `${formatDecimal(Math.abs(deviation))}% ${deviation < 0 ? "below" : "above"} ${grams}`;
}

/** "2.90 g Passed (2.5 – 3.5)", "3.18 g (Spec. NA)" or, without `showNa`, "3.18 g". */
function averageText(outcome: SizeOutcome, config: WeightConfig, labels: Labels, showNa: boolean): string {
  const value = `${formatDecimal(outcome.shown, config.decimals)} g`;
  if (!outcome.spec) return value;
  if (outcome.spec.kind === "na") return showNa ? `${value} (${labelFor(labels, "specRow")} NA)` : value;
  const word = outcome.status === "fail" ? labelFor(labels, "fail") : labelFor(labels, "pass");
  return `${value} ${word} (${formatSpec(outcome.spec)})`;
}

/** "Average 2.90 g; 17.1% below the indicative 3.5 g." or "Weight (g): 3 of 13 gloves." */
function sizeSummary(outcome: SizeOutcome, config: WeightConfig, labels: Labels, context: InspectionContext): string {
  if (outcome.status === "not_done") return `${labelFor(labels, "values")}: ${outcome.count} of ${config.n} gloves.`;
  const indicative = indicativeFor(context, outcome.size);
  const deviation =
    indicative && outcome.deviation !== null ? `; ${deviationText(outcome.deviation, indicative)}` : "";
  return `${labelFor(labels, "average")} ${averageText(outcome, config, labels, true)}${deviation}.`;
}

/** "Average: XS 2.56 g, M 3.18 g (0.6% below the indicative 3.2 g). Not done for size S." */
function moduleSummary(
  outcomes: readonly SizeOutcome[],
  config: WeightConfig,
  labels: Labels,
  context: InspectionContext,
): string {
  if (outcomes.length === 0) return "No sizes ordered yet.";
  const weighed = outcomes.filter((outcome) => outcome.status !== "not_done");
  const notDone = outcomes.filter((outcome) => outcome.status === "not_done");
  const parts: string[] = [];
  if (weighed.length > 0) {
    const items = weighed.map((outcome) => {
      const indicative = indicativeFor(context, outcome.size);
      let note = "";
      if (indicative && outcome.deviation !== null) {
        const beyond = Math.abs(outcome.deviation) > config.warnThresholdPct;
        note = ` (${deviationText(outcome.deviation, indicative)}${beyond ? `, beyond the ${formatDecimal(config.warnThresholdPct)}% threshold` : ""})`;
      }
      return `${sizeLabel(context, outcome.size)} ${averageText(outcome, config, labels, false)}${note}`;
    });
    parts.push(`${labelFor(labels, "average")}: ${items.join(", ")}.`);
  }
  if (notDone.length > 0) {
    parts.push(`Not done for size ${notDone.map((outcome) => sizeLabel(context, outcome.size)).join(", ")}.`);
  }
  return parts.join(" ");
}
