// The app's own report (Kenneth, 27 October 2026: the new pre-shipment
// design, "inside the report, there are charts and infographics, try to use
// the data to those charts in the report too"; docs/REPORT.md). One pure
// function turns the export (lib/schemas/export.ts, everything the
// inspection holds with its options in `report`) into a typed model that the
// components in components/report draw: the chrome every page shares, the
// Summary (page 1), one slot per later section and the plan of pages in
// print order, numbered. Client-safe: the print route builds it from the
// export on the server, and the Report page from the screen's own copy
// (live-export.ts), so the preview and the PDF are the same pages.
import { formatCount } from "@/lib/format";
import { inspectionSummaryOf } from "@/lib/export/conclusion";
import { richTextPlain } from "@/lib/rich-text";
import type { InspectionResult, InspectionStatus } from "@/lib/schemas/common";
import type { ExportPhoto, InspectionExport } from "@/lib/schemas/export";
import type { ModuleKey } from "@/lib/schemas/module-result";
import {
  REPORT_PAGE_SIZES,
  REPORT_PHOTO_GROUPS,
  REPORT_SECTIONS,
  type ReportBlockKey,
  type ReportPageSize,
  type ReportPhotoGroupKey,
  type ReportSectionKey,
} from "@/lib/schemas/report-options";
import type { RichTextDoc } from "@/lib/schemas/rich-text";
import { checkRows, checksVerdict, type CheckRow, type CheckStatus } from "./checks";
import { longDate, sharesOf, weekdayDate } from "./format";
import { STERICARE_LETTERHEAD, type Letterhead } from "./letterhead";
import { labelOf, moduleOf, num, orderedSizes, rec, sizeLabel, text } from "./read";
import { sectionBuilder } from "./sections";
import { photoRecordsOf } from "./sections/photos";
// Outfit's measured widths, which Section 02 sizes its columns by too.
import { wrappedLines } from "./sections/order-sampling-layout";

/* ------------------------------------------------------------------ *
 * The model
 * ------------------------------------------------------------------ */

/** A status as the report shows it, with the app's status colours: a check's, or the conclusion's. */
export type ReportStatus = CheckStatus | "hold";

export type ReportOrientation = "portrait" | "landscape";

/** The paper as it lies, in millimetres: a landscape page is the portrait one turned. */
export type ReportPaper = { size: ReportPageSize; orientation: ReportOrientation; label: string; width: number; height: number };

/**
 * What a page shows around its content, as each document fills it: the
 * report ("Pre-Shipment Inspection Report", the PO and the inspection day,
 * a Draft tag until approved, "Prepared for …", numbered pages) and the
 * sampling plan sent to a manufacturer ("Sampling Plan", no tag, its own
 * footer line, no numbers). components/report/report-page.tsx draws it.
 */
export type PageChrome = {
  letterhead: Letterhead;
  /** The header band's line, set in spaced capitals. */
  bandTitle: string;
  /** The band's right side: "PO-0001 · Inspected 11 April 2025". */
  bandAside: string | null;
  /** A Draft tag beside the band's title. */
  draft: boolean;
  /** The footer's left: "Prepared for Client A · Brand A PC-A01 Blue Nitrile". */
  footerLeft: string | null;
  /** A smaller line under it: the report's footer note. */
  footerNote: string | null;
  /** The footer's right, in place of the page number: "Computer-generated document. No signature required." */
  footerRight: string | null;
  /** "Page 1 of 9" at the footer's right, while footerRight is null. */
  numbered: boolean;
};

/** What every page of the report shows around its content (the header band and the footer). */
export type ReportChrome = {
  letterhead: Letterhead;
  /** The report's title (the Report page's option): the header band's line, set in capitals. */
  title: string;
  /** The PO as the header band names it, the bracketed reference left out: "PO-0001". Null when none is entered. */
  po: string | null;
  /** The inspection day in full: "11 April 2025". */
  inspectedOn: string | null;
  /** "Prepared for" in the footer; null while Show Client is off or no client is recorded. */
  client: string | null;
  /** The product, in the footer: the header's product name. */
  product: string | null;
  footerNote: string | null;
  /** Every page carries a Draft tag until the inspection is approved. */
  draft: boolean;
  status: InspectionStatus;
  refNo: string;
};

/** One detail in the Summary's card: the template's label, the value or "Not stated". */
export type ReportFact = {
  key: "client" | "poNo" | "manufacturer" | "inspectionDate" | "factoryAddress" | "mfgDate" | "expiryDate";
  label: string;
  value: string;
  /** False when nothing is entered: the value reads "Not stated". */
  stated: boolean;
  /** Across both columns (the factory address). */
  wide: boolean;
};

export type OrderMixRow = { size: string; label: string; cases: number; share: number };

/** Order Mix by Size: each size's share of the cartons, and the totals. */
export type OrderMix = {
  rows: OrderMixRow[];
  totalCases: number;
  /** Null until the gloves per case are known. */
  totalGloves: number | null;
  glovesPerCase: number | null;
  /** "gloves", or "pairs" for a template counted in pairs. */
  unitWord: "gloves" | "pairs";
};

/** The Inspection Summary as written: formatted (drawn as the app draws it), plain text, or none yet. */
export type SummaryText = { kind: "rich"; doc: RichTextDoc } | { kind: "plain"; paragraphs: string[] } | { kind: "empty" };

/** The overall conclusion card. */
export type ReportConclusion = {
  /** The inspector's final result; not_done until it is chosen. */
  status: ReportStatus;
  result: InspectionResult | null;
  /** The template's conclusion word (PASSED, FAILED, HOLD), or "Not Concluded". */
  label: string;
  /** From the checks: "All 9 checks passed for every size on the order: S, M, L and XL." */
  verdict: string;
  /** "12 April 2025": the conclusion's date. */
  date: string | null;
};

/** Page 1 (the design's page 1). */
export type SummaryModel = {
  /** "Preshipment Inspection · Nitrile Disposable Examination Gloves": the template's report title. */
  kicker: string;
  /** The product name, else the template's words. */
  title: string;
  conclusion: ReportConclusion;
  facts: ReportFact[];
  /** Null while switched off, or with nothing ordered. */
  orderMix: OrderMix | null;
  /** Null while switched off. */
  inspectionSummary: SummaryText | null;
  /** Null while switched off. */
  checks: CheckRow[] | null;
  /**
   * Where the Inspection Summary prints: on page 1, or on a page of its own
   * after it when page 1 cannot hold it with the rest (summaryPlacement).
   */
  summaryPlacement: "first" | "own";
};

