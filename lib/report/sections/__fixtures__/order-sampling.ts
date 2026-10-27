// Section 02's test inspections: SAFEDON_EG's placeholder data
// (docs/FIXTURES.md; template sizes XS to XL) with its order, packing,
// glove, sampling plan and box/carton numbers replaced, run through the
// real modules and the export's own assembly, so every computed value and
// issue is the app's. Lot numbers are placeholders and the box/carton
// numbers are generated (spreadCartons), never a client's.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import { safedonRecord } from "@/lib/report/__fixtures__/exports";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { safedonEgData } from "@/tests/acceptance/examples";

/** What a size's sampling plan holds; each count may be left empty (null). */
export type SampledSpec = {
  cases: number | null;
  innerUnits: number | null;
  gloves: number | null;
  watertightVisual: number | null;
  dimensions: number | null;
  physical: number | null;
  dispensing: number | null;
};

export type OrderLineSpec = {
  cases: number;
  /** Default: one placeholder lot, "LOT-<size>1". */
  lots?: string[];
  /** Over the defaults: the square root of the cases sampled (at least 2), 200 gloves, 13 for each test, 8 inner units for dispensing. */
  sampled?: Partial<SampledSpec>;
  /** Default: as many as the cases sampled, spread over the lot. */
  cartons?: number[];
};

export type OrderExportOptions = {
  /** Default 100 gloves a pack, 10 packs a case; null leaves the packing empty. */
  packing?: { glovesPerInner: number | null; innersPerCase: number | null; glovesPerCase?: number | null } | null;
  glove?: { surfaceTexture?: string | null; colour?: string | null; gloveType?: string | null; indicativeWeight?: number | null; length?: number | null };
  /** Test rows switched off on the Sampling Plan. */
  rowsOff?: string[];
};

/** `count` distinct box/carton numbers from 1 to `ordered`, spread over the lot and the same every run. */
export function spreadCartons(count: number, ordered: number, seed = 1): number[] {
  const picked = new Set<number>();
  let value = seed;
  while (picked.size < Math.min(count, ordered)) {
    value = (value * 9301 + 49297) % 233280;
    picked.add(1 + Math.floor((value / 233280) * ordered));
  }
  return [...picked];
}

function sampledOf(line: OrderLineSpec): SampledSpec {
  return {
    cases: Math.max(2, Math.round(Math.sqrt(line.cases))),
    innerUnits: null,
    gloves: 200,
    watertightVisual: 200,
    dimensions: 13,
    physical: 13,
    dispensing: 8,
    ...line.sampled,
  };
}

/** The SAFEDON_EG inspection with this order, through the real modules. */
export function orderExport(lines: Readonly<Record<string, OrderLineSpec>>, options: OrderExportOptions = {}): InspectionExport {
  const data = safedonEgData();
  const modules = data.modules as Record<string, Record<string, unknown>>;
  const entries = Object.entries(lines).map(([size, line], index) => ({ size, line, sampled: sampledOf(line), seed: index * 7 + 3 }));
  const packing = options.packing === undefined ? { glovesPerInner: 100, innersPerCase: 10 } : options.packing;
  modules.order_lots = {
    sizes: Object.fromEntries(entries.map(({ size, line }) => [size, { qtyCases: line.cases, lotNumbers: line.lots ?? [`LOT-${size}1`], packingSite: "Packer C" }])),
  };
  modules.packing_config = {
    glovesPerInner: packing?.glovesPerInner ?? null,
    innersPerCase: packing?.innersPerCase ?? null,
    glovesPerCase:
      packing === null ? null : packing.glovesPerCase !== undefined ? packing.glovesPerCase : packing.glovesPerInner !== null && packing.innersPerCase !== null ? packing.glovesPerInner * packing.innersPerCase : null,
    packingMode: null,
  };
  modules.glove_info = {
    gloveType: options.glove?.gloveType === undefined ? "Nitrile, powder free" : options.glove.gloveType,
    variants: [
      {
        sizes: [],
        surfaceTexture: options.glove?.surfaceTexture === undefined ? "Finger-textured" : options.glove.surfaceTexture,
        indicativeWeight: options.glove?.indicativeWeight === undefined ? 3.5 : options.glove.indicativeWeight,
        colour: options.glove?.colour === undefined ? "Black" : options.glove.colour,
        length: options.glove?.length === undefined ? 240 : options.glove.length,
      },
    ],
  };
  modules.sampling_plan = {
    ...(options.rowsOff ? { rowsOff: options.rowsOff } : {}),
    sizes: Object.fromEntries(
      entries.map(({ size, sampled }) => [
        size,
        {
          cases: sampled.cases,
          innerUnitsPerCase: null,
          innerUnits: sampled.innerUnits ?? sampled.cases,
          gloves: sampled.gloves,
          codeLetter: null,
          codeLetterReason: null,
          glovesWatertightVisual: sampled.watertightVisual,
          glovesDimensions: sampled.dimensions,
          glovesPhysical: sampled.physical,
          glovesWeight: null,
          innerUnitsDispensing: sampled.dispensing,
          pouches: null,
          pouchesDyeLeak: null,
        },
      ]),
    ),
  };
  modules.carton_sampling = {
    sizes: Object.fromEntries(
      entries.map(({ size, line, sampled, seed }) => [size, { cartonNumbers: line.cartons ?? spreadCartons(sampled.cases ?? 0, line.cases, seed) }]),
    ),
  };
  const record = safedonRecord({ data });
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(`The order fixture does not evaluate: ${evaluation.message}`);
  return ExportSchema.parse(
    assembleExport({
      record,
      evaluated: evaluation.evaluated,
      links: { photos: new Map(), files: new Map(), clientLogo: null, sourceFile: null },
      exportedAt: "2025-02-20T09:00:00.000Z",
    }),
  );
}
