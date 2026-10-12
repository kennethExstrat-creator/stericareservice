// Result per ordered size (BUILD_SPEC 6.1 dispensing_packing): the average
// layering and dispensing % of the size's boxes against the template's
// minimums; any box with a failing stickiness code fails the size. Not done
// until every planned box row is complete (6.2 rule 5): the rows come from
// the sampling plan's inner units for dispensing, else the template's boxes
// per size. A box number is the inspector's own and is never checked against
// the carton list (rule 7): the STD_EG box 2336 stands as typed.
import { codeLetterForSampleSize } from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas/module-result";
import { formatDecimal, mean, roundTo } from "@/lib/stats";
import {
  errorIssue,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type InspectionContext,
  type Labels,
} from "@/modules/_framework";
import type { DispensingPackingConfig, StickinessCode } from "./config";
import { isBlankPackingBox, type DispensingPackingData, type PackingBox } from "./schema";
import { codeLettersOf, fillPlaceholders, inSentence, joinWithAmpersand, plainLabel } from "./text";

/** Averages are shown, and so judged, at one decimal: 88.3%. */
export const AVERAGE_DECIMALS = 1;

/** One check of the report's "Passed / Failed" row. */
export type CheckResult = "pass" | "fail" | "not_done";

export type PackingSizeComputed = {
  /** Box rows planned: the sampling plan's inner units for dispensing, else config.boxesPerSize. */
  boxesExpected: number;
  /** Rows with a box number. */
  boxesTested: number;
  /** Rows with every value entered and valid. */
  boxesComplete: number;
  /** ISO 2859-1 code letter of the boxes tested, for the heading; null below 2. */
  codeLetter: string | null;
  /** Mean of the valid layering % entered so far. */
  layeringAverage: number | null;
  dispensingAverage: number | null;
  /** The worst code entered, the latest in config.stickinessCodes: the report's Average row. */
  stickinessSummary: string | null;
  /** Boxes per stickiness code. */
  stickinessCounts: Record<string, number>;
  layeringResult: CheckResult;
  dispensingResult: CheckResult;
  stickinessResult: CheckResult;
};

export type DispensingPackingComputed = {
  sizes: Record<string, PackingSizeComputed>;
  /** The ordered sizes' code letters, A to R: the heading's {codeLetters}. */
  codeLetters: string[];
};

export function calcDispensingPacking({
  data,
  config,
  labels,
  context,
}: CalcInput<DispensingPackingData, DispensingPackingConfig>): CalcOutput<DispensingPackingComputed> {
  const issues: CalcIssue[] = [];
  const sizes: Record<string, PackingSizeComputed> = {};
  const perSize = perSizeResults(context.sizes, (size) => {
    const evaluated = evaluateSize(size, data.sizes[size]?.boxes ?? [], { config, labels, context });
    sizes[size] = evaluated.computed;
    issues.push(...evaluated.issues);
    return evaluated.result;
  });
  const summary = context.sizes
    .map((size) => `Size ${sizeLabel(context, size)}: ${perSize[size]?.summary ?? ""}`)
    .join(" ");
  return {
    result: resultFromSizes(perSize, summary),
    computed: { sizes, codeLetters: codeLettersOf(Object.values(sizes).map((entry) => entry.codeLetter)) },
    issues,
  };
}

/** Box rows planned for a size: the sampling plan's inner units for dispensing, else the template's boxes per size. */
export function plannedBoxes(context: InspectionContext, config: DispensingPackingConfig, size: string): number {
  const planned = samplingFor(context, size).packagingDispensing;
  if (planned !== null && Number.isInteger(planned) && planned >= 0) return planned;
  return config.boxesPerSize.bySize?.[size] ?? config.boxesPerSize.default;
}

/** The report heading with its placeholders filled in. */
export function packingHeading(
  labels: Labels,
  config: DispensingPackingConfig,
  codeLetters: readonly string[],
): string {
  return fillPlaceholders(labelFor(labels, "heading"), {
    codeLetters: codeLetters.length > 0 ? joinWithAmpersand(codeLetters) : "—",
    minLayeringPct: formatDecimal(config.minLayeringPct),
    minDispensingPct: formatDecimal(config.minDispensingPct),
  });
}

/** The average as shown: one decimal, rounded like the report's Excel. */
export function formatAverage(value: number | null): string {
  return value === null ? "" : formatDecimal(value, AVERAGE_DECIMALS);
}

type SizeInput = {
  config: DispensingPackingConfig;
  labels: Labels;
  context: InspectionContext;
};

type SizeOutcome = { result: PerSizeResult; computed: PackingSizeComputed; issues: CalcIssue[] };

