// Canonical units (BUILD_SPEC 4.2 rule 5): measurements are stored in mm, g,
// N, MPa and %, counts in pcs. Labels on a source form may spell them
// differently; data never does.
import type { Unit } from "@/lib/schemas/common";

export const MEASUREMENT_UNITS = ["mm", "g", "N", "MPa", "%"] as const satisfies readonly Unit[];

/** Every unit a field can carry: the measurement units plus pieces for counts. */
export const UNITS = [...MEASUREMENT_UNITS, "pcs"] as const satisfies readonly Unit[];

// Keys are lower case without spaces.
const UNIT_ALIASES: Readonly<Record<string, Unit>> = {
  mm: "mm",
  millimetre: "mm",
  millimetres: "mm",
  millimeter: "mm",
  millimeters: "mm",
  g: "g",
  gm: "g",
  gram: "g",
  grams: "g",
  n: "N",
  newton: "N",
  newtons: "N",
  mpa: "MPa",
  // 1 MPa is 1 N/mm²: ASTM reports tensile strength in MPa, some sheets in N/mm².
  "n/mm2": "MPa",
  "n/mm²": "MPa",
  "%": "%",
  percent: "%",
  pct: "%",
  pcs: "pcs",
  pc: "pcs",
  piece: "pcs",
  pieces: "pcs",
};

/** The canonical unit for a spelling such as "Mpa", "grams" or "N/mm²"; null if unknown. */
export function normaliseUnit(raw: string): Unit | null {
  return UNIT_ALIASES[raw.trim().toLowerCase().replace(/\s+/g, "")] ?? null;
}
