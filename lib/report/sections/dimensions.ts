// Section 03, Dimensions & Weight (TG35 page 3), from the Dimension and
// Weight steps: the lead says what was measured and what each measure must
// meet, from the specs in force; then, each where its block is switched on,
// every glove's length as a dot per size against its limits, the palm width
// measured against each size's tolerance, the statistic of each measure by
// size with each size's result, and the weight per glove. The statistic is
// the template's (median or average), the spec the one in force (set for
// this inspection, else the template's), the words the template's. A size
// without readings says "Not stated"; a block with nothing to draw is left
// out, and a section with none prints nothing. Pages follow from the parts'
// heights: a chart too long for what is left of a page moves to the next
// whole, or runs on there with its remaining sizes.
import { formatNumber, formatSpec, hasLimit } from "@/lib/format";
import type { ExportModule, InspectionExport } from "@/lib/schemas/export";
import type { Spec } from "@/lib/stats";
import { SpecSchema } from "@/modules/_framework/config-schemas";
import { andList, rangeText } from "../format";
import { bandEdges, niceAxis, stackDots, stackHeight } from "../geometry";
import type {
  DimensionsAsideLine,
  DimensionsLengthChart,
  DimensionsPage,
  DimensionsPagePart,
  DimensionsResultsTable,
  DimensionsSection,
  DimensionsWeightBars,
  DimensionsWidthChart,
  ReportPlanEntryFor,
} from "../model";
import { at, inTemplateOrder, moduleOf, num, orderedSizes, rec, sizeLabel } from "../read";
import {
  capitalised,
  contentRoom,
  DIMENSIONS_ROOM as ROOM,
  glovesCounted,
  inSentence,
  isThickness,
  lengthRowHeight,
  linesOf,
  measureLabel,
  NO_FIGURE,
  NOT_STATED,
  PAGE_ROOM,
  readDimensions,
  readingsOf,
  shortLabel,
  specText,
  statisticFigure,
  typedDecimals,
  type DimensionReadings,
} from "./dimension-shared";
import { defineSection } from "./index";

const LENGTH = "length";
const WIDTH = "width";

export const dimensions = defineSection({ key: "dimensions", build: buildDimensions });

function buildDimensions(doc: InspectionExport, entry: ReportPlanEntryFor<"dimensions">): DimensionsSection | null {
  const on = new Set<string>(entry.blocks.map((block) => block.key));
  const readings = readDimensions(doc);
  const weight = moduleOf(doc, "weight");
  const parts: Parts = {
    lead: null,
    gloveLength: on.has("gloveLength") && readings ? gloveLengthOf(readings) : null,
    palmWidth: on.has("palmWidth") && readings ? palmWidthOf(readings) : null,
    medianResults: on.has("medianResults") && readings ? medianResultsOf(readings) : null,
    weightPerGlove: on.has("weightPerGlove") && weight ? weightPerGloveOf(doc, weight, readings) : null,
  };
  if (!parts.gloveLength && !parts.palmWidth && !parts.medianResults && !parts.weightPerGlove) return null;
  // The lead speaks of what the section shows: the measures where a dimension block is on, the weight where its block is.
  const measured = parts.gloveLength || parts.palmWidth || parts.medianResults ? readings : null;
  parts.lead = leadOf(doc, measured, parts.weightPerGlove ? weight : null);
  const pages = pagesOf(doc, parts);
  return { pageCount: pages.length, ...parts, pages };
}

/* ------------------------------------------------------------------ *
 * Specs
 * ------------------------------------------------------------------ */

