// The photo records (TG35 pages 9 to 11): after the sections, a page per
// record the options switch on, each in the design's groups of photos under
// their headings, "Photo Record 1 of 3" numbered among the records shown.
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
// (mediaCategory), and its target (size, defect, packaging level). The
// photos are those marked In Report, or every photo while none is, a flagged
// original left out (as photoGroupsOf in ../model.ts chooses them); at most
// Photos per Group in a record, shared in turn among its groups, so none is
// crowded out. A photo naming a defect is captioned with it in bold; the
// rest keep the inspector's caption. A group with no photos is left out, and
// a record with none. A record its page cannot hold continues on the next.
//
// Typed by SectionBuilder, never importing the registry at run time (as
// ./labellingConclusion.ts explains).
import { isMediaCategoryKey, type MediaCategoryKey } from "@/lib/inspections/source-documents";
import { parseTarget, type PhotoTarget } from "@/lib/photos/target";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { isModuleKey, type ModuleKey } from "@/lib/schemas/module-result";
import { REPORT_PHOTO_GROUPS, type ReportPhotoGroupKey } from "@/lib/schemas/report-options";
import { shortTitleFor } from "@/lib/templates/short-titles";
import { andList, counted, longDate } from "../format";
import type { PhotoBlock, PhotoRecordPage, PhotosSection, PhotoTile } from "../model";
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

/** Finished Goods Sampling's order: the warehouse first (the large photo), then the steps' photos, the samples, the inspection under way. */
const FINISHED_GOODS_RANK: Readonly<Record<string, number>> = { media_warehouse: 0, media_samples: 2, media_proof: 3 };

/** A packing check photo of the aged sample, which has no box/carton number to tag: its caption says so. */
const AGED = /\bag(?:e)?(?:d|ing)\b/i;

/** The large photo and the four that fill the two rows beside it: fewer, and the group is a plain row. */
const LEAD_PHOTOS = 5;

/* ------------------------------------------------------------------ *
 * Choosing the photos
 * ------------------------------------------------------------------ */

type Placed = { photo: ExportPhoto; index: number; tag: string | null; target: PhotoTarget; block: PhotoBlockKey };

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
    const block = blockFor(doc, tag, target, photo.caption);
    return block ? [{ photo, index, tag, target, block }] : [];
  });
  const width = contentWidthOf(doc);
  return REPORT_PHOTO_GROUPS.flatMap((group): PhotoRecord[] => {
    if (!doc.report.photos.groups[group.key]) return [];
    const definitions = PHOTO_BLOCKS[group.key];
    const candidates = definitions.map((definition) => inOrder(doc, definition.key, placed.filter((entry) => entry.block === definition.key)));
    const kept = shared(candidates, doc.report.photos.perGroup);
    const blocks = definitions.flatMap((definition, index) => (kept[index].length === 0 ? [] : [blockOf(doc, definition, kept[index], width)]));
    return blocks.length === 0 ? [] : [{ key: group.key, title: group.title, blocks }];
  });
}

function blockFor(doc: InspectionExport, tag: string | null, target: PhotoTarget, caption: string | null): PhotoBlockKey | null {
  if (tag === null) return null;
  if (isMediaCategoryKey(tag)) return MEDIA_PHOTO_BLOCK[tag];
  if (!isModuleKey(tag)) return null;
  if (tag === "labeling") return labelLevelOf(doc, target) === "inner" ? "dispenserArtwork" : "cartonLabels";
  if (tag === "dispensing_packing" && AGED.test(caption ?? "")) return "aged";
  return MODULE_PHOTO_BLOCK[tag] ?? null;
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
  const budget = captionBudget(definition.columns, width);
  return {
    key: definition.key,
    title,
    note: noteOf(doc, definition.key, entries),
    columns: definition.columns,
    aspect: definition.aspect,
    lead: definition.lead === true && entries.length >= LEAD_PHOTOS,
    photos: entries.map((entry) => tileOf(doc, definition.key, title, entry, budget)),
  };
}

/**
 * A photo's caption: labels by their size ("Size S", the artwork's own words
 * after it: "Size S, front"); a photo naming a defect by the inspector's
 * caption or the defect's name in the template's wording, in bold; any other
 * by the inspector's caption. Kept to three lines of its tile.
 */
