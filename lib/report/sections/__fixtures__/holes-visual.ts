// Section 06's four-size test inspection: the STD_EG template (its major,
// minor and critical defects, five hole locations) on an order of sizes S,
// M, L and XL, with 200, 315, 200 and 125 gloves for the watertight test and
// the visual inspection, and a ring mark found in size M. It is the
// inspection whose Minor table went alone onto a continued page while the
// left column had room under the critical defects (Kenneth, 27 October
// 2026). On STD_EG version 6 the ring mark is a defect not in the list, as
// the inspector typed it; version 7 lists Ring Mark last of its majors, as
// INS-2026-2442 has it now with its Product Defects photos described.
// Placeholder data (docs/FIXTURES.md: lots, counts and cases are made up),
// run through the real modules and the export's own assembly, so every limit
// is calc's.
import { assembleExport } from "@/lib/export/assemble";
import { evaluateRecord } from "@/lib/export/evaluate";
import { stdEgInspectionData, stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { ExportSchema, type ExportPhoto, type InspectionExport } from "@/lib/schemas/export";

const SIZES = ["S", "M", "L", "XL"] as const;
type Size = (typeof SIZES)[number];

/** The gloves tested and inspected per size. */
export const FOUR_SIZE_SAMPLES: Readonly<Record<Size, number>> = { S: 200, M: 315, L: 200, XL: 125 };

/** The ring mark as the inspector typed it on version 6, a defect not in the list (size M). */
export const FOUR_SIZE_ONE_OFF = "Ring mark";

/** Ring Mark's code, last of STD_EG's majors from version 7. */
const RING_MARK = "ring_mark";

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
  /** STD_EG's version: 6 (the default, as the inspection was made) without Ring Mark in its majors, 7 with it. */
  version?: 6 | 7;
};

