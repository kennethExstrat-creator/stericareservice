// Result per ordered size (BUILD_SPEC 6.1 dispensing_safedon): the size's
// defect rate, every defect of every box tested over the gloves dispensed,
// against the template's maximum (a rate equal to it passes). A box is tested
// once it has a box/carton number (onsite/SAFEDON_EG.md, mapping to the core). Not
// done until the planned boxes are tested (6.2 rule 5): the sampling plan's
// inner units for dispensing, else the template's boxes per size. A
// box/carton number the size's sampled list does not hold is a warning on its
// field, never a block and never the rate (rule 7; Kenneth, 13 October 2026);
// with no sampled list for the size yet, nothing is checked. Messages name a
// box by its No. in the box list.
import { codeLetterForSampleSize } from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas/module-result";
import { formatDecimal, roundTo } from "@/lib/stats";
import {
  boxNotSampledIssue,
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
  type Labels,
} from "@/modules/_framework";
import type { DispensingSafedonConfig } from "./config";
import { countOf, isBlankSafedonBox, type DispensingSafedonData, type SafedonBox } from "./schema";
import {
  codeLettersOf,
  fillPlaceholders,
  formatSizeRate,
  joinWithAmpersand,
  ratePercent,
  RATE_DECIMALS,
} from "./text";

/** The report's Conclusion for a size: Passed or Failed, not done until the boxes are tested. */
export type CheckResult = "pass" | "fail" | "not_done";

export type SafedonBoxComputed = {
  boxNo: number | null;
  /** The box's counts over the template's defects: "1/125" on the report's first Total line. */
  boxDefects: number;
  /** boxDefects / glovesPerPack x 100: 0.8 (the report's 0.008 as a fraction). */
  boxRatePct: number;
};

export type SafedonSizeComputed = {
  /** Box columns planned: the sampling plan's inner units for dispensing, else config.boxesPerSize. */
  boxesExpected: number;
  /** Boxes with a box/carton number. */
  boxesTested: number;
  /** Boxes tested with any defect. */
  boxesFailed: number;
  /** ISO 2859-1 code letter of the boxes tested, for the heading; null below 2. */
  codeLetter: string | null;
  totalDefects: number;
  /** boxesTested x glovesPerPack. */
  glovesInspected: number;
  /** totalDefects / glovesInspected x 100; null before a box is tested. */
  ratePct: number | null;
  /** Defects of the boxes tested, per defect code of the template. */
  defectCounts: Record<string, number>;
  /** One per box column, in data order. */
  boxes: SafedonBoxComputed[];
  result: CheckResult;
};

export type DispensingSafedonComputed = {
  sizes: Record<string, SafedonSizeComputed>;
  /** The ordered sizes' code letters, A to R: the heading's {codeLetters}. */
  codeLetters: string[];
};

export function calcDispensingSafedon({
  data,
  config,
  title,
  labels,
  context,
  hasData,
}: CalcInput<DispensingSafedonData, DispensingSafedonConfig>): CalcOutput<DispensingSafedonComputed> {
  const issues: CalcIssue[] = [];
  const perInner = context.packing.glovesPerInner;
  if (hasData && perInner !== null && perInner !== config.glovesPerPack) {
    issues.push(
      warningIssue(
        "gloves_per_pack_mismatch",
        `${title}: the rates use ${config.glovesPerPack} gloves per pack, but the packing configuration has ${perInner} gloves per inner unit.`,
      ),
    );
  }
  const sizes: Record<string, SafedonSizeComputed> = {};
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

/** Box columns planned for a size: the sampling plan's inner units for dispensing, else the template's boxes per size. */
export function plannedBoxes(context: InspectionContext, config: DispensingSafedonConfig, size: string): number {
  const planned = samplingFor(context, size).packagingDispensing;
  if (planned !== null && Number.isInteger(planned) && planned >= 0) return planned;
  return config.boxesPerSize.bySize?.[size] ?? config.boxesPerSize.default;
}

/** The report heading with its code letters: "Glove Dispensing Inspection (Sampling Code Letter C & D)". */
export function safedonHeading(labels: Labels, codeLetters: readonly string[]): string {
  return fillPlaceholders(labelFor(labels, "heading"), {
    codeLetters: codeLetters.length > 0 ? joinWithAmpersand(codeLetters) : "—",
  });
}

type SizeInput = {
  config: DispensingSafedonConfig;
  labels: Labels;
  context: InspectionContext;
};

type SizeOutcome = { result: PerSizeResult; computed: SafedonSizeComputed; issues: CalcIssue[] };

function evaluateSize(size: string, boxes: readonly SafedonBox[], { config, labels, context }: SizeInput): SizeOutcome {
  const issues: CalcIssue[] = [];
  const codes = config.defects.map((defect) => defect.code);
  const listed = new Set(codes);
  const shownSize = sizeLabel(context, size);

  const defectCounts: Record<string, number> = Object.fromEntries(codes.map((code) => [code, 0]));
  const rows: SafedonBoxComputed[] = [];
  let tested = 0;
  let failed = 0;
  let total = 0;
  let untested: number | null = null;

  for (const [index, entry] of boxes.entries()) {
    // The box's No. in the box list: boxes[0] is No. 1.
    const number = index + 1;
    const defects = codes.reduce((sum, code) => sum + countOf(entry, code), 0);
    rows.push({ boxNo: entry.boxNo, boxDefects: defects, boxRatePct: (defects * 100) / config.glovesPerPack });

    for (const [code, count] of Object.entries(entry.counts)) {
      if (listed.has(code) || count === null || count === 0) continue;
      issues.push(
        warningIssue(
          "defect_not_in_template",
          `${count} "${code}" counted in No. ${number} for size ${shownSize} is not a defect of this template and is left out of the total.`,
          { size, path: ["sizes", size, "boxes", index, "counts", code] },
        ),
      );
    }
    if (isBlankSafedonBox(entry)) continue;

    if (entry.boxNo === null) {
      if (defects > 0) untested ??= number;
      continue;
    }
    tested += 1;
    total += defects;
    if (defects > 0) failed += 1;
    for (const code of codes) defectCounts[code] += countOf(entry, code);
    const unsampled = boxNotSampledIssue(context, size, entry.boxNo, ["sizes", size, "boxes", index, "boxNo"]);
    if (unsampled) issues.push(unsampled);
  }

  const planned = plannedBoxes(context, config, size);
  const gloves = tested * config.glovesPerPack;
  const rate = ratePercent(total, gloves);
  const known = {
    boxesExpected: planned,
    boxesTested: tested,
    boxesFailed: failed,
    codeLetter: tested >= 2 ? codeLetterForSampleSize(tested) : null,
    totalDefects: total,
    glovesInspected: gloves,
    ratePct: rate,
    defectCounts,
    boxes: rows,
  };

  if (planned === 0 || untested !== null || tested < planned || rate === null) {
    const summary =
      planned === 0
        ? "No boxes are planned for this size."
        : `${tested} of ${planned} boxes tested${untested === null ? "" : `; ${labelFor(labels, "boxNo")} missing in No. ${untested}, which has defects counted`}.`;
    return { result: { status: "not_done", summary }, computed: { ...known, result: "not_done" }, issues };
  }

  const result: CheckResult = roundTo(rate, RATE_DECIMALS) <= config.maxRatePct ? "pass" : "fail";
  return {
    result: {
      status: result,
      summary: `${formatSizeRate(total, gloves)}, max. ${formatDecimal(config.maxRatePct)}%: ${result === "pass" ? "Passed" : "Failed"}.`,
    },
    computed: { ...known, result },
    issues,
  };
}
