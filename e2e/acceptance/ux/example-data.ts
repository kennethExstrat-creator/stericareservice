// The two example reports as saved inspection data, for the UX audit's
// fixtures: the same builders as tests/acceptance/examples.ts (stdEgData,
// safedonEgData), which Playwright cannot load (it reads the seed bundle
// through import.meta, and the e2e specs run as CommonJS). The client,
// manufacturer, PO, lot and carton identifiers are the fixtures' placeholders.
import { roundTo } from "@/lib/stats";
import type { InspectionData } from "@/modules/_framework";
import { dimensionsData } from "@/modules/dimensions/__fixtures__/examples";
import { headerData, pickedDate } from "@/modules/header/__fixtures__/examples";
import { orderData } from "@/modules/order_lots/__fixtures__/examples";
import { packingData } from "@/modules/packing_config/__fixtures__/examples";
import { cartonSamplingData, samplingPlanData } from "@/modules/sampling_plan/__fixtures__/examples";
import { weightData } from "@/modules/weight/__fixtures__/examples";
import {
  SAFEDON_DEFECTS,
  SAFEDON_EG_EXAMPLE,
  STD_EG_EXAMPLE,
  STD_EG_EXPECTED,
  type ExampleReport,
  type PerSize,
  type ReportSize,
} from "@/tests/fixtures/examples";

function filled<T>(perSize: PerSize<T>): [ReportSize, T][] {
  return (["XS", "S", "M", "L", "XL"] as const).flatMap((size) => {
    const entry = perSize[size];
    return entry === undefined ? [] : [[size, entry] as [ReportSize, T]];
  });
}

function bySize<T, U>(perSize: PerSize<T>, map: (entry: T, size: ReportSize) => U): Record<string, U> {
  return Object.fromEntries(filled(perSize).map(([size, entry]) => [size, map(entry, size)]));
}

function gloveInfoData(example: ExampleReport) {
  const { surfaceTexture, indicativeWeightG, colour, length } = example.gloveInfo;
  return { surfaceTexture, indicativeWeight: indicativeWeightG, colour, length };
}

function watertightData(example: ExampleReport) {
  return {
    sizes: bySize(example.watertight.perSize, (entry) => ({
      tested: entry.tested,
      holes: { ...entry.holes },
      otherDescription: null,
      unmapped: [],
    })),
  };
}

function visualData(example: ExampleReport) {
  const sizes = new Set<ReportSize>(
    (["critical", "major", "minor"] as const).flatMap((cls) => filled(example.visual[cls].perSize).map(([size]) => size)),
  );
  const classData = (cls: "critical" | "major" | "minor", size: ReportSize) => {
    const entry = example.visual[cls].perSize[size];
    return { inspected: entry?.inspected ?? null, counts: { ...entry?.counts }, unmapped: [] as { label: string; count: number }[] };
  };
  return {
    sizes: Object.fromEntries(
      [...sizes].map((size) => [
        size,
        { critical: classData("critical", size), major: classData("major", size), minor: classData("minor", size) },
      ]),
    ),
  };
}

function labelingData(example: ExampleReport) {
  const level = (entry: { inspected: number; defects: Readonly<Record<string, number | undefined>> } | undefined) => ({
    inspected: entry?.inspected ?? null,
    boxNos: [],
    defects: { ...entry?.defects },
  });
  return {
    sizes: bySize(example.labeling.inner.perSize, (_, size) => ({
      inner: level(example.labeling.inner.perSize[size]),
      carton: level(example.labeling.carton.perSize[size]),
    })),
  };
}

function conclusionData(example: ExampleReport, finished: boolean) {
  return finished
    ? {
        finalResult: example.conclusion.printedResult === "PASSED" ? "pass" : "fail",
        remark: example.conclusion.remark,
        date: pickedDate(example.conclusion.date),
        signature: null,
      }
    : { finalResult: null, remark: null, date: null, signature: null };
}

function readingsWithMedian(value: number, n = 13): number[] {
  const middle = (n - 1) / 2;
  const sorted = Array.from({ length: n }, (_, index) => roundTo(value + (index - middle) * 0.05, 6));
  return [...sorted.filter((_, index) => index % 2 === 1), ...sorted.filter((_, index) => index % 2 === 0)];
}

