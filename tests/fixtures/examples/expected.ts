// Expected results for the two example reports, as typed data.
//
// Every row of docs/examples/expected-results.md (git-ignored) is here, with
// carton and box numbers replaced by the fixtures' placeholders. Where the
// original report is wrong, the expected value is the corrected one and
// `originalReport` records what the report showed. See docs/FIXTURES.md.
import type { ModuleKey, ModuleStatus } from "@/lib/schemas";
import type { ColumnOutcome, Spec } from "@/lib/stats";
import { deepFreeze } from "./helpers";
import type {
  DimensionMeasure,
  HoleCode,
  PerMeasure,
  PerSize,
  ReportSize,
  StickinessCode,
  VisualClass,
  VisualDefectCode,
} from "./types";

/** The two columns of an expected-results row besides the typed "Expected" values. */
export type ExpectedRow = {
  /** The "Check" column, with placeholder carton and box numbers. */
  readonly check: string;
  /** The "Original report" column: what the report showed; "same" when it agrees. */
  readonly originalReport: string;
};

/** An accept / reject decision from the AQL engine (BUILD_SPEC 7). */
export type ExpectedAqlCheck = ExpectedRow & {
  readonly n: number;
  readonly codeLetter: string;
  readonly aql: number;
  /** Table 2-A has an arrow at this code letter and AQL: the plan whose Ac / Re apply. */
  readonly arrow?: { readonly direction: "up" | "down"; readonly codeLetter: string; readonly n: number };
  readonly accept: number;
  readonly reject: number;
  readonly found: number;
  readonly status: ModuleStatus;
};

export type ExpectedWatertight = ExpectedAqlCheck & {
  /** Holes found, by location (locations with none are left out). */
  readonly byLocation: Readonly<Partial<Record<HoleCode, number>>>;
};

export type ExpectedVisual = ExpectedAqlCheck & {
  /** Defects found, by code (codes with none are left out). */
  readonly byDefect: Readonly<Partial<Record<VisualDefectCode, number>>>;
};

export type ExpectedLabeling = ExpectedRow & {
  readonly inner: { readonly n: number; readonly defects: number };
  readonly carton: { readonly n: number; readonly defects: number };
  readonly status: ModuleStatus;
};

/** ISO 2859-1 level I plan for the lot, against the sample taken (BUILD_SPEC 7, 13). */
export type SamplingNotice = {
  readonly lotGloves: number;
  readonly level: "I";
  readonly codeLetter: string;
  readonly required: number;
  readonly sampled: number;
  readonly belowPlan: boolean;
};

/** A validation error (blocks submit) or warning (goes into the export), BUILD_SPEC 6.2. */
export type ExpectedIssue = {
  readonly level: "error" | "warning";
  readonly module: ModuleKey;
  readonly size?: ReportSize;
  /** A label for the fixture; the module owns the app's real issue code. */
  readonly code: string;
  readonly message: string;
  /** Raised only under this condition. */
  readonly when?: string;
};

/** A cell typed as text: the app refuses `raw` (6.2 rule 1) and stores `accepted`. */
export type RejectedInput = {
  readonly module: ModuleKey;
  readonly size: ReportSize;
  /** Glove number, 1 to 13. */
  readonly glove: number;
  readonly measure: DimensionMeasure;
  readonly raw: string;
  readonly accepted: number;
};

/* ------------------------------------------------------------------ *
 * A. SAFEDON_EG
 * ------------------------------------------------------------------ */

export type SafedonDispensingBox = { readonly box: number; readonly defects: number; readonly rate: number };

