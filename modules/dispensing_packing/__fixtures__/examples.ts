// The example reports (tests/fixtures/examples) in this module's shape. The
// reports predate the aged sample (Kenneth, 26 October 2026) and print none,
// and an empty one keeps its size not done (27 October 2026): each size they
// check gets a placeholder aged sample that passes, as an inspector would
// enter one, the boxes kept as printed (docs/FIXTURES.md).
import type { DispensingPackingSection } from "@/tests/fixtures/examples";
import type { DispensingPackingData, PackingAgedSample } from "../schema";

/**
 * An aged sample that passes the defaults (layering 85% against 70%,
 * dispensing 88% against 80%, code A passes): placeholder values for a size
 * whose report printed none.
 */
export const PASSING_AGED_SAMPLE: Readonly<PackingAgedSample> = { layeringPct: 85, dispensingPct: 88, stickiness: "A", note: null };

/** A copy of the placeholder, for data a test may change. */
export function passingAgedSample(): PackingAgedSample {
  return { ...PASSING_AGED_SAMPLE };
}

/** The report's packing check as the capture screen saves it: each box as typed, and a passing aged sample per size. */
export function packingCheckData(section: DispensingPackingSection): DispensingPackingData {
  return {
    sizes: Object.fromEntries(
      Object.entries(section.perSize).flatMap(([size, entry]) =>
        entry === undefined
          ? []
          : [
              [
                size,
                {
                  boxes: entry.boxes.map((box) => ({
                    boxNo: box.box,
                    layeringPct: box.layeringPct,
                    dispensingPct: box.dispensingPct,
                    stickiness: box.stickiness,
                    note: null,
                  })),
                  agedSample: passingAgedSample(),
                },
              ],
            ],
      ),
    ),
  };
}
