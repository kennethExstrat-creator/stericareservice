// Result per ordered size (BUILD_SPEC 6.1 dispensing_packing): the average
// layering and dispensing % of the size's boxes against the template's
// minimums; any box with a failing stickiness code fails the size. Not done
// until every planned box row is complete (6.2 rule 5): the rows come from
// the sampling plan's inner units for dispensing, else the template's boxes
// per size. A box/carton number the size's sampled list does not hold is a
// warning on its cell, never a block and never the result (rule 7; Kenneth,
// 13 October 2026): the STD_EG box 2336 is stored as typed and warned about.
// With no sampled list for the size yet, nothing is checked.
//
// The size's aged sample (Kenneth, 26 October 2026) is no box: it is not
// counted, has no box/carton number to lack and stays out of the averages.
// It is judged on its own against the same minimums and codes: a failed one
// fails the size (even while boxes are still to come), a passed one changes
// nothing, one entered in part keeps the size not done (a warning names what
// is missing) and an empty one is none. Summaries give it a line of its own,
// after the boxes'.
import { codeLetterForSampleSize } from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas/module-result";
import { formatDecimal, mean, roundTo } from "@/lib/stats";
import {
  boxNotSampledIssue,
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
  type InspectionContext,
  type IssuePath,
  type Labels,
} from "@/modules/_framework";
import type { DispensingPackingConfig, StickinessCode } from "./config";
import {
  isBlankAgedSample,
  isBlankPackingBox,
  type DispensingPackingData,
  type PackingAgedSample,
  type PackingBox,
  type PackingSize,
} from "./schema";
import { codeLettersOf, fillPlaceholders, inSentence, joinWithAmpersand, joinWithAnd, plainLabel } from "./text";

/** Averages are shown, and so judged, at one decimal: 88.3%. */
export const AVERAGE_DECIMALS = 1;

/** One check of the report's "Passed / Failed" row. */
export type CheckResult = "pass" | "fail" | "not_done";

/** The size's aged sample, judged on its own against the boxes' minimums and codes. */
export type AgedSampleComputed = {
  /** Its layering % against config.minLayeringPct; not_done until its three values are entered and valid. */
  layeringResult: CheckResult;
  dispensingResult: CheckResult;
  /** Its stickiness code passes or fails as config.stickinessCodes says. */
  stickinessResult: CheckResult;
  /** Its own verdict: fail when a check fails; not_done until the three are judged. */
  result: CheckResult;
};