function asSpec(value: unknown): Spec | null {
  const parsed = SpecSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

/** Without binary noise: 95 - 10 is 85. */
const clean = (value: number) => Number(value.toPrecision(12));

function sameSpec(a: Spec, b: Spec): boolean {
  return formatSpec(a) === formatSpec(b);
}

/** The spec's limits along a dot plot: a minimum's reject zone below it, a maximum's above, both for a range. */
function limitsOf(spec: Spec | null): { value: number; side: "below" | "above" }[] {
  if (!spec) return [];
  switch (spec.kind) {
    case "min":
      return [{ value: spec.min, side: "below" }];
    case "max":
      return [{ value: spec.max, side: "above" }];
    case "range":
      return [
        { value: spec.min, side: "below" },
        { value: spec.max, side: "above" },
      ];
    case "tolerance":
      return [
        { value: clean(spec.nominal - spec.tolerance), side: "below" },
        { value: clean(spec.nominal + spec.tolerance), side: "above" },
      ];
    case "na":
      return [];
  }
}

/** What a measure must meet, the sizes whose spec sets it, and the sizes with none. */
type Requirement = { words: string; limited: string[]; unlimited: string[] };

/**
 * What a measure must meet across the sizes, for the lead: "must reach 240
 * mm" where every size with a spec has that minimum, "must sit inside each
 * size's tolerance" where the tolerances differ; null where no size has a
 * limit (recorded for information).
 */
function requirementOf(specs: readonly (Spec | null)[], labels: readonly string[], unit: string): Requirement | null {
  const limited = specs.flatMap((spec, index) => (hasLimit(spec) ? [{ spec, label: labels[index] }] : []));
  if (limited.length === 0) return null;
  const kinds = new Set(limited.map(({ spec }) => spec.kind));
  let words: string;
  if (limited.every(({ spec }) => sameSpec(spec, limited[0].spec))) {
    const spec = limited[0].spec;
    words =
      spec.kind === "min"
        ? `must reach ${formatNumber(spec.min, { unit })}`
        : spec.kind === "max"
          ? `must not exceed ${formatNumber(spec.max, { unit })}`
          : `must sit within ${formatSpec(spec, { unit })}`;
  } else if (kinds.size === 1 && kinds.has("min")) words = "must reach each size's minimum";
  else if (kinds.size === 1 && kinds.has("max")) words = "must not exceed each size's maximum";
  else if (kinds.has("tolerance") || kinds.has("range")) words = "must sit inside each size's tolerance";
  else words = "must meet each size's spec";
  const named = new Set(limited.map(({ label }) => label));
  return { words, limited: [...named], unlimited: labels.filter((label) => !named.has(label)) };
}

/** "size M", "sizes S and M". */
const sizesWord = (labels: readonly string[]) => `${labels.length === 1 ? "size" : "sizes"} ${andList(labels)}`;

/** The key's words for the glove length's reject zone: "Below 240 mm minimum". */
function limitTextOf(specs: readonly (Spec | null)[]): string | null {
  const limits = specs.filter(hasLimit);
  if (limits.length === 0) return null;
  const kinds = new Set(limits.map((spec) => spec.kind));
  if (limits.every((spec) => sameSpec(spec, limits[0]))) {
    const spec = limits[0];
    if (spec.kind === "min") return `Below ${formatNumber(spec.min)} mm minimum`;
    if (spec.kind === "max") return `Above ${formatNumber(spec.max)} mm maximum`;
    return `Outside ${formatSpec(spec, { unit: "mm" })}`;
  }
  if (kinds.size === 1 && kinds.has("min")) return "Below each size's minimum";
  if (kinds.size === 1 && kinds.has("max")) return "Above each size's maximum";
  return "Outside each size's spec";
}

/* ------------------------------------------------------------------ *
 * The lead
 * ------------------------------------------------------------------ */

/** A measure inside the lead's sentences: the width is the palm's, as the design says it. */
function proseName(step: ExportModule, measure: string): string {
  const label = measureLabel(step, measure);
  return inSentence(measure === WIDTH && !/palm/i.test(label) ? `Palm ${label}` : label);
}

/**
 * "13 gloves measured per size. Length must reach 240 mm and palm width must
 * sit inside each size's tolerance. Thickness and weight are recorded for
 * information." The thicknesses recorded for information are named
 * together. Where only some sizes have a spec, each requirement names its
 * sizes, or, where every requirement leaves out the same ones, a sentence
 * says once that they have none: "Size XL has no spec."
 */
function leadOf(doc: InspectionExport, readings: DimensionReadings | null, weight: ExportModule | null): string | null {
  const sentences: string[] = [];
  const required: { name: string; requirement: Requirement }[] = [];
  const recorded: string[] = [];
  if (readings) {
    const gloves = glovesCounted(readings);
    if (gloves) sentences.push(`${gloves} measured per size.`);
    const labels = readings.sizes.map((size) => size.label);
    const thicknesses: string[] = [];
    for (const measure of readings.measures) {
      const name = proseName(readings.dimension, measure);
      const requirement = requirementOf(
        readings.sizes.map((size) => size.spec[measure] ?? null),
        labels,
        "mm",
      );
      if (requirement) required.push({ name, requirement });
      else if (isThickness(measure)) thicknesses.push(name);
      else recorded.push(name);
    }
    recorded.push(...(thicknesses.length > 1 ? ["thickness"] : thicknesses));
  }
  if (weight) {
    const sizes = weightSizes(doc, weight, readings);
    const requirement = requirementOf(
      sizes.map((size) => asSpec(at(weight.computed, "spec", size))),
      sizes.map((size) => sizeLabel(doc, size)),
      "g",
    );
    if (requirement) required.push({ name: "weight", requirement });
    else recorded.push("weight");
  }
  const left = required.map(({ requirement }) => requirement.unlimited.join("|"));
  const sameLeft = left.length > 0 && left.every((sizes) => sizes === left[0]);
  const clauses = required.map(({ name, requirement }) =>
    requirement.unlimited.length === 0 || sameLeft ? `${name} ${requirement.words}` : `${name} ${requirement.words} for ${sizesWord(requirement.limited)}`,
  );
  if (clauses.length > 0) sentences.push(`${capitalised(andList(clauses))}.`);
  if (sameLeft && required[0].requirement.unlimited.length > 0) {
    const sizes = required[0].requirement.unlimited;
    sentences.push(`${capitalised(sizesWord(sizes))} ${sizes.length === 1 ? "has" : "have"} no spec.`);
  }
  if (recorded.length > 0) sentences.push(`${capitalised(andList(recorded))} ${recorded.length === 1 ? "is" : "are"} recorded for information.`);
  return sentences.length > 0 ? sentences.join(" ") : null;
}

/* ------------------------------------------------------------------ *
 * Glove Length (mm), Each Glove
 * ------------------------------------------------------------------ */

/** "Glove Length": the template's label with the design's word before it, unless the label has it. */
function chartName(label: string, word: string): string {
  return new RegExp(`\\b${word}\\b`, "i").test(label) ? label : `${word} ${label}`;
}

function gloveLengthOf(readings: DimensionReadings): DimensionsLengthChart | null {
  if (!readings.measures.includes(LENGTH)) return null;
  const decimals = readings.decimals[LENGTH] ?? 0;
  const perSize = readings.sizes.map((size) => ({ size, values: readingsOf(size, LENGTH) }));
  const all = perSize.flatMap(({ values }) => values);
  if (all.length === 0) return null;
  const precision = Math.max(...all.map(typedDecimals));
  const rows = perSize.map(({ size, values }) => {
    const statistic = size.shown[LENGTH] ?? null;
    const failed = size.verdict[LENGTH] === "fail";
    const aside: DimensionsAsideLine[] =
      values.length === 0
        ? [{ text: NOT_STATED }]
        : [
            {
              text: readings.statisticLabel,
              strong: statistic === null ? NO_FIGURE : formatNumber(statistic, { decimals, unit: "mm" }),
              ...(failed ? { tone: "fail" as const } : {}),
            },
            { text: `Range ${rangeText(values, { decimals: Math.max(decimals, precision) })}` },
          ];
    return { size: size.size, label: size.label, values, statistic, limits: limitsOf(size.spec[LENGTH] ?? null), aside };
  });
  const statistics = rows.flatMap((row) => (row.statistic === null ? [] : [row.statistic]));
  const limits = rows.flatMap((row) => row.limits.map((limit) => limit.value));
  return {
    title: `${chartName(measureLabel(readings.dimension, LENGTH), "Glove")} (mm), Each Glove`,
    statisticLabel: readings.statisticLabel,
    limitText: limitTextOf(readings.sizes.map((size) => size.spec[LENGTH] ?? null)),
    axis: niceAxis([...all, ...statistics], { include: limits, count: 8 }),
    step: 10 ** -precision,
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Palm Width (mm) against Size Tolerance
 * ------------------------------------------------------------------ */

function palmWidthOf(readings: DimensionReadings): DimensionsWidthChart | null {
  if (!readings.measures.includes(WIDTH)) return null;
  const decimals = readings.decimals[WIDTH] ?? 0;
  const perSize = readings.sizes.map((size) => ({ size, values: readingsOf(size, WIDTH) }));
  const all = perSize.flatMap(({ values }) => values);
  if (all.length === 0) return null;
  // The axis reaches each band's edges: both of a tolerance or a range, the one limit of a minimum or a maximum.
  const edges = readings.sizes.flatMap((size) => limitsOf(size.spec[WIDTH] ?? null).map((limit) => limit.value));
  const statistics = readings.sizes.flatMap((size) => {
    const shown = size.shown[WIDTH];
    return shown === null || shown === undefined ? [] : [shown];
  });
  const axis = niceAxis([...all, ...statistics], { include: edges, count: 6 });
  const rows = perSize.map(({ size, values }) => {
    const spec = size.spec[WIDTH] ?? null;
    const statistic = size.shown[WIDTH] ?? null;
    const failed = size.verdict[WIDTH] === "fail";
    const aside: DimensionsAsideLine[] = [
      { text: "Spec", strong: specText(spec) },
      values.length === 0
        ? { text: NOT_STATED }
        : {
            text: readings.statisticLabel,
            strong: statistic === null ? NO_FIGURE : formatNumber(statistic, { decimals }),
            ...(failed ? { tone: "fail" as const } : {}),
          },
    ];
    return {
      size: size.size,
      label: size.label,
      band: bandEdges(spec, axis),
      range: values.length === 0 ? null : { min: Math.min(...values), max: Math.max(...values) },
      statistic,
      aside,
    };
  });
  return {
    title: `${chartName(measureLabel(readings.dimension, WIDTH), "Palm")} (mm) against Size Tolerance`,
    statisticLabel: readings.statisticLabel,
    axis,
    rows,
  };
}

/* ------------------------------------------------------------------ *
 * Median Results by Size
 * ------------------------------------------------------------------ */

function medianResultsOf(readings: DimensionReadings): DimensionsResultsTable | null {
  const measured = readings.sizes.some((size) => readings.measures.some((measure) => readingsOf(size, measure).length > 0));
  if (!measured) return null;
  const { dimension } = readings;
  // Length and width under the statistic, then the thicknesses under theirs, each in the template's order.
  const columns = [
    ...readings.measures
      .filter((measure) => !isThickness(measure))
      .map((measure) => ({ measure, label: measureLabel(dimension, measure), group: "statistic" as const })),
    ...readings.measures
      .filter(isThickness)
      .map((measure) => ({ measure, label: shortLabel(measureLabel(dimension, measure)), group: "thickness" as const })),
  ];
  const byHand = readings.sizes.flatMap((size) =>
    readings.measures.filter((measure) => size.byHand[measure]).map((measure) => `size ${size.label} ${measureLabel(dimension, measure)}`),
  );
  return {
    title: `${readings.statisticLabel} Results by Size`,
    statisticGroup: `${readings.statisticLabel} (mm)`,
    columns,
    rows: readings.sizes.map((size) => ({
      size: size.size,
      label: size.label,
      cells: Object.fromEntries(columns.map(({ measure }) => [measure, statisticFigure(readings, size, measure)])),
      status: size.status,
      byHand: readings.measures.some((measure) => size.byHand[measure]),
    })),
    note: byHand.length > 0 ? `* Set by the inspector: ${andList(byHand)}.` : null,
  };
}

/* ------------------------------------------------------------------ *
 * Weight per Glove (g)
 * ------------------------------------------------------------------ */

/** The sizes weighed: the Dimension step's, else the order's, else those the Weight step holds values for. */
function weightSizes(doc: InspectionExport, weight: ExportModule, readings: DimensionReadings | null): string[] {
  if (readings && readings.sizes.length > 0) return readings.sizes.map((size) => size.size);
  const ordered = orderedSizes(doc);
  if (ordered.length > 0) return ordered;
  return inTemplateOrder(doc, [...new Set([...Object.keys(rec(weight.data.sizes)), ...Object.keys(rec(weight.computed.shown))])]);
}

function weightPerGloveOf(doc: InspectionExport, weight: ExportModule, readings: DimensionReadings | null): DimensionsWeightBars | null {
  const sizes = weightSizes(doc, weight, readings);
  const decimals = num(at(weight.config, "decimals")) ?? 2;
  const rows = sizes.map((size) => {
    const value = num(at(weight.computed, "shown", size)) ?? num(at(weight.computed, "average", size));
    const status = at(weight.computed, "result", size) ?? weight.result.perSize?.[size]?.status;
    return {
      size,
      label: sizeLabel(doc, size),
      value,
      display: value === null ? NO_FIGURE : formatNumber(value, { decimals, unit: "g" }),
      tone: status === "fail" ? ("fail" as const) : status === "warn" ? ("warn" as const) : null,
    };
  });
  const values = rows.flatMap((row) => (row.value === null ? [] : [row.value]));
  if (values.length === 0) return null;
  const specs = sizes.map((size) => asSpec(at(weight.computed, "spec", size)));
  const limits = specs.filter(hasLimit);
  const shared = limits.length === sizes.length && limits.every((spec) => sameSpec(spec, limits[0])) ? limits[0] : null;
  const minimum = shared?.kind === "min" ? shared.min : null;
  return {
    title: "Weight per Glove (g)",
    max: Math.max(...values, minimum ?? 0) * 1.04,
    minimum,
    rows,
    note: weightNote(doc, weight, readings, sizes, specs),
  };
}

/**
 * "Average of 13 gloves per size. For information only; indicative weight
 * for size M is 3.5 g." The gloves are those weighed one by one where the
 * step has them (an inspection saved before 26 October 2026), else those the
 * Dimension step measured, whose sheet the weight is read from. The size the
 * indicative weight is for is named when it is past the threshold.
 */
function weightNote(
  doc: InspectionExport,
  weight: ExportModule,
  readings: DimensionReadings | null,
  sizes: readonly string[],
  specs: readonly (Spec | null)[],
): string {
  const sentences: string[] = [];
  const weighed = [...new Set(sizes.map((size) => num(at(weight.computed, "count", size)) ?? 0))];
  const measured = readings ? [...new Set(readings.sizes.map((size) => size.rows))] : [];
  const gloves = weighed.length === 1 && weighed[0] > 1 ? weighed[0] : measured.length === 1 && measured[0] > 0 ? measured[0] : null;
  sentences.push(gloves === null ? "Average weight per size." : `Average of ${gloves} ${gloves === 1 ? "glove" : "gloves"} per size.`);

  const limits = specs.filter(hasLimit);
  const judged =
    limits.length === 0
      ? "For information only"
      : limits.length === specs.length && limits.every((spec) => sameSpec(spec, limits[0]))
        ? `Spec ${formatSpec(limits[0], { unit: "g" })}`
        : "Judged against each size's spec";
  const indicative = rec(weight.computed.indicative);
  const grams = num(indicative.grams);
  const reference = typeof indicative.size === "string" ? indicative.size : null;
  if (grams === null || reference === null) {
    sentences.push(`${judged}.`);
    return sentences.join(" ");
  }
  const label = sizeLabel(doc, reference);
  sentences.push(`${judged}; indicative weight for size ${label} is ${formatNumber(grams, { unit: "g" })}.`);
  const deviation = num(at(weight.computed, "deviationPct", reference));
  const threshold = num(weight.computed.warnThresholdPct);
  if (deviation !== null && threshold !== null && Math.abs(deviation) > threshold) {
    const percent = (value: number) => formatNumber(value, { unit: "%" });
    sentences.push(`Size ${label} is ${percent(Math.abs(deviation))} ${deviation < 0 ? "below" : "above"} it, past the ${percent(threshold)} threshold.`);
  }
  return sentences.join(" ");
}

/* ------------------------------------------------------------------ *
 * Pages
 * ------------------------------------------------------------------ */

type Parts = Omit<DimensionsSection, "pageCount" | "pages">;

/** The results and the weight side by side: as tall as the taller. */
function resultsHeight({ medianResults, weightPerGlove }: Pick<Parts, "medianResults" | "weightPerGlove">): number {
  const table = medianResults
    ? ROOM.blockHeading +
      ROOM.blockGap +
      ROOM.tableGroups +
      ROOM.tableHeader +
      medianResults.rows.length * ROOM.tableRow +
      (medianResults.note ? ROOM.tableNote : 0)
    : 0;
  const perLine = medianResults ? ROOM.weightNoteCharacters.beside : ROOM.weightNoteCharacters.alone;
  const bars = weightPerGlove
    ? ROOM.blockHeading +
      ROOM.blockGap +
      weightPerGlove.rows.length * ROOM.barRow +
      Math.max(0, weightPerGlove.rows.length - 1) * ROOM.barGap +
      (weightPerGlove.note ? ROOM.weightNoteGap + linesOf(weightPerGlove.note, perLine) * ROOM.weightNoteLine : 0)
    : 0;
  return Math.max(table, bars);
}

type Flow = { block: "gloveLength" | "palmWidth"; frame: number; rows: number[] } | { block: "results"; height: number };

/**
 * The parts page by page. Each part follows the one before while it fits
 * what is left of the page; a part that does not moves to the next page
 * whole, or, where it is taller than a page, runs on there with its
 * remaining sizes. Page 1 starts under the heading and the lead, the pages
 * after it under the heading alone.
 */
function pagesOf(doc: InspectionExport, parts: Parts): DimensionsPage[] {
  const room = contentRoom(doc);
  const chartFrame = ROOM.blockHeading + ROOM.blockGap + ROOM.axis;
  const flows: Flow[] = [];
  if (parts.gloveLength) {
    const { rows, step } = parts.gloveLength;
    flows.push({ block: "gloveLength", frame: chartFrame, rows: rows.map((row) => lengthRowHeight(stackHeight(stackDots(row.values, step)))) });
  }
  if (parts.palmWidth) flows.push({ block: "palmWidth", frame: chartFrame, rows: parts.palmWidth.rows.map(() => ROOM.bandRow) });
  if (parts.medianResults || parts.weightPerGlove) flows.push({ block: "results", height: resultsHeight(parts) });

  const pages: DimensionsPagePart[][] = [[]];
  let used = PAGE_ROOM.heading + (parts.lead ? ROOM.leadGap + linesOf(parts.lead, ROOM.leadCharacters) * ROOM.leadLine : 0);
  const current = () => pages[pages.length - 1];
  const fits = (height: number) => used + ROOM.gap + height <= room;
  const turn = () => {
    pages.push([]);
    used = PAGE_ROOM.heading;
  };

  for (const flow of flows) {
    if (flow.block === "results") {
      if (!fits(flow.height) && current().length > 0) turn();
      current().push({ block: "results" });
      used += ROOM.gap + flow.height;
      continue;
    }
    const whole = flow.frame + flow.rows.reduce((sum, height) => sum + height, 0);
    if (!fits(whole) && current().length > 0 && PAGE_ROOM.heading + ROOM.gap + whole <= room) turn();
    let from = 0;
    while (from < flow.rows.length) {
      let to = from;
      let height = flow.frame;
      while (to < flow.rows.length && fits(height + flow.rows[to])) {
        height += flow.rows[to];
        to += 1;
      }
      if (to === from) {
        if (current().length > 0) {
          turn();
          continue;
        }
        // A row taller than a page: on a page of its own.
        height += flow.rows[to];
        to += 1;
      }
      current().push({ block: flow.block, from, to, continued: from > 0 });
      used += ROOM.gap + height;
      from = to;
      if (from < flow.rows.length) turn();
    }
  }
  return pages.filter((page) => page.length > 0).map((page) => ({ parts: page }));
}
