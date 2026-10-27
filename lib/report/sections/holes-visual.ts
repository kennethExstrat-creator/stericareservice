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
// columns, the holes and the critical defects down the left, the major and
// minor defects down the right. Its columns take all they can before
// anything goes on: the visual table breaks between its classes where it
// can (and starts again under its class's heading where it cannot), and a
// class the right column cannot hold moves, whole, under the critical
// defects where it fits, headed by its own header row and class heading.
// What fits in neither column (long defect lists, long template labels)
// follows on the next page; more than four sizes stack the parts across the
// page instead. The pages are planned here, from the room each part takes
// (HOLES_VISUAL_ROOM, the sizes components/report/sections/holes-visual.tsx
// draws at, checked against Chrome's drawing and kept just above it), so
// the page count is known before anything is drawn.
//
// The defect photos never make a page of their own (Kenneth, 27 October
// 2026: a continued page of photos alone "looks less seamless with the
// data"). They sit where the tables leave room on the section's own pages,
// as TG35 page 6 has them under the critical defects: a column the tables
// have finished in, under them, or a column they leave empty on a page that
// exists anyway. The design's tiles are 4:3; where no column takes a row of
// those, a row of 3:2 tiles goes where one fits (shorter, landscape still,
// as TG35's photos are), so the four sizes' right column, with about 45 mm
// under the major defects, still shows a pinhole and a visual defect. Only
// photos that show a defect (lib/report/photo-reading.ts: a ring drawn,
// Steri-AI's description, a defect tagged or named), one per defect: the
// first pinhole and the first visual defect lead, so a row of two shows both
// checks as TG35 page 6 does, then the rest, the described first and the
// clearest first; what finds no room is in the photo records, as every
// defect photo is.
import { formatCount } from "@/lib/format";
import { isMediaCategoryKey } from "@/lib/inspections/source-documents";
import { parseTarget, type PhotoTarget } from "@/lib/photos/target";
import type { ExportModule, ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { REPORT_PAGE_SIZES } from "@/lib/schemas/report-options";
import { humanize } from "@/lib/zod-form/labels";
import { HAND_LABEL } from "@/modules/_framework/hands";
import type { DefectClass } from "@/modules/visual/schema";
import { OTHER_LOCATION } from "@/modules/watertight/config";
import { andList, aqlText, counted } from "../format";
import type { PhotoMarker, PhotoSize } from "../markers";
import { lineCount, textWidth } from "../measure";
import type { ReportPlanEntryFor } from "../model";
import { defectFamily, defectKey, describedCheck, describedFamily, photoShows, photoWords, PRODUCT_DEFECTS, type DefectFamily } from "../photo-reading";
import { at, isRecord, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import { defineSection } from "./index";

/** The text measure the tables are planned by, as this section has always offered it. */
export { lineCount } from "../measure";

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

/**
 * A defect photo as the section prints it: its caption (the inspector's,
 * else Steri-AI's, else its tags) bold where it names the defect, and the
 * rings drawn on it with the image's natural pixels to place them.
 */
export type DefectPhoto = { id: string; url: string; caption: string | null; strong: boolean; markers: PhotoMarker[]; size: PhotoSize | null };

/** The defect photos' tiles: the design's 4:3, or 3:2 for a row the room holds only so. */
export type DefectPhotoAspect = "4/3" | "3/2";

/**
 * A table's or the photos' part on a page: a table's widths in percent of its
 * column, and whether its heading prints (not over a class moved under the
 * left column's tables, which its own header row and class heading head);
 * the photos' heading where they open a column, two across in a column and
 * four across a stacked page, and their tiles' shape.
 */
export type HolesVisualSlot =
  | { kind: "table"; table: DefectTable; continued: boolean; heading: boolean; widths: { label: number; value: number } }
  | { kind: "photos"; title: string | null; photos: DefectPhoto[]; columns: 2 | 4; aspect: DefectPhotoAspect };

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
  /**
   * The defect photos the pages print (defectPhotosOf's, as many as the room
   * the tables leave holds); none while switched off, or where no row fits.
   */
  photos: DefectPhoto[];
  pages: HolesVisualPage[];
};

/* ------------------------------------------------------------------ *
 * Building it
 * ------------------------------------------------------------------ */

/** The visual classes in the design's order: the grid's columns, the tables. */
const CLASS_ORDER: readonly DefectClass[] = ["major", "minor", "critical"];
const CLASS_WORD: Readonly<Record<DefectClass, string>> = { critical: "Critical", major: "Major", minor: "Minor" };

/** The design's names: the watertight check, a visual check ("Visual: Major"), the rows around the defects (TG35 page 6). */
const HOLES = "Freedom from Holes";
const VISUAL = "Visual";
const WORDS = { tested: "Samples Tested", inspected: "Samples Inspected", found: "Total Found", limits: "Accept / Reject" } as const;
const HANDS_TOGETHER = "Right and left hands together";
const DASH = "—";

/** Defect photos the section offers a place at most: two rows of two. */
export const DEFECT_PHOTOS_MAX = 4;

export const holesVisual = defineSection({ key: "holesVisual", build: buildHolesVisual });

function buildHolesVisual(doc: InspectionExport, entry: ReportPlanEntryFor<"holesVisual">): (HolesVisualContent & { pageCount: number }) | null {
  const sizes = orderedSizes(doc);
  const holes = moduleOf(doc, "watertight");
  const visual = moduleOf(doc, "visual");
  if (sizes.length === 0 || (!holes && !visual)) return null;
  const on = (key: (typeof entry.blocks)[number]["key"]) => entry.blocks.some((block) => block.key === key);

  const reading = readChecks(doc, sizes, holes, visual);
  const content: Omit<HolesVisualContent, "pages" | "photos"> = {
    lead: leadOf(doc, reading),
    sizes: sizes.map((size, index) => ({ size, label: reading.sizeLabels[index] })),
    limits: on("defectsAgainstLimit") && reading.columns.length > 0 ? limitsOf(reading) : null,
    tables: {
      pinholes: on("pinholesByLocation") && holes ? pinholesTable(holes, reading) : null,
      critical: on("visualCritical") && visual ? criticalTable(visual, reading) : null,
      visual: on("visualMajorMinor") && visual ? visualTable(visual, reading) : null,
    },
  };
  const { pages, photos } = planPages(doc, entry, content, on("defectPhotos") ? chooseDefectPhotos(doc, holes, visual) : []);
  return { ...content, photos, pages, pageCount: pages.length };
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

/** Where a defect photo comes from: the watertight test, the visual inspection, or Source Documents' Media. */
type PhotoSource = "holes" | "visual" | "media";

/** A defect photo offered a place: its tags, where it comes from, the module it was taken in, and the modules whose lists name its defect. */
type Candidate = { photo: ExportPhoto; index: number; target: PhotoTarget; source: PhotoSource; module: ExportModule | null; lists: ExportModule[] };

/** The defect photos the section offers a place, in order (DEFECT_PHOTOS_MAX at most): for its tests and the pages. */
export function defectPhotosOf(doc: InspectionExport): DefectPhoto[] {
  return chooseDefectPhotos(doc, moduleOf(doc, "watertight"), moduleOf(doc, "visual"));
}

/**
 * Photos of the defects, offered a place in this order, at most
 * DEFECT_PHOTOS_MAX: those taken in the watertight test or the visual
 * inspection, those in Media's Product Defects, and any Media photo
 * Steri-AI says shows a hole or a visual defect; each only where it shows a
 * defect (photoShows: a ring drawn, Steri-AI's description, a defect tagged,
 * a caption naming one), never the setting or a photo that says nothing.
 * Those Steri-AI describes come first, the clearest first; then those with
 * rings drawn, in the order taken; then the rest, holes, visual defects and
 * Media's taking turns, each in the order taken. One photo per defect
 * (defectKey): a later photo of a defect already shown waits in the photo
 * records. Of what is left, the first pinhole and the first visual defect
 * lead (the clearest of each where Steri-AI describes them), in the
 * section's order, so a row of two shows both checks, as TG35 page 6 shows
 * a pinhole beside a ringed mark; the rest follow in order. As for the photo
 * records (photoGroupsOf, lib/report/model.ts), once an admin has marked
 * photos In Report only those print, and a flagged original (a HEIC the
 * browser could not convert) never does.
 */
function chooseDefectPhotos(doc: InspectionExport, holes: ExportModule | null, visual: ExportModule | null): DefectPhoto[] {
  const usable = doc.photos.filter((photo) => !photo.flagged);
  const chosen = usable.some((photo) => photo.includeInReport) ? usable.filter((photo) => photo.includeInReport) : usable;
  const both = [holes, visual].filter((entry): entry is ExportModule => entry !== null);
  const candidates = chosen.flatMap((photo, index): Candidate[] => {
    const parsed = parseTarget(photo.target);
    const target = parsed.ok ? parsed.target : {};
    const source = sourceOf(doc, photo, holes, visual);
    if (!source || photoShows(photo, target, photo.moduleKey) !== "defect") return [];
    const step = source === "holes" ? holes : source === "visual" ? visual : null;
    return [{ photo, index, target, source, module: step, lists: step ? [step] : both }];
  });
  const taken = (a: Candidate, b: Candidate) => (a.photo.takenAt ?? "~").localeCompare(b.photo.takenAt ?? "~") || a.index - b.index;
  const clarity = (entry: Candidate) => (entry.photo.description?.kind === "defect" ? entry.photo.description.clarity : null);
  const described = candidates.filter((entry) => clarity(entry) !== null).sort((a, b) => (clarity(b) ?? 0) - (clarity(a) ?? 0) || taken(a, b));
  const ringed = candidates.filter((entry) => clarity(entry) === null && entry.photo.markers.length > 0).sort(taken);
  const queues = (["holes", "visual", "media"] as const).map((source) =>
    candidates.filter((entry) => clarity(entry) === null && entry.photo.markers.length === 0 && entry.source === source).sort(taken),
  );
  const turns: Candidate[] = [];
  for (let round = 0; queues.some((queue) => round < queue.length); round += 1) for (const queue of queues) if (queue[round]) turns.push(queue[round]);
  const shown = new Set<string>();
  const each = [...described, ...ringed, ...turns].filter((entry) => {
    const key = defectKey(entry.photo, entry.target);
    if (shown.has(key)) return false;
    shown.add(key);
    return true;
  });
  const leads = (["holes", "visual"] as const).flatMap((check) => each.find((entry) => checkOf(doc, entry) === check) ?? []);
  return [...leads, ...each.filter((entry) => !leads.includes(entry))].slice(0, DEFECT_PHOTOS_MAX).map((entry) => {
    // Plain on Section 06's own page, as TG35 page 6 sets them; the photo records bold a defect's caption.
    const { caption } = captionOf(doc, entry);
    const { markers, size } = entry.photo;
    return { id: entry.photo.id, url: entry.photo.url, caption, strong: false, markers: markers.map((marker) => ({ ...marker })), size: size ? { ...size } : null };
  });
}

/**
 * The check a defect photo shows a defect of: the one Steri-AI's defect code
 * belongs to; else the step it was taken in; else, a Media photo, its tagged
 * defect's, or the test Steri-AI says it belongs to; null when none says.
 */
function checkOf(doc: InspectionExport, { photo, target, source }: Candidate): DefectFamily | null {
  return describedFamily(doc, photo) ?? (source !== "media" ? source : (defectFamily(doc, target.defect) ?? describedCheck(photo)));
}

/** A photo's source among the defect photos; null for one of another step, or a Media photo of neither check. */
function sourceOf(doc: InspectionExport, photo: ExportPhoto, holes: ExportModule | null, visual: ExportModule | null): PhotoSource | null {
  if (photo.moduleKey === "watertight") return holes ? "holes" : null;
  if (photo.moduleKey === "visual") return visual ? "visual" : null;
  if (photo.moduleKey === PRODUCT_DEFECTS) return "media";
  return isMediaCategoryKey(photo.moduleKey) && describedFamily(doc, photo) !== null ? "media" : null;
}

/**
 * A defect photo's caption: the inspector's own, else Steri-AI's ("Pinhole,
 * palm area"), in bold as naming the defect; else its tags in the
 * template's words, the defect in bold ("Pin Hole: Palm · Size M"), or its
 * size alone; else none (never Media's category, the same on every tile).
 */
function captionOf(doc: InspectionExport, { photo, target, module, lists }: Candidate): { caption: string | null; strong: boolean } {
  const words = photoWords(photo);
  if (words) return { caption: words, strong: true };
  const size = target.size ? `Size ${sizeLabel(doc, target.size)}` : null;
  const hand = target.hand ? HAND_LABEL[target.hand] : null;
  const defect = target.defect ? defectName(lists, target.defect) : null;
  const what = defect && module?.key === "watertight" ? `${labelOf(module, "holes", "Pin Hole")}: ${defect}` : defect;
  const parts = [what, size, hand].filter((part): part is string => part !== null);
  return { caption: parts.length > 0 ? parts.join(" · ") : null, strong: what !== null };
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
 * footer. Text is measured by Outfit's own character widths with a margin
 * (../measure.ts), so a line estimated to fit does, and a few millimetres
 * stay free at each page's foot: a part that might not fit moves on, never
 * cut off.
 * ------------------------------------------------------------------ */

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
  /** Photos: the gap between tiles and between rows, a caption's gap (0.1 mm over) and lines (8.5 pt × 1.4). */
  photoGap: 3,
  photoRowGap: 2.4,
  captionGap: 1.5,
  captionLine: 4.2,
} as const;

const ROOM = HOLES_VISUAL_ROOM;

/** Each tile shape's width over its height. */
const PHOTO_ASPECT: Readonly<Record<DefectPhotoAspect, number>> = { "4/3": 4 / 3, "3/2": 3 / 2 };

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

/** The photos' rows (`columns` tiles of `aspect` across a column `width` mm wide), each row as tall as its longest caption, a bold one by bold widths. */
function photosHeight(photos: readonly DefectPhoto[], width: number, columns: number, aspect: DefectPhotoAspect): number {
  const tile = (width - (columns - 1) * ROOM.photoGap) / columns;
  let height = 0;
  for (let start = 0; start < photos.length; start += columns) {
    const captions = photos
      .slice(start, start + columns)
      .map((photo) => (photo.caption ? ROOM.captionGap + lineCount(photo.caption, tile, 8.5, photo.strong ? "bold" : "regular") * ROOM.captionLine : 0));
    height += (start > 0 ? ROOM.photoRowGap : 0) + tile / PHOTO_ASPECT[aspect] + Math.max(0, ...captions);
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

/** The tables' two streams: the holes and the critical defects (the left column's), the major and minor defects (the right's). */
type Stream = "left" | "right";

/** A table's piece; `headed` false for a class moved under the left column's tables, which prints without the table's heading. */
type TablePart = { table: DefectTable; rows: DefectRow[]; continued: boolean; keep: boolean; headed: boolean; stream: Stream };

/** A column of a page, with its width and the room it has, in mm. */
type Frame = { page: number; column: number; width: number; room: number };

/** A part in its frame, with the room it takes there and its table's stream (none for the photos). */
type Placed = { frame: Frame; slot: HolesVisualSlot; height: number; stream: Stream | null };

/** A table as a part: one to `keep` whole moves on rather than split while a frame can hold it. */
function tablePart(table: DefectTable, keep = true): TablePart {
  return { table, rows: table.rows, continued: false, keep, headed: true, stream: table.key === "visual" ? "right" : "left" };
}

/** A part's height in a column `width` mm wide. */
function partHeight(part: TablePart, width: number, sizes: number): number {
  return tableHeight(part.table, part.rows, width, sizes, part.continued, part.headed);
}

function slotOf(part: TablePart, width: number, sizes: number): HolesVisualSlot {
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

function placedIn(part: TablePart, frame: Frame, sizes: number): Placed {
  return { frame, slot: slotOf(part, frame.width, sizes), height: partHeight(part, frame.width, sizes), stream: part.stream };
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
type Poured = { placed: Placed[]; rest: TablePart[]; used: number[] };

/**
 * Pours the tables into frames in order (each a column of a page, from
 * `frameAt`), at most `frames` of them: a table goes under the last while
 * it fits. One that does not moves to the next frame, or splits there if it
 * may split or no frame could hold it whole (under other parts, inside a
 * class only when no frame could). What the frames cannot hold comes back
 * as the rest. With no limit an empty frame always takes a first piece, so
 * every table lands.
 */
function pour(parts: readonly TablePart[], frameAt: (index: number) => Frame, sizes: number, frames = Number.POSITIVE_INFINITY): Poured {
  const placed: Placed[] = [];
  const force = !Number.isFinite(frames);
  let index = 0;
  let used = 0;
  const fill = [0];
  const put = (part: TablePart, frame: Frame) => {
    const entry = placedIn(part, frame, sizes);
    placed.push(entry);
    used += (used > 0 ? ROOM.partGap : 0) + entry.height;
    fill[index] = used;
  };
  const advance = () => {
    index += 1;
    used = 0;
    if (index < frames) fill[index] = 0;
  };
  for (let at = 0; at < parts.length; at += 1) {
    let part: TablePart | null = parts[at];
    while (part) {
      if (index >= frames) return { placed, rest: [part, ...parts.slice(at + 1)], used: fill };
      const frame = frameAt(index);
      const free = frame.room - used - (used > 0 ? ROOM.partGap : 0);
      const whole = partHeight(part, frame.width, sizes);
      if (whole <= free) {
        put(part, frame);
        part = null;
      } else if (part.keep && used > 0 && whole <= frame.room) {
        advance();
      } else {
        const pieces: [TablePart, TablePart] | null = splitTable(part, free, frame.width, sizes) ?? (used === 0 && force ? smallestPieces(part) : null);
        // Under other parts, a table that would break inside a class moves on whole while a frame can hold it.
        const movesOn = pieces !== null && used > 0 && pieces[1].rows[0]?.continued === true && whole <= frame.room;
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

/**
 * The section's pages: the tables first, planned as the design lays them
 * (planTables), then the defect photos where the tables leave room
 * (photoSpot); the photos the pages print come back with them.
 */
function planPages(
  doc: InspectionExport,
  entry: ReportPlanEntryFor<"holesVisual">,
  content: Omit<HolesVisualContent, "pages" | "photos">,
  photos: readonly DefectPhoto[],
): { pages: HolesVisualPage[]; photos: DefectPhoto[] } {
  const paper = REPORT_PAGE_SIZES.find((size) => size.value === doc.report.pageSize) ?? REPORT_PAGE_SIZES[0];
  const noteLines = doc.report.footerNote ? Math.min(2, Math.ceil(doc.report.footerNote.length / ROOM.footerNoteCharacters)) : 0;
  const height = paper.height - ROOM.chrome - noteLines * ROOM.footerNoteLine - ROOM.safety;
  const width = paper.width - 26;
  const firstTop = headingHeight(entry.title, content.lead, width) + ROOM.gap + (content.limits ? limitsHeight(content.limits, width) + ROOM.gap : 0);
  const laterTop = headingHeight(entry.title, null, width) + ROOM.gap;
  const room = (page: number) => height - (page === 0 ? firstTop : laterTop);
  const stack = content.sizes.length > 4;
  const leftWidth = (width - ROOM.columnGap) * ROOM.leftShare;
  const frameAt = (page: number, column: number): Frame =>
    stack ? { page, column: 0, width, room: room(page) } : { page, column, width: column === 0 ? leftWidth : width - ROOM.columnGap - leftWidth, room: room(page) };
  const placed = planTables(content, frameAt, room, stack);
  const pages = pagesOf(placed, stack ? "stack" : "columns");
  // Photos that open a column are headed by their block's name on the Report page.
  const title = entry.blocks.find((block) => block.key === "defectPhotos")?.label ?? "Defect Photos";
  const spot = photoSpot(placed, pages, frameAt, photos, title);
  if (!spot) return { pages, photos: [] };
  pages[spot.frame.page].columns[spot.frame.column].push(spot.slot);
  return { pages, photos: spot.photos };
}

/** The tables placed in the pages' frames, as the design lays them out. */
function planTables(
  content: Omit<HolesVisualContent, "pages" | "photos">,
  frameAt: (page: number, column: number) => Frame,
  room: (page: number) => number,
  stack: boolean,
): Placed[] {
  const sizes = content.sizes.length;
  const { pinholes, critical, visual } = content.tables;
  const tables: TablePart[] = [...(pinholes ? [tablePart(pinholes)] : []), ...(critical ? [tablePart(critical)] : [])];
  const visualPart = visual ? tablePart(visual, false) : null;
  const right: TablePart[] = visualPart ? [visualPart] : [];

  // More than four sizes: each part across the page, one under the other.
  if (stack) return pour([...tables, ...right], (page) => frameAt(page, 0), sizes).placed;

  const stacked = (parts: readonly TablePart[], column: number) =>
    parts.reduce((sum, part, index) => sum + (index > 0 ? ROOM.partGap : 0) + partHeight(part, frameAt(0, column).width, sizes), 0);

  /** From `page` on: two streams, the left parts down the left columns and the visual table down the right; one alone shares both columns. */
  const from = (page: number, leftParts: readonly TablePart[], rightParts: readonly TablePart[]): Placed[] => {
    if (leftParts.length > 0 && rightParts.length > 0) {
      return [
        ...pour(leftParts, (index) => frameAt(page + index, 0), sizes).placed,
        ...pour(rightParts, (index) => frameAt(page + index, 1), sizes).placed,
      ];
    }
    if (leftParts.length > 0) {
      // The holes and the critical defects alone: split between the two columns, the taller as short as it can be.
      const balanced = balance(leftParts, stacked, room(page));
      if (balanced) return balanced.flatMap((parts, column) => parts.map((part) => placedIn(part, frameAt(page, column), sizes)));
    }
    // The left column, then the right, page after page.
    return pour([...leftParts, ...rightParts], (index) => frameAt(page + Math.floor(index / 2), index % 2), sizes).placed;
  };

  /**
   * The design's first page, its two columns filled before anything goes
   * on, the tables in their reading order (the holes, the critical defects,
   * the major, the minor): the holes and the critical defects down the left
   * column, the visual table down the right, whole where it fits, else
   * breaking between its classes as before. A class the right column cannot
   * hold moves, whole, under the left column's tables where it fits there,
   * without the table's heading (Kenneth, 27 October 2026: the Minor table
   * under the critical defects, not alone on a page), once they are all on
   * the page. Nothing goes above what a column already holds. What fits in
   * neither column comes back, the left parts' and the visual table's, each
   * in its order.
   */
  const firstPage = (visualTable: TablePart): { placed: Placed[]; left: TablePart[]; right: TablePart[] } => {
    const [leftFrame, rightFrame] = [frameAt(0, 0), frameAt(0, 1)];
    const holes = pour(tables, () => leftFrame, sizes, 1);
    const visualFirst = pour([visualTable], () => rightFrame, sizes, 1);
    const placed = [...holes.placed, ...visualFirst.placed];
    const leftUsed = holes.used[0];
    const [next] = visualFirst.rest;
    const moved = next && leftUsed > 0 && holes.rest.length === 0 ? wholeClasses(next, leftFrame.room - leftUsed - ROOM.partGap, leftFrame.width, sizes) : null;
    if (!moved) return { placed, left: holes.rest, right: visualFirst.rest };
    return { placed: [...placed, placedIn(moved[0], leftFrame, sizes)], left: holes.rest, right: moved[1] ? [moved[1]] : [] };
  };

  if (tables.length > 0 && visualPart) {
    const first = firstPage(visualPart);
    return [...first.placed, ...from(1, first.left, first.right)];
  }
  return from(0, tables, right);
}

/**
 * Where the defect photos go: the column of the section's pages that holds
 * the most of them in the design's 4:3 tiles, in whole rows (two across a
 * column, four across a stacked page), then the earlier page, then the
 * column with more room left; under its tables, or heading it where the
 * tables leave it empty. Where no column holds a row of 4:3 tiles, the one
 * that holds a row of 3:2 the same way (shorter, landscape still), so a
 * page with room for a row under its tables shows one (Kenneth, 27 October
 * 2026, of the photos: "The layout should be more seamless"). Only a column
 * the tables have finished in: none of its tables goes on to a later page,
 * so photos never come before a table's end. Null where no row fits: a page
 * is never added for photos, which print in the photo records too.
 */
function photoSpot(
  placed: readonly Placed[],
  pages: readonly HolesVisualPage[],
  frameAt: (page: number, column: number) => Frame,
  photos: readonly DefectPhoto[],
  title: string,
): { frame: Frame; slot: HolesVisualSlot; photos: DefectPhoto[] } | null {
  if (photos.length === 0) return null;
  const lastPage = new Map<Stream, number>();
  for (const { stream, frame } of placed) if (stream) lastPage.set(stream, Math.max(lastPage.get(stream) ?? 0, frame.page));
  // The columns the photos may go in, with the room each leaves and the heading they would need there.
  const spots = pages.flatMap((page, index) =>
    page.columns.flatMap((_, column) => {
      const frame = frameAt(index, column);
      const here = placed.filter((entry) => entry.frame.page === index && entry.frame.column === column);
      if (here.some((entry) => entry.stream !== null && (lastPage.get(entry.stream) ?? index) > index)) return [];
      const used = here.reduce((sum, entry, at) => sum + (at > 0 ? ROOM.partGap : 0) + entry.height, 0);
      const heading = used === 0 ? blockHeadingHeight(title, null, frame.width) + ROOM.tableGap : 0;
      return [{ frame, free: frame.room - used - (used > 0 ? ROOM.partGap : 0), heading, across: page.layout === "stack" ? (4 as const) : (2 as const), opening: used === 0 }];
    }),
  );
  const bestIn = (aspect: DefectPhotoAspect) => {
    let best: ((typeof spots)[number] & { count: number }) | null = null;
    for (const spot of spots) {
      let count = photos.length;
      while (count > 0 && spot.heading + photosHeight(photos.slice(0, count), spot.frame.width, spot.across, aspect) > spot.free) count -= 1;
      if (count > 0 && (!best || count > best.count || (count === best.count && spot.frame.page === best.frame.page && spot.free > best.free))) best = { ...spot, count };
    }
    return best ? { ...best, aspect } : null;
  };
  // Two rows of 3:2 are taller than one of 4:3: a column that takes no 4:3 row takes one row of 3:2 at most.
  const best = bestIn("4/3") ?? bestIn("3/2");
  if (!best) return null;
  const shown = photos.slice(0, best.count);
  return { frame: best.frame, photos: shown, slot: { kind: "photos", title: best.opening ? title : null, photos: shown, columns: best.across, aspect: best.aspect } };
}

/** The parts split between a page's two columns, in order, the taller column as short as it can be; null when no split fits. */
function balance(parts: readonly TablePart[], stacked: (parts: readonly TablePart[], column: number) => number, room: number): [TablePart[], TablePart[]] | null {
  let best: { split: [TablePart[], TablePart[]]; tallest: number } | null = null;
  for (let at = 1; at <= parts.length; at += 1) {
    const split: [TablePart[], TablePart[]] = [parts.slice(0, at), parts.slice(at)];
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