function tileOf(doc: InspectionExport, block: PhotoBlockKey, blockTitle: string, entry: Placed, budget: number): PhotoTile {
  const { photo, target, tag } = entry;
  const own = text(photo.caption);
  const sized = target.size ? `Size ${sizeLabel(doc, target.size)}` : null;
  const defect = target.defect ? defectName(doc, tag, target.defect, target.level) : null;
  let caption: string | null;
  if (block === "cartonLabels") caption = sized ? [sized, defect].filter(Boolean).join(", ") : (own ?? defect);
  else if (block === "dispenserArtwork") caption = sized ? [sized, defect ?? own].filter(Boolean).join(", ") : (own ?? defect);
  else caption = own ?? defect;
  return {
    id: photo.id,
    url: photo.url,
    caption: caption === null ? null : clipped(caption, budget * PHOTO_ROOM.captionLines),
    strong: caption !== null && (defect !== null || tag === "media_defects"),
    alt: [blockTitle, sized, own ?? defect].filter(Boolean).join(", "),
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

/** At the heading's right, from the data: where and when the goods were sampled, what the labels show, what was tested. */
function noteOf(doc: InspectionExport, key: PhotoBlockKey, entries: readonly Placed[]): string | null {
  const sizes = orderedSizes(doc);
  const computed = (module: ModuleKey) => moduleOf(doc, module)?.computed;
  switch (key) {
    case "finishedGoods": {
      const header = moduleOf(doc, "header");
      const maker = text(header?.computed.manufacturer) ?? text(doc.template.manufacturer?.name);
      const place = maker && entries.some((entry) => entry.tag === "media_warehouse") ? `${maker} warehouse` : maker;
      const day = longDate(text(header?.computed.inspectionDate) ?? text(header?.data.inspectionDate));
      return [place, day].filter(Boolean).join(", ") || null;
    }
    case "cartonLabels":
    case "dispenserArtwork": {
      const labeling = moduleOf(doc, "labeling");
      const read = labeling ? checkedFor(levelChecks(labeling, key === "cartonLabels" ? "carton" : "inner", sizes)) : [];
      return read.length > 0 ? sentenceCase(andList(read)) : null;
    }
    case "layering": {
      const boxes = totalOf(sizes.map((size) => num(at(computed("dispensing_packing"), "sizes", size, "boxesTested"))));
      return boxes ? `${counted(boxes, "box", "boxes")} tested` : null;
    }
    case "dispensing": {
      const gloves = totalOf(sizes.map((size) => num(at(computed("dispensing_safedon"), "sizes", size, "glovesInspected"))));
      return gloves ? `${counted(gloves, "glove")} inspected` : null;
    }
    case "aged": {
      const aged = sizes.filter((size) => Object.keys(rec(at(computed("dispensing_packing"), "sizes", size, "agedSample"))).length > 0).map((size) => sizeLabel(doc, size));
      if (aged.length === 0) return null;
      return aged.length === 1 ? `One box, size ${aged[0]}` : `One box per size: ${andList(aged)}`;
    }
    case "watertight": {
      const perSize = sizes.map((size) => rec(at(computed("watertight"), "sizes", size)));
      const tested = totalOf(perSize.map((entry) => num(entry.tested) ?? num(entry.n)));
      return tested ? `${counted(totalOf(perSize.map((entry) => num(entry.totalDefects))) ?? 0, "pinhole")} in ${counted(tested, "glove")}` : null;
    }
    case "forceAtBreak": {
      const data = moduleOf(doc, "force_at_break")?.data;
      const specimens = totalOf(sizes.map((size) => list(at(data, "sizes", size, "values")).filter((value) => num(value) !== null).length || null));
      return specimens ? `${counted(specimens, "specimen")} tested` : null;
    }
    default:
      return null;
  }
}

/** The sum of the values known; null when none is. */
function totalOf(values: readonly (number | null)[]): number | null {
  const known = values.filter((value): value is number => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function sentenceCase(words: string): string {
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** Words cut at a word's end, with an ellipsis, where they run past `max` characters. */
function clipped(words: string, max: number): string {
  if (words.length <= max) return words;
  const cut = words.slice(0, Math.max(1, max - 1));
  const space = cut.lastIndexOf(" ");
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}…`;
}

/* ------------------------------------------------------------------ *
 * The pages
 *
 * A record is a page in the design. Its groups are estimated from the
 * components' sizes (PhotoGrid, BlockHeading, SectionHeading, in
 * millimetres, at the paper's content width) and laid in order; a group
 * the page cannot hold starts the next page, under the record's heading
 * again ("(Continued)"). A group is never split: Photos per Group keeps a
 * record to twelve photos.
 * ------------------------------------------------------------------ */

export const PHOTO_ROOM = {
  /** The kicker and the title (SectionHeading). */
  heading: 14.1,
  /** Between the heading and the groups, and between groups. */
  gap: 4.6,
  /** A group's heading (BlockHeading, its title and note on one baseline) and the space under it; a line more where its note wraps. */
  blockHeading: 5.6,
  blockLine: 4.2,
  blockGap: 2.4,
  /** The grid's gaps, a caption's gap and line, the lines a caption keeps. */
  columnGap: 3,
  rowGap: 2.4,
  captionGap: 1.4,
  captionLine: 4.2,
  captionLines: 3,
  /** The millimetres a character takes: of a caption at 8.5 pt, of a heading at 12 pt. */
  characterWidth: 1.65,
  headingCharacterWidth: 2.4,
} as const;

const ASPECT_RATIO: Readonly<Record<PhotoBlock["aspect"], number>> = { "3/2": 1.5, "4/3": 4 / 3, "1/1": 1 };

function tileWidth(columns: number, width: number): number {
  return (width - (columns - 1) * PHOTO_ROOM.columnGap) / columns;
}

/** The characters a caption's line holds in a tile, a few short of full so a line's last word never spills. */
function captionBudget(columns: number, width: number): number {
  return Math.max(8, Math.floor(tileWidth(columns, width) / PHOTO_ROOM.characterWidth) - 4);
}

/** A group's height in millimetres: its heading, and its grid laid out as CSS lays it (the lead over two rows and two columns). */
export function photoBlockHeight(block: PhotoBlock, width: number): number {
  const tile = tileWidth(block.columns, width);
  const budget = captionBudget(block.columns, width);
  const rows: number[] = [];
  let row = 0;
  let column = 0;
  const step = () => {
    column += 1;
    if (column >= block.columns) {
      column = 0;
      row += 1;
    }
  };
  block.photos.forEach((photo, index) => {
    if (block.lead && index === 0) {
      rows[0] = 0;
      rows[1] = 0;
      return;
    }
    while (block.lead && row < 2 && column < 2) step();
    const captionLines = photo.caption ? Math.min(PHOTO_ROOM.captionLines, Math.ceil(photo.caption.length / budget)) : 0;
    rows[row] = Math.max(rows[row] ?? 0, captionLines);
    step();
  });
  const grid =
    rows.reduce((sum, captionLines) => sum + tile / ASPECT_RATIO[block.aspect] + (captionLines > 0 ? PHOTO_ROOM.captionGap + captionLines * PHOTO_ROOM.captionLine : 0), 0) +
    Math.max(0, rows.length - 1) * PHOTO_ROOM.rowGap;
  const heading = block.title.length * PHOTO_ROOM.headingCharacterWidth + 6 + (block.note?.length ?? 0) * PHOTO_ROOM.characterWidth;
  return PHOTO_ROOM.blockHeading + (heading > width ? PHOTO_ROOM.blockLine : 0) + PHOTO_ROOM.blockGap + grid;
}

/** The records' pages: each record's groups in order, a group its page cannot hold starting the next. */
export function photoPages(records: readonly PhotoRecord[], room: number, width: number): PhotoRecordPage[] {
  const pages: PhotoRecordPage[] = [];
  records.forEach((record, index) => {
    const kicker = `Photo Record ${index + 1} of ${records.length}`;
    let page: PhotoRecordPage = { key: record.key, kicker, title: record.title, blocks: [] };
    let used = PHOTO_ROOM.heading;
    for (const block of record.blocks) {
      const height = PHOTO_ROOM.gap + photoBlockHeight(block, width);
      if (page.blocks.length > 0 && used + height > room) {
        pages.push(page);
        page = { key: record.key, kicker, title: `${record.title} (Continued)`, blocks: [] };
        used = PHOTO_ROOM.heading;
      }
      page.blocks.push(block);
      used += height;
    }
    pages.push(page);
  });
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
