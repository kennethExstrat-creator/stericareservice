// Section 06's four-size test inspection: the STD_EG template (eleven major,
// six minor and two critical defects, five hole locations) on an order of
// sizes S, M, L and XL, with 200, 315, 200 and 125 gloves for the watertight
// test and the visual inspection, and a major defect not in the list. It is
// the inspection whose Minor table went alone onto a continued page while the
// left column had room under the critical defects (Kenneth, 27 October 2026).
// Placeholder data (docs/FIXTURES.md: lots, counts and the one-off are made
// up), run through the real modules and the export's own assembly, so every
// limit is calc's.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import { stdEgInspectionData, stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";

const SIZES = ["S", "M", "L", "XL"] as const;
type Size = (typeof SIZES)[number];

/** The gloves tested and inspected per size. */
export const FOUR_SIZE_SAMPLES: Readonly<Record<Size, number>> = { S: 200, M: 315, L: 200, XL: 125 };

/** The major defect not in the list, in the inspector's words (size M). */
export const FOUR_SIZE_ONE_OFF = "Torn cuff edge";

const CASES: Readonly<Record<Size, number>> = { S: 900, M: 1500, L: 800, XL: 400 };

const HOLES: Readonly<Record<Size, Record<string, number>>> = {
  S: { hole_finger: 1 },
  M: { hole_palm: 1, hole_finger: 1 },
  L: {},
  XL: { hole_cuff: 1 },
};

const MAJOR: Readonly<Record<Size, Record<string, number>>> = {
  S: { thin_crotch_area: 1, thin_spot: 2 },
  M: { thin_body_area: 1, thin_spot: 3 },
  L: { thin_spot: 1 },
  XL: { stain: 1 },
};

const MINOR: Readonly<Record<Size, Record<string, number>>> = {
  S: { dirt_small: 2 },
  M: { dirt_small: 1, sticky_pleats: 1 },
  L: {},
  XL: { lump_small: 1 },
};

export type FourSizeOptions = {
  /** Keep STD_EG's photos (a pin hole and a thin spot marked In Report). Default false: no defect photos, as on the inspection. */
  photos?: boolean;
};

/** The four-size inspection's export. */
export function fourSizeExport({ photos = false }: FourSizeOptions = {}): InspectionExport {
  const data = stdEgInspectionData();
  const modules = data.modules as Record<string, Record<string, unknown>>;
  const perSize = <T>(value: (size: Size) => T) => Object.fromEntries(SIZES.map((size) => [size, value(size)]));
  modules.order_lots = { sizes: perSize((size) => ({ qtyCases: CASES[size], lotNumbers: [`LOT-${size}1`], packingSite: null })) };
  modules.sampling_plan = {
    sizes: perSize((size) => ({
      cases: Math.round(Math.sqrt(CASES[size])),
      innerUnitsPerCase: null,
      innerUnits: Math.round(Math.sqrt(CASES[size])),
      gloves: FOUR_SIZE_SAMPLES[size],
      codeLetter: null,
      codeLetterReason: null,
      glovesWatertightVisual: FOUR_SIZE_SAMPLES[size],
      glovesDimensions: 13,
      glovesPhysical: 13,
      glovesWeight: null,
      innerUnitsDispensing: 13,
      pouches: null,
      pouchesDyeLeak: null,
    })),
  };
  const counts = (codes: readonly string[], found: Record<string, number>) => Object.fromEntries(codes.map((code) => [code, found[code] ?? 0]));
  modules.watertight = {
    sizes: perSize((size) => ({
      tested: FOUR_SIZE_SAMPLES[size],
      holes: counts(["hole_crotch", "hole_palm", "hole_finger", "hole_cuff", "hole_other"], HOLES[size]),
      otherDescription: null,
      unmapped: [],
    })),
  };
  const majorCodes = ["thin_crotch_area", "thin_crotch_ring", "thin_body_area", "thin_spot", "dirt_nonremovable", "stain", "foreign_matter", "bead_defective", "lump_big", "skin_visual", "flow_mark"];
  const minorCodes = ["dirt_small", "sticky_pleats", "lump_small", "bead_poor", "bead_rolled", "bead_defective"];
  modules.visual = {
    sizes: perSize((size) => ({
      critical: { inspected: FOUR_SIZE_SAMPLES[size], counts: { embedded_insect: 0, embedded_metal: 0 }, unmapped: [] },
      major: {
        inspected: FOUR_SIZE_SAMPLES[size],
        counts: counts(majorCodes, MAJOR[size]),
        unmapped: size === "M" ? [{ label: FOUR_SIZE_ONE_OFF, count: 1 }] : [],
      },
      minor: { inspected: FOUR_SIZE_SAMPLES[size], counts: counts(minorCodes, MINOR[size]), unmapped: [] },
    })),
  };
  const base = stdEgRecord();
  const record = stdEgRecord({ data, photos: photos ? base.photos : [], files: base.files });
  const evaluation = evaluateRecord(record);
  if (!evaluation.ok) throw new Error(`The four-size fixture does not evaluate: ${evaluation.message}`);
  return ExportSchema.parse(
    assembleExport({
      record,
      evaluated: evaluation.evaluated,
      links: {
        photos: new Map(record.photos.map((photo) => [photo.storagePath, `https://storage.example.com/inspection-photos/${photo.id}.jpg`])),
        files: new Map(record.files.map((file) => [file.storagePath, `https://storage.example.com/inspection-files/${file.id}.pdf`])),
        clientLogo: null,
        sourceFile: null,
      },
      exportedAt: "2025-04-12T09:15:00.000Z",
    }),
  );
}
