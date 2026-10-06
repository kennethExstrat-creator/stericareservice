// Types for the anonymised example-report fixtures (docs/FIXTURES.md).
//
// The fixtures follow the printed 4-page reports section by section, not the
// module schemas: an adapter maps them into module data once the schemas
// exist. Conventions:
//
// - A plain number is a clean numeric cell, exactly as printed.
// - A `TextCell` is a cell the inspector typed that is not a number ("2 42").
//   The app must reject the raw text (BUILD_SPEC 6.2 rule 1); `intended` is
//   the corrected value from the expected results.
// - `printed*` fields are the report's own computed or result cells, verbatim
//   (runs of spaces collapsed to one) and including the wrong ones. The app
//   computes these itself (6.2 rule 2); they show what the original report said.
// - Units: mm, g, N, MPa; percentages are numbers in % (88, not 0.88).
// - Carton and box numbers, names, codes, lots and dates are placeholders.
import type { Spec } from "@/lib/stats";

/** Size columns printed on both reports, in print order. */
export const REPORT_SIZES = ["XS", "S", "M", "L", "XL"] as const;
export type ReportSize = (typeof REPORT_SIZES)[number];

/** Per-size data, present only for the sizes a section filled in. */
export type PerSize<T> = Readonly<Partial<Record<ReportSize, T>>>;

/** A numeric cell the inspector typed as text, kept verbatim. */
export type TextCell = {
  readonly kind: "text";
  /** Exactly what the cell shows. */
  readonly raw: string;
  /** The number the inspector meant: the corrected value in the expected results. */
  readonly intended: number;
  readonly note: string;
};

/** What the inspector typed into a numeric cell. */
export type NumberCell = number | TextCell;

/** A fictional date that replaces a real one; the order of a report's dates is kept. */
export type FictionalDate = {
  /** `YYYY-MM-DD`, or `YYYY-MM` where the report prints only a month. */
  readonly iso: string;
  /** The fictional date written the way the report writes it. */
  readonly printed: string;
  /** The report's format for this field (the reports mix formats). */
  readonly format: "dddd, MMMM D, YYYY" | "M/D/YYYY" | "DD/MM/YYYY" | "MMM-YY";
};

/** An accept / reject pair as printed in a "Defect Limit" or "Limit" row. */
export type Limit = { readonly accept: number; readonly reject: number };

/** One printed row label and the canonical code it maps to (supabase/seed.sql). */
export type CodedRow<C extends string> = { readonly code: C; readonly label: string };

/* ------------------------------------------------------------------ *
 * Page 1
 * ------------------------------------------------------------------ */

/** Manufacturer Information (module `header`). */
export type HeaderSection = {
  readonly manufacturer: string;
  /** Printed in brackets under the manufacturer (STD_EG only). */
  readonly factory?: string;
  readonly factoryAddress: string;
  /** "PO / SO Number" or "PO Number": the PO, then a second reference in brackets. */
  readonly po: { readonly printed: string; readonly poNo: string; readonly ref: string };
  /** "Product Name (Brand, code & description)" or "(Brand & code)". */
  readonly productName: string;
  /** The product code inside the product name, when it has one. */
  readonly productCode: string | null;
  /** A different product code for the same product outside the report (STD_EG: the source file name). */
  readonly productCodeElsewhere?: { readonly where: string; readonly code: string };
  /** "Client Name": STD_EG only, blank (null) in the example. */
  readonly client?: string | null;
  /** The client whose logo heads a client-branded report (SAFEDON_EG). */
  readonly clientLogo?: string;
  /** "Factrory [sic] glove code": STD_EG only, blank (null) in the example. */
  readonly factoryGloveCode?: string | null;
  /** "Inspected by": SAFEDON_EG only. STD_EG has no inspector field anywhere. */
  readonly inspectedBy?: string;
  readonly inspectionDate: FictionalDate;
  readonly mfgDate: FictionalDate;
  readonly expiryDate: FictionalDate;
};

/** Glove Information (module `glove_info`). */
export type GloveInfoSection = {
  readonly surfaceTexture: string;
  /** "Indicative weight (size M)", in g. */
  readonly indicativeWeightG: number;
  readonly indicativeWeightPrinted: string;
  readonly colour: string;
  /** Free text, e.g. "240 mm minimum". */
  readonly length: string;
};

