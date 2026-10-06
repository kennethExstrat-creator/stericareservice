// How the capture screen changes the data, kept pure so it can be tested:
// one box column at a time, every other size and column kept as saved (sizes
// taken out of the order keep their data, MODULES.md section 10). Counts stay
// sparse: a count tapped back to 0 is removed, as nothing counted reads 0.
// Columns the sheet shows but nobody filled in are not saved: trailing blank
// columns are dropped.
import { MAX_BOXES_PER_SIZE } from "./config";
import { emptySafedonBox, isBlankSafedonBox, type DispensingSafedonData, type SafedonBox } from "./schema";

/** The size's saved box columns; none yet for a size never touched. */
export function boxesOf(data: DispensingSafedonData, size: string): readonly SafedonBox[] {
  return data.sizes[size]?.boxes ?? [];
}

/** Box columns the sheet shows: the plan, more if more are saved or asked for ("Add box"), never past the cap. */
export function columnsShown(planned: number, saved: number, requested = 0): number {
  return Math.min(MAX_BOXES_PER_SIZE, Math.max(planned, saved, requested));
}

/** `boxes` without the blank columns at its end. */
export function withoutTrailingBlanks(boxes: readonly SafedonBox[]): SafedonBox[] {
  let end = boxes.length;
  while (end > 0 && isBlankSafedonBox(boxes[end - 1])) end -= 1;
  return boxes.slice(0, end);
}

function updateBox(
  data: DispensingSafedonData,
  size: string,
  index: number,
  change: (box: SafedonBox) => SafedonBox,
): DispensingSafedonData {
  const boxes = [...boxesOf(data, size)];
  while (boxes.length <= index) boxes.push(emptySafedonBox());
  boxes[index] = change(boxes[index]);
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], boxes: withoutTrailingBlanks(boxes) } } };
}

/** New data with the box number of column `index` set (null clears it). */
export function setSafedonBoxNo(
  data: DispensingSafedonData,
  size: string,
  index: number,
  boxNo: number | null,
): DispensingSafedonData {
  return updateBox(data, size, index, (box) => ({ ...box, boxNo }));
}

/** New data with one defect count of column `index` set; 0 removes it. */
export function setSafedonCount(
  data: DispensingSafedonData,
  size: string,
  index: number,
  code: string,
  count: number,
): DispensingSafedonData {
  return updateBox(data, size, index, (box) => {
    const counts = { ...box.counts };
    if (Number.isInteger(count) && count > 0) counts[code] = count;
    else delete counts[code];
    return { ...box, counts };
  });
}
