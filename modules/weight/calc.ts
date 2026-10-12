// Per size: the average of the gloves weighed, printed at the template's
// decimals. With a spec the printed average passes or fails; without one it
// is a record (info). The size the indicative weight is given for (glove_info,
// through the context) is compared with it, and a deviation beyond the
// threshold is a warning (BUILD_SPEC 6.2 rule 9). The gloves weighed are the
// sampling plan's gloves for weight, else the template's n (glovesFor);
// not done until every glove counted is weighed (rule 5). A weight of 0 g or
// less is an error that blocks submit; it still counts, as MeasurementGrid's
// live average counts it, so the screen never shows two answers for one size.
import type { ModuleStatus } from "@/lib/schemas";
import { checkSpec, formatDecimal, formatSpec, mean, roundTo, type Spec } from "@/lib/stats";
import {
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type IndicativeWeight,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import { MAX_N, type WeightConfig } from "./config";
import type { WeightData } from "./schema";

type BySize<T> = { [size: string]: T };

export type WeightComputed = {
  /** Gloves weighed per ordered size (glovesFor): the sampling plan's gloves for weight, else the template's n. */
  n: BySize<number>;
  /** Values counted per size: those entered among the first n. */
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

/** Where a size's number of gloves weighed comes from. */
export type GlovesSource = "sampling" | "template";

/**
 * Gloves to weigh for a size: weight's own count, never another test's
 * (Kenneth, 12 October 2026: "each metrics and measurement should have their
 * own number of glove count"). The sampling plan's gloves for weight when it
 * holds a count (BUILD_SPEC 8: numbers flow forward), else the template's n
 * (13 on STD_EG, its report's "average of 13 gloves per size"), as
 * dimensions measures its own gloves (rowsFor). n 1 is one value per size
 * (SAFEDON_EG) whatever the plan says. Capped at MAX_N, so a mistyped plan
 * cannot stall the screen.
 */
export function glovesFor(
  context: InspectionContext,
  size: string,
  config: Pick<WeightConfig, "n">,
): { n: number; source: GlovesSource } {
  if (config.n === 1) return { n: 1, source: "template" };
  const planned = samplingFor(context, size).weight;
  if (planned === null || !Number.isInteger(planned) || planned < 0) return { n: config.n, source: "template" };
  return { n: Math.min(planned, MAX_N), source: "sampling" };
}

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

/** (average − indicative) / indicative in %, at 1 decimal, as printed and compared with the threshold. */
export function deviationPct(average: number, indicativeGrams: number): number {
  return roundTo(((average - indicativeGrams) / indicativeGrams) * 100, 1);
}

type SizeOutcome = {
  size: string;
  /** Gloves weighed for the size (glovesFor). */
  n: number;
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
    n: {},
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
    const { n, source } = glovesFor(context, size, config);
    const values = data.sizes[size]?.values ?? [];
    issues.push(...valueIssues(size, values, { n, source, oneValue: config.n === 1 }, labels, context));
    const counted = Array.from({ length: n }, (_, index) => values[index] ?? null).filter(
      (value): value is number => value !== null,
    );
    const average = mean(counted);
    const shown = average === null ? null : roundTo(average, config.decimals);
    const spec = specFor(config, size);
    computed.n[size] = n;
    computed.count[size] = counted.length;
    computed.average[size] = average;
    computed.shown[size] = shown;
    computed.spec[size] = spec ?? null;

    // A plan of 0 gloves for weight has nothing to weigh: not done, as dimensions says of its own (shown stays null).
    const outcome: SizeOutcome = { size, n, count: counted.length, shown, spec, deviation: null, status: "not_done" };
    if (n > 0 && counted.length === n && shown !== null) {
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

/** The size's gloves weighed and where that number comes from; `oneValue`: the template weighs one value per size (config n 1). */
type Weighed = { n: number; source: GlovesSource; oneValue: boolean };

function valueIssues(
  size: string,
  values: readonly (number | null)[],
  { n, source, oneValue }: Weighed,
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
      // Named as the screen shows it: a cell of the sizes' table, or glove No. x of the size's grid.
      const cell = oneValue ? labelFor(labels, "values") : `${labelFor(labels, "values")} ${rowNo} ${index + 1}`;
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
      warningIssue("weight_beyond_n", `Size ${name}: values for ${rowNo} ${which} are not counted; ${weighedText(n, source)}.`, {
        size,
        path: ["sizes", size, "values", n],
      }),
    );
  }
  return issues;
}

/** "the sampling plan has 12 gloves for weight" or "the template weighs 13 gloves per size". */
function weighedText(n: number, source: GlovesSource): string {
  const gloves = `${n} ${n === 1 ? "glove" : "gloves"}`;
  if (source === "template") return `the template weighs ${gloves} per size`;
  return n === 0 ? "the sampling plan has no gloves for weight" : `the sampling plan has ${gloves} for weight`;
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

/** "Average 2.90 g; 17.1% below the indicative 3.5 g." or "Weight (g): 3 of 12 gloves." */
function sizeSummary(outcome: SizeOutcome, config: WeightConfig, labels: Labels, context: InspectionContext): string {
  if (outcome.n === 0) return "The sampling plan has no gloves for weight.";
  if (outcome.status === "not_done") return `${labelFor(labels, "values")}: ${outcome.count} of ${outcome.n} gloves.`;
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