/** One row of the order table (module `order_lots`). */
export type OrderLine = {
  readonly qtyCases: number;
  readonly lots: readonly string[];
  /** "Packing Site" column (SAFEDON_EG only). */
  readonly packingSite?: string;
};

export type OrderSection = {
  readonly lines: PerSize<OrderLine>;
  readonly printedTotalCartons: number;
  readonly printedTotalGloves: number;
};

/** Packing configuration (module `packing_config`). */
export type PackingSection = {
  readonly innerUnit: "inner box" | "plastic pack";
  readonly glovesPerInner: number;
  readonly innersPerCase: number;
  readonly printedGlovesPerCase: number;
};

/** One row of the Sampling Plan (module `sampling_plan`). */
export type SamplingRow = {
  readonly orderQtyCases: number;
  /** "Sampling Quantity": cases, inner units, gloves. */
  readonly cases: number;
  readonly inners: number;
  readonly gloves: number;
  readonly watertightVisualGloves: number;
  readonly dimensionGloves: number;
  /** "# gloves for FAB" (STD_EG) or "# gloves for Tensile" (SAFEDON_EG). */
  readonly physicalTestGloves: number;
  /** Inner units for the packaging and dispensing inspection. */
  readonly dispensingInners: number;
};

/** One size of "Finished Goods Sampling Information (carton number)" (module `carton_sampling`). */
export type CartonGrid = {
  /** The grid as printed: rows of up to 10, filled cells only, left to right. Placeholder numbers. */
  readonly rows: readonly (readonly number[])[];
  readonly printedSamplingQuantity: number;
};

/* ------------------------------------------------------------------ *
 * Page 2
 * ------------------------------------------------------------------ */

export type DimensionMeasure = "length" | "width" | "finger" | "palm" | "cuff";

/** Per-measure data, present only for the measures a table has. */
export type PerMeasure<T> = Readonly<Partial<Record<DimensionMeasure, T>>>;

/** One "Dimension - Size ..." table (module `dimensions`). */
export type DimensionTable = {
  /** Gloves 1 to 13, one row each, values in the section's `columns` order. */
  readonly gloves: readonly (readonly NumberCell[])[];
  readonly spec: PerMeasure<Spec>;
  readonly printedSpec: PerMeasure<string>;
  /** The Median or Average row as printed. */
  readonly printedStatistic: PerMeasure<string>;
  /** The "P/F" (STD_EG) or "A / Rej." (SAFEDON_EG) row as printed. */
  readonly printedResult: PerMeasure<string>;
};

export type DimensionSection = {
  readonly statistic: "median" | "average";
  /** Measured columns in print order (the gloves' value order). */
  readonly columns: readonly DimensionMeasure[];
  readonly perSize: PerSize<DimensionTable>;
};

/** Weight per size (module `weight`). */
export type WeightEntry = {
  /** Gloves weighed: 13 (STD_EG prints only their average) or 1 (SAFEDON_EG). */
  readonly gloves: number;
  /** The individual weights when printed; null when only the average is. */
  readonly values: readonly number[] | null;
  /** The printed weight in g: the average of `gloves` gloves. */
  readonly averageG: number;
  readonly printed: string;
  /** "Remark" row (STD_EG). */
  readonly printedRemark?: string;
  /** "Spec." and "A / Rej." cells of the weight column (SAFEDON_EG). */
  readonly printedSpec?: string;
  readonly printedResult?: string;
};

/** Force at break per size (module `force_at_break`, STD_EG). */
export type ForceAtBreakEntry = {
  /** The 13 readings are on the attached lab report, not on this report: null. */
  readonly readingsN: readonly number[] | null;
  readonly medianN: number;
  readonly printedMedian: string;
  readonly printedSpec: string;
  readonly printedResult: string;
};

/** Physical properties per size (module `tensile`, SAFEDON_EG), averages from the lab reports. */
export type TensileEntry = {
  readonly tensileMPa: number;
  readonly elongationPct: number;
  readonly printedSpec: { readonly tensile: string; readonly elongation: string };
  readonly printedResult: { readonly tensile: string; readonly elongation: string };
};

