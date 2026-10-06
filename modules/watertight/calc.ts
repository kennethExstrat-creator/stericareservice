// Per ordered size: the holes found against the AQL plan of the gloves tested
// (BUILD_SPEC 6.1, 7). The code letter, Accept / Reject and the total are
// computed here (6.2 rule 2); the size is accepted at Ac or fewer holes,
// rejected at Re or more, and not done until the gloves tested are entered or
// while the sample is too small for the AQL (6.2 rule 5). With handSplit the
// holes of both hands count against one limit per size.
import { AqlSchema, CODE_LETTERS, decide, formatAql, planFromSampleSize, type Aql, type CodeLetter } from "@/lib/aql";
import type { PerSizeResult } from "@/lib/schemas";
import {
  errorIssue,
  HAND_LABEL,
  HANDS,
  isBlank,
  labelFor,
  perSizeResults,
  resultFromSizes,
  samplingFor,
  sizeLabel,
  warningIssue,
  type CalcInput,
  type CalcIssue,
  type CalcOutput,
  type Hand,
  type InspectionContext,
  type IssuePath,
} from "@/modules/_framework";
import { OTHER_LOCATION, type HoleLocation, type WatertightConfig } from "./config";
import { emptyWatertightHand, emptyWatertightSize, type WatertightData, type WatertightHand, type WatertightSize } from "./schema";

type Labels = CalcInput<WatertightData, WatertightConfig>["labels"];

/** A one-off hole label the inspector added: not in the template's list, flagged for an admin. */
export type UnmappedHole = { label: string; count: number; hand: Hand | null };

export type HandHoles = { holes: Record<string, number>; total: number };

export type WatertightSizeComputed = {
  /** As entered: n for the plan. Null until the inspector enters or confirms it. */
  tested: number | null;
  /** The sampling plan's gloves for watertight and visual, which tested is checked against. */
  planned: number | null;
  /** The sample's code letter; usedLetter is where an arrow led, n its sample size. */
  codeLetter: CodeLetter | null;
  usedLetter: CodeLetter | null;
  n: number | null;
  arrow: "up" | "down" | null;
  accept: number | null;
  reject: number | null;
  /** Holes per location code, both hands: every listed location in the template's order, then codes it lacks. */
  holes: Record<string, number>;
  /** Per hand, with handSplit on. */
  hands: { R: HandHoles; L: HandHoles } | null;
  unmapped: UnmappedHole[];
  /** Every hole counted, both hands, one-offs included: printed as total / tested. */
  totalDefects: number;
  decision: "accept" | "reject" | "incomplete" | null;
  result: "pass" | "fail" | "not_done";
};

export type WatertightComputed = {
  /** The AQL used: the template's, else the client's, else BUILD_SPEC 7's. */
  aql: number;
  /** Locations in the template's order and wording. */
  locations: HoleLocation[];
  /** Code letters of the ordered sizes, as the heading prints them: "J & L". */
  codeLetters: string;
  /** The heading caption with its code letters and AQL filled in. */
  heading: string;
  sizes: Record<string, WatertightSizeComputed>;
};

