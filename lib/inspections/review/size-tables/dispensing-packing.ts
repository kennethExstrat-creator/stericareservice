// Glove Packing Check, sizes across (modules/dispensing_packing): the boxes
// complete of those planned ("13 of 13"), the boxes' average layering and
// dispensing at one decimal, as the summary prints them ("90.4%"), against
// the template's minimums under the label ("Min. 70%"), the stickiest code
// entered with the codes that pass under the label ("A, B, B1, C"), and,
// once any size has one, the aged sample's three, judged on their own. A
// check failed is red. Amber for what the module warns about at those
// fields: a box/carton number not sampled, a value out of range or a code
// the template lacks, an aged sample entered in part. Averages of the boxes
// entered so far show while a size is not done, and are not judged yet.
import { formatDecimal } from "@/lib/stats";
import { labelFor } from "@/modules/_framework";
import {
  formatAverage,
  type AgedSampleComputed,
  type CheckResult,
  type DispensingPackingComputed,
  type PackingSizeComputed,
} from "@/modules/dispensing_packing/calc";
import { DispensingPackingConfigSchema, type StickinessCode } from "@/modules/dispensing_packing/config";
import { DispensingPackingDataSchema, type PackingAgedSample } from "@/modules/dispensing_packing/schema";
import { plainLabel } from "@/modules/dispensing_packing/text";
import type { SizeTableAdapter, SizeTableCell, SizeTableRow } from "../size-table";
import { cellsBySize, EMPTY_CELL } from "./cells";
import { cellOf, countedItem, hasIssueAt, isRecord, tableOf, toneOf } from "./counts-format";

type AgedField = "layeringPct" | "dispensingPct" | "stickiness";

/** The aged sample's check of each of its values. */
const AGED_CHECK = {
  layeringPct: "layeringResult",
  dispensingPct: "dispensingResult",
  stickiness: "stickinessResult",
} as const satisfies Record<AgedField, keyof AgedSampleComputed>;

export const dispensingPackingTable: SizeTableAdapter = (entry, context) => {
  const computed = entry.computed as DispensingPackingComputed;
  if (!isRecord(computed.sizes)) return null;
  const config = DispensingPackingConfigSchema.safeParse(entry.config);
  if (!config.success) return null;
  const { minLayeringPct, minDispensingPct, stickinessCodes } = config.data;
  const parsed = DispensingPackingDataSchema.safeParse(entry.data);
  const saved = parsed.success ? parsed.data : null;
  const { labels, issues } = entry;

  // The column headings' words, as the summary uses them: "Layering %" is "Layering".
  const words = {
    layering: plainLabel(labelFor(labels, "layeringPct")),
    dispensing: plainLabel(labelFor(labels, "dispensingPct")),
    stickiness: plainLabel(labelFor(labels, "stickiness")),
    aged: labelFor(labels, "agedSample"),
  };
  const specs = {
    layering: `Min. ${formatDecimal(minLayeringPct)}%`,
    dispensing: `Min. ${formatDecimal(minDispensingPct)}%`,
    // The codes that pass, as the capture screen lists them.
    stickiness: stickinessCodes
      .filter((code) => code.pass)
      .map((code) => code.code)
      .join(", "),
  };
  const of = (size: string): PackingSizeComputed | null => computed.sizes[size] ?? null;
  const atBoxes = (size: string, field: string) => hasIssueAt(issues, ["sizes", size, "boxes", null, field]);
  const judged = (result: CheckResult, warn: boolean) => toneOf(result === "fail", warn);
  const bySize = (cell: (own: PackingSizeComputed, size: string) => SizeTableCell) =>
    cellsBySize(context, (size) => {
      const own = of(size);
      return own ? cell(own, size) : EMPTY_CELL;
    });

  const rows: SizeTableRow[] = [
    {
      key: "boxesComplete",
      label: "Boxes Complete",
      cells: bySize((own, size) =>
        cellOf(`${own.boxesComplete} of ${own.boxesExpected}`, { tone: toneOf(false, atBoxes(size, "boxNo")) }),
      ),
    },
    {
      key: "layeringPct",
      label: words.layering,
      spec: specs.layering,
      cells: bySize((own, size) =>
        cellOf(percent(own.layeringAverage), { tone: judged(own.layeringResult, atBoxes(size, "layeringPct")) }),
      ),
    },
    {
      key: "dispensingPct",
      label: words.dispensing,
      spec: specs.dispensing,
      cells: bySize((own, size) =>
        cellOf(percent(own.dispensingAverage), { tone: judged(own.dispensingResult, atBoxes(size, "dispensingPct")) }),
      ),
    },
    {
      key: "stickiness",
      label: words.stickiness,
      ...(specs.stickiness === "" ? {} : { spec: specs.stickiness }),
      cells: bySize((own, size) =>
        cellOf(own.stickinessSummary, {
          note: codeCounts(own.stickinessCounts, stickinessCodes),
          tone: judged(own.stickinessResult, atBoxes(size, "stickiness")),
        }),
      ),
    },
  ];

  // Each size's aged sample (26 October 2026), apart from the boxes: once any size has one.
  if (context.sizes.some((size) => of(size)?.agedSample)) {
    // Its values as entered (calc keeps only its checks), each judged by its own check.
    const aged = (field: AgedField, text: (sample: PackingAgedSample | null) => string | null) =>
      bySize((own, size) => {
        if (!own.agedSample) return EMPTY_CELL;
        const sample = saved?.sizes[size]?.agedSample ?? null;
        return cellOf(text(sample), {
          tone: judged(own.agedSample[AGED_CHECK[field]], hasIssueAt(issues, ["sizes", size, "agedSample", field])),
        });
      });
    rows.push(
      {
        key: "agedSample.layeringPct",
        label: `${words.aged}: ${words.layering}`,
        spec: specs.layering,
        cells: aged("layeringPct", (sample) => percent(sample?.layeringPct ?? null)),
      },
      {
        key: "agedSample.dispensingPct",
        label: `${words.aged}: ${words.dispensing}`,
        spec: specs.dispensing,
        cells: aged("dispensingPct", (sample) => percent(sample?.dispensingPct ?? null)),
      },
      {
        key: "agedSample.stickiness",
        label: `${words.aged}: ${words.stickiness}`,
        ...(specs.stickiness === "" ? {} : { spec: specs.stickiness }),
        cells: aged("stickiness", (sample) => sample?.stickiness ?? null),
      },
    );
  }
  return tableOf(rows);
};

/** "88.3%": a percentage as the summary prints it, at one decimal; nothing yet (—). */
function percent(value: number | null): string | null {
  return value === null ? null : `${formatAverage(value)}%`;
}

/** "A 12, D 1": the boxes per stickiness code, in the template's order, once more than one code is entered. */
function codeCounts(counts: Readonly<Record<string, number>>, codes: readonly StickinessCode[]): string | null {
  const used = codes.filter((code) => (counts[code.code] ?? 0) > 0);
  return used.length > 1 ? used.map((code) => countedItem(code.code, counts[code.code] ?? 0)).join(", ") : null;
}
