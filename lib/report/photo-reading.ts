// Reading a photo for the report (Kenneth, 27 October 2026: "the template
// design i gave to you did list out the defect type, such as pinhole, palm
// etc. Please loop in AI to identify properly rather than squeezing in all
// photos without analyzing"): whether it shows a defect or the setting, the
// words it prints under, and the defect it is one photo of. Section 06 and
// the photo records read a photo the same way.
//
// What a photo shows comes from the strongest word on it: a ring the
// inspector drew round something; else Steri-AI's description (lib/ai's
// photo describer: a defect close-up or the setting, the template's defect
// code, how clearly it shows); else the inspector's own tags and caption
// (the capture screen's defect tag, a caption naming a defect, Media's
// Product Defects). Its words are the inspector's caption first, then
// Steri-AI's: the AI suggests, it never words over the inspector. Pure and
// client-safe.
import type { MediaCategoryKey } from "@/lib/inspections/source-documents";
import type { PhotoTarget } from "@/lib/photos/target";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import { at, list, moduleOf, rec, text } from "./read";

export type PhotoDescription = NonNullable<ExportPhoto["description"]>;

/** Media's Product Defects (Source Documents): defects found on the gloves or their packaging. */
export const PRODUCT_DEFECTS: MediaCategoryKey = "media_defects";

/** The checks a defect photo belongs to: a hole of the watertight test, or a defect of the visual inspection. */
export type DefectFamily = "holes" | "visual";

/** What a photo shows: a defect, the setting (a rig, a bench, cartons), or nothing that says. */
export type PhotoShows = "defect" | "setting" | "unsaid";

/**
 * Words that name a defect in an inspector's caption: holes and leaks, thin
 * areas and spots, stains and dirt, the critical defects, the marks, lumps
 * and beads the templates list. A word that also names other things (a
 * carton's shipping marks) counts only in a defect's phrase.
 */
const DEFECT_WORDS =
  /\b(?:pin ?holes?|holes?|leak(?:s|ing|ed|age)?|burst|tears?|torn|splits?|cracks?|cracked|thin|spots?|stains?|stained|dirt|dirty|specks?|insects?|metal|debris|foreign|embedded|blisters?|bubbles?|discolou?r\w*|defects?|defective|damaged?|residue|contaminat\w*|sticky|lumps?|(?:ring(?:ed)?|ring-shaped|flow|powder) marks?|(?:poor|rolled|broken|cracked) beads?|beading)\b/i;

/** Words that name the setting rather than a defect: "Test rig", "Inspection bench", "Carton labels". */
const SETTING_WORDS = /\b(?:rigs?|bench(?:es)?|testers?|set-?up|stations?|machines?|equipment|overview|tanks?|warehouse|pallets?|cartons?|labels?|lighting)\b/i;

/** Whether an inspector's caption names a defect: "Pinhole at palm", "Thin spot", "Stain on the cuff". */
export function namesDefect(words: string | null | undefined): boolean {
  return !!words && DEFECT_WORDS.test(words);
}

/** Whether an inspector's caption names the setting and no defect: "Test rig", "Inspection bench". */
export function namesSetting(words: string | null | undefined): boolean {
  return !!words && SETTING_WORDS.test(words) && !DEFECT_WORDS.test(words);
}

/**
 * What a photo shows. A ring drawn on it shows a defect. Steri-AI's
 * description says next: a defect close-up, or the setting (even where the
 * capture screen tagged the defect in focus when the photo was taken). Then
 * the inspector's tags and words: a defect tagged, a caption naming one, or
 * a captioned photo in Media's Product Defects, unless its caption names
 * the setting.
 */
export function photoShows(photo: ExportPhoto, target: PhotoTarget, tag: string | null): PhotoShows {
  if (photo.markers.length > 0) return "defect";
  if (photo.description) return photo.description.kind === "defect" ? "defect" : "setting";
  const own = text(photo.caption);
  if (target.defect !== undefined || namesDefect(own)) return "defect";
  if (namesSetting(own)) return "setting";
  return own !== null && tag === PRODUCT_DEFECTS ? "defect" : "unsaid";
}

/** The words a photo prints under before any fallback: the inspector's caption, else Steri-AI's. */
export function photoWords(photo: ExportPhoto): string | null {
  return text(photo.caption) ?? text(photo.description?.text);
}

/**
 * The defect a photo is one photo of, so a page shows one photo of each:
 * Steri-AI's defect code and, for a hole, its location; else the defect
 * tagged on the capture screen; else the photo alone.
 */
export function defectKey(photo: ExportPhoto, target: PhotoTarget): string {
  const described = photo.description?.kind === "defect" ? photo.description : null;
  const codes = [...new Set([described?.defect, described?.location].filter((code): code is string => !!code))];
  if (codes.length > 0) return codes.join("@");
  if (target.defect) return target.defect;
  return `photo:${photo.id}`;
}

/** The template's codes in a list of entries ({ code, label }). */
function codesIn(entries: unknown): string[] {
  return list(entries).flatMap((entry) => {
    const code = text(rec(entry).code);
    return code ? [code] : [];
  });
}

/**
 * Which check a template code is a defect of: a hole location of the
 * watertight test, or a defect of a visual class; a code shaped as a hole
 * location ("hole_palm") where the template has no watertight test; else
 * neither.
 */
export function defectFamily(doc: Pick<InspectionExport, "modules">, code: string | null | undefined): DefectFamily | null {
  if (!code) return null;
  const holes = moduleOf(doc, "watertight");
  if ([...codesIn(holes?.computed.locations), ...codesIn(rec(holes?.config).locations)].includes(code)) return "holes";
  const visual = moduleOf(doc, "visual");
  const visualCodes = (["critical", "major", "minor"] as const).flatMap((cls) => [
    ...codesIn(at(visual?.computed, "classes", cls, "defects")),
    ...codesIn(at(visual?.config, "classes", cls, "defects")),
  ]);
  if (visualCodes.includes(code)) return "visual";
  return /^hole_/.test(code) ? "holes" : null;
}

/** The check of the defect Steri-AI says a photo shows: its code's, or the holes where it names a hole location; null for the setting or a defect of neither. */
export function describedFamily(doc: Pick<InspectionExport, "modules">, photo: ExportPhoto): DefectFamily | null {
  const described = photo.description;
  if (!described || described.kind !== "defect") return null;
  return defectFamily(doc, described.defect) ?? (described.location ? "holes" : null);
}