/**
 * What every built section carries: the pages it prints. Each section's
 * builder (lib/report/sections/<key>.ts, listed in lib/report/sections;
 * docs/REPORT.md "Adding a section") widens its own type below with the
 * content its pages draw (components/report/sections/<key>.tsx).
 */
export type ReportSectionContent = { pageCount: number };

/** Section 02, Order, Product & Sampling: Glove Information, packing, the order lots and sampling plan, the sampled box/carton numbers. */
export type OrderSamplingSection = import("./sections/order-sampling").OrderSamplingContent;
/** Section 03, Dimensions & Weight: glove length (DotPlot), palm width (RangeBand), the medians, weight per glove (HBars). */
export type DimensionsSection = ReportSectionContent & {
  /**
   * Under the title, from the specs in force: "13 gloves measured per size.
   * Length must reach 240 mm and palm width must sit inside each size's
   * tolerance. Thickness and weight are recorded for information."
   */
  lead: string | null;
  /** Glove Length (mm), Each Glove, by its block's key; null while switched off or with no length measured. */
  gloveLength: DimensionsLengthChart | null;
  /** Palm Width (mm) against Size Tolerance. */
  palmWidth: DimensionsWidthChart | null;
  /** Median Results by Size. */
  medianResults: DimensionsResultsTable | null;
  /** Weight per Glove (g). */
  weightPerGlove: DimensionsWeightBars | null;
  /** What each page prints, in order. */
  pages: DimensionsPage[];
};

/** A figure as printed, in fail red where it fails its spec. */
export type DimensionsFigure = { text: string; failed: boolean };
/** A line at a chart row's right: words, then the figure in bold, red where it fails ("Median **243 mm**"). */
export type DimensionsAsideLine = { text: string; strong?: string; tone?: "fail" };
/** A chart's axis (lib/report/geometry's Axis). */
export type DimensionsAxis = { min: number; max: number; ticks: number[] };
/** One page of Section 03: its parts in print order. */
export type DimensionsPage = { parts: DimensionsPagePart[] };
/** A run of a chart's sizes (its rows from, to; continued from the page before), or the results and the weight side by side. */
export type DimensionsPagePart = { block: "gloveLength" | "palmWidth"; from: number; to: number; continued: boolean } | { block: "results" };

export type DimensionsLengthChart = {
  /** "Glove Length (mm), Each Glove". */
  title: string;
  /** The template's statistic, "Median" or "Average": the marker's name in the key. */
  statisticLabel: string;
  /** The key's words for the reject zone: "Below 240 mm minimum"; null when no size has a limit. */
  limitText: string | null;
  axis: DimensionsAxis;
  /** Readings within this of each other stack: their precision (1 mm). */
  step: number;
  rows: {
    size: string;
    /** As the template shows the size. */
    label: string;
    /** Each glove's length, in glove order. */
    values: number[];
    /** The statistic as printed: the marker's place; null without readings. */
    statistic: number | null;
    /** The spec in force as limits: a minimum's reject zone below it, a maximum's above, a range's both. */
    limits: { value: number; side: "below" | "above" }[];
    /** "Median 243 mm", "Range 242 to 245"; "Not stated" without readings. */
    aside: DimensionsAsideLine[];
  }[];
};

export type DimensionsWidthChart = {
  /** "Palm Width (mm) against Size Tolerance". */
  title: string;
  statisticLabel: string;
  axis: DimensionsAxis;
  rows: {
    size: string;
    label: string;
    /** The spec in force along the axis: nominal ± tolerance, a range, a minimum open to the right; null for NA. */
    band: { from: number; to: number } | null;
    /** The narrowest and widest measured; null without readings. */
    range: { min: number; max: number } | null;
    statistic: number | null;
    /** "Spec 80 ± 10", "Median 84". */
    aside: DimensionsAsideLine[];
  }[];
};

export type DimensionsResultsTable = {
  /** "Median Results by Size". */
  title: string;
  /** Over length and width: "Median (mm)". */
  statisticGroup: string;
  /** The measures the template switches on: length and width first, under the statistic, then the thicknesses. */
  columns: { measure: string; label: string; group: "statistic" | "thickness" }[];
  rows: {
    size: string;
    label: string;
    /** By measure: the statistic as printed, red where the measure failed; "—" without readings. */
    cells: Record<string, DimensionsFigure>;
    /** The size's verdict, the module's own. */
    status: CheckStatus;
    /** A P/F set by hand among its measures: a note mark beside the chip. */
    byHand: boolean;
  }[];
  /** Under the table, for the marks: "* Set by the inspector: size M Width." */
  note: string | null;
};

export type DimensionsWeightBars = {
  /** "Weight per Glove (g)". */
  title: string;
  /** The bars' scale from 0: just past the heaviest. */
  max: number;
  /** A minimum every size shares: a dashed red line across the bars. */
  minimum: number | null;
  rows: {
    size: string;
    label: string;
    value: number | null;
    /** "2.90 g", at the template's decimals; "—" without a weight. */
    display: string;
    /** Out of its spec (fail), or past the indicative weight's threshold (warn). */
    tone: "fail" | "warn" | null;
  }[];
  /** "Average of 13 gloves per size. For information only; indicative weight for size M is 3.5 g." */
  note: string | null;
};
/** Section 04, Measurements by Glove: every glove's readings, size by size. */
export type MeasurementsSection = ReportSectionContent & {
  /** At the title's right: "All values in mm · 13 gloves per size". */
  aside: string;
  /** The measures the template switches on, in its order, by short label: "Length", "Finger". */
  columns: { measure: string; label: string }[];
  /** The template's words for the rows ("No.", "Median", "Spec."), and "Result". */
  labels: { no: string; statistic: string; spec: string; result: string };
  /** Each page's rows of tables, two side by side, and under them what its marks mean: "* Set by the inspector." */
  pages: { rows: MeasurementsTable[][]; note: string | null }[];
};

