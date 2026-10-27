// Section 06 of the report, Freedom from Holes & Visual Inspection (the TG35
// design's page 6, Kenneth, 27 October 2026), from the watertight and visual
// modules' computed values: a lead that says what was checked and whether
// every size stayed inside its limits; Defects Found against Acceptance
// Limit, a grid of the sizes against each check (the watertight test and the
// visual classes), each cell the count found over a track that ends at the
// reject number; Pinholes by Location; the critical defects; photos of the
// defects; and the major and minor defects, class by class with their totals
// and limits. Locations, defects and classes are the template's words, the
// rows around them the design's ("Samples Tested", "Total Found", "Total
// Major", "Accept / Reject": Kenneth, 27 October 2026), the check "Freedom
// from Holes"; the limits and results are calc's (modules/watertight/calc.ts,
// modules/visual/calc.ts), never worked out again here. With a hand split
// (surgical gloves) the counts are both hands added together, as calc counts
// them against one limit per size, and the section says so.
//
// The first page follows the design: the grid across the page, then two
// columns, the holes, the critical defects and the photos down the left, the
// major and minor defects down the right. Its columns take all they can
// before anything goes on, the tables before the photos: the visual table
// breaks between its classes where it can (and starts again under its
// class's heading where it cannot), and a class the right column cannot
// hold moves, whole, under the critical defects where it fits, headed by
// its own header row and class heading; photos the left column cannot hold
// go under the visual table once it has ended. What fits in neither column
// (long defect lists, long template labels) follows on the next page; more
// than four sizes stack the parts across the page instead. The pages are
// planned here, from the room each part takes (HOLES_VISUAL_ROOM, the sizes
// components/report/sections/holes-visual.tsx draws at, checked against
// Chrome's drawing and kept just above it), so the page count is known
// before anything is drawn.
import { formatCount } from "@/lib/format";
import { mediaCategory, type MediaCategoryKey } from "@/lib/inspections/source-documents";
import { parseTarget, type PhotoTarget } from "@/lib/photos/target";
import type { ExportModule, ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES } from "@/lib/schemas/report-options";
import { humanize } from "@/lib/zod-form/labels";
import { HAND_LABEL } from "@/modules/_framework/hands";
import type { DefectClass } from "@/modules/visual/schema";
import { OTHER_LOCATION } from "@/modules/watertight/config";
import { andList, aqlText, counted } from "../format";
import type { ReportPlanEntryFor } from "../model";
import { at, isRecord, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import { defineSection } from "./index";

/* ------------------------------------------------------------------ *
 * The content
 * ------------------------------------------------------------------ */

/** A check's verdict for one size: calc's own. */
export type DefectStatus = "pass" | "fail" | "not_done";

/** A column of the grid: the watertight test, or a visual class. */
export type DefectLimitColumn = {
  key: "holes" | DefectClass;
  /** "Freedom from Holes", "Visual: Major": the design's names, the class in the template's words. */
  label: string;
  /** "AQL 1.5"; null when the module gives none. */
  aql: string | null;
};

/** One size against one check: "2 found · accept ≤ 10" over its track. */
export type DefectLimitCell = {
  key: DefectLimitColumn["key"];
  found: number;
  /** calc's Accept and Reject; null until the gloves tested or inspected are entered. */
  accept: number | null;
  reject: number | null;
  status: DefectStatus;
};

export type DefectLimitRow = {
  size: string;
  /** As the template shows it. */
  label: string;
  /** "n = 200", the gloves tested and inspected; "n = 200 / 315" where the checks differ, "n = —" before any is entered. */
  n: string;
  cells: DefectLimitCell[];
};

/** Defects Found against Acceptance Limit, with its legend's words. */
export type DefectLimits = {
  title: string;
  legend: { found: string; reject: string; track: string };
  columns: DefectLimitColumn[];
  rows: DefectLimitRow[];
};

/**
 * A figure in a defect table as it prints: a count, a sample, a limit or a
 * dash, and how it reads (a defect found in bold, a zero in grey, a total
 * over its limit and a critical defect in red).
 */
export type DefectValue = { text: string; tone: "plain" | "muted" | "zero" | "found" | "total" | "fail" | "missing" };

export type DefectRow = {
  key: string;
  /** The gloves tested or inspected, a defect or location, a class's heading, its total, its Accept / Reject. */
  kind: "samples" | "defect" | "group" | "total" | "limits";
  /** A defect, location or class in the template's words ("Palm", "Major"); the rows around them in the design's ("Samples Tested"). */
  label: string;
  /** Under a one-off's label: the template's "Defect Not in the List". */
  note?: string;
  /** A class heading's AQL: "AQL 2.5". */
  detail?: string;
  /** A class heading repeated at the top of the column the class continues in. */
  continued?: boolean;
  /** One per size, in the sizes' order; none for a class heading. */
  values: DefectValue[];
};

export type DefectTable = {
  key: "pinholes" | "critical" | "visual";
  /** "Pinholes by Location", "Visual: Critical Defects". */
  title: string;
  /** Beside the title: "Right and left hands together" for a hand split. */
  aside: string | null;
  /** The first column's header: "Location", "AQL 0.0 · Accept 0", "Defect". */
  firstHeader: string;
  rows: DefectRow[];
};

export type DefectPhoto = { id: string; url: string; caption: string | null };

/**
 * A table's or the photos' part on a page: a table's widths in percent of its
 * column, and whether its heading prints (not over a class moved under the
 * left column's tables, which its own header row and class heading head);
 * the photos' heading where they open a column.
 */
export type HolesVisualSlot =
  | { kind: "table"; table: DefectTable; continued: boolean; heading: boolean; widths: { label: number; value: number } }
  | { kind: "photos"; title: string | null; photos: DefectPhoto[]; columns: 2 | 4 };

/** One page of the section: two columns under the grid (the design), or one across the page (more than four sizes). */
export type HolesVisualPage = { layout: "columns" | "stack"; columns: HolesVisualSlot[][] };

export type HolesVisualContent = {
  /** "Watertight and visual checks on the same 840 gloves. Every size stayed inside its acceptance limit." */
  lead: string;
  /** The sizes on the order, as the template shows them: the tables' columns and the grid's rows. */
  sizes: { size: string; label: string }[];
  /** Null while switched off, or with neither check to show. */
  limits: DefectLimits | null;
  /** Each table whole, null while switched off or not in the inspection; the pages hold their parts. */
  tables: { pinholes: DefectTable | null; critical: DefectTable | null; visual: DefectTable | null };
  /** The defect photos, at most DEFECT_PHOTOS_MAX (a page short of room prints the first two); none while switched off. */
  photos: DefectPhoto[];
  pages: HolesVisualPage[];
};

/* ------------------------------------------------------------------ *
 * Building it
 * ------------------------------------------------------------------ */

/** Media's Product Defects (Source Documents): its photos are defect photos wherever they were taken. */
const PRODUCT_DEFECTS: MediaCategoryKey = "media_defects";

/** The visual classes in the design's order: the grid's columns, the tables. */
const CLASS_ORDER: readonly DefectClass[] = ["major", "minor", "critical"];
const CLASS_WORD: Readonly<Record<DefectClass, string>> = { critical: "Critical", major: "Major", minor: "Minor" };

/** The design's names: the watertight check, a visual check ("Visual: Major"), the rows around the defects (TG35 page 6). */
const HOLES = "Freedom from Holes";
const VISUAL = "Visual";
const WORDS = { tested: "Samples Tested", inspected: "Samples Inspected", found: "Total Found", limits: "Accept / Reject" } as const;
const HANDS_TOGETHER = "Right and left hands together";
const DASH = "—";

/** Defect photos the section prints at most: two rows of two. */
export const DEFECT_PHOTOS_MAX = 4;

export const holesVisual = defineSection({ key: "holesVisual", build: buildHolesVisual });

function buildHolesVisual(doc: InspectionExport, entry: ReportPlanEntryFor<"holesVisual">): (HolesVisualContent & { pageCount: number }) | null {
  const sizes = orderedSizes(doc);
  const holes = moduleOf(doc, "watertight");
  const visual = moduleOf(doc, "visual");
  if (sizes.length === 0 || (!holes && !visual)) return null;
  const on = (key: (typeof entry.blocks)[number]["key"]) => entry.blocks.some((block) => block.key === key);

  const reading = readChecks(doc, sizes, holes, visual);
  const content: Omit<HolesVisualContent, "pages"> = {
    lead: leadOf(doc, reading),
    sizes: sizes.map((size, index) => ({ size, label: reading.sizeLabels[index] })),
    limits: on("defectsAgainstLimit") && reading.columns.length > 0 ? limitsOf(reading) : null,
    tables: {
      pinholes: on("pinholesByLocation") && holes ? pinholesTable(holes, reading) : null,
      critical: on("visualCritical") && visual ? criticalTable(visual, reading) : null,
      visual: on("visualMajorMinor") && visual ? visualTable(visual, reading) : null,
    },
    photos: on("defectPhotos") ? defectPhotos(doc, holes, visual) : [],
  };
  const pages = planPages(doc, entry, content);
  return { ...content, pages, pageCount: pages.length };
}

/* ------------------------------------------------------------------ *
 * Reading the modules
 * ------------------------------------------------------------------ */

/** One size of one check, as calc computed it. */
type SizeCounts = {
  /** The gloves tested (watertight) or inspected (a visual class). */
  n: number | null;
  accept: number | null;
  reject: number | null;
  /** Per code, both hands. */
  counts: Record<string, number>;
  /** Defects not in the template's list, in the inspector's words, both hands. */
  oneOffs: { label: string; count: number }[];
  total: number;
  status: DefectStatus;
};

type Check = {
  key: DefectLimitColumn["key"];
  label: string;
  aql: number | null;
  /** The template's list: the hole locations, or a class's defects. */
  list: { code: string; label: string }[];
  /** Per size on the order; null where calc has nothing for it. */
  sizes: (SizeCounts | null)[];
};

type Reading = {
  sizes: readonly string[];
  sizeLabels: string[];
  holes: Check | null;
  /** The visual classes switched on, in the design's order (major, minor, critical). */
  classes: Check[];
  /** The grid's columns: the holes, then the classes. */
  columns: Check[];
  handSplit: boolean;
};

function readChecks(doc: InspectionExport, sizes: readonly string[], holes: ExportModule | null, visual: ExportModule | null): Reading {
  const holesCheck = holes ? holesOf(holes, sizes) : null;
  const classes = visual ? classesOf(visual, sizes) : [];
  return {
    sizes,
    sizeLabels: sizes.map((size) => sizeLabel(doc, size)),
    holes: holesCheck,
    classes,
    columns: [...(holesCheck ? [holesCheck] : []), ...classes],
    handSplit: splitsHands(holes) || splitsHands(visual),
  };
}

function splitsHands(module: ExportModule | null): boolean {
  return rec(module?.config).handSplit === true;
}

function holesOf(module: ExportModule, sizes: readonly string[]): Check {
  const config = rec(module.config);
  return {
    key: "holes",
    label: HOLES,
    aql: num(module.computed.aql) ?? num(config.aql),
    list: entriesOf(module.computed.locations ?? config.locations),
    sizes: sizes.map((size) => {
      const entry = at(module.computed, "sizes", size);
      return isRecord(entry) ? sizeCounts(entry, entry.tested, entry.holes, entry.totalDefects) : null;
    }),
  };
}

function classesOf(module: ExportModule, sizes: readonly string[]): Check[] {
  return CLASS_ORDER.flatMap((cls): Check[] => {
    const info = rec(at(module.computed, "classes", cls));
    const config = rec(at(module.config, "classes", cls));
    if (Object.keys(info).length === 0 && Object.keys(config).length === 0) return [];
    if ((info.include ?? config.include) === false) return [];
    return [
      {
        key: cls,
        label: `${VISUAL}: ${classWord(module, cls)}`,
        aql: num(info.aql) ?? num(config.aql) ?? (cls === "critical" ? 0 : null),
        list: entriesOf(info.defects ?? config.defects),
        sizes: sizes.map((size) => {
          const entry = at(module.computed, "sizes", size, cls);
          return isRecord(entry) ? sizeCounts(entry, entry.inspected, entry.counts, entry.total) : null;
        }),
      },
    ];
  });
}

function sizeCounts(entry: Record<string, unknown>, n: unknown, counts: unknown, total: unknown): SizeCounts {
  return {
    n: num(n),
    accept: num(entry.accept),
    reject: num(entry.reject),
    counts: Object.fromEntries(
      Object.entries(rec(counts)).flatMap(([code, value]): [string, number][] => {
        const known = num(value);
        return known === null ? [] : [[code, known]];
      }),
    ),
    oneOffs: list(entry.unmapped).flatMap((item) => {
      const label = text(rec(item).label);
      const found = num(rec(item).count);
      return label && found ? [{ label, count: found }] : [];
    }),
    total: num(total) ?? 0,
    status: entry.result === "pass" || entry.result === "fail" ? entry.result : "not_done",
  };
}

function entriesOf(value: unknown): { code: string; label: string }[] {
  return list(value).flatMap((item) => {
    const code = text(rec(item).code);
    return code ? [{ code, label: text(rec(item).label) ?? humanize(code) }] : [];
  });
}

/** The class's name as the template words it: "Critical Defects". */
function className(module: ExportModule, cls: DefectClass): string {
  return labelOf(module, `${cls}Counts`, `${CLASS_WORD[cls]} Defects`);
}

/** The class in the template's words, its "Defects" left to the heading: "Major Defects" as "Major". */
function classWord(module: ExportModule, cls: DefectClass): string {
  return className(module, cls).replace(/\s+defects?$/i, "").trim() || CLASS_WORD[cls];
}

/** Nothing entered for the size yet, no gloves and nothing counted: its figures print as dashes, not zeros. */
function isBlank(entry: SizeCounts): boolean {
  return entry.n === null && entry.total === 0;
}

/* ------------------------------------------------------------------ *
 * The lead
 * ------------------------------------------------------------------ */

/**
 * What was checked and how it went: "Watertight and visual checks on the
 * same 840 gloves. Every size stayed inside its acceptance limit.", the
 * sizes that failed and which checks, or what is not done yet.
 */
function leadOf(doc: InspectionExport, reading: Reading): string {
  const [one, many] = doc.template.unit === "pairs" ? ["pair", "pairs"] : ["glove", "gloves"];
  const gloves = (value: number) => counted(value, one, many);
  const holesN = reading.holes?.sizes.map((entry) => entry?.n ?? null) ?? null;
  const visualN = reading.classes.length > 0 ? reading.sizes.map((_, index) => reading.classes.map((check) => check.sizes[index]?.n ?? null).find((n) => n !== null) ?? null) : null;
  const holesTotal = sumOf(holesN);
  const visualTotal = sumOf(visualN);
  const same = holesN !== null && visualN !== null && holesN.every((n, index) => n !== null && n === visualN[index]);

  let checked: string | null = null;
  if (same && holesTotal !== null) checked = `Watertight and visual checks on the same ${gloves(holesTotal)}`;
  else if (holesTotal !== null && visualTotal !== null) checked = `Watertight test on ${gloves(holesTotal)} and visual inspection on ${gloves(visualTotal)}`;
  else if (holesTotal !== null) checked = `Watertight test on ${gloves(holesTotal)}`;
  else if (visualTotal !== null) checked = `Visual inspection on ${gloves(visualTotal)}`;
  const sentences = checked ? [`${checked}${reading.handSplit ? ", right and left hands counted together" : ""}.`] : [];
  if (reading.columns.length === 0) return sentences.join(" ");

  // Each size's checks that failed, by their names; the sizes with a check not done.
  const failed = new Map<number, string[]>();
  const notDone: number[] = [];
  reading.sizes.forEach((_, index) => {
    const fails = reading.columns.filter((check) => check.sizes[index]?.status === "fail").map((check) => check.label);
    if (fails.length > 0) failed.set(index, fails);
    else if (reading.columns.some((check) => (check.sizes[index]?.status ?? "not_done") === "not_done")) notDone.push(index);
  });
  const recorded = reading.columns.some((check) => check.sizes.some((entry) => entry !== null && (entry.n !== null || entry.total > 0)));
  const sizesNamed = (indexes: readonly number[]) => `${indexes.length === 1 ? "size" : "sizes"} ${andList(indexes.map((index) => reading.sizeLabels[index]))}`;

  if (failed.size === 0 && notDone.length === 0) {
    sentences.push(reading.sizes.length === 1 ? `Size ${reading.sizeLabels[0]} stayed inside every acceptance limit.` : "Every size stayed inside its acceptance limit.");
  } else if (failed.size === 0 && !recorded) {
    sentences.push("No results are recorded yet.");
  } else {
    if (failed.size > 0) {
      // Sizes that failed the same checks are named together: "Sizes S and L failed Visual: Critical; size M failed …".
      const bySet = new Map<string, { checks: string[]; indexes: number[] }>();
      for (const [index, checks] of failed) {
        const key = checks.join("\n");
        bySet.set(key, { checks, indexes: [...(bySet.get(key)?.indexes ?? []), index] });
      }
      sentences.push(`${capitalised([...bySet.values()].map(({ checks, indexes }) => `${sizesNamed(indexes)} failed ${andList(checks)}`).join("; "))}.`);
    } else {
      sentences.push("No size has gone over an acceptance limit so far.");
    }
    if (notDone.length > 0) sentences.push(`${capitalised(sizesNamed(notDone))} ${notDone.length === 1 ? "is" : "are"} not done yet.`);
  }
  return sentences.join(" ");
}

function sumOf(values: readonly (number | null)[] | null): number | null {
  const known = (values ?? []).filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((total, value) => total + value, 0);
}

function capitalised(words: string): string {
  return `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
}

/* ------------------------------------------------------------------ *
 * Defects Found against Acceptance Limit
 * ------------------------------------------------------------------ */

const LIMITS_TITLE = "Defects Found against Acceptance Limit";
const LIMITS_LEGEND = { found: "Found", reject: "Reject point", track: "Track ends at reject number" } as const;

function limitsOf(reading: Reading): DefectLimits {
  return {
    title: LIMITS_TITLE,
    legend: { ...LIMITS_LEGEND },
    columns: reading.columns.map((check) => ({ key: check.key, label: check.label, aql: check.aql === null ? null : aqlText(check.aql) })),
    rows: reading.sizes.map((size, index) => {
      const ns = [...new Set(reading.columns.map((check) => check.sizes[index]?.n ?? null).filter((n): n is number => n !== null))];
      return {
        size,
        label: reading.sizeLabels[index],
        n: `n = ${ns.length === 0 ? DASH : ns.map((n) => formatCount(n)).join(" / ")}`,
        cells: reading.columns.map((check) => {
          const entry = check.sizes[index];
          return { key: check.key, found: entry?.total ?? 0, accept: entry?.accept ?? null, reject: entry?.reject ?? null, status: entry?.status ?? "not_done" };
        }),
      };
    }),
  };
}

/* ------------------------------------------------------------------ *
 * The tables
 * ------------------------------------------------------------------ */

const MISSING: DefectValue = { text: DASH, tone: "missing" };

function countValue(value: number, failing: boolean): DefectValue {
  return { text: formatCount(value), tone: value === 0 ? "zero" : failing ? "fail" : "found" };
}

/** The gloves tested or inspected per size. */
function samplesRow(key: string, label: string, check: Check): DefectRow {
  return {
    key,
    kind: "samples",
    label,
    values: check.sizes.map((entry) => (entry?.n === null || entry?.n === undefined ? MISSING : { text: formatCount(entry.n), tone: "plain" })),
  };
}

/**
 * A list's rows: each entry of the template's list in its order, then codes
 * counted that it does not list, then the one-off defects ("not in the
 * list") in the inspector's words, the sizes that saved the same words
 * added up. `critical` reads any count as failing.
 */
function defectRows(
  check: Check,
  prefix: string,
  oneOffNote: string,
  { critical = false, rename }: { critical?: boolean; rename?: (code: string, label: string) => string } = {},
): DefectRow[] {
  const listed = new Set(check.list.map((entry) => entry.code));
  const unlisted = [...new Set(check.sizes.flatMap((entry) => Object.entries(entry?.counts ?? {}).flatMap(([code, value]) => (!listed.has(code) && value > 0 ? [code] : []))))];
  const oneOffs = new Map<string, string>();
  for (const entry of check.sizes) for (const oneOff of entry?.oneOffs ?? []) if (!oneOffs.has(oneOff.label.toLowerCase())) oneOffs.set(oneOff.label.toLowerCase(), oneOff.label);
  const values = (pick: (entry: SizeCounts) => number) => check.sizes.map((entry) => (!entry || isBlank(entry) ? MISSING : countValue(pick(entry), critical)));
  const codeRow = (code: string, label: string): DefectRow => ({ key: `${prefix}:${code}`, kind: "defect", label, values: values((entry) => entry.counts[code] ?? 0) });
  return [
    ...check.list.map(({ code, label }) => codeRow(code, rename ? rename(code, label) : label)),
    ...unlisted.map((code) => codeRow(code, humanize(code))),
    ...[...oneOffs.entries()].map(
      ([key, label]): DefectRow => ({
        key: `${prefix}:one-off:${key}`,
        kind: "defect",
        label,
        note: oneOffNote,
        values: values((entry) => entry.oneOffs.reduce((total, oneOff) => total + (oneOff.label.toLowerCase() === key ? oneOff.count : 0), 0)),
      }),
    ),
  ];
}

/** A total per size, in red where the size failed the check. */
function totalRow(key: string, label: string, check: Check): DefectRow {
  return {
    key,
    kind: "total",
    label,
    values: check.sizes.map((entry) => (!entry || isBlank(entry) ? MISSING : { text: formatCount(entry.total), tone: entry.status === "fail" ? "fail" : "total" })),
  };
}

/** "Accept / Reject", and calc's limits per size: "10 / 11". */
function limitsRow(key: string, check: Check): DefectRow {
  return {
    key,
    kind: "limits",
    label: WORDS.limits,
    values: check.sizes.map((entry) => (entry && entry.accept !== null && entry.reject !== null ? { text: `${entry.accept} / ${entry.reject}`, tone: "muted" } : MISSING)),
  };
}

function pinholesTable(module: ExportModule, reading: Reading): DefectTable | null {
  const check = reading.holes;
  if (!check) return null;
  const descriptions = otherDescriptions(module, reading.sizes);
  return {
    key: "pinholes",
    title: "Pinholes by Location",
    aside: splitsHands(module) ? HANDS_TOGETHER : null,
    firstHeader: "Location",
    rows: [
      samplesRow("pinholes:tested", WORDS.tested, check),
      ...defectRows(check, "pinholes", labelOf(module, "unmapped", "Defect Not in the List"), {
        // "Other :" says where its holes were, as the reports print it ("Other : Glove Burst"); with nothing said, "Other".
        rename: (code, label) => (code !== OTHER_LOCATION ? label : descriptions.length > 0 ? `${label.trimEnd()} ${descriptions.join(", ")}` : label.replace(/\s*:\s*$/, "")),
      }),
      totalRow("pinholes:total", WORDS.found, check),
      limitsRow("pinholes:limits", check),
    ],
  };
}

/** Where the holes under "Other :" were, as the inspector described them: each once, in size order. */
function otherDescriptions(module: ExportModule, sizes: readonly string[]): string[] {
  const seen = new Map<string, string>();
  for (const size of sizes) {
    const computed = rec(at(module.computed, "sizes", size));
    const data = rec(at(module.data, "sizes", size));
    const places = isRecord(computed.hands)
      ? (["R", "L"] as const).map((hand) => ({ holes: num(at(computed.hands, hand, "holes", OTHER_LOCATION)), words: text(at(data, hand, "otherDescription")) }))
      : [{ holes: num(at(computed, "holes", OTHER_LOCATION)), words: text(data.otherDescription) }];
    for (const { holes, words } of places) if (holes && words && !seen.has(words.toLowerCase())) seen.set(words.toLowerCase(), words);
  }
  return [...seen.values()];
}

function criticalTable(module: ExportModule, reading: Reading): DefectTable | null {
  const check = reading.classes.find((entry) => entry.key === "critical");
  if (!check) return null;
  return {
    key: "critical",
    title: `${VISUAL}: ${className(module, "critical")}`,
    aside: splitsHands(module) ? HANDS_TOGETHER : null,
    // Critical defects are AQL 0: none may be found.
    firstHeader: `${aqlText(check.aql ?? 0)} · ${labelOf(module, "accept", "Accept")} 0`,
    rows: [
      ...defectRows(check, "critical", labelOf(module, "unmapped", "Defect Not in the List"), { critical: true }),
      totalRow("critical:total", `Total ${classWord(module, "critical")}`, check),
    ],
  };
}

/**
 * The major and minor defects ("Visual: Major & Minor Defects"; a class
 * alone when the template switches the other off): the gloves inspected,
 * then each class under its heading ("Major · AQL 2.5") with its defects,
 * its total and its limits.
 */
function visualTable(module: ExportModule, reading: Reading): DefectTable | null {
  const checks = reading.classes.filter((check) => check.key === "major" || check.key === "minor");
  if (checks.length === 0) return null;
  const note = labelOf(module, "unmapped", "Defect Not in the List");
  const words = checks.map((check) => classWord(module, check.key as DefectClass));
  return {
    key: "visual",
    title: checks.length > 1 ? `${VISUAL}: ${words.join(" & ")} Defects` : `${VISUAL}: ${className(module, checks[0].key as DefectClass)}`,
    aside: splitsHands(module) ? HANDS_TOGETHER : null,
    firstHeader: "Defect",
    rows: [
      samplesRow("visual:inspected", WORDS.inspected, checks[0]),
      ...checks.flatMap((check, index): DefectRow[] => {
        const cls = check.key as DefectClass;
        return [
          { key: `${cls}:group`, kind: "group", label: words[index], ...(check.aql === null ? {} : { detail: aqlText(check.aql) }), values: [] },
          ...defectRows(check, cls, note),
          totalRow(`${cls}:total`, `Total ${words[index]}`, check),
          limitsRow(`${cls}:limits`, check),
        ];
      }),
    ],
  };
}

/* ------------------------------------------------------------------ *
 * The defect photos
 * ------------------------------------------------------------------ */

/**
 * Photos of the defects: those taken in the watertight test or the visual
 * inspection tagged with a defect, and those in Media's Product Defects,
 * holes, visual defects and product defects taking turns, each kind in the
 * order taken. As for the photo records (photoGroupsOf, lib/report/model.ts),
 * once an admin has marked photos In Report only those print, and a flagged
 * original (a HEIC the browser could not convert) never does. Each is
 * captioned by the inspector's own caption, else by its tags in the
 * template's words: "Pin Hole: Palm · Size M".
 */
function defectPhotos(doc: InspectionExport, holes: ExportModule | null, visual: ExportModule | null): DefectPhoto[] {
  const usable = doc.photos.filter((photo) => !photo.flagged);
  const chosen = usable.some((photo) => photo.includeInReport) ? usable.filter((photo) => photo.includeInReport) : usable;
  const kinds: Tagged[][] = [[], [], []];
  for (const photo of chosen) {
    const parsed = parseTarget(photo.target);
    const target = parsed.ok ? parsed.target : {};
    if (photo.moduleKey === "watertight" && holes && target.defect) kinds[0].push({ photo, target, module: holes, lists: [holes] });
    else if (photo.moduleKey === "visual" && visual && target.defect) kinds[1].push({ photo, target, module: visual, lists: [visual] });
    else if (photo.moduleKey === PRODUCT_DEFECTS) kinds[2].push({ photo, target, module: null, lists: [holes, visual].filter((entry): entry is ExportModule => entry !== null) });
  }
  const queues = kinds.map((entries) =>
    entries
      .map((entry, index) => ({ entry, index }))
      .sort((a, b) => (a.entry.photo.takenAt ?? "~").localeCompare(b.entry.photo.takenAt ?? "~") || a.index - b.index)
      .map(({ entry }) => entry),
  );
  const picked: DefectPhoto[] = [];
  for (let round = 0; picked.length < DEFECT_PHOTOS_MAX && queues.some((queue) => round < queue.length); round += 1) {
    for (const queue of queues) {
      const entry = queue[round];
      if (entry && picked.length < DEFECT_PHOTOS_MAX) picked.push({ id: entry.photo.id, url: entry.photo.url, caption: captionOf(doc, entry) });
    }
  }
  return picked;
}

/** A defect photo: its tags, the module it was taken in (none for Product Defects), and the modules whose lists name its defect. */
type Tagged = { photo: ExportPhoto; target: PhotoTarget; module: ExportModule | null; lists: ExportModule[] };

function captionOf(doc: InspectionExport, { photo, target, module, lists }: Tagged): string | null {
  const own = text(photo.caption);
  if (own) return own;
  const defect = target.defect ? defectName(lists, target.defect) : null;
  const what = module?.key === "watertight" ? `${labelOf(module, "holes", "Pin Hole")}: ${defect}` : (defect ?? mediaCategory(PRODUCT_DEFECTS)?.title ?? null);
  const parts = [what, target.size ? `Size ${sizeLabel(doc, target.size)}` : null, target.hand ? HAND_LABEL[target.hand] : null];
  const words = parts.filter((part): part is string => part !== null);
  return words.length > 0 ? words.join(" · ") : null;
}

/** A tagged defect in the template's words (a hole location, a visual defect); a one-off as typed, a code no list names in words. */
function defectName(modules: readonly ExportModule[], defect: string): string {
  const lists = modules.flatMap((module) =>
    module.key === "watertight"
      ? [module.computed.locations ?? rec(module.config).locations]
      : CLASS_ORDER.map((cls) => at(module.computed, "classes", cls, "defects") ?? at(module.config, "classes", cls, "defects")),
  );
  const found = lists.flatMap((entries) => entriesOf(entries)).find((entry) => entry.code === defect);
  if (found) return found.label.replace(/\s*:\s*$/, "");
  return /^[a-z][a-z0-9_]*$/.test(defect) ? humanize(defect) : defect;
}

/* ------------------------------------------------------------------ *
 * The room each part takes
 *
 * Heights in millimetres, from the sizes the section's components draw
 * each part at (components/report/sections/holes-visual.tsx and the
 * primitives it uses): a page's room is the paper less its header band and
 * footer. Text is measured by Outfit's own character widths with a margin,
 * so a line estimated to fit does, and a few millimetres stay free at each
 * page's foot: a part that might not fit moves on, never cut off.
 * ------------------------------------------------------------------ */

const MM_PER_PT = 25.4 / 72;

export const HOLES_VISUAL_ROOM = {
  /** The header band and the footer with the content's padding (components/report/report-page.tsx): 56.6 mm as Chrome draws them, 1 mm over. */
  chrome: 57.6,
  /** A line of the footer note (7.5 pt, two at most), and about as many characters as it holds. */
  footerNoteLine: 3.7,
  footerNoteCharacters: 100,
  /** Kept free at the foot of every page, for what the estimates miss. */
  safety: 3,
  /** Between the page's parts (the heading, the grid, the columns), and between the parts of a column (the design's 4 mm between its tables). */
  gap: 5,
  partGap: 4,
  /** Between the two columns, the left one 84 parts of 177 and the right 93 (the design's 84 and 93 mm). */
  columnGap: 7,
  leftShare: 84 / 177,
  /** The heading: the kicker (8.5 pt × 1.3), the gaps, a line of the title (21 pt × 1.15), a line of the lead (9.5 pt × 1.5, 175 mm at most). */
  kicker: 3.9,
  headingGap: 1.6,
  titleLine: 8.52,
  leadLine: 5.03,
  leadWidth: 175,
  /**
   * A block's heading (12 pt × 1.25: 5.3 mm as Chrome draws it), another
   * line of it, and a line of its aside (8.5 pt × 1.4) wrapped under it;
   * then the design's 1 mm to its table.
   */
  blockHeading: 5.4,
  blockTitleLine: 5.29,
  blockAsideLine: 4.2,
  /** An aside beside the title sits on its baseline, and its line reaches lower: 5.5 mm in all as drawn. */
  asideBeside: 0.2,
  /** The grid's legend (7.5 pt × 1.3) wrapped under its title. */
  legendWrap: 1 + 3.44,
  tableGap: 1,
  gridGap: 2.4,
  /**
   * The grid: a line of a check's name (9.5 pt × 1.3), then its AQL (8.5 pt ×
   * 1.4), padding and rule (10.4 mm in all as Chrome draws them); a size's
   * row with its hairline (Kenneth, 27 October 2026: about 11 mm).
   */
  gridLabelLine: 4.36,
  gridHeaderRest: 6.1,
  gridRow: 11,
  /** The grid's size column and the gap between its columns. */
  gridSizeColumn: 17,
  gridColumnGap: 4.6,
  /**
   * A table: the header row's padding and rule and a line of it (8.5 pt ×
   * 1.4; 6.5 mm as Chrome draws a row of one line), a line of a cell (9 pt ×
   * 1.2), a row's padding, a class's heading row, a total's rule, a one-off's
   * note (7.5 pt × 1.3; 3.6 mm under its label as drawn).
   */
  tableHeaderPad: 2.4,
  tableHeaderLine: 4.2,
  tableLine: 3.81,
  rowPad: 1,
  groupRow: 1.4 + 3.81 + 0.5 + 0.3,
  totalRule: 0.3,
  noteLine: 3.6,
  /** A cell's padding either side. */
  cellPad: 1.6,
  /** A size's column: its share of what a 40 mm label leaves, 10.5 to 15 mm, and as wide as its widest figure ("14 / 15") with 2 mm to spare, while the label keeps 26 mm. */
  labelMin: 40,
  labelFloor: 26,
  valueMin: 10.5,
  valueMax: 15,
  figureGap: 2,
  /** Photos (4:3): the gap between tiles and between rows, a caption's gap (0.1 mm over) and lines (8.5 pt × 1.4). */
  photoGap: 3,
  photoRowGap: 2.4,
  captionGap: 1.5,
  captionLine: 4.2,
} as const;

const ROOM = HOLES_VISUAL_ROOM;

/**
 * Outfit's advance widths in hundredths of an em for the characters " " to
 * "~", as Chrome draws them (the print route prints from Chrome): regular,
 * and semibold for every heavier weight. Figures are tabular. Other
 * characters take their own width, or a wide letter's.
 */
const OUTFIT_WIDTHS = {
  regular:
    "21 26 40 64 59 66 66 24 30 30 49 54 27 46 29 39 59 59 59 59 59 59 59 59 59 59 27 27 54 54 54 51 75 66 62 66 74 59 57 78 71 26 45 65 55 84 71 80 60 82 62 54 58 68 66 96 65 63 56 34 39 34 45 50 28 58 58 48 58 54 33 58 55 22 29 50 22 86 55 57 58 58 40 43 33 52 49 73 48 50 45 32 28 32 54",
  bold: "20 27 44 65 59 67 68 25 30 30 49 56 28 46 29 39 59 59 59 59 59 59 59 59 59 59 28 27 56 56 56 50 75 68 63 66 75 60 58 79 72 28 47 67 56 85 73 81 61 82 63 55 60 70 67 97 67 64 57 34 39 34 46 49 31 59 59 48 59 54 35 58 56 25 31 53 25 87 56 57 59 59 42 44 34 53 51 75 50 51 47 33 29 33 56",
} as const;
type Weight = keyof typeof OUTFIT_WIDTHS;
const ADVANCES: Readonly<Record<Weight, readonly number[]>> = {
  regular: OUTFIT_WIDTHS.regular.split(" ").map(Number),
  bold: OUTFIT_WIDTHS.bold.split(" ").map(Number),
};
const OTHER_ADVANCES: Readonly<Record<string, number>> = { "·": 16, "≤": 55, "—": 86, "–": 56, "×": 56 };
/** Over the characters' sum: for kerning and rounding it leaves out, so a line estimated to fit does. */
const WIDTH_MARGIN = 1.04;

function advance(character: string, weight: Weight): number {
  const code = character.charCodeAt(0);
  return (code >= 32 && code < 127 ? ADVANCES[weight][code - 32] : (OTHER_ADVANCES[character] ?? 80)) / 100;
}

function textWidth(words: string, pt: number, weight: Weight = "regular"): number {
  let em = 0;
  for (const character of words) em += advance(character, weight);
  return em * pt * MM_PER_PT * WIDTH_MARGIN;
}

/** The lines a text wraps to in a box `width` mm wide, word by word; a word longer than a line breaks inside it. */
export function lineCount(words: string, width: number, pt: number, weight: Weight = "regular"): number {
  const parts = words.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0 || !(width > 0)) return 1;
  const space = textWidth(" ", pt, weight);
  let lines = 1;
  let used = 0;
  for (const part of parts) {
    const size = textWidth(part, pt, weight);
    if (used > 0 && used + space + size <= width) {
      used += space + size;
      continue;
    }
    if (used > 0) lines += 1;
    const extra = Math.max(0, Math.ceil(size / width) - 1);
    lines += extra;
    used = size - extra * width;
  }
  return lines;
}

/** A table's label column and each size's column, in mm, in a column `width` mm wide; `rows` are the whole table's, so its pieces line up. */
function tableWidths(width: number, sizes: number, rows: readonly DefectRow[]): { label: number; value: number } {
  const count = Math.max(1, sizes);
  const bold = (value: DefectValue) => value.tone === "found" || value.tone === "total" || value.tone === "fail";
  const figures = rows.flatMap((row) => row.values.map((value) => textWidth(value.text, 9, bold(value) ? "bold" : "regular")));
  // Right-aligned, a figure may use its cell's padding: 2 mm keep it clear of the next.
  const need = Math.max(0, ...figures) + ROOM.figureGap;
  const share = Math.min(ROOM.valueMax, Math.max(ROOM.valueMin, (width - ROOM.labelMin) / count));
  const value = Math.min(Math.max(share, need), (width - ROOM.labelFloor) / count);
  return { label: width - value * count, value };
}

/** A block's heading, its aside beside the title while both fit the line. */
function blockHeadingHeight(title: string, aside: string | null, width: number): number {
  const lines = lineCount(title, width, 12, "bold");
  const height = ROOM.blockHeading + (lines - 1) * ROOM.blockTitleLine;
  if (!aside) return height;
  if (lines === 1 && textWidth(title, 12, "bold") + 6 + textWidth(aside, 8.5) <= width) return height + ROOM.asideBeside;
  return height + 1 + lineCount(aside, width, 8.5) * ROOM.blockAsideLine;
}

function rowHeight(row: DefectRow, labelWidth: number): number {
  if (row.kind === "group") return ROOM.groupRow;
  const lines = lineCount(row.label, labelWidth, 9, row.kind === "total" ? "bold" : "regular");
  const note = row.note ? lineCount(row.note, labelWidth, 7.5) * ROOM.noteLine : 0;
  return lines * ROOM.tableLine + ROOM.rowPad + note + (row.kind === "total" ? ROOM.totalRule : 0);
}

/** A table's piece: its heading (unless `headed` is false), its header row and its rows. */
function tableHeight(table: DefectTable, rows: readonly DefectRow[], width: number, sizes: number, continued: boolean, headed = true): number {
  const labelWidth = tableWidths(width, sizes, table.rows).label - 2 * ROOM.cellPad;
  const header = ROOM.tableHeaderPad + lineCount(table.firstHeader, labelWidth, 8.5, "bold") * ROOM.tableHeaderLine;
  const heading = headed ? blockHeadingHeight(table.title, continued ? "Continued" : table.aside, width) + ROOM.tableGap : 0;
  return heading + header + rows.reduce((sum, row) => sum + rowHeight(row, labelWidth), 0);
}

function photosHeight(photos: readonly DefectPhoto[], width: number, columns: number): number {
  const tile = (width - (columns - 1) * ROOM.photoGap) / columns;
  let height = 0;
  for (let start = 0; start < photos.length; start += columns) {
    const captions = photos.slice(start, start + columns).map((photo) => (photo.caption ? ROOM.captionGap + lineCount(photo.caption, tile, 8.5) * ROOM.captionLine : 0));
    height += (start > 0 ? ROOM.photoRowGap : 0) + tile * 0.75 + Math.max(0, ...captions);
  }
  return height;
}

/** The grid, its legend (7.5 pt, each with a 3.6 mm swatch) beside the title while both fit the line. */
function limitsHeight(limits: DefectLimits, width: number): number {
  const words = Object.values(limits.legend);
  const legend = textWidth(words.join(""), 7.5) + words.length * (3.6 + 1.4) + (words.length - 1) * 4;
  const heading = textWidth(limits.title, 12, "bold") + 6 + legend <= width ? ROOM.blockHeading : ROOM.blockHeading + ROOM.legendWrap;
  const slots = Math.max(limits.columns.length, 3);
  const column = (width - ROOM.gridSizeColumn - slots * ROOM.gridColumnGap) / slots;
  const labelLines = Math.max(1, ...limits.columns.map((entry) => lineCount(entry.label, column, 9.5, "bold")));
  return heading + ROOM.gridGap + labelLines * ROOM.gridLabelLine + ROOM.gridHeaderRest + limits.rows.length * ROOM.gridRow;
}

/** The section's heading: with the lead on its first page, without it on the next. */
function headingHeight(title: string, lead: string | null, width: number): number {
  const top = ROOM.kicker + ROOM.headingGap + lineCount(title, width, 21, "bold") * ROOM.titleLine;
  return lead ? top + ROOM.headingGap + lineCount(lead, Math.min(ROOM.leadWidth, width), 9.5) * ROOM.leadLine : top;
}

/* ------------------------------------------------------------------ *
 * The pages
 * ------------------------------------------------------------------ */

/** A table's piece; `headed` false for a class moved under the left column's tables, which prints without the table's heading. */
type TablePart = { kind: "table"; table: DefectTable; rows: DefectRow[]; continued: boolean; keep: boolean; headed: boolean };
/** The photos, headed by `title` where they open a column rather than follow a table. */
type PhotosPart = { kind: "photos"; photos: DefectPhoto[]; title: string };
type Part = TablePart | PhotosPart;

/** A column of a page, with its width and the room it has, in mm. */
type Frame = { page: number; column: number; width: number; room: number };
type Placed = { frame: Frame; slot: HolesVisualSlot };

/** A table as a part: one to `keep` whole moves on rather than split while a frame can hold it. */
function tablePart(table: DefectTable, keep = true): TablePart {
  return { kind: "table", table, rows: table.rows, continued: false, keep, headed: true };
}

/** A part's height in a column `width` mm wide; `opening` the column, photos take their heading. */
function partHeight(part: Part, width: number, sizes: number, photoColumns: 2 | 4, opening: boolean): number {
  if (part.kind === "table") return tableHeight(part.table, part.rows, width, sizes, part.continued, part.headed);
  return (opening ? blockHeadingHeight(part.title, null, width) + ROOM.tableGap : 0) + photosHeight(part.photos, width, photoColumns);
}

function slotOf(part: Part, width: number, sizes: number, photoColumns: 2 | 4, opening: boolean): HolesVisualSlot {
  if (part.kind === "photos") return { kind: "photos", title: opening ? part.title : null, photos: part.photos, columns: photoColumns };
  const widths = tableWidths(width, sizes, part.table.rows);
  const percent = (mm: number) => Math.round((mm / width) * 100000) / 1000;
  return {
    kind: "table",
    table: { ...part.table, rows: part.rows },
    continued: part.continued,
    heading: part.headed,
    widths: { label: percent(widths.label), value: percent(widths.value) },
  };
}

/**
 * The longest head of a table that fits `room`, and the rest. It breaks
 * between two classes where it can, else inside one, and the rest then
 * starts under the class's heading again. A head never ends on a class's
 * heading, never parts a total from its limits, and holds a row besides
 * the gloves inspected; null when none does.
 */
function splitTable(part: TablePart, room: number, width: number, sizes: number): [TablePart, TablePart] | null {
  const { rows } = part;
  const breaksWell = (size: number) => {
    const last = rows[size - 1];
    if (last.kind === "group" || (last.kind === "total" && rows[size]?.kind === "limits")) return false;
    return rows.slice(0, size).some((row) => row.kind !== "group" && row.kind !== "samples");
  };
  let take = 0;
  for (let size = 1; size < rows.length && tableHeight(part.table, rows.slice(0, size), width, sizes, part.continued) <= room; size += 1) take = size;
  while (take > 0 && !breaksWell(take)) take -= 1;
  if (take === 0) return null;
  const between = rows.slice(0, take).findLastIndex((row) => row.kind === "limits") + 1;
  return piecesAt(part, between > 0 && breaksWell(between) ? between : take);
}

/** The table's first `take` rows and the rest, which starts under its class's heading again if it breaks inside a class. */
function piecesAt(part: TablePart, take: number): [TablePart, TablePart] {
  const head = part.rows.slice(0, take);
  const heading = head.findLast((row) => row.kind === "group");
  const rest = part.rows.slice(take);
  const restarted = heading && rest[0]?.kind !== "group" ? [{ ...heading, key: `${heading.key}:continued`, continued: true }, ...rest] : rest;
  return [
    { ...part, rows: head },
    { ...part, rows: restarted, continued: true },
  ];
}

/** A table's smallest first piece, up to its first row besides the headings, for a frame too small for any other; null when it cannot split. */
function smallestPieces(part: TablePart): [TablePart, TablePart] | null {
  const first = part.rows.findIndex((row) => row.kind !== "group" && row.kind !== "samples");
  let take = first + 1;
  while (take < part.rows.length && part.rows[take - 1].kind === "total" && part.rows[take]?.kind === "limits") take += 1;
  return first === -1 || take >= part.rows.length ? null : piecesAt(part, take);
}

/** The parts a pour placed, what it could not, and how full it left each frame it reached (mm, by the frame's index). */
type Poured = { placed: Placed[]; rest: Part[]; used: number[] };

/**
 * Pours the parts into frames in order (each a column of a page, from
 * `frameAt`), at most `frames` of them: a part goes under the last while it
 * fits. One that does not moves to the next frame, or splits there if it is
 * a table that may split or that no frame could hold whole (under other
 * parts, inside a class only when no frame could); photos that do not fit
 * keep their first row. What the frames cannot hold comes back as the rest.
 * With no limit an empty frame always takes a first piece, so every part
 * lands.
 */
function pour(
  parts: readonly Part[],
  frameAt: (index: number) => Frame,
  sizes: number,
  photoColumns: 2 | 4,
  frames = Number.POSITIVE_INFINITY,
): Poured {
  const placed: Placed[] = [];
  const force = !Number.isFinite(frames);
  let index = 0;
  let used = 0;
  const fill = [0];
  const height = (part: Part, frame: Frame) => partHeight(part, frame.width, sizes, photoColumns, used === 0);
  const put = (part: Part, frame: Frame) => {
    placed.push({ frame, slot: slotOf(part, frame.width, sizes, photoColumns, used === 0) });
    used += (used > 0 ? ROOM.partGap : 0) + height(part, frame);
    fill[index] = used;
  };
  const advance = () => {
    index += 1;
    used = 0;
    if (index < frames) fill[index] = 0;
  };
  for (let at = 0; at < parts.length; at += 1) {
    let part: Part | null = parts[at];
    while (part) {
      if (index >= frames) return { placed, rest: [part, ...parts.slice(at + 1)], used: fill };
      const frame = frameAt(index);
      const free = frame.room - used - (used > 0 ? ROOM.partGap : 0);
      if (height(part, frame) <= free) {
        put(part, frame);
        part = null;
      } else if (part.kind === "photos") {
        const firstRow: PhotosPart = { ...part, photos: part.photos.slice(0, photoColumns) };
        if (height(firstRow, frame) <= free || (used === 0 && force)) {
          put(firstRow, frame);
          part = null;
        } else advance();
      } else if (part.keep && used > 0 && partHeight(part, frame.width, sizes, photoColumns, true) <= frame.room) {
        advance();
      } else {
        const pieces: [TablePart, TablePart] | null = splitTable(part, free, frame.width, sizes) ?? (used === 0 && force ? smallestPieces(part) : null);
        // Under other parts, a table that would break inside a class moves on whole while a frame can hold it.
        const movesOn = pieces !== null && used > 0 && pieces[1].rows[0]?.continued === true && partHeight(part, frame.width, sizes, photoColumns, true) <= frame.room;
        if (pieces && !movesOn) {
          put(pieces[0], frame);
          part = pieces[1];
        } else if (!pieces && used === 0 && force) {
          // A table that cannot split at all takes the empty frame whole.
          put(part, frame);
          part = null;
        }
        advance();
      }
    }
  }
  return { placed, rest: [], used: fill };
}

/**
 * The longest run of whole classes from the start of a piece of the visual
 * table that fits `room` in a column `width` mm wide, to move under the left
 * column's tables, and what is left of the piece; null when the piece starts
 * inside a class (its heading restarted) or its first class does not fit.
 * The run prints without the table's heading: its header row and its first
 * class's heading ("Minor · AQL 4.0") head it.
 */
function wholeClasses(part: TablePart, room: number, width: number, sizes: number): [TablePart, TablePart | null] | null {
  const { rows } = part;
  if (rows[0]?.kind !== "group" || rows[0].continued) return null;
  let take = 0;
  for (let end = 1; end <= rows.length; end += 1) {
    // A class ends where the next one's heading begins, or with the piece.
    if (end < rows.length && rows[end].kind !== "group") continue;
    if (tableHeight(part.table, rows.slice(0, end), width, sizes, part.continued, false) > room) break;
    take = end;
  }
  if (take === 0) return null;
  return [{ ...part, rows: rows.slice(0, take), headed: false }, take < rows.length ? { ...part, rows: rows.slice(take) } : null];
}

function planPages(doc: InspectionExport, entry: ReportPlanEntryFor<"holesVisual">, content: Omit<HolesVisualContent, "pages">): HolesVisualPage[] {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  const noteLines = doc.report.footerNote ? Math.min(2, Math.ceil(doc.report.footerNote.length / ROOM.footerNoteCharacters)) : 0;
  const height = paper.height - ROOM.chrome - noteLines * ROOM.footerNoteLine - ROOM.safety;
  const width = paper.width - 26;
  const sizes = content.sizes.length;
  const firstTop = headingHeight(entry.title, content.lead, width) + ROOM.gap + (content.limits ? limitsHeight(content.limits, width) + ROOM.gap : 0);
  const laterTop = headingHeight(entry.title, null, width) + ROOM.gap;
  const room = (page: number) => height - (page === 0 ? firstTop : laterTop);
  const { pinholes, critical, visual } = content.tables;
  // Photos that open a column are headed by their block's name on the Report page.
  const photosTitle = entry.blocks.find((block) => block.key === "defectPhotos")?.label ?? "Defect Photos";
  const tables: TablePart[] = [...(pinholes ? [tablePart(pinholes)] : []), ...(critical ? [tablePart(critical)] : [])];
  const photos: PhotosPart | null = content.photos.length > 0 ? { kind: "photos", photos: content.photos, title: photosTitle } : null;
  const left: Part[] = [...tables, ...(photos ? [photos] : [])];
  const visualPart = visual ? tablePart(visual, false) : null;
  const right: Part[] = visualPart ? [visualPart] : [];

  // More than four sizes: each part across the page, one under the other.
  if (sizes > 4) return pagesOf(pour([...left, ...right], (page) => ({ page, column: 0, width, room: room(page) }), sizes, 4).placed, "stack");

  const leftWidth = (width - ROOM.columnGap) * ROOM.leftShare;
  const widthOf = (column: number) => (column === 0 ? leftWidth : width - ROOM.columnGap - leftWidth);
  const frameOf = (page: number, column: number): Frame => ({ page, column, width: widthOf(column), room: room(page) });
  const stacked = (parts: readonly Part[], column: number) =>
    parts.reduce((sum, part, index) => sum + (index > 0 ? ROOM.partGap : 0) + partHeight(part, widthOf(column), sizes, 2, index === 0), 0);
  const twoPhotos = (parts: readonly Part[]) => parts.map((part) => (part.kind === "photos" ? { ...part, photos: part.photos.slice(0, 2) } : part));

  /** From `page` on: two streams, the left parts down the left columns and the visual table down the right; one alone shares both columns. */
  const from = (page: number, leftParts: readonly Part[], rightParts: readonly Part[]): Placed[] => {
    if (leftParts.length > 0 && rightParts.length > 0) {
      return [
        ...pour(leftParts, (index) => frameOf(page + index, 0), sizes, 2).placed,
        ...pour(rightParts, (index) => frameOf(page + index, 1), sizes, 2).placed,
      ];
    }
    if (leftParts.length > 0) {
      // The holes, the critical defects and the photos alone: split between the two columns, the taller as short as it can be.
      const balanced = balance(leftParts, stacked, room(page)) ?? balance(twoPhotos(leftParts), stacked, room(page));
      if (balanced) {
        return balanced.flatMap((parts, column) => parts.map((part, index) => ({ frame: frameOf(page, column), slot: slotOf(part, widthOf(column), sizes, 2, index === 0) })));
      }
    }
    // The left column, then the right, page after page.
    return pour([...leftParts, ...rightParts], (index) => frameOf(page + Math.floor(index / 2), index % 2), sizes, 2).placed;
  };

  /** Whether a part fits under `used` mm of a frame. */
  const fits = (part: Part, frame: Frame, used: number) => partHeight(part, frame.width, sizes, 2, used === 0) <= frame.room - used - (used > 0 ? ROOM.partGap : 0);

  /**
   * The design's first page, its two columns filled before anything goes
   * on, the tables first and in their reading order (the holes, the critical
   * defects, the major, the minor): the holes and the critical defects down
   * the left column, the visual table down the right, whole where it fits,
   * else breaking between its classes as before. A class the right column
   * cannot hold moves, whole, under the left column's tables where it fits
   * there, without the table's heading (Kenneth, 27 October 2026: the Minor
   * table under the critical defects, not alone on a page), once they are
   * all on the page. Then the
   * photos: the left column where they fit, else the right once the visual
   * table has ended, else their first row. Nothing goes above what a column
   * already holds. What fits in neither column comes back, the left parts'
   * and the visual table's, each in its order.
   */
  const firstPage = (visualTable: TablePart): { placed: Placed[]; left: Part[]; right: Part[] } => {
    const [leftFrame, rightFrame] = [frameOf(0, 0), frameOf(0, 1)];
    const holes = pour(tables, () => leftFrame, sizes, 2, 1);
    const visualFirst = pour([visualTable], () => rightFrame, sizes, 2, 1);
    const placed = [...holes.placed, ...visualFirst.placed];
    const rightUsed = visualFirst.used[0];
    let leftUsed = holes.used[0];
    let rest = visualFirst.rest;
    const [next] = rest;
    const moved = next?.kind === "table" && leftUsed > 0 && holes.rest.length === 0 ? wholeClasses(next, leftFrame.room - leftUsed - ROOM.partGap, leftFrame.width, sizes) : null;
    if (moved) {
      placed.push({ frame: leftFrame, slot: slotOf(moved[0], leftFrame.width, sizes, 2, false) });
      leftUsed += ROOM.partGap + partHeight(moved[0], leftFrame.width, sizes, 2, false);
      rest = moved[1] ? [moved[1]] : [];
    }
    if (!photos) return { placed, left: holes.rest, right: rest };
    // After a table that goes on, the photos go on too; else whole where they fit, the left column first, else their first row.
    const spots = [{ frame: leftFrame, used: leftUsed }, ...(rest.length === 0 ? [{ frame: rightFrame, used: rightUsed }] : [])];
    const choices = holes.rest.length > 0 ? [] : [photos, { ...photos, photos: photos.photos.slice(0, 2) }];
    const spot = choices.flatMap((part) => spots.map((at) => ({ part, ...at }))).find((at) => fits(at.part, at.frame, at.used));
    if (!spot) return { placed, left: [...holes.rest, photos], right: rest };
    return { placed: [...placed, { frame: spot.frame, slot: slotOf(spot.part, spot.frame.width, sizes, 2, spot.used === 0) }], left: holes.rest, right: rest };
  };

  if (left.length > 0 && visualPart) {
    const first = firstPage(visualPart);
    return pagesOf([...first.placed, ...from(1, first.left, first.right)], "columns");
  }
  return pagesOf(from(0, left, right), "columns");
}

/** The parts split between a page's two columns, in order, the taller column as short as it can be; null when no split fits. */
function balance(parts: readonly Part[], stacked: (parts: readonly Part[], column: number) => number, room: number): [Part[], Part[]] | null {
  let best: { split: [Part[], Part[]]; tallest: number } | null = null;
  for (let at = 1; at <= parts.length; at += 1) {
    const split: [Part[], Part[]] = [parts.slice(0, at), parts.slice(at)];
    const tallest = Math.max(stacked(split[0], 0), stacked(split[1], 1));
    if (tallest <= room && (!best || tallest < best.tallest)) best = { split, tallest };
  }
  return best?.split ?? null;
}

function pagesOf(placed: readonly Placed[], layout: HolesVisualPage["layout"]): HolesVisualPage[] {
  const count = Math.max(1, ...placed.map(({ frame }) => frame.page + 1));
  const pages: HolesVisualPage[] = Array.from({ length: count }, () => ({ layout, columns: layout === "columns" ? [[], []] : [[]] }));
  for (const { frame, slot } of placed) pages[frame.page].columns[frame.column].push(slot);
  return pages;
}
