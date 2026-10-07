// Report photos on the review (BUILD_SPEC 8.1): each with the module, size,
// hand, defect, box, packaging level or list entry it was tagged with at
// capture, in the template's wording, as the gallery words them (displayTags
// in lib/inspections/photos/view.ts). The AI panel words the photos a
// finding cites the same way. Pure; the loaders sign the URLs and look up
// defect names.
import type { PhotoTags } from "@/components/qc/photo-tags";
import { formatHand, formatSize, formatSizeHand, type SizeOption } from "@/lib/format";
import { EMPTY_TAG_OPTIONS, itemName, levelName, tagOptionsFromTemplate } from "@/lib/inspections/photos/view";
import { parseTarget, type PhotoTarget } from "@/lib/photos/target";
import { isModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import type { ValidationReport } from "@/lib/validation";
import { labelFor, type InspectionContext, type Labels } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { ReviewEvaluation } from "./evaluate";

/** The inspection_photos columns the review reads. */
export type PhotoRow = {
  id: string;
  module_key: string | null;
  target: string | null;
  caption: string | null;
  storage_path: string;
  thumb_path: string | null;
  taken_at: string | null;
  flagged: boolean;
};

export type ReviewPhoto = {
  id: string;
  /** Signed URL of the 400 px thumbnail; null when there is none (a flagged original) or signing failed. */
  thumbUrl: string | null;
  /** Signed URL of the photo itself. */
  fullUrl: string | null;
  alt: string;
  tags: PhotoTags;
  caption: string | null;
  flagged: boolean;
  takenAt: string | null;
};

export const UNTAGGED = "Not tagged";

/** Section titles, labels, sizes, packaging levels and list entries in the template's wording, for photo tags. */
export type SectionWording = {
  title(key: string | null): string;
  /** A defect code as the module labels it, or null when the module has no label for it. */
  defectLabel(key: string | null, code: string): string | null;
  /** A packaging level ("carton") as the module words it: "Carton Box". */
  levelName(key: string | null, level: string): string;
  /** An entry of the module's own list (a document, a loading stage) as the template words it: "Doors closed". */
  itemName(key: string | null, item: string): string;
  /** The template's sizes, whose labels ("Medium") name a size. */
  sizes: readonly SizeOption[];
};

/** What the wording is read from: an inspection run through the module framework (the review's or the export's evaluation). */
export type WordingSource = {
  /** The inspection's copy of its template version. */
  template: ResolvedTemplate;
  context: Pick<InspectionContext, "templateSizes">;
  report: Pick<ValidationReport, "modules" | "excluded" | "custom">;
};

export function sectionWording(evaluation: ReviewEvaluation): SectionWording {
  return photoWording(evaluation.ok ? evaluation : null);
}

/** The wording of an evaluated inspection; null (results that cannot be worked out) gives the modules' own names. */
export function photoWording(source: WordingSource | null): SectionWording {
  const titles = new Map<string, string>();
  const labels = new Map<string, Labels>();
  if (source) {
    for (const entry of source.report.modules) {
      titles.set(entry.key, entry.title);
      labels.set(entry.key, entry.labels);
    }
    for (const entry of source.report.excluded) titles.set(entry.key, entry.title);
    for (const entry of source.report.custom) titles.set(entry.custom.key, entry.custom.title);
  }
  // The gallery's lists of levels and entries, from the same template.
  const lists = source ? tagOptionsFromTemplate(source.template, null, []) : EMPTY_TAG_OPTIONS;
  return {
    title: (key) => {
      if (key === null || key.trim() === "") return UNTAGGED;
      return titles.get(key) ?? (isModuleKey(key) ? MODULE_REGISTRY[key].title : key);
    },
    defectLabel: (key, code) => {
      const moduleLabels = key ? labels.get(key) : undefined;
      if (!moduleLabels) return null;
      // labelFor shows the code itself when the module has no label for it.
      const label = labelFor(moduleLabels, code);
      return label === code ? null : label;
    },
    levelName: (key, level) => levelName(key, level, lists),
    itemName: (key, item) => itemName(key, item, lists),
    sizes: source ? source.context.templateSizes : [],
  };
}

/**
 * Defects the photos are tagged with that their module has no label for:
 * the loader names them from defect_codes. A one-off defect (BUILD_SPEC 8)
 * is tagged with its own label and simply finds no code.
 */
export function unlabelledDefects(
  rows: readonly Pick<PhotoRow, "module_key" | "target">[],
  wording: SectionWording,
): string[] {
  const codes = rows.flatMap((row) => {
    const parsed = parseTarget(row.target);
    const defect = parsed.ok ? parsed.target.defect : undefined;
    return defect && wording.defectLabel(row.module_key, defect) === null ? [defect] : [];
  });
  return [...new Set(codes)];
}

/**
 * A photo's tags in the template's wording, for its tile's tag line:
 * "Packaging Labeling Inspection · Size M · Box 1324 · Carton Box". The size
 * by the template's name for it ("Medium"); the hand as R or L, which the
 * tag line spells out.
 */
export function photoTags(
  row: Pick<PhotoRow, "module_key" | "target">,
  wording: SectionWording,
  defectNames: ReadonlyMap<string, string> = new Map(),
): PhotoTags {
  const target = targetOf(row);
  const defect = target.defect ? defectWords(row, target.defect, wording, defectNames) : undefined;
  return {
    module: wording.title(row.module_key),
    // PhotoTile says "Size" before it: "Size Medium".
    ...(target.size ? { size: formatSize(target.size, { sizes: wording.sizes }) } : {}),
    ...(target.hand ? { hand: target.hand } : {}),
    ...(defect ? { defect } : {}),
    ...(target.box !== undefined ? { box: String(target.box) } : {}),
    ...(target.level !== undefined ? { level: wording.levelName(row.module_key, target.level) } : {}),
    ...(target.item !== undefined ? { item: wording.itemName(row.module_key, target.item) } : {}),
  };
}

/** A photo's tags, caption and text alternative; the URLs are added by the loader. */
export function describePhoto(
  row: PhotoRow,
  wording: SectionWording,
  defectNames: ReadonlyMap<string, string> = new Map(),
): Omit<ReviewPhoto, "thumbUrl" | "fullUrl"> {
  const target = targetOf(row);
  const tags = photoTags(row, wording, defectNames);
  // "Size M, right hand", as the capture kit names a size and hand.
  const where = target.size
    ? formatSizeHand(target.size, target.hand, { sizes: wording.sizes })
    : target.hand
      ? formatHand(target.hand).toLowerCase()
      : undefined;
  const description = [tags.module, where, tags.defect, tags.box && `Box ${tags.box}`, tags.level, tags.item]
    .filter(Boolean)
    .join(", ");
  const caption = row.caption?.trim() ? row.caption.trim() : null;
  return {
    id: row.id,
    alt: caption ? `${caption} (${description})` : `Photo: ${description}`,
    tags,
    caption,
    flagged: row.flagged,
    takenAt: row.taken_at,
  };
}

/** The photo's target; one that cannot be read tags nothing rather than failing the page. */
function targetOf(row: Pick<PhotoRow, "target">): PhotoTarget {
  const parsed = parseTarget(row.target);
  return parsed.ok ? parsed.target : {};
}

/** The module's word for the defect, else defect_codes' name, else the code or one-off label as tagged. */
function defectWords(
  row: Pick<PhotoRow, "module_key">,
  code: string,
  wording: SectionWording,
  defectNames: ReadonlyMap<string, string>,
): string {
  return wording.defectLabel(row.module_key, code) ?? defectNames.get(code) ?? code;
}