/** A size's gloves, or a run of them where they pass a page. */
export type MeasurementsTable = {
  key: string;
  size: string;
  /** "Size S". */
  title: string;
  /** "Lot LOT-A01 · Avg. weight 2.90 g"; null when neither is recorded. */
  aside: string | null;
  /** The rest of a size's gloves after a page: headed "(continued)". */
  continued: boolean;
  gloves: { no: number; cells: Record<string, DimensionsFigure> }[];
  /** On a size's last run: the statistic, the spec in force and the result per measure. */
  summary: {
    statistic: Record<string, DimensionsFigure>;
    spec: Record<string, string>;
    result: Record<string, { text: string; status: CheckStatus; byHand: boolean }>;
    /** The size's verdict: the Result label's colour. */
    status: CheckStatus;
  } | null;
};
/** Section 05, Force at Break (or Physical Properties): the lab's details, each specimen (DotPlot), the readings, the lab's summary. */
export type ForceAtBreakSection = ReportSectionContent & {
  /** Under the title, from the config: "Lab test to EN 455-2. The median of 13 specimens per size must reach 6 N." */
  lead: string | null;
  /** Laboratory Details: what the inspection records of the lab's test; null while switched off or with nothing recorded. */
  details: ForceAtBreakDetail[] | null;
  /** The force at break readings (force_at_break), when the inspection includes them. */
  force: ForceAtBreakTest | null;
  /** The lab report's tensile strength and elongation averages (tensile), when the inspection includes them. */
  tensile: ForceAtBreakTensile | null;
  /** What each page draws, in order: the blocks switched on, split to the paper (lib/report/sections/forceAtBreak.ts). */
  pages: ForceAtBreakPage[];
};

/** A detail of the lab's test: "Standard", "EN 455-2". */
export type ForceAtBreakDetail = { key: string; label: string; value: string };

/** A specimen's reading as entered, padded to the readings' decimals ("6.0"); `low` below the minimum (red, with "*"). */
export type ForceAtBreakReading = { value: number; text: string; low: boolean };

/** One size of the force at break test. */
export type ForceAtBreakSize = {
  size: string;
  /** As the template shows it. */
  label: string;
  /** Specimens tested: the sampling plan's gloves for the test, else the template's. */
  n: number;
  /** One per specimen, in test order; null where none is entered yet. */
  readings: (ForceAtBreakReading | null)[];
  /** The module's median at its decimals, as judged; null until every reading is in. */
  median: number | null;
  /** The median as printed, in N: "6.4"; null without one. */
  medianText: string | null;
  /** "5.5 to 6.9": the lowest and highest reading; null with none. */
  range: string | null;
  /** Of the readings entered, at the median's decimals; null with none (the SD with fewer than two). */
  average: string | null;
  sd: string | null;
  minimum: ForceAtBreakReading | null;
  maximum: ForceAtBreakReading | null;
  /** The size's lots on the order: "LOT-A01, LOT-A02"; null when none is entered. */
  lots: string | null;
  /** The module's own verdict for the size. */
  status: CheckStatus;
  /** The chart row's tallest stack of dots. */
  stack: number;
};

export type ForceAtBreakTest = {
  sizes: ForceAtBreakSize[];
  /** The minimum median (config specMin) and its words ("6 N"); null when none is set. */
  specMin: number | null;
  specText: string | null;
  /** The template's words: the statistic ("Median"), the reading number ("No."), the order's lots ("Lot Number"). */
  medianLabel: string;
  rowLabel: string;
  lotLabel: string;
  /** The chart's axis (niceAxis), its ticks' decimals, and how close readings stack (their precision, or a dot's width). */
  axis: { min: number; max: number; ticks: number[] };
  tickDecimals: number;
  step: number;
  /** The most specimens of any size: the readings table's rows. */
  rows: number;
  /** Under the chart: each size with a specimen below the minimum, and each size that failed, judged by the statistic. */
  notes: string[];
  /** Under the lab's summary: the lab reports the readings come from. Who tested and verified is not recorded. */
  labNote: string | null;
};

/** An average of the tensile test as printed, the figure ("34.18") and with its unit ("34.18 MPa"); red when below its minimum. */
export type ForceAtBreakAverage = { value: number; figure: string; text: string; fail: boolean };

export type ForceAtBreakTensileSize = {
  size: string;
  label: string;
  tensile: ForceAtBreakAverage | null;
  elongation: ForceAtBreakAverage | null;
  lots: string | null;
  status: CheckStatus;
};

/** Physical Properties: the lab report's averages per size (the app holds no specimen readings). */
export type ForceAtBreakTensile = {
  sizes: ForceAtBreakTensileSize[];
  /** The template's words: "Tensile Strength (Average) (MPa)", "Elongation at Break, Average (%)", "Lot Number". */
  tensileLabel: string;
  elongationLabel: string;
  lotLabel: string;
  /** Each minimum and its words ("14 MPa", "500%"); null when none is set. */
  tensileMin: { value: number; text: string } | null;
  elongationMin: { value: number; text: string } | null;
  /** The bars' axes, from 0. */
  tensileAxis: { min: number; max: number };
  elongationAxis: { min: number; max: number };
  /** Under the summary: the lab reports the averages come from, or that none is attached. */
  labNote: string | null;
};

/** A part of a page of the section: a block, or a stretch of one split across pages. */
export type ForceAtBreakPart =
  | { kind: "details" }
  /** The chart's rows for these sizes; `notes` under the last of them. */
  | { kind: "forceChart"; sizes: string[]; notes: boolean }
  /** Specimen Readings' rows from `from` to `to` (the Median under the last), beside the lab's summary where `summary`; `paired` while both blocks are on. */
  | { kind: "forceTables"; readings: { from: number; to: number; median: boolean } | null; summary: boolean; paired: boolean }
  | { kind: "tensileChart" }
  | { kind: "tensileSummary" };

export type ForceAtBreakPage = { parts: ForceAtBreakPart[] };
/** Section 06, Freedom from Holes & Visual Inspection: defects against the limits (TrackBar), pinholes, defects by class, photos. */
export type HolesVisualSection = ReportSectionContent & import("./sections/holes-visual").HolesVisualContent;
/**
 * Section 07's slot: the packing check's content (PackingSection), or, for a
 * template with the Safedon dispensing check and no packing check, Glove
 * Dispensing's (GloveDispensingSection, `kind: "safedon"`).
 */