/** The four-size inspection's export. */
export function fourSizeExport({ photos = false, version = 6 }: FourSizeOptions = {}): InspectionExport {
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
  const ringMark = (size: Size) => (size === "M" ? 1 : 0);
  modules.visual = {
    sizes: perSize((size) => ({
      critical: { inspected: FOUR_SIZE_SAMPLES[size], counts: { embedded_insect: 0, embedded_metal: 0 }, unmapped: [] },
      major: {
        inspected: FOUR_SIZE_SAMPLES[size],
        counts: { ...counts(majorCodes, MAJOR[size]), ...(version === 7 ? { [RING_MARK]: ringMark(size) } : {}) },
        unmapped: version === 6 && ringMark(size) > 0 ? [{ label: FOUR_SIZE_ONE_OFF, count: ringMark(size) }] : [],
      },
      minor: { inspected: FOUR_SIZE_SAMPLES[size], counts: counts(minorCodes, MINOR[size]), unmapped: [] },
    })),
  };
  const base = stdEgRecord();
  if (!base.template) throw new Error("The STD_EG fixture has no template row.");
  const template = version === 7 ? base.template : { ...base.template, version: 6, resolved: withoutRingMark(base.template.resolved as ResolvedTemplate) };
  const record = stdEgRecord({ data, template, photos: photos ? base.photos : [], files: base.files });
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

/** STD_EG as version 6 has it: Ring Mark not yet among the visual inspection's majors. */
function withoutRingMark(template: ResolvedTemplate): ResolvedTemplate {
  const resolved = structuredClone(template);
  const visual = resolved.modules.find((module) => module.key === "visual");
  const classes = visual?.config.classes as Record<string, { defects?: { code: string }[] }> | undefined;
  const major = classes?.major;
  if (!major?.defects?.some((defect) => defect.code === RING_MARK)) throw new Error("STD_EG's majors no longer end with Ring Mark.");
  major.defects = major.defects.filter((defect) => defect.code !== RING_MARK);
  return resolved;
}

/* ------------------------------------------------------------------ *
 * Product Defects photos (INS-2026-2442's shape, placeholder data)
 *
 * Four photos in Source Documents' Media under Product Defects, untagged
 * and uncaptioned, as the inspection had them; then as Steri-AI describes
 * them: two pinholes (palm, between fingers), a ringed mark and the test
 * rig. Every photo carries its natural pixels, as real exports do.
 * ------------------------------------------------------------------ */

/** A phone photo's natural pixels, landscape. */
export const PHOTO_SIZE = { width: 4032, height: 3024 } as const;

type Description = NonNullable<ExportPhoto["description"]>;

/** What Steri-AI says each of the four shows, in the order taken; STD_EG version 6 lists the ringed mark as Ring-Shaped Thin Area (Crotch). */
export const PRODUCT_DEFECT_DESCRIPTIONS: readonly Description[] = [
  { text: "Pinhole, palm area", kind: "defect", defect: "hole_palm", location: "hole_palm", clarity: 0.86, check: "watertight" },
  { text: "Test rig", kind: "context", defect: null, location: null, clarity: 0.9, check: "watertight" },
  { text: "Ringed mark, thin area", kind: "defect", defect: "thin_crotch_ring", location: null, clarity: 0.74, check: "visual" },
  { text: "Pinhole, between fingers", kind: "defect", defect: "hole_crotch", location: "hole_crotch", clarity: 0.92, check: "watertight" },
];

/** A placeholder photo in the export's shape: untagged, uncaptioned, not marked In Report, its natural pixels known. */
export function placeholderPhoto(id: number, patch: Partial<ExportPhoto> = {}): ExportPhoto {
  return {
    id: `00000000-0000-4000-8000-${String(700000 + id).padStart(12, "0")}`,
    url: `https://storage.example.com/inspection-photos/placeholder-${id}.jpg?token=placeholder`,
    moduleKey: null,
    target: null,
    caption: null,
    takenAt: `2025-04-11T03:${String(id).padStart(2, "0")}:00.000Z`,
    includeInReport: false,
    flagged: false,
    description: null,
    markers: [],
    size: { ...PHOTO_SIZE },
    ...patch,
  };
}

/** The four Product Defects photos; `described`, with Steri-AI's descriptions. */
export function productDefectPhotos({ described = false }: { described?: boolean } = {}): ExportPhoto[] {
  return PRODUCT_DEFECT_DESCRIPTIONS.map((description, index) =>
    placeholderPhoto(index + 1, { moduleKey: "media_defects", description: described ? { ...description } : null }),
  );
}

/** The four-size inspection with only the four Product Defects photos (INS-2026-2442's case). */
export function fourSizeProductDefectsExport({ described = false }: { described?: boolean } = {}): InspectionExport {
  const doc = fourSizeExport();
  doc.photos = productDefectPhotos({ described });
  return doc;
}

/* ------------------------------------------------------------------ *
 * INS-2026-2442 as it stands now (its shape, placeholder data)
 *
 * The four sizes on STD_EG version 7, Ring Mark one of its majors on one
 * line (no defect not in the list), so the Minor class sits under the
 * critical defects and the major defects leave the right column's foot
 * free. Its Product Defects photos are all described by Steri-AI, none
 * captioned by the inspector: four pinholes, a thin area of the glove body
 * and the watertight test's setting, in the order taken.
 * ------------------------------------------------------------------ */

/** What Steri-AI says each of the six shows, in the order taken. */
export const DESCRIBED_DEFECT_PHOTOS: readonly Description[] = [
  { text: "Pinhole, cuff", kind: "defect", defect: "hole_cuff", location: "hole_cuff", clarity: 0.8, check: "watertight" },
  { text: "Pinhole, palm area", kind: "defect", defect: "hole_palm", location: "hole_palm", clarity: 0.8, check: "watertight" },
  { text: "Pinhole, between fingers", kind: "defect", defect: "hole_crotch", location: "hole_crotch", clarity: 0.75, check: "watertight" },
  { text: "Pinhole, side of thumb", kind: "defect", defect: "hole_finger", location: "hole_finger", clarity: 0.7, check: "watertight" },
  { text: "Thin area, glove body", kind: "defect", defect: "thin_body_area", location: null, clarity: 0.7, check: "visual" },
  { text: "Watertight test", kind: "context", defect: null, location: null, clarity: 0.9, check: "watertight" },
];

/** What Steri-AI says of the three photos in Media's Product and Package Samples: the setting, of no test. */
export const DESCRIBED_SAMPLE_PHOTOS: readonly Description[] = ["Carton label, size M", "Carton label, size L", "Dispenser box artwork"].map((text) => ({
  text,
  kind: "context",
  defect: null,
  location: null,
  clarity: 0.9,
  check: null,
}));

/**
 * INS-2026-2442's shape now: the four sizes on version 7 with the six
 * described Product Defects photos; `sampling`, its three described photos
 * of the samples besides, a row of a Sampling & Packaging record (its page
 * 10 of 12, two-thirds blank under them, Kenneth, 27 October 2026).
 */
export function describedDefectsExport({ sampling = false }: { sampling?: boolean } = {}): InspectionExport {
  const doc = fourSizeExport({ version: 7 });
  const described = DESCRIBED_DEFECT_PHOTOS.map((description, index) => placeholderPhoto(index + 1, { moduleKey: "media_defects", description: { ...description } }));
  const samples = sampling
    ? DESCRIBED_SAMPLE_PHOTOS.map((description, index) => placeholderPhoto(DESCRIBED_DEFECT_PHOTOS.length + index + 1, { moduleKey: "media_samples", description: { ...description } }))
    : [];
  doc.photos = [...samples, ...described];
  return doc;
}