/* ------------------------------------------------------------------ *
 * Pages 3 and 4
 * ------------------------------------------------------------------ */

export type HoleCode = "hole_crotch" | "hole_palm" | "hole_finger" | "hole_cuff" | "hole_other" | "glove_burst";

/** One size of "Freedom from Holes by watertight test" (module `watertight`). */
export type WatertightEntry = {
  readonly tested: number;
  /** Holes per location: every printed row, zeros included. */
  readonly holes: Readonly<Partial<Record<HoleCode, number>>>;
  readonly printedLimit: Limit;
  /** "Total number of defects found", verbatim. */
  readonly printedTotal: string;
  readonly printedResult: string;
};

export type WatertightSection = {
  readonly printedTitle: string;
  readonly aql: number;
  readonly rows: readonly CodedRow<HoleCode>[];
  readonly perSize: PerSize<WatertightEntry>;
};

export type VisualDefectCode =
  | "embedded_insect"
  | "embedded_metal"
  | "thin_crotch_ring"
  | "thin_crotch_area"
  | "thin_body_area"
  | "thin_spot"
  | "dirt_nonremovable"
  | "stain"
  | "foreign_matter"
  | "powder_mark"
  | "bead_blister"
  | "bead_defective"
  | "lump_big"
  | "lump_small"
  | "dirt_small"
  | "sticky_pleats"
  | "bead_thin"
  | "bead_small_defect"
  | "bead_poor"
  | "bead_rolled";

export type VisualClass = "critical" | "major" | "minor";

/** One size of one visual class (module `visual`). */
export type VisualEntry = {
  readonly inspected: number;
  /** Defects per printed row, zeros included. */
  readonly counts: Readonly<Partial<Record<VisualDefectCode, number>>>;
  readonly printedLimit: Limit;
  readonly printedTotal: string;
  readonly printedResult: string;
};

export type VisualClassBlock = {
  readonly printedTitle: string;
  readonly aql: number;
  readonly rows: readonly CodedRow<VisualDefectCode>[];
  /** The result line's label, verbatim ([sic] where mislabelled). */
  readonly printedResultLabel: string;
  readonly perSize: PerSize<VisualEntry>;
};

export type VisualSection = {
  readonly printedTitle: string;
} & Readonly<Record<VisualClass, VisualClassBlock>>;

/** Glove stickiness codes of the STD_EG packing check: A, B, B1 and C pass, D fails. */
export type StickinessCode = "A" | "B" | "B1" | "C" | "D";

export type PackingCheckBox = {
  /** "Box #": a carton number (placeholder). */
  readonly box: number;
  readonly layeringPct: number;
  readonly dispensingPct: number;
  readonly stickiness: StickinessCode;
};

export type PackingCheckColumns<T> = {
  readonly layering: T;
  readonly dispensing: T;
  readonly stickiness: T;
};

/** One size of "Glove Packing Check" (module `dispensing_packing`, STD_EG). */
export type DispensingPackingEntry = {
  readonly boxes: readonly PackingCheckBox[];
  readonly printedAverage: PackingCheckColumns<string>;
  readonly printedResult: PackingCheckColumns<string>;
};

export type DispensingPackingSection = {
  readonly printedTitle: string;
  readonly minLayeringPct: number;
  readonly minDispensingPct: number;
  readonly perSize: PerSize<DispensingPackingEntry>;
};

export type SafedonDefectCode = "no_cuff" | "finger_out" | "multiple_out" | "stuck" | "sticky" | "faulty_cuff";

/** One size of "Glove Dispensing Inspection" (module `dispensing_safedon`, SAFEDON_EG). */
export type DispensingSafedonEntry = {
  /** "Box #" row: carton numbers (placeholders), left to right. */
  readonly boxes: readonly number[];
  /** One printed row per defect: a count per box, in `boxes` order. */
  readonly counts: Readonly<Record<SafedonDefectCode, readonly number[]>>;
  /** Total line 1, per box: defects / gloves per pack, e.g. "1/125". */
  readonly printedPerBox: readonly string[];
  /** Total line 2, per box: the defect rate, printed as a percentage. */
  readonly printedRatePerBox: readonly string[];
  /** Total line 3: defects / gloves (rate) for the size. */
  readonly printedSizeTotal: string;
  readonly printedSpec: string;
  readonly printedConclusion: string;
};