export type PackingSlot = PackingSection | GloveDispensingSection;
/** Section 07, Glove Packing & Dispensing: average layering and dispensing (GroupedHBars), each box, the aged gloves, stickiness. */
export type PackingSection = ReportSectionContent & {
  /** Absent: the packing check's content (Glove Dispensing's is "safedon"). */
  kind?: undefined;
  /** Under the title, from the config: what was opened and why, the minimums, the stickiness grades that pass and fail. */
  lead: string;
  /** The template's words, its labels without their marks: "Layering %" is "Layering"; the per-box table's short forms "Layer" and "Disp.". */
  words: { layering: string; dispensing: string; stickiness: string; layeringShort: string; dispensingShort: string; boxNo: string; item: string; average: string };
  /** The minimums in %, each a dashed red line on the chart; null where the template sets none. */
  minimums: { layering: number | null; dispensing: number | null };
  /** Average Layering & Dispensing: a row per size on the order, then the aged gloves'. Null while switched off or nothing is ordered. */
  chart: { rows: PackingChartRow[]; aged: PackingChartRow | null } | null;
  /** Per-Box Results; null while switched off or nothing is ordered. */
  perBox: PackingPerBox | null;
  /** Box-Aged Gloves; null while switched off or no aged sample is entered. */
  aged: PackingAged | null;
  /** Stickiness Grades: the template's codes in its order; null while switched off. */
  grades: PackingGrade[] | null;
  /** The parts each page prints, pageCount of them: the first page under the section's heading and lead. */
  pages: { parts: PackingPart[] }[];
};
/** A percentage as the page prints it: null until entered; `low` below its minimum, printed in red. */
export type PackingFigure = { value: number | null; low: boolean };
/** A stickiness code of the template: its legend, and whether a box graded so passes. */
export type PackingGrade = { code: string; label: string; pass: boolean };
/** A row of the chart: a size's boxes, or the aged gloves. */
export type PackingChartRow = {
  /** The size, or "aged". */
  key: string;
  /** "S", "Aged Gloves". */
  label: string;
  /** "8 boxes"; the aged gloves' under their label, after their ageing: "70 °C · 7 days · 4 boxes". */
  sublabel: string;
  layering: PackingFigure;
  dispensing: PackingFigure;
  /** The worst grade given; null while none is. */
  grade: PackingGrade | null;
};
/** A box as the per-box table prints it, by its item. */
export type PackingBoxRow = { boxNo: number | null; layering: PackingFigure; dispensing: PackingFigure };
export type PackingPerBox = {
  /** Each size on the order: its boxes by item (null for a blank row), and their averages. */
  sizes: { size: string; label: string; boxes: (PackingBoxRow | null)[]; layering: PackingFigure; dispensing: PackingFigure }[];
  /** Item rows: as many as the size with the most. */
  items: number;
  /** At the block's top right: the unit, then every box's grade or the grades given; a failing grade's part in red. */
  note: { text: string; fail?: boolean }[];
};
export type PackingAgedRow = { size: string; label: string; layering: PackingFigure; dispensing: PackingFigure; grade: PackingGrade | null; status: CheckStatus };
export type PackingAged = {
  /** With the ageing (AGEING_CONDITION in ./format.ts): "Box-Aged Gloves (70 °C, 7 Days)". */
  title: string;
  rows: PackingAgedRow[];
  /** The samples' average layering and dispensing, and the worst grade among them. */
  average: { layering: PackingFigure; dispensing: PackingFigure; grade: PackingGrade | null };
  /** The rows' one result when they agree, printed once across them as the design does; null when they differ: each row prints its own. */
  status: CheckStatus | null;
};
/** A part of a page: the chart, items `from` to `to` (0-based, `to` left out) of the per-box table, or the aged gloves beside the grades. */
export type PackingPart = { kind: "chart" } | { kind: "perBox"; from: number; to: number } | { kind: "agedAndGrades" };
/** Section 07 for a Safedon template, Glove Dispensing: each size's defect rate against the maximum, each box, the defects by type and their definitions. */
export type GloveDispensingSection = ReportSectionContent & import("./sections/glove-dispensing").GloveDispensingContent;
/** Section 08, Packaging Labelling & Conclusion: the label checks, the results matrix (TickMatrix), the conclusion card. */
export type LabellingConclusionSection = ReportSectionContent & {
  /** The heading's title: the plan entry's, or the conclusion's own where the template inspects no labels. */
  title: string;
  /** Under the title, what the labels were checked for and the limit; null without the cards. */
  lead: string | null;
  /** The sizes on the order, as the template shows them: the cards' and the matrix's columns. */
  sizes: { value: string; label: string }[];
  /** A card per labelling level the template inspects, in its wording (Dispenser Box, Carton Box); none while switched off. */
  levels: LabelLevelCard[];
  /** Every check the inspection judged by size; null while switched off or with no size on the order. */
  matrix: ResultsMatrix | null;
  conclusion: FinalConclusion;
  /** The blocks each page prints, in order: one page, or two where one cannot hold them. */
  pages: LabellingBlock[][];
};

export type LabellingBlock = "levels" | "matrix" | "conclusion";

/** A count in a card, red when it fails the size, amber when fewer boxes were inspected than planned; null when nothing is recorded. */
export type LabelCell = { value: number | null; tone: "fail" | "warn" | null };

export type LabelLevelCard = {
  level: "inner" | "carton";
  /** The level in the template's wording: "Dispenser Box", "Carton Boxes". */
  title: string;
  /** The computed limits in the template's words: "Accept 0 · Reject 1". */
  limit: string;
  /** Boxes inspected, per size. */
  inspected: LabelCell[];
  /** A row per check the level lists, in the template's order and wording. */
  checks: { code: string; label: string; cells: LabelCell[] }[];
  /** Blank rows after the checks, so two cards side by side line up their totals. */
  padding: number;
  /** Defects found over the level's checks, per size. */
  defects: LabelCell[];
  /** "Passed, All Sizes", or the sizes that failed. */
  result: { status: Extract<CheckStatus, "pass" | "fail" | "not_done">; label: string };
};

/** The results matrix: a row per check, a cell per size on the order (null where it does not apply). */
export type ResultsMatrix = {
  rows: { key: string; label: string; cells: (CheckStatus | null)[] }[];
  /** What the cells show, in the legend's order; "none" for a dash. */
  legend: (CheckStatus | "none")[];
};

/** The signature as drawn on the iPad: SVG path data in the pad's own box. */
export type SignatureDrawing = { width: number; height: number; paths: string[] };

