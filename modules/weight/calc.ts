// Per size: one value, the size's average weight in g as the dimension sheet
// prints it (Kenneth, 26 October 2026: "this page should only record average
// weight of each size, which already in the dimension document"), printed at
// the template's decimals; the template's n is not used. An inspection saved
// before then weighed its gloves one by one (13 on STD_EG): the average of
// those values is the size's weight, as its report printed it. With a spec
// the printed weight passes or fails; without one it is a record (info). The
// size the indicative weight is given for (glove_info, through the context)
// is compared with it, and a deviation beyond the threshold is a warning
// (BUILD_SPEC 6.2 rule 9). Not done until the size has its value (rule 5). A
// weight of 0 g or less is an error that blocks submit.
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
  /**
   * Values the size's weight comes from: 1, the average as entered; more on
   * an inspection saved before 26 October 2026, which weighed its gloves one
   * by one; 0 while nothing is entered.
   */
  count: BySize<number>;
  /** The size's weight: its value, or the mean of an older inspection's values, unrounded; null until there is one. */
  average: BySize<number | null>;
  /** The weight at the template's decimals: what is printed, judged and compared. */
  shown: BySize<number | null>;
  /** The size's spec; null when the template has none for it. */
  spec: BySize<Spec | null>;
  /**
   * For the indicative weight's size only, once its weight is entered:
   * (printed weight − indicative) / indicative × 100, at 1 decimal.
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

/**
 * The indicative weight for this size, else null: the glove variants' for
 * the size (glove_info), else the one weight given for one size
 * (indicativeWeight), compared for that size only.
 */
export function indicativeFor(context: InspectionContext, size: string): IndicativeWeight | null {
  const grams = context.indicativeWeights?.[size];
  if (grams !== undefined && grams > 0) return { grams, size };
  const indicative = context.indicativeWeight;
  return indicative && indicative.size === size && indicative.grams > 0 ? indicative : null;
}

/** (weight − indicative) / indicative in %, at 1 decimal, as printed and compared with the threshold. */
export function deviationPct(average: number, indicativeGrams: number): number {
  return roundTo(((average - indicativeGrams) / indicativeGrams) * 100, 1);
}

type SizeOutcome = {
  size: string;
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
    const entered = (data.sizes[size]?.values ?? []).filter((value): value is number => value !== null);
    const average = mean(entered);
    const shown = average === null ? null : roundTo(average, config.decimals);
    const spec = specFor(config, size);
    computed.count[size] = entered.length;
    computed.average[size] = average;
    computed.shown[size] = shown;
    computed.spec[size] = spec ?? null;

    const outcome: SizeOutcome = { size, shown, spec, deviation: null, status: "not_done" };
    if (average !== null && average <= 0) {
      // Named as the screen shows it: the size's cell, where the error is marked.
      issues.push(
        errorIssue("weight_not_positive", `Size ${sizeLabel(context, size)}, ${labelFor(labels, "values")}: must be more than 0 g.`, {
          size,
          path: ["sizes", size, "values", 0],
        }),
      );
    }
    if (shown !== null) {
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

/** "Average 2.90 g; 17.1% below the indicative 3.5 g." or "Weight (g): not entered." */
function sizeSummary(outcome: SizeOutcome, config: WeightConfig, labels: Labels, context: InspectionContext): string {
  if (outcome.status === "not_done") return `${labelFor(labels, "values")}: not entered.`;
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