export type SafedonEgExpected = {
  readonly template: "SAFEDON_EG";
  readonly totals: ExpectedRow & { readonly cartons: number; readonly gloves: number };
  readonly watertight: PerSize<ExpectedWatertight>;
  readonly visual: Readonly<Record<VisualClass, PerSize<ExpectedVisual>>>;
  readonly dispensing: PerSize<
    ExpectedRow & {
      /** Per box: defects and the rate as a fraction of the gloves per pack. */
      readonly boxes: readonly SafedonDispensingBox[];
      readonly defects: number;
      readonly gloves: number;
      readonly ratePct: number;
      readonly maxRatePct: number;
      readonly status: ModuleStatus;
    }
  >;
  readonly dimensions: PerSize<
    ExpectedRow & {
      /** The expected averages (from the source workbook's unrounded readings). */
      readonly average: PerMeasure<number>;
      /**
       * The averages of the readings as printed (thickness rounded to 2
       * decimals), which is what the fixture holds and what an inspector
       * typing the PDF enters. Length and width agree with `average`.
       */
      readonly averageOfPrintedReadings: PerMeasure<number>;
      /** The averages the original report computed, where they differ. */
      readonly originalAverage?: PerMeasure<number>;
      readonly perMeasure: PerMeasure<ColumnOutcome>;
      readonly status: ModuleStatus;
    }
  >;
  readonly tensile: PerSize<
    ExpectedRow & {
      readonly tensileMPa: number;
      readonly elongationPct: number;
      readonly minTensileMPa: number;
      readonly minElongationPct: number;
      readonly status: ModuleStatus;
    }
  >;
  readonly labeling: PerSize<ExpectedLabeling>;
  readonly sampling: PerSize<ExpectedRow & SamplingNotice>;
  readonly conclusion: ExpectedRow & { readonly result: "pass" | "fail" | "hold" };
  readonly rejectedInputs: readonly RejectedInput[];
  readonly errors: readonly ExpectedIssue[];
  readonly warnings: readonly ExpectedIssue[];
};

const SAFEDON_LABELING: ExpectedLabeling = {
  check: "Labelling",
  inner: { n: 3, defects: 0 },
  carton: { n: 1, defects: 0 },
  status: "pass",
  originalReport: "same",
};

const safedonVisual = (
  check: string,
  aql: number,
  n: 80 | 200,
  accept: number,
  originalReport = "same",
): ExpectedVisual => ({
  check,
  n,
  codeLetter: n === 80 ? "J" : "L",
  aql,
  accept,
  reject: accept + 1,
  found: 0,
  byDefect: {},
  status: "pass",
  originalReport,
});

const safedonTensile = (tensileMPa: number, elongationPct: number) =>
  ({
    check: "Tensile (MPa) / elongation (%)",
    tensileMPa,
    elongationPct,
    minTensileMPa: 14,
    minElongationPct: 500,
    status: "pass",
    originalReport: "same",
  }) as const;

const LEVEL_I_SET = "inspection level I is set on the template";

