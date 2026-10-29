// Exports for Section 07's tests (Glove Packing & Dispensing): the STD_EG
// export (./exports.ts; placeholder identifiers, docs/FIXTURES.md) with its
// order and its packing check made over for the sizes a test needs, the
// module's computed values and results worked out by its own calc, as the
// export carries them. Box/carton numbers are made up here, never a
// client's; values are the tests' own.
import { ExportSchema, type InspectionExport } from "@/lib/schemas/export";
import { calcDispensingPacking } from "@/modules/dispensing_packing/calc";
import { DISPENSING_PACKING_DEFAULT_CONFIG, DISPENSING_PACKING_LABELS, type DispensingPackingConfig } from "@/modules/dispensing_packing/config";
import { DispensingPackingDataSchema, type PackingAgedSample, type PackingBox } from "@/modules/dispensing_packing/schema";
import { makeTestContext } from "@/modules/_framework/testing";
import { makeStdEgExport } from "./exports";

export type PackingSizeInput = {
  /** Cartons ordered: 1,000 unless given. */
  cases?: number;
  boxes: Partial<PackingBox>[];
  aged?: Partial<PackingAgedSample>;
};

export type PackingExportOptions = {
  /** Over the module's default config; the boxes planned per size are the boxes given unless set. */
  config?: Partial<DispensingPackingConfig>;
  /** Over the module's default labels: a template's own wording. */
  labels?: Readonly<Record<string, string>>;
  /** The answer to "Aged Sample?" (Kenneth, 30 October 2026); unanswered unless given. */
  hasAgedSample?: "yes" | "no";
};

/** `count` boxes numbered from `first` (placeholders, from 3,000 up), every value the same unless `values` says. */
export function packingBoxes(count: number, values: Partial<PackingBox> = {}, first = 7001): Partial<PackingBox>[] {
  return Array.from({ length: count }, (_, index) => ({ boxNo: first + index * 7, layeringPct: 88, dispensingPct: 90, stickiness: "A", ...values }));
}

const EMPTY_BOX: PackingBox = { boxNo: null, layeringPct: null, dispensingPct: null, stickiness: null, note: null };

/** JSON as the export stores it. */
function json<T>(value: unknown): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/** The STD_EG export ordering these sizes (in the template's order), its packing check as given. */
export function packingExport(sizes: Readonly<Record<string, PackingSizeInput>>, options: PackingExportOptions = {}): InspectionExport {
  const doc = makeStdEgExport();
  const order = doc.modules.find((module) => module.key === "order_lots");
  const packing = doc.modules.find((module) => module.key === "dispensing_packing");
  if (!order || !packing) throw new Error("The STD_EG export has no order or no packing check.");
  const entries = Object.entries(sizes);
  order.data = json({ ...order.data, sizes: Object.fromEntries(entries.map(([size, input]) => [size, { qtyCases: input.cases ?? 1000, lotNumbers: [], packingSite: null }])) });

  const config: DispensingPackingConfig = {
    ...DISPENSING_PACKING_DEFAULT_CONFIG,
    boxesPerSize: { default: 13, bySize: Object.fromEntries(entries.map(([size, input]) => [size, Math.max(1, input.boxes.length)])) },
    ...options.config,
  };
  const labels = { ...DISPENSING_PACKING_LABELS, ...options.labels };
  const data = DispensingPackingDataSchema.parse({
    ...(options.hasAgedSample ? { hasAgedSample: options.hasAgedSample } : {}),
    sizes: Object.fromEntries(
      entries.map(([size, input]) => [
        size,
        {
          boxes: input.boxes.map((box) => ({ ...EMPTY_BOX, ...box })),
          ...(input.aged ? { agedSample: { layeringPct: null, dispensingPct: null, stickiness: null, note: null, ...input.aged } } : {}),
        },
      ]),
    ),
  });
  const templateOrder = (doc.template.sizes ?? []).map((size) => size.value);
  const context = makeTestContext({ sizes: entries.map(([size]) => size).sort((a, b) => templateOrder.indexOf(a) - templateOrder.indexOf(b)) });
  const output = calcDispensingPacking({ data, config, labels, context, title: packing.title, results: {}, hasData: true });
  packing.data = json(data);
  packing.config = json(config);
  packing.labels = labels;
  packing.computed = json(output.computed);
  packing.result = output.result;
  return ExportSchema.parse(doc);
}

/**
 * Four sizes as TG35 page 7 lays them out (S 8 boxes, M 13, L 8, XL 5, an
 * aged sample each, every box graded A), with the tests' own numbers.
 */
export function fourSizeExport(options: PackingExportOptions = {}): InspectionExport {
  return packingExport(
    {
      S: { boxes: packingBoxes(8, { layeringPct: 90, dispensingPct: 92 }, 3001), aged: { layeringPct: 87, dispensingPct: 85, stickiness: "B" } },
      M: { boxes: packingBoxes(13, { layeringPct: 90, dispensingPct: 92 }, 4001), aged: { layeringPct: 91, dispensingPct: 89, stickiness: "B" } },
      L: { boxes: packingBoxes(8, { layeringPct: 88, dispensingPct: 90 }, 5001), aged: { layeringPct: 89, dispensingPct: 87, stickiness: "B1" } },
      XL: { boxes: packingBoxes(5, { layeringPct: 87, dispensingPct: 89 }, 6001), aged: { layeringPct: 87, dispensingPct: 85, stickiness: "B" } },
    },
    options,
  );
}