export function calcWatertight({
  data,
  config,
  labels,
  context,
}: CalcInput<WatertightData, WatertightConfig>): CalcOutput<WatertightComputed> {
  const issues: CalcIssue[] = [];
  const locations = config.locations.map((location) => ({ code: location.code, label: locationLabel(labels, location) }));
  const aql = config.aql ?? context.aql.watertight;
  const plannable = AqlSchema.safeParse(aql);
  if (!plannable.success) {
    issues.push(
      errorIssue(
        "aql_invalid",
        `AQL ${aql} is not in ISO 2859-1 Table 2-A, so no limits can be set: ask an admin to correct the template or the client's AQL.`,
      ),
    );
  }

  const sizes: Record<string, WatertightSizeComputed> = {};
  const lines: string[] = [];
  const perSize = perSizeResults(context.sizes, (size) => {
    const outcome = calcSize({
      size,
      entry: data.sizes[size] ?? emptyWatertightSize(),
      aql: plannable.success ? plannable.data : null,
      split: config.handSplit,
      locations,
      labels,
      context,
    });
    sizes[size] = outcome.computed;
    issues.push(...outcome.issues);
    lines.push(`size ${sizeLabel(context, size)}: ${outcome.line}`);
    return outcome.result;
  });

  const codeLetters = listCodeLetters(Object.values(sizes).map((entry) => entry.codeLetter));
  const heading = fillCaption(labelFor(labels, "heading"), {
    codeLetters,
    aql: plannable.success ? aqlCaption(plannable.data) : String(aql),
  });
  const summary = lines.length === 0 ? "No sizes ordered yet." : `${capitalise(lines.join("; "))}.`;
  return { result: resultFromSizes(perSize, summary), computed: { aql, locations, codeLetters, heading, sizes }, issues };
}

type SizeInput = {
  size: string;
  entry: WatertightSize;
  aql: Aql | null;
  split: boolean;
  locations: readonly HoleLocation[];
  labels: Labels;
  context: InspectionContext;
};

type SizeOutcome = {
  computed: WatertightSizeComputed;
  result: PerSizeResult;
  /** The size's part of the module summary. */
  line: string;
  issues: CalcIssue[];
};

function calcSize({ size, entry, aql, split, locations, labels, context }: SizeInput): SizeOutcome {
  const where = (hand: Hand | null) =>
    `Size ${sizeLabel(context, size)}${hand === null ? "" : `, ${HAND_LABEL[hand].toLowerCase()}`}`;
  const testedLabel = labelFor(labels, "tested");
  const testedPath: IssuePath = ["sizes", size, "tested"];
  const counted = countHoles({ size, entry, split, locations, where });
  const issues = counted.issues;

  const tested = entry.tested;
  const planned = samplingFor(context, size).watertightVisual;
  const computed: WatertightSizeComputed = {
    tested,
    planned,
    codeLetter: null,
    usedLetter: null,
    n: null,
    arrow: null,
    accept: null,
    reject: null,
    holes: counted.holes,
    hands: counted.hands,
    unmapped: counted.unmapped,
    totalDefects: counted.total,
    decision: null,
    result: "not_done",
  };
  const notDone = (summary: string, line: string): SizeOutcome => ({
    computed,
    result: { status: "not_done", summary },
    line: `not done, ${line}`,
    issues,
  });

  if (tested === null) {
    const hint = planned === null ? "" : ` (sampling plan: ${planned})`;
    return notDone(`Missing: ${testedLabel}${hint}.`, `${testedLabel} missing${hint}`);
  }
  if (tested < 2) {
    issues.push(
      errorIssue("tested_too_small", `${where(null)}: ${testedLabel} must be at least 2 for an AQL plan.`, {
        size,
        path: testedPath,
      }),
    );
    return notDone(`${testedLabel} must be at least 2.`, `${testedLabel} below 2`);
  }
  if (planned !== null && tested !== planned) {
    issues.push(
      warningIssue(
        "tested_not_planned",
        `${where(null)}: ${testedLabel} is ${tested}, but the sampling plan has ${planned} gloves for watertight and visual.`,
        { size, path: testedPath },
      ),
    );
  }
  if (counted.total > tested) {
    issues.push(
      warningIssue(
        "holes_exceed_tested",
        `${where(null)}: ${plural(counted.total, "hole")} counted in ${tested} gloves tested. Check the counts.`,
        { size, path: testedPath },
      ),
    );
  }
  if (aql === null) return notDone("No limits: the AQL is not in ISO 2859-1 Table 2-A.", "no limits for this AQL");

  const planning = planFromSampleSize({ sampleSize: tested, aql });
  if (!planning.ok) return notDone(planning.error.message, "no AQL plan");
  const plan = planning.plan;
  for (const warning of plan.warnings) {
    issues.push(warningIssue(warning.code, `${where(null)}: ${warning.message}`, { size, path: testedPath }));
  }

  const decision = decide(counted.total, { ac: plan.ac, re: plan.re, n: plan.n, sampleSize: tested });
  computed.codeLetter = plan.codeLetter;
  computed.usedLetter = plan.usedLetter;
  computed.n = plan.n;
  computed.arrow = plan.arrow;
  computed.accept = plan.ac;
  computed.reject = plan.re;
  computed.decision = decision;

  const found = `${counted.total} / ${tested}${foundList(computed, locations, counted.descriptions)}`;
  if (decision === "incomplete") {
    return notDone(
      `${found}: ${tested} gloves are too few for AQL ${aqlCaption(aql)}, which needs ${plan.n} (Accept ${plan.ac}, Reject ${plan.re}).`,
      `${found}, too few gloves for AQL ${aqlCaption(aql)} (needs ${plan.n})`,
    );
  }
  computed.result = decision === "accept" ? "pass" : "fail";
  const line = `${found}, ${labelFor(labels, "defectLimit")} ${plan.ac} / ${plan.re}: ${decision === "accept" ? "Passed" : "Failed"}`;
  return { computed, result: { status: computed.result, summary: `${line}.` }, line, issues };
}