/** The conclusion card's parts besides the result, which is the Summary's (SummaryModel.conclusion). */
export type FinalConclusion = {
  /** The template's word for the conclusion: the card's kicker. */
  heading: string;
  dateLabel: string;
  /** The conclusion's date as the design writes it, "12/04/2025"; null until dated. */
  date: string | null;
  /** Null while switched off. `drawing` is null until signed, or while the report is to be signed by hand (`byHand`). */
  signature: { label: string; drawing: SignatureDrawing | null; byHand: boolean } | null;
  /** Null while switched off; `text` null for none recorded. */
  remark: { label: string; text: string | null } | null;
};

/** The photo records: each record's photos in the design's groups (PhotoGrid), a page each, or more where one cannot hold them. */
export type PhotosSection = ReportSectionContent & {
  /** One per page, in print order. */
  pages: PhotoRecordPage[];
};

export type PhotoRecordPage = {
  key: ReportPhotoGroupKey;
  /** "Photo Record 1 of 3", numbered among the records the report shows. */
  kicker: string;
  /** The record's title; a page it continues on says so. */
  title: string;
  blocks: PhotoBlock[];
};

/** One group of photos under its heading: "Finished Goods Sampling", "Carton Labels". */
export type PhotoBlock = {
  key: string;
  title: string;
  /** At the heading's right, from the data: where and when, what the photos show. */
  note: string | null;
  columns: 4 | 5;
  aspect: "3/2" | "4/3" | "1/1";
  /** The first photo over two rows and two columns. */
  lead: boolean;
  photos: PhotoTile[];
};

/**
 * A photo as its record prints it: the caption bold where the photo shows a
 * defect, and the rings drawn on it with the image's natural pixels to place
 * them (lib/report/markers.ts).
 */
export type PhotoTile = {
  id: string;
  url: string;
  caption: string | null;
  strong: boolean;
  alt: string;
  markers: import("./markers").PhotoMarker[];
  size: import("./markers").PhotoSize | null;
};

/** One slot per section after the Summary, by the report options' section keys and "photos". */
export type ReportSections = {
  orderSampling?: OrderSamplingSection;
  dimensions?: DimensionsSection;
  measurements?: MeasurementsSection;
  forceAtBreak?: ForceAtBreakSection;
  holesVisual?: HolesVisualSection;
  packing?: PackingSlot;
  labellingConclusion?: LabellingConclusionSection;
  photos?: PhotosSection;
};

/** A slot's key: a section's (the report options' keys), or the photo records'. */
export type ReportSlotKey = keyof ReportSections;

export type ReportSummaryPlanEntry = { kind: "summary"; key: "summary"; pageCount: 1 | 2 };

export type ReportSectionPlanEntry<K extends ReportSectionKey = ReportSectionKey> = {
  kind: "section";
  key: K;
  /** 2 for the first section after the Summary, then on: a section left out leaves no gap. */
  number: number;
  /** "Section 02". */
  kicker: string;
  /** The design's title, or the module's where the inspection shows another test: "Physical Properties". */
  title: string;
  /** The blocks switched on, in print order. */
  blocks: { key: ReportBlockKey<K>; label: string }[];
  /** The section's modules the inspection includes, in report order. */
  moduleKeys: ModuleKey[];
  /** Its content's page count once built; 1 ("nothing entered yet") until then. */
  pageCount: number;
  /** False while the section's builder gives nothing: the page then says "nothing entered yet". */
  built: boolean;
};

/** A photo as the report prints it. */
export type ReportPhoto = Pick<ExportPhoto, "id" | "url" | "moduleKey" | "target" | "caption" | "takenAt">;

/** One photo record: a group switched on that has photos. */
export type ReportPhotoRecord = {
  key: ReportPhotoGroupKey;
  /** 1, 2 or 3 among the photo records the report shows. */
  index: number;
  of: number;
  /** "Photo Record 1 of 3". */
  kicker: string;
  title: string;
  /** The group's photos, at most Photos per Group, in capture order. */
  photos: ReportPhoto[];
};

/** The photo records after the sections, one entry for all of them: a page each until built. */
export type ReportPhotosPlanEntry = {
  kind: "photos";
  key: "photos";
  records: ReportPhotoRecord[];
  pageCount: number;
  built: boolean;
};

export type ReportPlanEntry = ReportSummaryPlanEntry | ReportSectionPlanEntry | ReportPhotosPlanEntry;

/** The plan entry a slot's builder and pages are given. */
export type ReportPlanEntryFor<K extends ReportSlotKey> = K extends "photos"
  ? ReportPhotosPlanEntry
  : K extends ReportSectionKey
    ? ReportSectionPlanEntry<K>
    : never;

export type ReportModel = {
  paper: ReportPaper;
  chrome: ReportChrome;
  /** Every size the template lists, in its order, as it shows them: what sizes are coloured by (sizeTone). */
  sizes: { value: string; label: string }[];
  summary: SummaryModel;
  sections: ReportSections;
  /** Every page in print order: the Summary, the sections, the photo records. */
  plan: ReportPlanEntry[];
  pageCount: number;
};

/* ------------------------------------------------------------------ *
 * Building it
 * ------------------------------------------------------------------ */

/** The words a conclusion takes where the template gives none. */
const CONCLUSION_WORDS: Readonly<Record<InspectionResult, string>> = { pass: "PASSED", fail: "FAILED", hold: "HOLD" };

export const NOT_STATED = "Not stated";
export const NOT_CONCLUDED = "Not Concluded";

export function buildReportModel(doc: InspectionExport): ReportModel {
  const paper = paperOf(doc.report.pageSize);
  const chrome = chromeOf(doc);
  const summary = summaryOf(doc, paper);
  const { plan, sections } = planOf(doc, summary);
  const sizes = (doc.template.sizes ?? []).map(({ value, label }) => ({ value, label }));
  return { paper, chrome, sizes, summary, sections, plan, pageCount: plan.reduce((sum, entry) => sum + entry.pageCount, 0) };
}

/** The paper at a size, upright or turned: A4 landscape is 297 × 210 mm. */
export function paperOf(size: ReportPageSize, orientation: ReportOrientation = "portrait"): ReportPaper {
  const paper = REPORT_PAGE_SIZES.find((entry) => entry.value === size) ?? REPORT_PAGE_SIZES[0];
  const turned = orientation === "landscape";
  return {
    size: paper.value,
    orientation,
    label: paper.label,
    width: turned ? paper.height : paper.width,
    height: turned ? paper.width : paper.height,
  };
}

