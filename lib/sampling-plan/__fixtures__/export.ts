// A placeholder inspection for the sampling plan's tests (docs/FIXTURES.md;
// never client data): the STD_EG example's inspection
// (lib/export/__fixtures__/std-eg.ts: PO-0001, Brand A, Manufacturer A,
// Nitrile) with Client A, ordering four sizes, S to XL, 1,000 gloves a case,
// and a sampling plan entered for them, run through the real modules and the
// export's own assembly, so the page reads what calc works out. At general
// level I, S and L are lots of code L (200 gloves), XL of code K (125), and
// M of code M, which the inspector reduced to L (200 gloves). XL takes 2
// inner boxes from each case where the others take 1, and M's boxes give 8
// gloves where the others give 13. FAB is switched off.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import { stdEgInspectionData, stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import type { OrderLotsData } from "@/modules/order_lots/schema";
import type { PackingConfigData } from "@/modules/packing_config/schema";
import type { SamplingPlanData, SamplingSize } from "@/modules/sampling_plan/schema";

export const PLAN_CLIENT = "Client A";

const EXPORTED_AT = "2025-04-12T09:00:00.000Z";

/** One size's row with every count, as the capture screen saves it. */
function planRow(row: Partial<SamplingSize>): SamplingSize {
  return {
    cases: null,
    innerUnitsPerCase: null,
    innerUnits: null,
    gloves: null,
    codeLetter: null,
    codeLetterReason: null,
    glovesWatertightVisual: null,
    glovesDimensions: null,
    glovesPhysical: null,
    glovesWeight: null,
    innerUnitsDispensing: null,
    pouches: null,
    pouchesDyeLeak: null,
    ...row,
  };
}

/** The four sizes' order: cases and placeholder lots (M in two lots). */
export function planOrderData(): OrderLotsData {
  return {
    sizes: {
      S: { qtyCases: 120, lotNumbers: ["LOT-S01"], packingSite: null },
      M: { qtyCases: 400, lotNumbers: ["LOT-M01", "LOT-M02"], packingSite: null },
      L: { qtyCases: 100, lotNumbers: ["LOT-L01"], packingSite: null },
      XL: { qtyCases: 30, lotNumbers: ["LOT-XL01"], packingSite: null },
    },
  };
}

/** 100 gloves an inner box, 10 inner boxes a case: 1,000 gloves a case. */
export function planPackingData(): PackingConfigData {
  return { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: null };
}

/** The plan as entered: complete for every size, M's letter reduced from M to L, FAB switched off. */
export function planData(): SamplingPlanData {
  const tests = (gloves: number, special: number, boxes: number) => ({
    glovesWatertightVisual: gloves,
    glovesDimensions: special,
    glovesPhysical: special,
    innerUnitsDispensing: boxes,
  });
  return {
    sizes: {
      S: planRow({ cases: 16, innerUnitsPerCase: 1, innerUnits: 16, gloves: 200, codeLetter: "L", ...tests(200, 13, 8) }),
      M: planRow({
        cases: 25,
        innerUnitsPerCase: 1,
        innerUnits: 25,
        gloves: 200,
        codeLetter: "L",
        codeLetterReason: "Consistent factory",
        ...tests(200, 13, 8),
      }),
      L: planRow({ cases: 16, innerUnitsPerCase: 1, innerUnits: 16, gloves: 200, codeLetter: "L", ...tests(200, 13, 8) }),
      XL: planRow({ cases: 5, innerUnitsPerCase: 2, innerUnits: 10, gloves: 125, codeLetter: "K", ...tests(125, 8, 5) }),
    },
    rowsOff: ["glovesPhysical"],
  };
}

/** The STD_EG inspection with Client A, the four sizes' order and packing, and the plan; `modules` over them. */
export function planRecord(modules: Readonly<Record<string, unknown>> = {}): InspectionRecord {
  const base = stdEgRecord();
  const data = stdEgInspectionData();
  return {
    ...base,
    data: {
      ...data,
      modules: {
        ...data.modules,
        order_lots: planOrderData(),
        packing_config: planPackingData(),
        sampling_plan: planData(),
        ...modules,
      },
    },
    client: { id: "00000000-0000-4000-8000-000000000301", name: PLAN_CLIENT, logoPath: null },
    photos: [],
    files: [],
  };
}

/** The export of planRecord: what the print route builds the page from. */
export function makePlanExport(modules: Readonly<Record<string, unknown>> = {}): InspectionExport {
  const record = planRecord(modules);
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(`The sampling plan fixture does not evaluate: ${evaluation.message}`);
  return ExportSchema.parse(
    assembleExport({
      record,
      evaluated: evaluation.evaluated,
      links: { photos: new Map(), files: new Map(), clientLogo: null, sourceFile: null },
      exportedAt: EXPORTED_AT,
    }),
  );
}