/**
 * The STD_EG example as entered: the report's duplicate carton kept (a submit
 * error; box 2336 is none, BUILD_SPEC 6.2 rule 7), or `corrected` as
 * tests/acceptance does.
 */
export function stdEgData({
  finished = false,
  corrected = false,
  unmapped,
}: {
  finished?: boolean;
  corrected?: boolean;
  /** A defect not on the template's list, in the inspector's words, counted once as a major defect. */
  unmapped?: string;
} = {}): InspectionData {
  const report = STD_EG_EXAMPLE;
  const cartons = cartonSamplingData(report);
  const boxes = bySize(report.dispensingPacking.perSize, (entry) => ({
    boxes: entry.boxes.map((box) => ({
      boxNo: box.box,
      layeringPct: box.layeringPct,
      dispensingPct: box.dispensingPct,
      stickiness: box.stickiness,
      note: null,
    })),
  }));
  if (corrected) {
    const { duplicateCarton } = STD_EG_EXPECTED.corrections;
    const index = (duplicateCarton.cell.row - 1) * 10 + (duplicateCarton.cell.column - 1);
    cartons.sizes[duplicateCarton.size].cartonNumbers[index] = duplicateCarton.to;
  }
  const visual = visualData(report);
  if (unmapped) {
    const first = Object.values(visual.sizes)[0];
    first.major.unmapped = [{ label: unmapped, count: 1 }];
  }
  return {
    modules: {
      header: headerData(report.header),
      glove_info: gloveInfoData(report),
      order_lots: orderData(report.order),
      packing_config: packingData(report.packing),
      sampling_plan: samplingPlanData(report),
      carton_sampling: cartons,
      dimensions: dimensionsData(report.dimensions),
      force_at_break: {
        sizes: bySize(report.forceAtBreak, (entry) => ({ values: readingsWithMedian(entry.medianN) })),
        labReport: null,
      },
      weight: weightData(report.weight),
      watertight: watertightData(report),
      visual,
      dispensing_packing: { sizes: boxes },
      labeling: labelingData(report),
      conclusion: conclusionData(report, finished),
    },
    custom: {},
  };
}

/** The SAFEDON_EG example, corrected cells typed again, with no lab report attached. */
export function safedonEgData({ finished = false }: { finished?: boolean } = {}): InspectionData {
  const report = SAFEDON_EG_EXAMPLE;
  return {
    modules: {
      header: headerData(report.header),
      glove_info: gloveInfoData(report),
      order_lots: orderData(report.order),
      packing_config: packingData(report.packing),
      sampling_plan: samplingPlanData(report),
      carton_sampling: cartonSamplingData(report),
      dimensions: dimensionsData(report.dimensions),
      tensile: {
        sizes: bySize(report.tensile, (entry) => ({
          tensileStrength: entry.tensileMPa,
          elongationAtBreak: entry.elongationPct,
        })),
        labReport: null,
      },
      weight: weightData(report.weight),
      watertight: watertightData(report),
      visual: visualData(report),
      dispensing_safedon: {
        sizes: bySize(report.dispensingSafedon.perSize, (entry) => ({
          boxes: entry.boxes.map((boxNo, index) => ({
            boxNo,
            counts: Object.fromEntries(SAFEDON_DEFECTS.map((code) => [code, entry.counts[code][index]])),
          })),
        })),
      },
      labeling: labelingData(report),
      conclusion: conclusionData(report, finished),
    },
    custom: {},
  };
}

/** A surgical order just started: two sizes ordered, nothing measured yet. */
export function stdSgData(): InspectionData {
  return {
    modules: {
      order_lots: {
        sizes: {
          "6.5": { qtyCases: 120, lotNumbers: ["LOT-SG-0001"], packingSite: null },
          "7.0": { qtyCases: 80, lotNumbers: ["LOT-SG-0002", "LOT-SG-0003"], packingSite: null },
        },
      },
    },
    custom: {},
  };
}