export const SAFEDON_EG_EXPECTED = deepFreeze<SafedonEgExpected>({
  template: "SAFEDON_EG",

  totals: { check: "Totals", cartons: 1530, gloves: 3_060_000, originalReport: "same" },

  watertight: {
    XS: {
      check: "Watertight XS",
      n: 80,
      codeLetter: "J",
      aql: 1.5,
      accept: 3,
      reject: 4,
      found: 1,
      byLocation: { hole_finger: 1 },
      status: "pass",
      originalReport: "total shows as a date (1 Jan 1980)",
    },
    S: {
      check: "Watertight S and M",
      n: 200,
      codeLetter: "L",
      aql: 1.5,
      accept: 7,
      reject: 8,
      found: 0,
      byLocation: {},
      status: "pass",
      originalReport: "same",
    },
    M: {
      check: "Watertight S and M",
      n: 200,
      codeLetter: "L",
      aql: 1.5,
      accept: 7,
      reject: 8,
      found: 0,
      byLocation: {},
      status: "pass",
      originalReport: "same",
    },
    L: {
      check: "Watertight L",
      n: 80,
      codeLetter: "J",
      aql: 1.5,
      accept: 3,
      reject: 4,
      found: 1,
      byLocation: { glove_burst: 1 },
      status: "pass",
      originalReport: "same",
    },
  },

  visual: {
    critical: {
      XS: safedonVisual("Critical, all sizes", 0, 80, 0, 'same, but labelled "Visual Minor"'),
      S: safedonVisual("Critical, all sizes", 0, 200, 0, 'same, but labelled "Visual Minor"'),
      M: safedonVisual("Critical, all sizes", 0, 200, 0, 'same, but labelled "Visual Minor"'),
      L: safedonVisual("Critical, all sizes", 0, 80, 0, 'same, but labelled "Visual Minor"'),
    },
    major: {
      XS: safedonVisual("Major limits", 2.5, 80, 5),
      S: safedonVisual("Major limits", 2.5, 200, 10),
      M: safedonVisual("Major limits", 2.5, 200, 10),
      L: safedonVisual("Major limits", 2.5, 80, 5),
    },
    minor: {
      XS: safedonVisual("Minor limits", 4, 80, 7),
      S: safedonVisual("Minor limits", 4, 200, 14),
      M: safedonVisual("Minor limits", 4, 200, 14),
      L: safedonVisual("Minor limits", 4, 80, 7),
    },
  },

  dispensing: {
    XS: {
      check: "Dispensing XS",
      boxes: [
        { box: 1, defects: 1, rate: 0.008 },
        { box: 12, defects: 0, rate: 0 },
        { box: 18, defects: 0, rate: 0 },
        { box: 25, defects: 0, rate: 0 },
        { box: 33, defects: 2, rate: 0.016 },
      ],
      defects: 3,
      gloves: 625,
      ratePct: 0.48,
      maxRatePct: 5,
      status: "pass",
      originalReport: "0.008 under box 18, box 33 shows 0",
    },
    S: {
      check: "Dispensing S",
      boxes: [51, 136, 365, 475, 539, 771, 790, 814].map((box) => ({ box, defects: 0, rate: 0 })),
      defects: 0,
      gloves: 1000,
      ratePct: 0,
      maxRatePct: 5,
      status: "pass",
      originalReport: "same",
    },
    M: {
      check: "Dispensing M",
      boxes: [
        { box: 92, defects: 0, rate: 0 },
        { box: 122, defects: 0, rate: 0 },
        { box: 174, defects: 2, rate: 0.016 },
        { box: 269, defects: 0, rate: 0 },
        { box: 382, defects: 1, rate: 0.008 },
        { box: 492, defects: 3, rate: 0.024 },
        { box: 549, defects: 2, rate: 0.016 },
        { box: 550, defects: 3, rate: 0.024 },
      ],
      defects: 11,
      gloves: 1000,
      ratePct: 1.1,
      maxRatePct: 5,
      status: "pass",
      originalReport: "same",
    },
    L: {
      check: "Dispensing L",
      boxes: [6, 16, 27, 40, 52].map((box) => ({ box, defects: 0, rate: 0 })),
      defects: 0,
      gloves: 625,
      ratePct: 0,
      maxRatePct: 5,
      status: "pass",
      originalReport: "shows 7 / 625 (1.12%)",
    },
  },

  dimensions: {
    XS: {
      check: "Dimension averages XS",
      average: { length: 241.38, width: 76.23, finger: 0.1755, palm: 0.1203 },
      averageOfPrintedReadings: { length: 241.38, width: 76.23, finger: 0.1769, palm: 0.1208 },
      perMeasure: { length: "pass", width: "pass", finger: "pass", palm: "pass" },
      status: "pass",
      originalReport: "same",
    },
    S: {
      check: "Dimension averages S",
      average: { length: 243.38, width: 86.69, finger: 0.1756, palm: 0.119 },
      averageOfPrintedReadings: { length: 243.38, width: 86.69, finger: 0.1754, palm: 0.1208 },
      originalAverage: { length: 243.5, width: 86.69, finger: 0.1748, palm: 0.1197 },
      perMeasure: { length: "pass", width: "pass", finger: "pass", palm: "pass" },
      status: "pass",
      originalReport: "243.5, 86.69, 0.1748, 0.1197 (5 text cells skipped)",
    },
    M: {
      check: "Dimension averages M",
      average: { length: 242.54, width: 97.31, finger: 0.174, palm: 0.1117 },
      averageOfPrintedReadings: { length: 242.54, width: 97.31, finger: 0.1738, palm: 0.11 },
      perMeasure: { length: "pass", width: "pass", finger: "pass", palm: "pass" },
      status: "pass",
      originalReport: "same",
    },
    L: {
      check: "Dimension averages L",
      average: { length: 242.62, width: 106.62, finger: 0.1742, palm: 0.1191 },
      averageOfPrintedReadings: { length: 242.62, width: 106.62, finger: 0.1746, palm: 0.12 },
      perMeasure: { length: "pass", width: "pass", finger: "pass", palm: "pass" },
      status: "pass",
      originalReport: "same",
    },
  },

  tensile: {
    XS: safedonTensile(34.18, 536),
    S: safedonTensile(32.99, 547),
    M: safedonTensile(34.03, 555),
    L: safedonTensile(33.17, 543),
  },

  labeling: { XS: SAFEDON_LABELING, S: SAFEDON_LABELING, M: SAFEDON_LABELING, L: SAFEDON_LABELING },

  sampling: {
    XS: {
      check: "Sampling notice",
      lotGloves: 120_000,
      level: "I",
      codeLetter: "L",
      required: 200,
      sampled: 80,
      belowPlan: true,
      originalReport: "not shown",
    },
    S: {
      check: "Sampling notice",
      lotGloves: 1_700_000,
      level: "I",
      codeLetter: "N",
      required: 500,
      sampled: 200,
      belowPlan: true,
      originalReport: "not shown",
    },
    M: {
      check: "Sampling notice",
      lotGloves: 1_120_000,
      level: "I",
      codeLetter: "N",
      required: 500,
      sampled: 200,
      belowPlan: true,
      originalReport: "not shown",
    },
    L: {
      check: "Sampling notice",
      lotGloves: 120_000,
      level: "I",
      codeLetter: "L",
      required: 200,
      sampled: 80,
      belowPlan: true,
      originalReport: "not shown",
    },
  },

  conclusion: { check: "Conclusion", result: "pass", originalReport: "PASSED" },

  rejectedInputs: [
    { module: "dimensions", size: "S", glove: 1, measure: "finger", raw: "0 .18", accepted: 0.18 },
    { module: "dimensions", size: "S", glove: 1, measure: "palm", raw: "0 .11", accepted: 0.11 },
    { module: "dimensions", size: "S", glove: 2, measure: "finger", raw: "0 .18", accepted: 0.18 },
    { module: "dimensions", size: "S", glove: 2, measure: "palm", raw: "0 .12", accepted: 0.12 },
    { module: "dimensions", size: "S", glove: 3, measure: "length", raw: "2 42", accepted: 242 },
  ],

  errors: [],

  warnings: [
    {
      level: "warning",
      module: "sampling_plan",
      size: "XS",
      code: "sample_below_plan",
      message: "80 gloves sampled; inspection level I needs 200 (lot 120,000 gloves, code L).",
      when: LEVEL_I_SET,
    },
    {
      level: "warning",
      module: "sampling_plan",
      size: "S",
      code: "sample_below_plan",
      message: "200 gloves sampled; inspection level I needs 500 (lot 1,700,000 gloves, code N).",
      when: LEVEL_I_SET,
    },
    {
      level: "warning",
      module: "sampling_plan",
      size: "M",
      code: "sample_below_plan",
      message: "200 gloves sampled; inspection level I needs 500 (lot 1,120,000 gloves, code N).",
      when: LEVEL_I_SET,
    },
    {
      level: "warning",
      module: "sampling_plan",
      size: "L",
      code: "sample_below_plan",
      message: "80 gloves sampled; inspection level I needs 200 (lot 120,000 gloves, code L).",
      when: LEVEL_I_SET,
    },
  ],
});