/** The report's chrome as its pages draw it. */
export function reportPageChrome(chrome: ReportChrome): PageChrome {
  return {
    letterhead: chrome.letterhead,
    bandTitle: chrome.title,
    bandAside: bandReference(chrome),
    draft: chrome.draft,
    footerLeft: preparedFor(chrome),
    footerNote: chrome.footerNote,
    footerRight: null,
    numbered: true,
  };
}

function chromeOf(doc: InspectionExport): ReportChrome {
  const header = moduleOf(doc, "header");
  return {
    letterhead: STERICARE_LETTERHEAD,
    title: doc.report.title,
    po: poOf(text(header?.data.poNo)),
    inspectedOn: longDate(inspectionDateOf(doc)),
    client: doc.report.showClient ? clientOf(doc) : null,
    product: text(header?.data.productName),
    footerNote: doc.report.footerNote,
    draft: doc.status !== "approved",
    status: doc.status,
    refNo: doc.refNo,
  };
}

/** "PO-0001 (SO-0001)" as "PO-0001"; a PO without the letters gets them: "77/99" as "PO 77/99". */
export function poOf(poNo: string | null): string | null {
  if (!poNo) return null;
  const bare = poNo.replace(/\s*\([^()]*\)\s*$/, "").trim() || poNo;
  return /^P\.?O\b/i.test(bare) ? bare : `PO ${bare}`;
}

function inspectionDateOf(doc: InspectionExport): string | null {
  const header = moduleOf(doc, "header");
  return text(header?.computed.inspectionDate) ?? text(header?.data.inspectionDate);
}

function clientOf(doc: InspectionExport): string | null {
  return text(moduleOf(doc, "header")?.computed.client) ?? text(doc.template.client?.name);
}

function summaryOf(doc: InspectionExport, paper: ReportPaper): SummaryModel {
  const header = moduleOf(doc, "header");
  const [lead, rest] = splitTitle(doc.template.reportTitle);
  const rows = checkRows(doc);
  const summary: Omit<SummaryModel, "summaryPlacement"> = {
    kicker: rest ? `${lead} · ${rest}` : lead,
    title: text(header?.data.productName) ?? rest ?? lead,
    conclusion: conclusionOf(doc, rows),
    facts: factsOf(doc),
    orderMix: doc.report.summary.orderMix ? orderMixOf(doc) : null,
    inspectionSummary: doc.report.summary.inspectionSummary ? summaryTextOf(doc) : null,
    checks: doc.report.summary.resultsByCheck ? rows : null,
  };
  return { ...summary, summaryPlacement: summaryPlacement(summary, paper, { footerNote: doc.report.footerNote !== null }) };
}

/** "Preshipment Inspection: Nitrile Disposable Examination Gloves" as its two halves. */
function splitTitle(title: string): [string, string | null] {
  const index = title.indexOf(":");
  if (index === -1) return [title.trim(), null];
  return [title.slice(0, index).trim(), title.slice(index + 1).trim() || null];
}

function conclusionOf(doc: InspectionExport, rows: readonly CheckRow[]): ReportConclusion {
  const conclusion = moduleOf(doc, "conclusion");
  const result = doc.conclusion.finalResult;
  const word = (value: InspectionResult) => labelOf(conclusion, value, CONCLUSION_WORDS[value]);
  const sizes = orderedSizes(doc).map((size) => sizeLabel(doc, size));
  const verdict = checksVerdict(rows, sizes);
  const suggested = doc.conclusion.suggestedResult;
  return {
    status: result ?? "not_done",
    result,
    label: result ? word(result) : NOT_CONCLUDED,
    // Until the inspector concludes, the line says what the app suggests.
    verdict: result || !suggested ? verdict : `${verdict} ${labelOf(conclusion, "suggestedResult", "Suggested Result")}: ${word(suggested)}.`,
    date: longDate(doc.conclusion.date),
  };
}

/** The details card, in the design's order, by the header's labels; a field the template switches off is left out. */
function factsOf(doc: InspectionExport): ReportFact[] {
  const header = moduleOf(doc, "header");
  const fields = rec(header?.config?.fields);
  const on = (field: string) => fields[field] !== false;
  const fact = (key: ReportFact["key"], fallback: string, value: string | null, wide = false): ReportFact => ({
    key,
    label: labelOf(header, key, fallback),
    value: value ?? NOT_STATED,
    stated: value !== null,
    wide,
  });
  const computed = header?.computed ?? {};
  const data = header?.data ?? {};
  const facts: ReportFact[] = [];
  // The client shows while Show Client is on, whatever the header's own field: it is the inspection's.
  if (doc.report.showClient) facts.push(fact("client", "Client", clientOf(doc)));
  if (on("poNo")) facts.push(fact("poNo", "PO / SO Number", text(data.poNo)));
  if (on("manufacturer")) facts.push(fact("manufacturer", "Manufacturer / Supplier", text(computed.manufacturer) ?? text(doc.template.manufacturer?.name)));
  if (on("inspectionDate")) facts.push(fact("inspectionDate", "Inspection Date", weekdayDate(inspectionDateOf(doc))));
  if (on("factoryAddress")) facts.push(fact("factoryAddress", "Factory Address", text(data.factoryAddress), true));
  if (on("mfgDate")) facts.push(fact("mfgDate", "Manufacturing Date", longDate(text(computed.mfgDate) ?? text(data.mfgDate))));
  if (on("expiryDate")) facts.push(fact("expiryDate", "Expiry Date", longDate(text(computed.expiryDate) ?? text(data.expiryDate))));
  return facts;
}

/** Each ordered size's cases and share, the shares adding up to 100%; null with nothing ordered. */
export function orderMixOf(doc: InspectionExport): OrderMix | null {
  const order = moduleOf(doc, "order_lots");
  const sizes = orderedSizes(doc);
  if (!order || sizes.length === 0) return null;
  const lines = rec(order.data.sizes);
  const cases = sizes.map((size) => num(rec(lines[size]).qtyCases) ?? 0);
  const shares = sharesOf(cases);
  const totalCases = cases.reduce((sum, value) => sum + value, 0);
  const packing = moduleOf(doc, "packing_config");
  const glovesPerCase = num(packing?.data.glovesPerCase) ?? num(packing?.computed.glovesPerCaseCheck);
  const totalGloves = num(order.computed.totalGloves) ?? (glovesPerCase === null ? null : totalCases * glovesPerCase);
  return {
    rows: sizes.map((size, index) => ({ size, label: sizeLabel(doc, size), cases: cases[index], share: shares[index] })),
    totalCases,
    totalGloves,
    glovesPerCase,
    unitWord: doc.template.unit === "pairs" ? "pairs" : "gloves",
  };
}