function evaluateSize(size: string, boxes: readonly PackingBox[], { config, labels, context }: SizeInput): SizeOutcome {
  const issues: CalcIssue[] = [];
  const codes = new Map(config.stickinessCodes.map((entry, rank) => [entry.code, { entry, rank }]));
  const words = {
    item: inSentence(labelFor(labels, "itemColumn")),
    layering: plainLabel(labelFor(labels, "layeringPct")),
    dispensing: plainLabel(labelFor(labels, "dispensingPct")),
    stickiness: plainLabel(labelFor(labels, "stickiness")),
    size: sizeLabel(context, size),
  };

  const layering: number[] = [];
  const dispensing: number[] = [];
  const stickinessCounts: Record<string, number> = {};
  const failingCodes: string[] = [];
  let worst: { entry: StickinessCode; rank: number } | null = null;
  let tested = 0;
  let complete = 0;
  let firstIncomplete: number | null = null;

  for (const [index, box] of boxes.entries()) {
    if (isBlankPackingBox(box)) continue;
    const item = `${words.item} ${index + 1}`;
    const at = (field: keyof PackingBox) => ({ size, path: ["sizes", size, "boxes", index, field] });

    if (box.boxNo !== null) tested += 1;

    const percent = (value: number | null, field: "layeringPct" | "dispensingPct", word: string): number | null => {
      if (value === null || (value >= 0 && value <= 100)) return value;
      issues.push(
        errorIssue(
          field === "layeringPct" ? "layering_out_of_range" : "dispensing_out_of_range",
          `${word} ${formatDecimal(value)}% (${item}) for size ${words.size} is not between 0 and 100%.`,
          at(field),
        ),
      );
      return null;
    };
    const layeringPct = percent(box.layeringPct, "layeringPct", words.layering);
    const dispensingPct = percent(box.dispensingPct, "dispensingPct", words.dispensing);
    if (layeringPct !== null) layering.push(layeringPct);
    if (dispensingPct !== null) dispensing.push(dispensingPct);

    const code = box.stickiness === null ? null : (codes.get(box.stickiness) ?? null);
    if (box.stickiness !== null && code === null) {
      issues.push(
        errorIssue(
          "stickiness_code_unknown",
          `${words.stickiness} "${box.stickiness}" (${item}) for size ${words.size} is not one of this template's codes (${config.stickinessCodes.map((entry) => entry.code).join(", ")}).`,
          at("stickiness"),
        ),
      );
    }
    if (code !== null) {
      stickinessCounts[code.entry.code] = (stickinessCounts[code.entry.code] ?? 0) + 1;
      if (worst === null || code.rank > worst.rank) worst = code;
      if (!code.entry.pass && !failingCodes.includes(code.entry.code)) failingCodes.push(code.entry.code);
    }

    if (box.boxNo !== null && layeringPct !== null && dispensingPct !== null && code !== null) complete += 1;
    else firstIncomplete ??= index + 1;
  }

  const planned = plannedBoxes(context, config, size);
  const layeringAverage = mean(layering);
  const dispensingAverage = mean(dispensing);
  const known = {
    boxesExpected: planned,
    boxesTested: tested,
    boxesComplete: complete,
    codeLetter: tested >= 2 ? codeLetterForSampleSize(tested) : null,
    layeringAverage,
    dispensingAverage,
    stickinessSummary: worst?.entry.code ?? null,
    stickinessCounts,
  };

  if (planned === 0 || firstIncomplete !== null || complete < planned || layeringAverage === null || dispensingAverage === null) {
    const summary =
      planned === 0
        ? "No boxes are planned for this size."
        : `${complete} of ${planned} boxes complete${firstIncomplete === null ? "" : ` (${words.item} ${firstIncomplete} is incomplete)`}.`;
    return {
      result: { status: "not_done", summary },
      computed: { ...known, layeringResult: "not_done", dispensingResult: "not_done", stickinessResult: "not_done" },
      issues,
    };
  }

  const atLeast = (value: number, minimum: number): CheckResult =>
    roundTo(value, AVERAGE_DECIMALS) >= minimum ? "pass" : "fail";
  const layeringResult = atLeast(layeringAverage, config.minLayeringPct);
  const dispensingResult = atLeast(dispensingAverage, config.minDispensingPct);
  const stickinessResult: CheckResult = failingCodes.length > 0 ? "fail" : "pass";
  const failed = [
    ...(layeringResult === "fail" ? [words.layering] : []),
    ...(dispensingResult === "fail" ? [words.dispensing] : []),
    ...(stickinessResult === "fail" ? [words.stickiness] : []),
  ];
  const figures = [
    `${words.layering} ${formatAverage(layeringAverage)}% (min. ${formatDecimal(config.minLayeringPct)}%)`,
    `${words.dispensing} ${formatAverage(dispensingAverage)}% (min. ${formatDecimal(config.minDispensingPct)}%)`,
    `${words.stickiness} ${known.stickinessSummary ?? ""}`,
  ].join(", ");
  return {
    result: {
      status: failed.length > 0 ? "fail" : "pass",
      summary: `${figures}: ${failed.length > 0 ? `Failed (${failed.join(", ")})` : "Passed"}.`,
    },
    computed: { ...known, layeringResult, dispensingResult, stickinessResult },
    issues,
  };
}
