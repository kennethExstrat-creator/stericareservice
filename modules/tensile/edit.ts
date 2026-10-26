// Pure edits of the saved data, for Capture and the capture screen. Each
// takes the latest data (useDataUpdater's `current`) and returns the whole new
// data (CaptureProps.onChange), keeping every saved size, also sizes no longer
// ordered: their averages return with them (6.2 rule 4).
import { withoutLabReportFile } from "@/modules/_framework";
import type { TensileMeasure } from "./config";
import { emptyTensileSize, type TensileData } from "./schema";

/** One average of one size replaced; null clears it. */
export function withAverage(data: TensileData, size: string, measure: TensileMeasure, value: number | null): TensileData {
  const entry = data.sizes[size] ?? emptyTensileSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, [measure]: value } } };
}

/**
 * A lab report unlinked in its file slot (Unlink, which never deletes the
 * file): that report leaves the list, the others stay, and without any the
 * module is not done again; the same data when it was not listed.
 */
export function withoutLabReport(data: TensileData, fileId: string): TensileData {
  return withoutLabReportFile(data, fileId);
}
