// What Steri-AI says a photo shows (docs/AI.md, "Describing photos"; Kenneth,
// 27 October 2026: "loop in AI to identify properly rather than squeezing in
// all photos without analyzing"): the export's photos[].description, kept on
// the photo's row (inspection_photos.ai_description, migration
// 20261027200000). A caption in the report's style, whether the photo shows a
// defect or the setting, the template's own defect and hole location codes,
// and how clearly it shows. Captions only: the inspector's own caption stays
// theirs and wins in the report, and no result ever changes. The one
// definition is the export photo's (lib/schemas/export.ts); this is it
// without its null. Client-safe.
import type { z } from "zod";
import { ExportPhotoSchema } from "./export";

export const PhotoDescriptionSchema = ExportPhotoSchema.shape.description.unwrap().unwrap();
export type PhotoDescription = z.infer<typeof PhotoDescriptionSchema>;

/** A caption under a photo, at most this long: "Pinhole, palm area", "Ringed mark, thin area", "Test rig". */
export const PHOTO_DESCRIPTION_TEXT_MAX = PhotoDescriptionSchema.shape.text.maxLength ?? 80;

/** A stored description (ai_description), or null when there is none or it does not read as one. */
export function readPhotoDescription(value: unknown): PhotoDescription | null {
  const parsed = PhotoDescriptionSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