export type PackingSizeComputed = {
  /** Box rows planned: the sampling plan's inner units for dispensing, else config.boxesPerSize. */
  boxesExpected: number;
  /** Rows with a box/carton number. */
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
  /** The aged sample's checks, apart from the boxes'; null while nothing is entered in it. */
  agedSample: AgedSampleComputed | null;
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
    const evaluated = evaluateSize(size, data.sizes[size] ?? { boxes: [] }, { config, labels, context });
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

/**
 * Between the boxes' line and the aged sample's in a size's summary: the
 * review shows each on its own line, and anything that runs the text
 * together reads a space. The boxes' line always comes first.
 */
export const SUMMARY_LINE_BREAK = "\n";

/** The boxes' line of a size's summary, without the aged sample's. */
export function boxesLineOf(summary: string): string {
  return summary.split(SUMMARY_LINE_BREAK)[0];
}

type SizeInput = {
  config: DispensingPackingConfig;
  labels: Labels;
  context: InspectionContext;
};

type SizeOutcome = { result: PerSizeResult; computed: PackingSizeComputed; issues: CalcIssue[] };

type RankedCode = { entry: StickinessCode; rank: number };

/** How a size's values are read, its boxes' and its aged sample's alike: the template's codes and words. */
type Reading = {
  size: string;
  config: DispensingPackingConfig;
  codes: ReadonlyMap<string, RankedCode>;
  words: { item: string; layering: string; dispensing: string; stickiness: string; aged: string; size: string };
  issues: CalcIssue[];
};

type CheckResults = Pick<AgedSampleComputed, "layeringResult" | "dispensingResult" | "stickinessResult">;

function evaluateSize(size: string, entry: PackingSize, { config, labels, context }: SizeInput): SizeOutcome {
  const reading: Reading = {
    size,
    config,
    codes: new Map(config.stickinessCodes.map((code, rank) => [code.code, { entry: code, rank }])),
    words: {
      item: inSentence(labelFor(labels, "itemColumn")),
      layering: plainLabel(labelFor(labels, "layeringPct")),
      dispensing: plainLabel(labelFor(labels, "dispensingPct")),
      stickiness: plainLabel(labelFor(labels, "stickiness")),
      // A label quoted as shown, inside a sentence too: "Aged Sample".
      aged: labelFor(labels, "agedSample"),
      size: sizeLabel(context, size),
    },
    issues: [],
  };
  const { words, issues } = reading;

  const layering: number[] = [];
  const dispensing: number[] = [];
  const stickinessCounts: Record<string, number> = {};
  const failingCodes: string[] = [];
  let worst: RankedCode | null = null;
  let tested = 0;
  let complete = 0;
  let firstIncomplete: number | null = null;

  for (const [index, box] of entry.boxes.entries()) {
    if (isBlankPackingBox(box)) continue;
    const item = `${words.item} ${index + 1}`;
    const at = (field: keyof PackingBox) => ["sizes", size, "boxes", index, field];

    if (box.boxNo !== null) {
      tested += 1;
      const unsampled = boxNotSampledIssue(context, size, box.boxNo, at("boxNo"));
      if (unsampled) issues.push(unsampled);
    }

    const layeringPct = readPercent(reading, box.layeringPct, "layeringPct", item, at("layeringPct"));
    const dispensingPct = readPercent(reading, box.dispensingPct, "dispensingPct", item, at("dispensingPct"));
    if (layeringPct !== null) layering.push(layeringPct);
    if (dispensingPct !== null) dispensing.push(dispensingPct);

    const code = readCode(reading, box.stickiness, item, at("stickiness"));
    if (code !== null) {
      stickinessCounts[code.entry.code] = (stickinessCounts[code.entry.code] ?? 0) + 1;
      if (worst === null || code.rank > worst.rank) worst = code;
      if (!code.entry.pass && !failingCodes.includes(code.entry.code)) failingCodes.push(code.entry.code);
    }

    if (box.boxNo !== null && layeringPct !== null && dispensingPct !== null && code !== null) complete += 1;
    else firstIncomplete ??= index + 1;
  }

  // After the boxes, apart from them: its issues follow theirs, and it is in none of their figures.
  const aged = evaluateAgedSample(reading, entry.agedSample);
  const agedLine = aged.computed === null ? null : (aged.line ?? `${words.aged} is incomplete.`);
  const withAgedLine = (line: string) => (agedLine === null ? line : `${line}${SUMMARY_LINE_BREAK}${agedLine}`);

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
    agedSample: aged.computed,
  };

  if (planned === 0 || firstIncomplete !== null || complete < planned || layeringAverage === null || dispensingAverage === null) {
    const summary =
      planned === 0
        ? "No boxes are planned for this size."
        : `${complete} of ${planned} boxes complete${firstIncomplete === null ? "" : ` (${words.item} ${firstIncomplete} is incomplete)`}.`;
    return {
      // A failed aged sample fails the size whatever the boxes still to come show: a failure is never hidden.
      result: { status: aged.computed?.result === "fail" ? "fail" : "not_done", summary: withAgedLine(summary) },
      computed: { ...known, layeringResult: "not_done", dispensingResult: "not_done", stickinessResult: "not_done" },
      issues,
    };
  }

  // The boxes' checks stand on the boxes alone; the size's verdict takes in the aged sample.
  const checks: CheckResults = {
    layeringResult: atLeast(layeringAverage, config.minLayeringPct),
    dispensingResult: atLeast(dispensingAverage, config.minDispensingPct),
    stickinessResult: failingCodes.length > 0 ? "fail" : "pass",
  };
  const failed = failedChecks(reading, checks);
  const boxesLine = `${figures(reading, formatAverage(layeringAverage), formatAverage(dispensingAverage), known.stickinessSummary)}: ${verdict(failed)}.`;
  // An aged sample entered in part keeps the size not done; a failed one fails it, a passed one changes nothing.
  const agedResult = aged.computed?.result ?? "pass";
  const status = agedResult === "not_done" ? "not_done" : failed.length > 0 || agedResult === "fail" ? "fail" : "pass";
  return {
    result: { status, summary: withAgedLine(boxesLine) },
    computed: { ...known, ...checks },
    issues,
  };
}

type AgedOutcome = {
  /** Null for an aged sample with nothing in it: none. */
  computed: AgedSampleComputed | null;
  /** Its line in the size's summary, once it is judged. */
  line: string | null;
};

/**
 * The size's aged sample against the boxes' minimums and codes, on its own.
 * A value out of range or a code the template lacks is an error at its cell,
 * as in a box row; a value not entered is a warning at the first one
 * missing, the sample not done until all three are in.
 */