export type DispensingSafedonSection = {
  readonly printedTitle: string;
  readonly glovesPerPack: number;
  readonly maxRatePct: number;
  readonly rows: readonly (CodedRow<SafedonDefectCode> & { readonly definition: string })[];
  readonly perSize: PerSize<DispensingSafedonEntry>;
};

export type LabelCheckCode = "lot_no" | "mfg_date" | "expiry_date" | "artwork" | "carton_no";

/** One size of one labelling level (module `labeling`). */
export type LabelingEntry = {
  readonly inspected: number;
  readonly defects: Readonly<Partial<Record<LabelCheckCode, number>>>;
  readonly printedLimit: Limit;
  readonly printedTotal: string;
  readonly printedResult: string;
};

export type LabelingLevel = {
  readonly printedTitle: string;
  readonly rows: readonly CodedRow<LabelCheckCode>[];
  readonly printedResultLabel: string;
  readonly perSize: PerSize<LabelingEntry>;
};

export type LabelingSection = { readonly inner: LabelingLevel; readonly carton: LabelingLevel };

/** Conclusion block (module `conclusion`). */
export type ConclusionSection = {
  readonly printedResult: "PASSED" | "FAILED";
  readonly remark: string | null;
  /** SAFEDON_EG prints the inspector again here. */
  readonly inspectedBy?: string;
  readonly date: FictionalDate;
  /** A drawn signature image is present (not transcribed). */
  readonly signed: boolean;
};

/** Report section names, for `UnorderedSizeCells`. */
export type SectionKey =
  | "dimensions"
  | "forceAtBreak"
  | "weight"
  | "watertight"
  | "visual.critical"
  | "visual.major"
  | "visual.minor"
  | "dispensingPacking"
  | "labeling.inner"
  | "labeling.carton";

/**
 * Cells a report prints for a size that was not ordered and has no data:
 * results ("Passed"), spreadsheet errors ("#VALUE!") and pre-filled limits.
 * Keyed by the printed row label (punctuation evened out, e.g. "P/F *" and
 * "P/F*" are both "P/F"); the app shows no table for these sizes.
 */
export type UnorderedSizeCells = {
  readonly section: SectionKey;
  readonly size: ReportSize;
  readonly cells: Readonly<Record<string, string | readonly string[]>>;
};

/* ------------------------------------------------------------------ *
 * Whole reports
 * ------------------------------------------------------------------ */

type ExampleBase = {
  readonly productType: "examination";
  readonly unit: "pcs";
  readonly sizesOnReport: readonly ReportSize[];
  /** Sizes with an order quantity: the only sizes the app shows (6.2 rule 4). */
  readonly sizesOrdered: readonly ReportSize[];
  readonly header: HeaderSection;
  readonly gloveInfo: GloveInfoSection;
  readonly order: OrderSection;
  readonly packing: PackingSection;
  readonly sampling: PerSize<SamplingRow>;
  readonly cartons: PerSize<CartonGrid>;
  readonly dimensions: DimensionSection;
  readonly weight: PerSize<WeightEntry>;
  readonly watertight: WatertightSection;
  readonly visual: VisualSection;
  readonly labeling: LabelingSection;
  readonly conclusion: ConclusionSection;
  readonly unorderedSizes: readonly UnorderedSizeCells[];
};

export type StdEgExample = ExampleBase & {
  readonly template: "STD_EG";
  readonly standard: "EN455";
  readonly forceAtBreak: PerSize<ForceAtBreakEntry>;
  readonly dispensingPacking: DispensingPackingSection;
};

export type SafedonEgExample = ExampleBase & {
  readonly template: "SAFEDON_EG";
  readonly standard: "ASTM_D6319";
  readonly tensile: PerSize<TensileEntry>;
  readonly dispensingSafedon: DispensingSafedonSection;
};

export type ExampleReport = StdEgExample | SafedonEgExample;
