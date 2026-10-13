import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import { STD_EG_IDS, stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import { ExportSchema, type InspectionExport } from "@/lib/schemas";

/* ------------------------------------------------------------------ *
 * STD_EG example as a submitted export (docs/examples/expected-results.md, B)
 *
 * Not typed by hand: the example inspection (lib/export/__fixtures__/
 * std-eg.ts: the anonymised report in each real module's data shape, on
 * the STD_EG seed template resolved against the real modules) goes
 * through the framework and the export's own assembly, with placeholder
 * signed links. A module whose data, computed values or results change
 * changes this export, and the tests that read it notice.
 *
 * State: submitted after the carton error was fixed, with the weight
 * warning (2.9 g against 3.5 g indicative, 17.1% below) and box 2336's
 * (not among size M's sampled box/carton numbers) still in the export; the
 * force-at-break lab report attached; five photos, one a flagged HEIC
 * original.
 * ------------------------------------------------------------------ */

export const FIXTURE_IDS = STD_EG_IDS;

const EXPORTED_AT = "2025-04-12T09:15:00.000Z";

/** Placeholder signed links, one per stored object; the token never reaches a model. */
function placeholderUrl(bucket: string, path: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return `https://storage.example.com/${bucket}/${name}?token=placeholder`;
}

let built: InspectionExport | null = null;

function build(): InspectionExport {
  const record = stdEgRecord();
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(`The STD_EG fixture does not evaluate: ${evaluation.message}`);
  const doc = assembleExport({
    record,
    evaluated: evaluation.evaluated,
    links: {
      photos: new Map(record.photos.map((photo) => [photo.storagePath, placeholderUrl("inspection-photos", photo.storagePath)])),
      files: new Map(record.files.map((file) => [file.storagePath, placeholderUrl("inspection-files", file.storagePath)])),
      clientLogo: null,
      sourceFile: null,
    },
    exportedAt: EXPORTED_AT,
  });
  return ExportSchema.parse(doc);
}

/** A fresh copy on every call, so tests can change it freely. */
export function makeStdEgExport(): InspectionExport {
  built ??= build();
  return structuredClone(built);
}
