// The photo records (TG35 pages 9 to 11): after the sections, each record
// the options switch on under its heading, "Photo Record 1 of 3" numbered
// among the records shown, in the design's groups of photos under their
// headings. The records flow from page to page, a page filling before the
// next starts: one starts under the record before where its opening fits, so
// a record of one row never leaves a page two-thirds blank, nor a record of
// one photo takes a page alone (Kenneth, 27 October 2026, of INS-2026-2442:
// "The layout should be more seamless"; "the photo section is wasting space").
//
// - Sampling & Packaging: Finished Goods Sampling (the warehouse first, as
//   the large photo, then the sampling, the samples and the inspection under
//   way), Carton Labels and Dispenser Box Artwork (labelling's photos by
//   their packaging level, each captioned with its size), and Documents and
//   Loading where they have photos.
// - Packing, Visual & Ageing: Layering, Dispensing & Stickiness (the packing
//   check; a photo captioned as aged goes under Inspection of Aged Gloves),
//   Glove Dispensing (the Safedon check), Glove Visual Inspection (with the
//   Product Defects of Source Documents' Media) and Weight.
// - Watertight & Laboratory Testing: Watertight Testing for Pinholes,
//   Physical Property Testing (force at break, or tensile), Dimension and
//   the dye leak test.
//
// A photo goes by its tag: the module it was taken in (a custom module's go
// with the module it follows), Source Documents' Media category
// (mediaCategory), and its target (size, defect, packaging level). A Media
// photo Steri-AI says shows a hole goes with the watertight photos, one
// showing a visual defect with the visual inspection's; the setting stays in
// its category's group. The photos are those marked In Report, or every
// photo while none is, a flagged original left out (as photoGroupsOf in
// ../model.ts chooses them); at most Photos per Group in a record, shared in
// turn among its groups, so none is crowded out, and a group keeps its
// defect photos first, so a defect Section 06 had no room for still prints
// here. Every defect photo prints here, Section 06's too, as TG35 repeats
// page 6's photos on pages 10 and 11.
//
// A photo's caption is the inspector's, else Steri-AI's description, else
// the defect tagged in the template's words; labels by their size. One
// showing a defect is captioned in bold, the setting plainly ("Test rig"),
// and one with nothing to say has none. A group's note beside its heading is
// from the data and stays on one line: a shorter wording where the full one
// would wrap. A group with no photos is left out, and a record with none. A
// record its page cannot hold continues on the next (photoPages).
//
// Typed by SectionBuilder, never importing the registry at run time (as
// ./labellingConclusion.ts explains).
import { isMediaCategoryKey, type MediaCategoryKey } from "@/lib/inspections/source-documents";
import { parseTarget, type PhotoTarget } from "@/lib/photos/target";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import { REPORT_PHOTO_GROUPS, type ReportPhotoGroupKey } from "@/lib/schemas/report-options";
import { shortTitleFor } from "@/lib/templates/short-titles";
import { AGEING_SENTENCE, andList, counted, longDate } from "../format";
import { hasRings } from "../markers";
import { clipToLines, lineCount, textWidth } from "../measure";
import type { PhotoBlock, PhotoRecordPage, PhotoRecordPart, PhotosSection, PhotoTile } from "../model";
import { describedCheck, describedFamily, photoShows, photoWords, type PhotoShows } from "../photo-reading";
import { at, labelOf, list, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "../read";
import type { SectionBuilder } from "./index";
import { checkedFor, contentWidthOf, levelChecks, paperRoom } from "./labellingConclusion";

/* ------------------------------------------------------------------ *
 * The groups
 * ------------------------------------------------------------------ */

export type PhotoBlockKey =
  | "finishedGoods"
  | "cartonLabels"
  | "dispenserArtwork"
  | "documents"
  | "loading"
  | "layering"
  | "dispensing"
  | "visual"
  | "aged"
  | "weight"
  | "watertight"
  | "forceAtBreak"
  | "tensile"
  | "dimensions"
  | "dyeLeak";

type BlockDefinition = {
  key: PhotoBlockKey;
  /** The design's heading, or the step's short name where the design has none. */
  title: string | { module: ModuleKey };
  columns: PhotoBlock["columns"];
  aspect: PhotoBlock["aspect"];
  /** The first photo large (TG35's warehouse), once four more fill the two rows beside it. */
  lead?: boolean;
};

/** Each record's groups in print order, laid out as the design lays them. */
export const PHOTO_BLOCKS: Readonly<Record<ReportPhotoGroupKey, readonly BlockDefinition[]>> = {
  samplingPackaging: [
    { key: "finishedGoods", title: "Finished Goods Sampling", columns: 4, aspect: "3/2", lead: true },
    { key: "cartonLabels", title: "Carton Labels", columns: 4, aspect: "3/2" },
    { key: "dispenserArtwork", title: "Dispenser Box Artwork", columns: 4, aspect: "3/2" },
    { key: "documents", title: { module: "documents" }, columns: 4, aspect: "4/3" },
    { key: "loading", title: { module: "loading" }, columns: 4, aspect: "4/3" },
  ],
  packingVisualAgeing: [
    { key: "layering", title: "Layering, Dispensing & Stickiness", columns: 5, aspect: "1/1" },
    { key: "dispensing", title: "Glove Dispensing", columns: 5, aspect: "1/1" },
    { key: "visual", title: "Glove Visual Inspection", columns: 4, aspect: "1/1" },
    { key: "aged", title: "Inspection of Aged Gloves", columns: 4, aspect: "4/3" },
    { key: "weight", title: { module: "weight" }, columns: 4, aspect: "4/3" },
  ],
  watertightLaboratory: [
    { key: "watertight", title: "Watertight Testing for Pinholes", columns: 5, aspect: "1/1" },
    { key: "forceAtBreak", title: "Physical Property Testing: Force at Break", columns: 4, aspect: "4/3" },
    { key: "tensile", title: "Physical Property Testing: Tensile Strength & Elongation", columns: 4, aspect: "4/3" },
    { key: "dimensions", title: { module: "dimensions" }, columns: 4, aspect: "4/3" },
    { key: "dyeLeak", title: { module: "dye_leak" }, columns: 4, aspect: "4/3" },
  ],
};

/** A module's photos' group (labelling's by level, and the packing check's aged photos, are worked out). Each in its record of REPORT_PHOTO_GROUPS. */
export const MODULE_PHOTO_BLOCK: Readonly<Partial<Record<ModuleKey, PhotoBlockKey>>> = {
  header: "finishedGoods",
  order_lots: "finishedGoods",
  glove_info: "finishedGoods",
  packing_config: "finishedGoods",
  sampling_plan: "finishedGoods",
  carton_sampling: "finishedGoods",
  labeling: "cartonLabels",
  documents: "documents",
  loading: "loading",
  dispensing_packing: "layering",
  dispensing_safedon: "dispensing",
  visual: "visual",
  weight: "weight",
  watertight: "watertight",
  force_at_break: "forceAtBreak",
  tensile: "tensile",
  dimensions: "dimensions",
  dye_leak: "dyeLeak",
};

/** Source Documents' Media categories (lib/inspections/source-documents.ts): the visit's photos by what they show. */
export const MEDIA_PHOTO_BLOCK: Readonly<Record<MediaCategoryKey, PhotoBlockKey>> = {
  media_warehouse: "finishedGoods",
  media_samples: "finishedGoods",
  media_proof: "finishedGoods",
  media_defects: "visual",
};

/** Each group's record. */
const BLOCK_RECORD: ReadonlyMap<PhotoBlockKey, ReportPhotoGroupKey> = new Map(
  (Object.entries(PHOTO_BLOCKS) as [ReportPhotoGroupKey, readonly BlockDefinition[]][]).flatMap(([record, blocks]) => blocks.map((block) => [block.key, record] as const)),
);

/** Finished Goods Sampling's order: the warehouse first (the large photo), then the steps' photos, the samples, the inspection under way. */
const FINISHED_GOODS_RANK: Readonly<Record<string, number>> = { media_warehouse: 0, media_samples: 2, media_proof: 3 };

/** A packing check photo of the aged sample, which has no box/carton number to tag: its caption says so. */
const AGED = /\bag(?:e)?(?:d|ing)\b/i;

/** The large photo and the four that fill the two rows beside it: fewer, and the group is a plain row. */
const LEAD_PHOTOS = 5;

/* ------------------------------------------------------------------ *
 * Choosing the photos
 * ------------------------------------------------------------------ */

/** A photo in its group: its tags, and what it shows (lib/report/photo-reading.ts). */
type Placed = { photo: ExportPhoto; index: number; tag: string | null; target: PhotoTarget; block: PhotoBlockKey; shows: PhotoShows };

export type PhotoRecord = { key: ReportPhotoGroupKey; title: string; blocks: PhotoBlock[] };

/** Every record the report shows, in order, with its groups and their photos. */
export function photoRecordsOf(doc: InspectionExport): PhotoRecord[] {
  const usable = doc.photos.filter((photo) => !photo.flagged);
  const chosen = usable.some((photo) => photo.includeInReport) ? usable.filter((photo) => photo.includeInReport) : usable;
  const after = new Map(doc.custom.map((custom) => [custom.key, custom.after ?? null]));
  const tagOf = (key: string | null): string | null => (key === null ? null : after.has(key) ? (after.get(key) ?? null) : key);
  const placed = chosen.flatMap((photo, index): Placed[] => {
    const tag = tagOf(photo.moduleKey);
    const parsed = parseTarget(photo.target);
    const target = parsed.ok ? parsed.target : {};
    const block = blockFor(doc, tag, target, photo);
    return block ? [{ photo, index, tag, target, block, shows: photoShows(photo, target, tag) }] : [];
  });
  const width = contentWidthOf(doc);
  return REPORT_PHOTO_GROUPS.flatMap((group): PhotoRecord[] => {
    if (!doc.report.photos.groups[group.key]) return [];
    const definitions = PHOTO_BLOCKS[group.key];
    const candidates = definitions.map((definition) => inOrder(doc, definition.key, placed.filter((entry) => entry.block === definition.key)));
    // Photos per Group keeps each group's defect photos first; a group then prints the photos it keeps in its own order.
    const kept = shared(candidates.map(defectsFirst), doc.report.photos.perGroup).map((entries, index) => candidates[index].filter((entry) => entries.includes(entry)));
    const blocks = definitions.flatMap((definition, index) => (kept[index].length === 0 ? [] : [blockOf(doc, definition, kept[index], width)]));
    return blocks.length === 0 ? [] : [{ key: group.key, title: group.title, blocks }];
  });
}

function blockFor(doc: InspectionExport, tag: string | null, target: PhotoTarget, photo: ExportPhoto): PhotoBlockKey | null {
  if (tag === null) return null;
  if (isMediaCategoryKey(tag)) return mediaBlock(doc, tag, photo);
  if (!isModuleKey(tag)) return null;
  if (tag === "labeling") return labelLevelOf(doc, target) === "inner" ? "dispenserArtwork" : "cartonLabels";
  if (tag === "dispensing_packing" && AGED.test(photoWords(photo) ?? "")) return "aged";
  return MODULE_PHOTO_BLOCK[tag] ?? null;
}

/**
 * A Media photo's group: by Steri-AI's description where it shows a defect
 * of either check, a hole with the watertight photos and a visual defect
 * with the visual inspection's, while that record is switched on; a setting
 * shot by the test it says the photo belongs to (TG35 page 11's "Test rig"
 * with the watertight photos); else, a photo nothing describes, its
 * category's.
 */
function mediaBlock(doc: InspectionExport, category: MediaCategoryKey, photo: ExportPhoto): PhotoBlockKey {
  const own = MEDIA_PHOTO_BLOCK[category];
  const family = describedFamily(doc, photo) ?? describedCheck(photo);
  const block: PhotoBlockKey = family === "holes" ? "watertight" : family === "visual" ? "visual" : own;
  const record = BLOCK_RECORD.get(block);
  return record && doc.report.photos.groups[record] ? block : own;
}

/** A group's photos, those showing a defect first, each kind in the group's order: what Photos per Group keeps first. */
function defectsFirst(entries: readonly Placed[]): Placed[] {
  return [...entries.filter((entry) => entry.shows === "defect"), ...entries.filter((entry) => entry.shows !== "defect")];
}

/**
 * A labelling photo's packaging level: as tagged; else by its box/carton
 * number among the level's boxes for its size; else the carton, unless the
 * template inspects only the inner unit.
 */
function labelLevelOf(doc: InspectionExport, target: PhotoTarget): "inner" | "carton" {
  if (target.level) return target.level;
  const labeling = moduleOf(doc, "labeling");
  if (target.box !== undefined && target.size) {
    for (const level of ["carton", "inner"] as const) {
      if (list(at(labeling?.data, "sizes", target.size, level, "boxNos")).includes(target.box)) return level;
    }
  }
  return rec(at(labeling?.config, "levels", "carton")).include === false ? "inner" : "carton";
}

/** A group's photos in its order: labels by size, Finished Goods Sampling the warehouse first; else as captured. */
function inOrder(doc: InspectionExport, key: PhotoBlockKey, entries: readonly Placed[]): Placed[] {
  const sizes = (doc.template.sizes ?? []).map((size) => size.value);
  const sizeRank = (size: string | undefined) => (size === undefined ? sizes.length + 1 : sizes.includes(size) ? sizes.indexOf(size) : sizes.length);
  const rank = (entry: Placed) =>
    key === "finishedGoods" ? (FINISHED_GOODS_RANK[entry.tag ?? ""] ?? 1) : key === "cartonLabels" || key === "dispenserArtwork" ? sizeRank(entry.target.size) : 0;
  return [...entries].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
}

/** At most `limit` items over the lists, taken in turn, one from each list a round, so every list keeps its first. */
export function shared<T>(lists: readonly (readonly T[])[], limit: number): T[][] {
  const kept: T[][] = lists.map(() => []);
  let left = limit;
  for (let round = 0; left > 0; round += 1) {
    let took = false;
    for (let index = 0; index < lists.length && left > 0; index += 1) {
      if (round < lists[index].length) {
        kept[index].push(lists[index][round]);
        left -= 1;
        took = true;
      }
    }
    if (!took) break;
  }
  return kept;
}

/* ------------------------------------------------------------------ *
 * A group as printed
 * ------------------------------------------------------------------ */

function blockOf(doc: InspectionExport, definition: BlockDefinition, entries: readonly Placed[], width: number): PhotoBlock {
  const title =
    typeof definition.title === "string" ? definition.title : shortTitleFor(definition.title.module, moduleOf(doc, definition.title.module)?.title ?? "");
  const tile = tileWidth(definition.columns, width);
  return {
    key: definition.key,
    title,
    note: fitNote(title, noteWordings(doc, definition.key, entries), width),
    columns: definition.columns,
    aspect: definition.aspect,
    lead: definition.lead === true && entries.length >= LEAD_PHOTOS,
    continued: false,
    photos: entries.map((entry) => tileOf(doc, definition.key, title, entry, tile)),
  };
}

/**
 * A photo's caption, kept to three lines of its tile: labels by their size
 * ("Size S"), the artwork's own words after it ("Size S, front") and a label
 * check that failed in bold; any other by the inspector's caption, else
 * Steri-AI's description ("Pinhole, palm area"), else the defect tagged in
 * the template's wording ("Pin Hole, Palm"), else none. A caption is bold
 * where the photo shows a defect, plain for the setting ("Test rig").
 */
function tileOf(doc: InspectionExport, block: PhotoBlockKey, blockTitle: string, entry: Placed, tile: number): PhotoTile {
  const { photo, target, tag } = entry;
  const words = photoWords(photo);
  const sized = target.size ? `Size ${sizeLabel(doc, target.size)}` : null;
  const defect = target.defect ? defectName(doc, tag, target.defect, target.level) : null;
  let caption: string | null = null;
  let strong = false;
  if ((block === "cartonLabels" || block === "dispenserArtwork") && sized) {
    caption = [sized, block === "cartonLabels" ? defect : (defect ?? text(photo.caption))].filter(Boolean).join(", ");
    strong = defect !== null;
  } else if (words) {
    caption = words;
    strong = entry.shows === "defect";
  } else if (defect) {
    caption = defect;
    strong = true;
  }
  return {
    id: photo.id,
    url: photo.url,
    caption: caption === null ? null : clipToLines(caption, tile, 8.5, strong ? "bold" : "regular", PHOTO_ROOM.captionLines),
    strong,
    alt: [blockTitle, sized, words ?? defect].filter(Boolean).join(", "),
    markers: photo.markers.map((marker) => ({ ...marker })),
    size: photo.size ? { ...photo.size } : null,
  };
}

/**
 * A defect a photo is tagged with, as its module words it: a pinhole by its
 * place ("Pin Hole, Finger"), a visual or dispensing defect or a label check
 * by its name; a one-off defect by the words it was tagged with.
 */
function defectName(doc: InspectionExport, tag: string | null, code: string, level?: string): string {
  const source = tag !== null && isModuleKey(tag) ? moduleOf(doc, tag) : null;
  if (!source) return code;
  const named = (entries: unknown) => text(rec(list(entries).find((entry) => rec(entry).code === code)).label);
  const own = labelOf(source, code, code);
  switch (source.key) {
    case "watertight": {
      const place = named(at(source.config, "locations")) ?? named(at(source.computed, "locations"));
      return place ? `${labelOf(source, "holes", "Pin Hole")}, ${place.replace(/\s*:\s*$/, "")}` : own;
    }
    case "visual":
      return ["critical", "major", "minor"].map((kind) => named(at(source.config, "classes", kind, "defects"))).find(Boolean) ?? own;
    case "dispensing_safedon":
      return named(at(source.config, "defects")) ?? own;
    case "labeling": {
      for (const each of level === "inner" || level === "carton" ? [level] : ["inner", "carton"]) {
        const name = named(at(source.config, "levels", each, "checks"));
        if (name) return labelOf(source, `${each}.${code}`, labelOf(source, code, name));
      }
      return own;
    }
    default:
      return own;
  }
}

/**
 * At the heading's right, from the data: where and when the goods were
 * sampled, what the labels show, what was tested, and that defects are
 * ringed where a photo has rings (TG35: "Defects circled in orange"); its
 * wordings fullest first, for fitNote to choose the first that stays on one
 * line.
 */
function noteWordings(doc: InspectionExport, key: PhotoBlockKey, entries: readonly Placed[]): string[] {
  const sizes = orderedSizes(doc);
  const computed = (module: ModuleKey) => moduleOf(doc, module)?.computed;
  const ringed = entries.some((entry) => hasRings(entry.photo));
  switch (key) {
    case "finishedGoods": {
      const header = moduleOf(doc, "header");
      const maker = text(header?.computed.manufacturer) ?? text(doc.template.manufacturer?.name);
      const place = maker && entries.some((entry) => entry.tag === "media_warehouse") ? `${maker} warehouse` : maker;
      const day = longDate(text(header?.computed.inspectionDate) ?? text(header?.data.inspectionDate));
      return wordings([place, day].filter(Boolean).join(", "), [maker, day].filter(Boolean).join(", "), place, day);
    }
    case "cartonLabels":
    case "dispenserArtwork": {
      const labeling = moduleOf(doc, "labeling");
      const read = labeling ? checkedFor(levelChecks(labeling, key === "cartonLabels" ? "carton" : "inner", sizes)) : [];
      // All the checks, then the first few and how many more.
      return wordings(...read.map((_, index) => sentenceCase(index === 0 ? andList(read) : `${read.slice(0, read.length - index).join(", ")} and ${index} more`)));
    }
    case "layering": {
      const boxes = totalOf(sizes.map((size) => num(at(computed("dispensing_packing"), "sizes", size, "boxesTested"))));
      return wordings(boxes ? `${counted(boxes, "box", "boxes")} tested` : null);
    }
    case "dispensing": {
      const gloves = totalOf(sizes.map((size) => num(at(computed("dispensing_safedon"), "sizes", size, "glovesInspected"))));
      return wordings(gloves ? `${counted(gloves, "glove")} inspected` : null);
    }
    case "aged": {
      // The ageing as TG35 states it (AGEING_CONDITION), then the samples: "Aged at 70 °C for 7 days, one box per size: S, M, L and XL".
      const aged = sizes.filter((size) => Object.keys(rec(at(computed("dispensing_packing"), "sizes", size, "agedSample"))).length > 0).map((size) => sizeLabel(doc, size));
      if (aged.length === 0) return wordings(AGEING_SENTENCE);
      if (aged.length === 1) return wordings(`${AGEING_SENTENCE}, one box, size ${aged[0]}`, AGEING_SENTENCE);
      return wordings(`${AGEING_SENTENCE}, one box per size: ${andList(aged)}`, `${AGEING_SENTENCE}, one box per size`, AGEING_SENTENCE);
    }
    case "visual":
      return wordings(ringed ? RINGED_NOTE : null);
    case "watertight": {
      const perSize = sizes.map((size) => rec(at(computed("watertight"), "sizes", size)));
      const tested = totalOf(perSize.map((entry) => num(entry.tested) ?? num(entry.n)));
      const found = tested ? `${counted(totalOf(perSize.map((entry) => num(entry.totalDefects))) ?? 0, "pinhole")} in ${counted(tested, "glove")}` : null;
      return wordings(ringed && found ? `${found}; leaks circled in red` : null, found, ringed ? RINGED_NOTE : null);
    }
    case "forceAtBreak": {
      const data = moduleOf(doc, "force_at_break")?.data;
      const specimens = totalOf(sizes.map((size) => list(at(data, "sizes", size, "values")).filter((value) => num(value) !== null).length || null));
      return wordings(specimens ? `${counted(specimens, "specimen")} tested` : null);
    }
    default:
      return [];
  }
}

/** The note where a group's photos have rings drawn on them, red as the report draws them. */
const RINGED_NOTE = "Defects circled in red";

/** The wordings with something in them, each once, in order. */
function wordings(...options: (string | null | undefined)[]): string[] {
  return [...new Set(options.filter((option): option is string => !!option))];
}

/**
 * A group's note on one line beside its heading (BlockHeading: the title at
 * 12 pt, 6 mm, the note at 8.5 pt): the first wording that fits, else the
 * last cut at a word with an ellipsis; null without one.
 */
function fitNote(title: string, options: readonly string[], width: number): string | null {
  if (options.length === 0) return null;
  const room = width - textWidth(title, 12, "bold") - PHOTO_ROOM.noteGap;
  return options.find((option) => textWidth(option, 8.5) <= room) ?? clipToLines(options[options.length - 1], room, 8.5, "regular", 1);
}

/** The sum of the values known; null when none is. */
function totalOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function sentenceCase(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/* ------------------------------------------------------------------ *
 * The pages
 *
 * The records flow from page to page, a page filling before the next starts
 * (Kenneth, 27 October 2026, of a record of one row on a page two-thirds
 * blank and the next of one photo: "the photo section is wasting space").
 * A record starts under the record before, a gap between them, where its
 * heading, its first group's heading and that group's first row of tiles
 * fit what the page has left; else it starts the next page. Each record
 * keeps its heading where it starts. Its groups follow in order: a group the
 * page cannot hold whole breaks between its rows of tiles (the large photo's
 * two rows go together), the rest going on at the top of the next page,
 * under the record's heading again ("(Continued)") and the group's, with
 * "Continued" beside it; a group whose first row does not fit starts the
 * next page. The heights are estimated from the components' sizes
 * (PhotoGrid, BlockHeading, SectionHeading, in millimetres, at the paper's
 * content width, the words by Outfit's own widths: ../measure.ts), each a
 * little over Chrome's drawing, against the room paperRoom leaves.
 * ------------------------------------------------------------------ */

export const PHOTO_ROOM = {
  /** The kicker and the title (SectionHeading: 14.0 mm as Chrome draws them). */
  heading: 14.1,
  /** Between the heading and the groups, and between groups. */
  gap: 4.6,
  /** Between a record and the next on the same page: more than between groups, so the next record's heading reads as a new start. */
  recordGap: 8,
  /** A group's heading (BlockHeading, its title and note on one baseline) and the space under it; a line more where its note wraps. */
  blockHeading: 5.6,
  blockLine: 4.2,
  blockGap: 2.4,
  /** Between a group's title and its note (BlockHeading's 6 mm). */
  noteGap: 6,
  /** The grid's gaps, a caption's gap and line, the lines a caption keeps. */
  columnGap: 3,
  rowGap: 2.4,
  captionGap: 1.4,
  captionLine: 4.2,
  captionLines: 3,
} as const;

/** Beside the heading of a group's rest on the next page, in place of its note (as Section 06's tables say it). */
export const CONTINUED_GROUP = "Continued";

const ASPECT_RATIO: Readonly<Record<PhotoBlock["aspect"], number>> = { "3/2": 1.5, "4/3": 4 / 3, "1/1": 1 };

function tileWidth(columns: number, width: number): number {
  return (width - (columns - 1) * PHOTO_ROOM.columnGap) / columns;
}

/**
 * A group's rows of tiles as the grid lays them, each with how many photos
 * it holds and its height (its tiles, and its longest caption, at most three
 * lines). The large photo spans two rows and two columns, the photos beside
 * it filling the other columns of those rows: those two rows are one here,
 * as a group never breaks inside them.
 */
export function photoRows(block: PhotoBlock, width: number): { count: number; height: number }[] {
  const tile = tileWidth(block.columns, width);
  const caption = (photo: PhotoTile) =>
    photo.caption ? PHOTO_ROOM.captionGap + Math.min(PHOTO_ROOM.captionLines, lineCount(photo.caption, tile, 8.5, photo.strong ? "bold" : "regular")) * PHOTO_ROOM.captionLine : 0;
  const row = (photos: readonly PhotoTile[]) => tile / ASPECT_RATIO[block.aspect] + Math.max(0, ...photos.map(caption));
  const rows: { count: number; height: number }[] = [];
  let start = 0;
  if (block.lead && block.photos.length > 1) {
    // The large photo's caption is not drawn; beside it, two rows of the columns it leaves.
    const across = block.columns - 2;
    const beside = block.photos.slice(1, 1 + 2 * across);
    rows.push({ count: 1 + beside.length, height: row(beside.slice(0, across)) + PHOTO_ROOM.rowGap + row(beside.slice(across)) });
    start = 1 + beside.length;
  }
  for (; start < block.photos.length; start += block.columns) {
    const photos = block.photos.slice(start, start + block.columns);
    rows.push({ count: photos.length, height: row(photos) });
  }
  return rows;
}

/** A group's heading and the space under it: a line more only for a title too long for its line with what stands beside it (fitNote keeps a note to it). */
function blockHeadHeight(block: PhotoBlock, width: number): number {
  const aside = block.continued ? CONTINUED_GROUP : block.note;
  const heading = textWidth(block.title, 12, "bold") + (aside ? PHOTO_ROOM.noteGap + textWidth(aside, 8.5) : 0);
  return PHOTO_ROOM.blockHeading + (heading > width ? PHOTO_ROOM.blockLine : 0) + PHOTO_ROOM.blockGap;
}

/** A group's height in millimetres: its heading, and its grid laid out as CSS lays it (the lead over two rows and two columns). */
export function photoBlockHeight(block: PhotoBlock, width: number): number {
  const rows = photoRows(block, width);
  return blockHeadHeight(block, width) + rows.reduce((sum, row) => sum + row.height, 0) + Math.max(0, rows.length - 1) * PHOTO_ROOM.rowGap;
}

/** A group's first `take` rows, and the rest (null when nothing is left), headed "Continued" on its page, a plain grid. */
function blockPieces(block: PhotoBlock, rows: readonly { count: number }[], take: number): [PhotoBlock, PhotoBlock | null] {
  const count = rows.slice(0, take).reduce((sum, row) => sum + row.count, 0);
  if (count >= block.photos.length) return [block, null];
  return [
    { ...block, photos: block.photos.slice(0, count) },
    { ...block, note: null, lead: false, continued: true, photos: block.photos.slice(count) },
  ];
}

/**
 * The records' pages, each record's heading where it starts: under the
 * record before when its heading, its first group's heading and first row
 * fit there, else on the next page; its groups in order, a group the page
 * cannot hold breaking between its rows, the rest on the next page under
 * the record's heading again ("(Continued)").
 */
export function photoPages(records: readonly PhotoRecord[], room: number, width: number): PhotoRecordPage[] {
  const pages: PhotoRecordPage[] = [];
  let page: PhotoRecordPart[] = [];
  let used = 0;
  const open = (part: PhotoRecordPart) => {
    used += (page.length > 0 ? PHOTO_ROOM.recordGap : 0) + PHOTO_ROOM.heading;
    page.push(part);
  };
  const turn = () => {
    pages.push({ records: page });
    page = [];
    used = 0;
  };
  records.forEach((record, index) => {
    const kicker = `Photo Record ${index + 1} of ${records.length}`;
    const [first] = record.blocks;
    const opening = PHOTO_ROOM.heading + (first ? PHOTO_ROOM.gap + blockHeadHeight(first, width) + (photoRows(first, width)[0]?.height ?? 0) : 0);
    if (page.length > 0 && used + PHOTO_ROOM.recordGap + opening > room) turn();
    let part: PhotoRecordPart = { key: record.key, kicker, title: record.title, blocks: [] };
    open(part);
    for (const block of record.blocks) {
      let rest: PhotoBlock | null = block;
      while (rest) {
        const rows = photoRows(rest, width);
        let take = 0;
        let height = blockHeadHeight(rest, width);
        for (; take < rows.length; take += 1) {
          const longer = height + (take > 0 ? PHOTO_ROOM.rowGap : 0) + rows[take].height;
          if (used + PHOTO_ROOM.gap + longer > room) break;
          height = longer;
        }
        if (take === 0 && part.blocks.length === 0) {
          if (page.length > 1) {
            // Only its heading would fit under the record before: the record starts the next page.
            page.pop();
            turn();
            open(part);
            continue;
          }
          // Alone on its page, a row goes on it whatever the room, so every photo lands.
          take = 1;
        }
        if (take > 0) {
          const [piece, after] = blockPieces(rest, rows, take);
          part.blocks.push(piece);
          used += PHOTO_ROOM.gap + photoBlockHeight(piece, width);
          rest = after;
        }
        if (rest) {
          turn();
          part = { key: record.key, kicker, title: `${record.title} (Continued)`, blocks: [] };
          open(part);
        }
      }
    }
  });
  if (page.length > 0) pages.push({ records: page });
  return pages;
}

/* ------------------------------------------------------------------ *
 * The builder
 * ------------------------------------------------------------------ */

export function buildPhotos(doc: InspectionExport): PhotosSection | null {
  const records = photoRecordsOf(doc);
  if (records.length === 0) return null;
  const pages = photoPages(records, paperRoom(doc), contentWidthOf(doc));
  return { pageCount: pages.length, pages };
}

export const photos: SectionBuilder<"photos"> = { key: "photos", build: (doc) => buildPhotos(doc) };
