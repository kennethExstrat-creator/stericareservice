// Pure edits of the saved data, for Capture and the capture screen. Each
// returns the whole new data (CaptureProps.onChange) and keeps every saved
// size, also sizes no longer ordered: their averages return with them
// (6.2 rule 4).
import type { TensileMeasure } from "./config";
import { emptyTensileSize, type TensileData } from "./schema";

/** One average of one size replaced; null clears it. */
export function withAverage(data: TensileData, size: string, measure: TensileMeasure, value: number | null): TensileData {
  const entry = data.sizes[size] ?? emptyTensileSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, [measure]: value } } };
}

/**
 * The lab report the capture screen queued for this module: the id
 * `enqueueFile` returns, which becomes the inspection_files row id. Null
 * detaches it, and the module is not done again.
 */
export function withLabReport(data: TensileData, fileId: string | null): TensileData {
  return { ...data, labReport: fileId };
}
