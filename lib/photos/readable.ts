// A Source Document as it is uploaded and read (docs/AI.md, "Source
// Documents"): a photo as a 2048 px JPEG, as every photo is made, so the AI
// can read it; a PDF, or a photo this browser cannot convert (a HEIC in
// Chrome), as it is. The capture screen's Files and New Inspection's card
// both hold documents this way. Browser only.
import { browserCodec } from "./browser-codec";
import { processPhoto } from "./process";

export async function readableFile(file: File): Promise<File> {
  if (!file.type.startsWith("image/")) return file;
  const result = await processPhoto(file, { codec: browserCodec() }).catch(() => null);
  if (!result?.ok || result.photo.flagged) return file;
  return new File([result.photo.blob], `${file.name.replace(/\.[^.]+$/, "")}.jpg`, { type: "image/jpeg" });
}