/* ------------------------------------------------------------------ *
 * B. STD_EG
 * ------------------------------------------------------------------ */

/** A grid cell, 1-based as printed: row 1 to 5, column 1 to 10. */
export type GridCell = { readonly row: number; readonly column: number };

export type StdEgExpected = {
  readonly template: "STD_EG";
  readonly totals: ExpectedRow & { readonly cartons: number; readonly gloves: number };
  readonly cartonList: ExpectedRow & {
    readonly size: ReportSize;
    readonly entries: number;
    readonly unique: number;
    readonly duplicate: { readonly carton: number; readonly cells: readonly GridCell[] };
    /** The `carton_sampling` result, which fails on validation errors (BUILD_SPEC 6.1). */
    readonly status: ModuleStatus;
  };
  readonly dispensingBox: ExpectedRow & {
    readonly size: ReportSize;
    /** The row ("Item") of the packing check, 1 to 13. */
    readonly item: number;
    readonly box: number;
    /** The listed carton one digit away, as the original box was from its carton. */
    readonly likelyIntended: number;
    /**
     * A validation error that blocks submit (BUILD_SPEC 6.2 rule 7; `errors`),
     * not a module result: the `dispensing_packing` result for the size is
     * `dispensing.M.status`, from the averages and stickiness codes (6.1).
     */
    readonly validation: "error";
  };
  readonly watertight: PerSize<ExpectedWatertight>;
  readonly visual: Readonly<Record<VisualClass, PerSize<ExpectedVisual>>>;
  readonly dimensions: PerSize<
    ExpectedRow & {
      readonly median: PerMeasure<number>;
      /** The specs the row names; the others are NA. */
      readonly spec: PerMeasure<Spec>;
      /** NA specs give "na" (lib/stats), although the report prints "Passed" under them. */
      readonly perMeasure: PerMeasure<ColumnOutcome>;
      readonly status: ModuleStatus;
    }
  >;
  readonly forceAtBreak: PerSize<
    ExpectedRow & { readonly medianN: number; readonly minN: number; readonly status: ModuleStatus }
  >;
  readonly weight: PerSize<
    ExpectedRow & {
      readonly averageG: number;
      readonly indicativeG: number;
      /** (average - indicative) / indicative, in %, 1 decimal. */
      readonly deviationPct: number;
      readonly thresholdPct: number;
      readonly status: ModuleStatus;
    }
  >;
  readonly dispensing: PerSize<
    ExpectedRow & {
      readonly layeringAvgPct: number;
      readonly dispensingAvgPct: number;
      /** Boxes per stickiness code. */
      readonly stickiness: Readonly<Partial<Record<StickinessCode, number>>>;
      readonly minLayeringPct: number;
      readonly minDispensingPct: number;
      readonly status: ModuleStatus;
    }
  >;
  readonly labeling: PerSize<ExpectedLabeling>;
  readonly unorderedSizes: ExpectedRow & { readonly sizes: readonly ReportSize[] };
  readonly inspector: ExpectedRow & { readonly recordedAutomatically: true };
  readonly productCode: ExpectedRow & { readonly code: string };
  /** Not a row of expected-results.md: BUILD_SPEC 13 says this example matches level I. */
  readonly sampling: PerSize<SamplingNotice>;
  readonly conclusion: ExpectedRow & { readonly result: "pass" | "fail" | "hold"; readonly condition: string };
  readonly rejectedInputs: readonly RejectedInput[];
  readonly errors: readonly ExpectedIssue[];
  readonly warnings: readonly ExpectedIssue[];
  /** Fixes that clear the two errors, so an acceptance test can reach "pass". */
  readonly corrections: {
    readonly duplicateCarton: {
      readonly size: ReportSize;
      readonly cell: GridCell;
      readonly from: number;
      readonly to: number;
      readonly note: string;
    };
    readonly strayBox: {
      readonly size: ReportSize;
      readonly item: number;
      readonly from: number;
      readonly to: number;
      readonly note: string;
    };
  };
};

