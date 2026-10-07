// Pure edits of the saved data, for Capture and the capture screen. Each
// takes the latest data (useDataUpdater's `current`) and returns the whole new
// data (CaptureProps.onChange), keeping every saved size, also sizes no longer
// ordered: their averages return with them (6.2 rule 4).
import type { TensileMeasure } from "./config";
import { emptyTensileSize, type TensileData } from "./schema";

/** One average of one size replaced; null clears it. */
export function withAverage(data: TensileData, size: string, measure: TensileMeasure, value: number | null): TensileData {
  const entry = data.sizes[size] ?? emptyTensileSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, [measure]: value } } };
}

/**
 * The lab report the file slot attached for this module (ModuleFileSlot's
 * onAdded): the id of its inspection_files row. The latest file attached is
 * the module's lab report. Null detaches it, and the module is not done again.
 */
export function withLabReport(data: TensileData, fileId: string | null): TensileData {
  return { ...data, labReport: fileId };
}

/** A file of the module was deleted: the lab report goes when it was that file; the same data otherwise. */
export function withoutLabReport(data: TensileData, fileId: string): TensileData {
  return data.labReport === fileId ? withLabReport(data, null) : data;
}