type Counted = {
  holes: Record<string, number>;
  hands: { R: HandHoles; L: HandHoles } | null;
  unmapped: UnmappedHole[];
  total: number;
  /** Where the "Other :" holes were, as described. */
  descriptions: string[];
  issues: CalcIssue[];
};

/** Adds up the holes of the size (both hands with a split), and flags what an admin or the inspector must look at. */
function countHoles({
  size,
  entry,
  split,
  locations,
  where,
}: {
  size: string;
  entry: WatertightSize;
  split: boolean;
  locations: readonly HoleLocation[];
  where: (hand: Hand | null) => string;
}): Counted {
  const issues = ignoredShape(size, entry, split, where(null));
  const listed = new Set(locations.map((location) => location.code));
  const holes = zeroCounts(locations);
  const hands = split
    ? { R: { holes: zeroCounts(locations), total: 0 }, L: { holes: zeroCounts(locations), total: 0 } }
    : null;
  const unmapped: UnmappedHole[] = [];
  const descriptions: string[] = [];
  let total = 0;

  for (const hand of split ? HANDS : [null]) {
    const record: WatertightHand = hand === null ? entry : (entry[hand] ?? emptyWatertightHand());
    const path: IssuePath = hand === null ? ["sizes", size] : ["sizes", size, hand];
    let handTotal = 0;
    for (const [code, count] of Object.entries(record.holes)) {
      holes[code] = (holes[code] ?? 0) + count;
      if (hands && hand) hands[hand].holes[code] = (hands[hand].holes[code] ?? 0) + count;
      handTotal += count;
      if (!listed.has(code) && count > 0) {
        issues.push(
          warningIssue(
            "hole_location_not_listed",
            `${where(hand)}: ${plural(count, "hole")} counted under "${code}", which this template does not list. They count towards the total; an admin checks the template.`,
            { size, path: [...path, "holes", code] },
          ),
        );
      }
    }
    record.unmapped.forEach((oneOff, index) => {
      if (oneOff.count === 0) return;
      const label = oneOff.label.trim();
      handTotal += oneOff.count;
      unmapped.push({ label, count: oneOff.count, hand });
      issues.push(
        warningIssue(
          "hole_unmapped",
          `${where(hand)}: "${label}" (${oneOff.count}) is not in the template's list of hole locations. It counts towards the total; an admin maps it to a defect code.`,
          { size, path: [...path, "unmapped", index] },
        ),
      );
    });
    const other = record.holes[OTHER_LOCATION] ?? 0;
    if (listed.has(OTHER_LOCATION) && other > 0) {
      if (isBlank(record.otherDescription)) {
        issues.push(
          warningIssue(
            "hole_other_undescribed",
            `${where(hand)}: ${plural(other, "hole")} under "${locationName(locations, OTHER_LOCATION)}" without saying where.`,
            { size, path: [...path, "otherDescription"] },
          ),
        );
      } else {
        descriptions.push((record.otherDescription ?? "").trim());
      }
    }
    if (hands && hand) hands[hand].total = handTotal;
    total += handTotal;
  }
  return { holes, hands, unmapped, total, descriptions, issues };
}

