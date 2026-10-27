// Exports for the report's tests, from the placeholder example reports
// (docs/FIXTURES.md; never client data): STD_EG (size M only, no client,
// force at break and the packing check) as the AI fixtures build it, and
// SAFEDON_EG (sizes XS to L, Client A, tensile and Safedon dispensing, the
// tensile lab report not attached), each run through the real modules and
// the export's own assembly. A section's tests read both: one size and
// several, both tests of each kind.
import { makeStdEgExport } from "@/lib/ai/__fixtures__/std-eg-export";
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import { stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { CLIENT_ID, safedonEgData, seedTemplate } from "@/tests/acceptance/examples";

export { makeStdEgExport };

const EXPORTED_AT = "2025-02-20T09:00:00.000Z";

/** The SAFEDON_EG example as the export reads it: Client A, sizes XS to L. */
export function safedonRecord(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  const base = stdEgRecord();
  if (!base.template) throw new Error("The STD_EG fixture has no template row.");
  return {
    ...base,
    refNo: "INS-2026-0002",
    inspectionDate: "2025-02-19",
    data: safedonEgData(),
    client: { id: CLIENT_ID, name: "Client A", logoPath: null },
    photos: [],
    files: [],
    template: { ...base.template, code: "SAFEDON_EG", standard: "ASTM_D6319", resolved: seedTemplate("SAFEDON_EG") },
    ...overrides,
  };
}

let safedon: InspectionExport | null = null;

/** A fresh copy of the SAFEDON_EG export on every call, so tests can change it freely. */
export function makeSafedonExport(): InspectionExport {
  if (!safedon) {
    const record = safedonRecord();
    const evaluation = evaluateRecord(record);
    if (!evaluation.ok) throw new Error(`The SAFEDON_EG fixture does not evaluate: ${evaluation.message}`);
    const doc = assembleExport({
      record,
      evaluated: evaluation.evaluated,
      links: { photos: new Map(), files: new Map(), clientLogo: null, sourceFile: null },
      exportedAt: EXPORTED_AT,
    });
    safedon = ExportSchema.parse(doc);
  }
  return structuredClone(safedon);
}

/** An export with these report options over what it carries: the block parsed as the export parses it. */
export function withReportOptions(doc: InspectionExport, report: Record<string, unknown>): InspectionExport {
  return ExportSchema.parse({ ...doc, report: { ...doc.report, ...report } });
}