/**
 * The inspector's summary: the formatted document from the conclusion's
 * data, drawn as the app draws it (components/qc/rich-text-view.tsx, no
 * HTML strings), else the export's plain text, else none.
 */
function summaryTextOf(doc: InspectionExport): SummaryText {
  const formatted = inspectionSummaryOf(moduleOf(doc, "conclusion")?.data ?? null);
  if (formatted) return { kind: "rich", doc: formatted };
  const plain = doc.conclusion.inspectionSummary?.text.trim();
  if (plain) return { kind: "plain", paragraphs: plain.split(/\n{2,}/) };
  return { kind: "empty" };
}

/* ------------------------------------------------------------------ *
 * Page 1's room
 *
 * The Summary is one fixed page. The Inspection Summary is the one part
 * that grows (up to 5,000 characters), so its height is estimated from its
 * lines; when page 1 cannot hold it with the rest, it prints on a page of
 * its own after page 1. Estimates in millimetres, measured on the pages as
 * drawn (components/report, A4): a page's header and footer, the title, the
 * conclusion row, the order mix, a check row (a line more where its words
 * wrap), a line of the summary.
 * ------------------------------------------------------------------ */

export const SUMMARY_ROOM = {
  /** The header band and the footer, with the content's padding. */
  chrome: 61,
  /** A footer note's second line in the footer. */
  footerNote: 4,
  kicker: 5.5,
  titleLine: 9.2,
  titleCharacters: 40,
  /** The conclusion card beside the details card. */
  conclusionRow: 53,
  orderMix: 20,
  /** A legend of more than four sizes wraps to a second line. */
  orderLegendLine: 4.2,
  /** The summary card's padding and heading. */
  summaryFrame: 17.5,
  summaryLine: 4.9,
  summaryCharacters: 118,
  /** Between paragraphs and lists, and between a list's items. */
  paragraphGap: 2.4,
  itemGap: 0.8,
  /** Results by Check's heading and header row. */
  checksFrame: 13.5,
  checkRow: 6.5,
  /** A row's line more where its check, criterion or result wraps, and the characters a line of the last two holds. */
  checkLine: 4.7,
  checkCharacters: { criterion: 30, result: 32 },
  /** The check's room, measured (9pt semibold): 24% of A4's 184 mm content less the cell's 4 mm; Letter's is wider. */
  checkText: 40.2,
  /** Between the page's blocks, their headings' leading with it. */
  gap: 5,
} as const;

/** The summary's lines, as wrapped, and its gaps: between its paragraphs and lists, and between a list's items. */
function summaryHeight(text: SummaryText): number {
  const plain = text.kind === "rich" ? richTextPlain(text.doc) : text.kind === "plain" ? text.paragraphs.join("\n\n") : "";
  const blocks = plain.split(/\n{2,}/).map((block) => block.split("\n").map((line) => line.trim()).filter((line) => line !== "")).filter((block) => block.length > 0);
  const lines = blocks.flat().reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / SUMMARY_ROOM.summaryCharacters)), 0);
  const items = blocks.reduce((sum, block) => sum + block.length - 1, 0);
  return lines * SUMMARY_ROOM.summaryLine + Math.max(0, blocks.length - 1) * SUMMARY_ROOM.paragraphGap + items * SUMMARY_ROOM.itemGap;
}

/** A check's row: a line more for each line its longest cell wraps to. */
function checkRowHeight(row: CheckRow): number {
  const { criterion, result } = SUMMARY_ROOM.checkCharacters;
  const lines = Math.max(
    wrappedLines(row.check, SUMMARY_ROOM.checkText, { pt: 9, bold: true }),
    Math.ceil((row.criterion ?? "").length / criterion),
    Math.ceil(((row.result ?? "").length + (row.sizesNote ? result : 0)) / result),
    1,
  );
  return SUMMARY_ROOM.checkRow + (lines - 1) * SUMMARY_ROOM.checkLine;
}

/** Page 1 holds the Inspection Summary when the estimate fits the paper; else the summary moves to a page of its own. */
export function summaryPlacement(
  summary: Omit<SummaryModel, "summaryPlacement">,
  paper: Pick<ReportPaper, "height">,
  { footerNote = false }: { footerNote?: boolean } = {},
): "first" | "own" {
  if (!summary.inspectionSummary || summary.inspectionSummary.kind === "empty") return "first";
  const room = paper.height - SUMMARY_ROOM.chrome - (footerNote ? SUMMARY_ROOM.footerNote : 0);
  const title = SUMMARY_ROOM.kicker + Math.max(1, Math.ceil(summary.title.length / SUMMARY_ROOM.titleCharacters)) * SUMMARY_ROOM.titleLine;
  const order = summary.orderMix
    ? SUMMARY_ROOM.orderMix + (summary.orderMix.rows.length > 4 ? SUMMARY_ROOM.orderLegendLine : 0) + SUMMARY_ROOM.gap
    : 0;
  const checks = summary.checks
    ? SUMMARY_ROOM.checksFrame + summary.checks.reduce((sum, row) => sum + checkRowHeight(row), 0) + SUMMARY_ROOM.gap
    : 0;
  const text = SUMMARY_ROOM.summaryFrame + summaryHeight(summary.inspectionSummary) + SUMMARY_ROOM.gap;
  return title + SUMMARY_ROOM.gap + SUMMARY_ROOM.conclusionRow + SUMMARY_ROOM.gap + order + checks + text <= room ? "first" : "own";
}

/* ------------------------------------------------------------------ *
 * The plan of pages
 * ------------------------------------------------------------------ */

/** A section's title: the design's, or the one test it shows where that test has its own name (STD_EG's flow since 26 October 2026). */
const TITLE_FOR_ONE_MODULE: Partial<Record<ModuleKey, string>> = {
  tensile: "Physical Properties",
  dispensing_safedon: "Glove Dispensing",
  // Section 08 with no labelling in the template: the conclusion alone.
  conclusion: "Conclusion",
};