/**
 * Holes saved in the shape the template does not use (per hand without a
 * hand split, or on the size with one) are left out, and said so. A template
 * version is fixed for an inspection, so this follows only an edit by hand.
 */
function ignoredShape(size: string, entry: WatertightSize, split: boolean, where: string): CalcIssue[] {
  if (split) {
    return hasHoles(entry)
      ? [
          warningIssue(
            "hand_split_mismatch",
            `${where}: holes are saved without a hand, but this template records right and left hands apart. They are left out.`,
            { size, path: ["sizes", size, "holes"] },
          ),
        ]
      : [];
  }
  return HANDS.filter((hand) => {
    const record = entry[hand];
    return record !== undefined && hasHoles(record);
  }).map((hand) =>
    warningIssue(
      "hand_split_mismatch",
      `${where}: holes are saved for the ${HAND_LABEL[hand].toLowerCase()}, but this template does not record hands apart. They are left out.`,
      { size, path: ["sizes", size, hand] },
    ),
  );
}

function hasHoles(record: WatertightHand): boolean {
  return Object.values(record.holes).some((count) => count > 0) || record.unmapped.some((oneOff) => oneOff.count > 0);
}

/** A template may reword one location through its labels, keyed by code, without rewriting the list. */
function locationLabel(labels: Labels, location: HoleLocation): string {
  const own = labels[location.code];
  return own !== undefined && own.trim() !== "" ? own : location.label;
}

function locationName(locations: readonly HoleLocation[], code: string): string {
  return locations.find((location) => location.code === code)?.label ?? code;
}

function zeroCounts(locations: readonly HoleLocation[]): Record<string, number> {
  return Object.fromEntries(locations.map((location) => [location.code, 0]));
}

/** "(Finger 1, Glove burst 1)": where the holes were, in the template's wording. */
function foundList(computed: WatertightSizeComputed, locations: readonly HoleLocation[], descriptions: string[]): string {
  const parts: string[] = [];
  for (const [code, count] of Object.entries(computed.holes)) {
    if (count === 0) continue;
    const name = locationName(locations, code).replace(/\s*:\s*$/, "");
    const detail = code === OTHER_LOCATION && descriptions.length > 0 ? `: ${descriptions.join(", ")}` : "";
    parts.push(`${name}${detail} ${count}`);
  }
  for (const hole of computed.unmapped) parts.push(`${hole.label} ${hole.count}`);
  return parts.length === 0 ? "" : ` (${parts.join(", ")})`;
}

/** The distinct code letters, in table order, as the reports' headings print them: "K, L & M". */
export function listCodeLetters(letters: readonly (CodeLetter | null)[]): string {
  const found = CODE_LETTERS.filter((letter) => letters.includes(letter));
  if (found.length === 0) return "–";
  if (found.length === 1) return found[0];
  return `${found.slice(0, -1).join(", ")} & ${found[found.length - 1]}`;
}

/** An AQL as the headings print it: critical as 0.0, the rest as ISO 2859-1 does (1.5, 4.0, 0.65). */
export function aqlCaption(aql: Aql): string {
  return aql === 0 ? "0.0" : formatAql(aql);
}

/** Fills `{name}` placeholders in a caption; an unknown placeholder stays as written. */
export function fillCaption(caption: string, values: Readonly<Record<string, string>>): string {
  return caption.replace(/\{(\w+)\}/g, (match, name: string) => values[name] ?? match);
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

function capitalise(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}