function evaluateAgedSample(reading: Reading, sample: PackingAgedSample | undefined): AgedOutcome {
  if (sample === undefined || isBlankAgedSample(sample)) return { computed: null, line: null };
  const { size, config, words, issues } = reading;
  const at = (field: keyof PackingAgedSample) => ["sizes", size, "agedSample", field];

  const layeringPct = readPercent(reading, sample.layeringPct, "layeringPct", words.aged, at("layeringPct"));
  const dispensingPct = readPercent(reading, sample.dispensingPct, "dispensingPct", words.aged, at("dispensingPct"));
  const code = readCode(reading, sample.stickiness, words.aged, at("stickiness"));

  const missing = (
    [
      ["layeringPct", words.layering],
      ["dispensingPct", words.dispensing],
      ["stickiness", words.stickiness],
    ] as const
  ).filter(([field]) => sample[field] === null);
  if (missing.length > 0) {
    issues.push(
      warningIssue(
        "aged_sample_incomplete",
        `${words.aged} for size ${words.size}: ${joinWithAnd(missing.map(([, word]) => word))} ${missing.length === 1 ? "is" : "are"} not entered yet.`,
        { size, path: at(missing[0][0]) },
      ),
    );
  }

  if (layeringPct === null || dispensingPct === null || code === null) {
    return {
      computed: { layeringResult: "not_done", dispensingResult: "not_done", stickinessResult: "not_done", result: "not_done" },
      line: null,
    };
  }
  const checks: CheckResults = {
    layeringResult: atLeast(layeringPct, config.minLayeringPct),
    dispensingResult: atLeast(dispensingPct, config.minDispensingPct),
    stickinessResult: code.entry.pass ? "pass" : "fail",
  };
  const failed = failedChecks(reading, checks);
  return {
    computed: { ...checks, result: failed.length > 0 ? "fail" : "pass" },
    line: `${words.aged}: ${figures(reading, formatAverage(layeringPct), formatAverage(dispensingPct), code.entry.code)}: ${verdict(failed)}.`,
  };
}

/** A percentage as calc takes it: null when missing, or outside 0 to 100, which is an error at its cell. */
function readPercent(
  { size, words, issues }: Reading,
  value: number | null,
  field: "layeringPct" | "dispensingPct",
  where: string,
  path: IssuePath,
): number | null {
  if (value === null || (value >= 0 && value <= 100)) return value;
  issues.push(
    errorIssue(
      field === "layeringPct" ? "layering_out_of_range" : "dispensing_out_of_range",
      `${field === "layeringPct" ? words.layering : words.dispensing} ${formatDecimal(value)}% (${where}) for size ${words.size} is not between 0 and 100%.`,
      { size, path },
    ),
  );
  return null;
}

/** A stickiness code as calc takes it: null when missing, or not one of the template's, which is an error at its cell. */
function readCode(
  { size, config, codes, words, issues }: Reading,
  value: string | null,
  where: string,
  path: IssuePath,
): RankedCode | null {
  if (value === null) return null;
  const code = codes.get(value) ?? null;
  if (code === null) {
    issues.push(
      errorIssue(
        "stickiness_code_unknown",
        `${words.stickiness} "${value}" (${where}) for size ${words.size} is not one of this template's codes (${config.stickinessCodes.map((entry) => entry.code).join(", ")}).`,
        { size, path },
      ),
    );
  }
  return code;
}

/** A value against its minimum, judged as shown: at one decimal. */
function atLeast(value: number, minimum: number): CheckResult {
  return roundTo(value, AVERAGE_DECIMALS) >= minimum ? "pass" : "fail";
}

/** The words of the checks that failed, in the report's order. */
function failedChecks({ words }: Reading, checks: CheckResults): string[] {
  return [
    ...(checks.layeringResult === "fail" ? [words.layering] : []),
    ...(checks.dispensingResult === "fail" ? [words.dispensing] : []),
    ...(checks.stickinessResult === "fail" ? [words.stickiness] : []),
  ];
}

/** "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A". */
function figures({ config, words }: Reading, layering: string, dispensing: string, stickiness: string | null): string {
  return [
    `${words.layering} ${layering}% (min. ${formatDecimal(config.minLayeringPct)}%)`,
    `${words.dispensing} ${dispensing}% (min. ${formatDecimal(config.minDispensingPct)}%)`,
    `${words.stickiness} ${stickiness ?? ""}`,
  ].join(", ");
}

function verdict(failed: readonly string[]): string {
  return failed.length > 0 ? `Failed (${failed.join(", ")})` : "Passed";
}