export function sectionTitle(key: ReportSectionKey, moduleKeys: readonly ModuleKey[]): string {
  const section = REPORT_SECTIONS.find((entry) => entry.key === key);
  const only = moduleKeys.length === 1 ? TITLE_FOR_ONE_MODULE[moduleKeys[0]] : undefined;
  return only ?? section?.title ?? key;
}

/**
 * The pages in print order: the Summary, each section the report shows
 * (REPORT_SECTIONS' order, numbered from 02 without gaps), then the photo
 * records. Each entry is planned first, then its builder (SECTION_BUILDERS,
 * lib/report/sections) fills its slot from the export and the entry, and
 * the entry takes the content's page count; an entry with no builder, or
 * whose builder gives nothing, prints "nothing entered yet" (a page per section, a
 * page per photo record).
 */
function planOf(doc: InspectionExport, summary: SummaryModel): { plan: ReportPlanEntry[]; sections: ReportSections } {
  const sections: ReportSections = {};
  const plan: ReportPlanEntry[] = [{ kind: "summary", key: "summary", pageCount: summary.summaryPlacement === "own" ? 2 : 1 }];
  let number = 1;
  for (const section of REPORT_SECTIONS) {
    const options = doc.report.sections[section.key];
    const moduleKeys = section.modules.filter((key) => moduleOf(doc, key) !== null);
    const switches = options.blocks as Record<string, boolean>;
    const blocks = section.blocks.filter((block) => switches[block.key] !== false);
    // In the report: switched on, in the inspection, and one of its blocks on (a section of none has its switch alone).
    if (!options.include || moduleKeys.length === 0 || (section.blocks.length > 0 && blocks.length === 0)) continue;
    number += 1;
    const entry = {
      kind: "section",
      key: section.key,
      number,
      kicker: `Section ${String(number).padStart(2, "0")}`,
      title: sectionTitle(section.key, moduleKeys),
      blocks: blocks.map(({ key, label }) => ({ key, label })),
      moduleKeys,
      pageCount: 1,
      built: false,
    } as ReportSectionPlanEntry;
    plan.push(withContent(doc, entry, sections));
  }
  const groups = photoGroupsOf(doc);
  // Source Documents' Media photos fill records too (photoRecordsOf, the builder's own choice), with no module of theirs.
  if (groups.length > 0 || photoRecordsOf(doc).length > 0) {
    const entry: ReportPhotosPlanEntry = {
      kind: "photos",
      key: "photos",
      records: groups.map((group, index) => ({
        key: group.key,
        index: index + 1,
        of: groups.length,
        kicker: `Photo Record ${index + 1} of ${groups.length}`,
        title: group.title,
        photos: group.photos,
      })),
      pageCount: Math.max(1, groups.length),
      built: false,
    };
    plan.push(withContent(doc, entry, sections));
  }
  return { plan, sections };
}

/** The entry with its builder's content in the model's slot and its page count; as planned without a builder. */
function withContent<E extends ReportSectionPlanEntry | ReportPhotosPlanEntry>(doc: InspectionExport, entry: E, sections: ReportSections): E {
  const builder = sectionBuilder(entry.key);
  const content = builder ? builder.build(doc, entry as never) : null;
  if (!content) return entry;
  (sections as Record<string, ReportSectionContent>)[entry.key] = content;
  return { ...entry, pageCount: Math.max(1, content.pageCount), built: true };
}

/**
 * The photo records the report prints: each group switched on with a photo,
 * its photos those of its modules (a custom module's go with the module it
 * follows), at most Photos per Group, in capture order. Once an admin has
 * marked photos In Report, only those print; until then every photo the
 * browser can show is a candidate. A flagged original (a HEIC the browser
 * could not convert) is left out.
 */
export function photoGroupsOf(doc: InspectionExport): { key: ReportPhotoGroupKey; title: string; photos: ReportPhoto[] }[] {
  const usable = doc.photos.filter((photo) => !photo.flagged);
  const chosen = usable.some((photo) => photo.includeInReport) ? usable.filter((photo) => photo.includeInReport) : usable;
  const after = new Map(doc.custom.map((custom) => [custom.key, custom.after ?? null]));
  const moduleFor = (key: string | null): string | null => (key === null ? null : after.has(key) ? (after.get(key) ?? null) : key);
  return REPORT_PHOTO_GROUPS.flatMap((group) => {
    if (!doc.report.photos.groups[group.key]) return [];
    const modules: readonly string[] = group.modules;
    const photos = chosen
      .filter((photo) => {
        const key = moduleFor(photo.moduleKey);
        return key !== null && modules.includes(key);
      })
      .slice(0, doc.report.photos.perGroup)
      .map(({ id, url, moduleKey, target, caption, takenAt }) => ({ id, url, moduleKey, target, caption, takenAt }));
    return photos.length === 0 ? [] : [{ key: group.key, title: group.title, photos }];
  });
}

/* ------------------------------------------------------------------ *
 * Words the pages share
 * ------------------------------------------------------------------ */

/** "4,551 cartons · 4,551,000 gloves · 1,000 gloves per carton": the order mix's totals. */
export function orderTotals(mix: OrderMix): string[] {
  return [
    `${formatCount(mix.totalCases)} ${mix.totalCases === 1 ? "carton" : "cartons"}`,
    ...(mix.totalGloves === null ? [] : [`${formatCount(mix.totalGloves)} ${mix.unitWord}`]),
    ...(mix.glovesPerCase === null ? [] : [`${formatCount(mix.glovesPerCase)} ${mix.unitWord} per carton`]),
  ];
}

/** "Prepared for Client A · Brand A PC-A01 Blue Nitrile": the footer's line. */
export function preparedFor(chrome: Pick<ReportChrome, "client" | "product">): string | null {
  const parts = [chrome.client ? `Prepared for ${chrome.client}` : null, chrome.product].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/** The header band's right side: "PO-0001 · Inspected 11 April 2025". */
export function bandReference(chrome: Pick<ReportChrome, "po" | "inspectedOn">): string | null {
  const parts = [chrome.po, chrome.inspectedOn ? `Inspected ${chrome.inspectedOn}` : null].filter((part): part is string => part !== null);
  return parts.length > 0 ? parts.join(" · ") : null;
}