export const STD_EG_EXPECTED = deepFreeze<StdEgExpected>({
  template: "STD_EG",

  totals: { check: "Totals", cartons: 2900, gloves: 5_800_000, originalReport: "same" },

  cartonList: {
    check: "Carton list",
    size: "M",
    entries: 50,
    unique: 49,
    duplicate: {
      carton: 525,
      cells: [
        { row: 2, column: 10 },
        { row: 3, column: 1 },
      ],
    },
    status: "fail",
    originalReport: "50 entries, 49 unique",
  },

  dispensingBox: {
    check: "Dispensing box 2336",
    size: "M",
    item: 12,
    box: 2336,
    likelyIntended: 2236,
    validation: "error",
    originalReport: "accepted (likely 2236)",
  },

  watertight: {
    M: {
      check: "Watertight M",
      n: 500,
      codeLetter: "N",
      aql: 1.5,
      accept: 14,
      reject: 15,
      found: 1,
      byLocation: { hole_finger: 1 },
      status: "pass",
      originalReport: "header says K, L & M; limit 10 / 11",
    },
  },

  visual: {
    critical: {
      M: {
        check: "Critical M",
        n: 500,
        codeLetter: "N",
        aql: 0,
        accept: 0,
        reject: 1,
        found: 0,
        byDefect: {},
        status: "pass",
        originalReport: "same",
      },
    },
    major: {
      M: {
        check: "Major M",
        n: 500,
        codeLetter: "N",
        aql: 2.5,
        accept: 21,
        reject: 22,
        found: 8,
        byDefect: { thin_crotch_area: 2, thin_body_area: 1, thin_spot: 5 },
        status: "pass",
        originalReport: "limit 14 / 15",
      },
    },
    minor: {
      M: {
        check: "Minor M",
        n: 500,
        codeLetter: "N",
        aql: 4,
        arrow: { direction: "up", codeLetter: "M", n: 315 },
        accept: 21,
        reject: 22,
        found: 0,
        byDefect: {},
        status: "pass",
        originalReport: "21 / 22",
      },
    },
  },

  dimensions: {
    M: {
      check: "Dimension medians M",
      median: { length: 245, width: 95, finger: 0.09, palm: 0.05, cuff: 0.04 },
      spec: { length: { kind: "min", min: 240 }, width: { kind: "tolerance", nominal: 95, tolerance: 10 } },
      perMeasure: { length: "pass", width: "pass", finger: "na", palm: "na", cuff: "na" },
      status: "pass",
      originalReport: "same",
    },
  },

  forceAtBreak: {
    M: { check: "Force at break M", medianN: 6.537, minN: 6, status: "pass", originalReport: "same" },
  },

  weight: {
    M: {
      check: "Weight M",
      averageG: 2.9,
      indicativeG: 3.5,
      deviationPct: -17.1,
      thresholdPct: 10,
      status: "warn",
      originalReport: "not flagged",
    },
  },

  dispensing: {
    M: {
      check: "Dispensing M",
      layeringAvgPct: 88.3,
      dispensingAvgPct: 90.3,
      stickiness: { A: 13 },
      minLayeringPct: 70,
      minDispensingPct: 80,
      status: "pass",
      originalReport: "same",
    },
  },

  labeling: {
    M: {
      check: "Labelling M",
      inner: { n: 3, defects: 0 },
      carton: { n: 1, defects: 0 },
      status: "pass",
      originalReport: "same",
    },
  },

  unorderedSizes: {
    check: "Sizes not ordered (XS, S, L, XL)",
    sizes: ["XS", "S", "L", "XL"],
    originalReport: 'show "Passed" with no data',
  },

  inspector: { check: "Inspector", recordedAutomatically: true, originalReport: "missing" },

  productCode: {
    check: "Product code",
    code: "PC-A01",
    originalReport: "PC-A02 in file name, PC-A01 in report",
  },

  sampling: {
    M: { lotGloves: 5_800_000, level: "I", codeLetter: "N", required: 500, sampled: 500, belowPlan: false },
  },

  conclusion: {
    check: "Conclusion",
    result: "pass",
    condition: "once the carton errors are fixed",
    originalReport: "PASSED",
  },

  rejectedInputs: [],

  errors: [
    {
      level: "error",
      module: "carton_sampling",
      size: "M",
      code: "carton_duplicate",
      message: "Carton 525 is entered twice (row 2 column 10, row 3 column 1).",
    },
    {
      level: "error",
      module: "dispensing_packing",
      size: "M",
      code: "box_not_in_carton_list",
      message: "Box 2336 (item 12) is not in the size M carton list.",
    },
  ],

  warnings: [
    {
      level: "warning",
      module: "weight",
      size: "M",
      code: "weight_deviation",
      message: "Average weight 2.9 g is 17.1% below the indicative 3.5 g (threshold 10%).",
    },
  ],

  corrections: {
    duplicateCarton: {
      size: "M",
      cell: { row: 3, column: 1 },
      from: 525,
      to: 830,
      note: "The report does not say which entry is wrong: the second becomes an unused number in range.",
    },
    strayBox: {
      size: "M",
      item: 12,
      from: 2336,
      to: 2236,
      note: "The listed carton one digit away: the likely intended box.",
    },
  },
});
