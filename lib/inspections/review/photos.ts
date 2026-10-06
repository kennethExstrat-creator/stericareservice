// Report photos on the review (BUILD_SPEC 8.1): each with the module, size,
// hand, defect or box it was tagged with at capture, in the template's
// wording. Pure; the loader signs the URLs and looks up defect names.
import type { PhotoTags } from "@/components/qc/photo-tags";
import { formatHand, formatSize, formatSizeHand, type SizeOption } from "@/lib/format";
import { parseTarget } from "@/lib/photos/target";
import { isModuleKey } from "@/lib/schemas/module-result";
import { labelFor, type Labels } from "@/modules/_framework";
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

/** Section titles, labels and sizes in the template's wording, for photo tags. */
export type SectionWording = {
  title(key: string | null): string;
  /** A defect code as the module labels it, or null when the module has no label for it. */
  defectLabel(key: string | null, code: string): string | null;
  /** The template's sizes, whose labels ("Medium") name a size. */
  sizes: readonly SizeOption[];
};

export function sectionWording(evaluation: ReviewEvaluation): SectionWording {
  const titles = new Map<string, string>();
  const labels = new Map<string, Labels>();
  if (evaluation.ok) {
    for (const entry of evaluation.report.modules) {
      titles.set(entry.key, entry.title);
      labels.set(entry.key, entry.labels);
    }
    for (const entry of evaluation.report.excluded) titles.set(entry.key, entry.title);
    for (const entry of evaluation.report.custom) titles.set(entry.custom.key, entry.custom.title);
  }
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
    sizes: evaluation.ok ? evaluation.context.templateSizes : [],
  };
}

/**
 * Defects the photos are tagged with that their module has no label for:
 * the loader names them from defect_codes. A one-off defect (BUILD_SPEC 8)
 * is tagged with its own label and simply finds no code.
 */
export function unlabelledDefects(rows: readonly PhotoRow[], wording: SectionWording): string[] {
  const codes = rows.flatMap((row) => {
    const parsed = parseTarget(row.target);
    const defect = parsed.ok ? parsed.target.defect : undefined;
    return defect && wording.defectLabel(row.module_key, defect) === null ? [defect] : [];
  });
  return [...new Set(codes)];
}

/** A photo's tags, caption and text alternative; the URLs are added by the loader. */
export function describePhoto(
  row: PhotoRow,
  wording: SectionWording,
  defectNames: ReadonlyMap<string, string> = new Map(),
): Omit<ReviewPhoto, "thumbUrl" | "fullUrl"> {
  const parsed = parseTarget(row.target);
  const target = parsed.ok ? parsed.target : {};
  const defect = target.defect
    ? (wording.defectLabel(row.module_key, target.defect) ?? defectNames.get(target.defect) ?? target.defect)
    : undefined;
  const section = wording.title(row.module_key);
  const box = target.box !== undefined ? String(target.box) : undefined;
  const tags: PhotoTags = {
    module: section,
    // PhotoTile says "Size" before it: "Size Medium".
    ...(target.size ? { size: formatSize(target.size, { sizes: wording.sizes }) } : {}),
    ...(target.hand ? { hand: target.hand } : {}),
    ...(defect ? { defect } : {}),
    ...(box ? { box } : {}),
  };
  // "Size M, right hand", as the capture kit names a size and hand.
  const where = target.size
    ? formatSizeHand(target.size, target.hand, { sizes: wording.sizes })
    : target.hand
      ? formatHand(target.hand).toLowerCase()
      : undefined;
  const description = [section, where, defect, box && `Box ${box}`].filter(Boolean).join(", ");
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
