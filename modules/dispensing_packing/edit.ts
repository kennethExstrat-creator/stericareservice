// How the capture screen changes the data, kept pure so it can be tested:
// one box row, or the size's aged sample, at a time, every other size and
// row kept as saved (sizes taken out of the order keep their data, MODULES.md
// section 10). Rows the grid shows but nobody filled in are not saved:
// trailing blank rows are dropped, and so is an emptied aged sample.
import { MAX_BOXES_PER_SIZE } from "./config";
import {
  emptyAgedSample,
  emptyPackingBox,
  isBlankAgedSample,
  isBlankPackingBox,
  type DispensingPackingData,
  type PackingAgedSample,
  type PackingBox,
  type PackingSize,
} from "./schema";

/** The size's saved rows; none yet for a size never touched. */
export function boxesOf(data: DispensingPackingData, size: string): readonly PackingBox[] {
  return data.sizes[size]?.boxes ?? [];
}

/** Rows the grid shows: the plan, more if more are saved or asked for ("Add box"), never past the cap. */
export function rowsShown(planned: number, saved: number, requested = 0): number {
  return Math.min(MAX_BOXES_PER_SIZE, Math.max(planned, saved, requested));
}

/** `boxes` without the blank rows at its end. */
export function withoutTrailingBlanks(boxes: readonly PackingBox[]): PackingBox[] {
  let end = boxes.length;
  while (end > 0 && isBlankPackingBox(boxes[end - 1])) end -= 1;
  return boxes.slice(0, end);
}

/** New data with row `index` of `size` changed by `patch`; rows before it are created blank as needed. */
export function updatePackingBox(
  data: DispensingPackingData,
  size: string,
  index: number,
  patch: Partial<PackingBox>,
): DispensingPackingData {
  const boxes = [...boxesOf(data, size)];
  while (boxes.length <= index) boxes.push(emptyPackingBox());
  boxes[index] = { ...boxes[index], ...patch };
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], boxes: withoutTrailingBlanks(boxes) } } };
}

/** The size's saved aged sample; an empty one for a size that has none yet. */
export function agedSampleOf(data: DispensingPackingData, size: string): PackingAgedSample {
  return data.sizes[size]?.agedSample ?? emptyAgedSample();
}

/** New data with the aged sample of `size` changed by `patch`; one left with nothing in it is not saved. */
export function updateAgedSample(
  data: DispensingPackingData,
  size: string,
  patch: Partial<PackingAgedSample>,
): DispensingPackingData {
  const agedSample = { ...agedSampleOf(data, size), ...patch };
  const entry: PackingSize = { ...data.sizes[size], boxes: data.sizes[size]?.boxes ?? [], agedSample };
  if (isBlankAgedSample(agedSample)) delete entry.agedSample;
  return { ...data, sizes: { ...data.sizes, [size]: entry } };
}
