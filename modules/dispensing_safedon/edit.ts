// How the capture screen changes the data, kept pure so it can be tested:
// one box column at a time, every other size and column kept as saved (sizes
// taken out of the order keep their data, MODULES.md section 10). Counts stay
// sparse: a count tapped back to 0 is removed, as nothing counted reads 0.
// Columns the sheet shows but nobody filled in are not saved: trailing blank
// columns are dropped. The box list's paging and its Delete are here too.
import { MAX_BOXES_PER_SIZE } from "./config";
import { countOf, emptySafedonBox, isBlankSafedonBox, type DispensingSafedonData, type SafedonBox } from "./schema";

/** Rows on one page of a size's box list: 10, as the carton numbers' (Kenneth, 13 October 2026; 15 from 12 October). */
export const BOXES_PER_PAGE = 10;

/** The page of the box list that shows box column `index`, from 0. */
export function boxPageOf(index: number): number {
  return Math.floor(Math.max(index, 0) / BOXES_PER_PAGE);
}

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

/**
 * New data without box column `index`: the columns after it move up one
 * place, and blank columns left at the end are dropped. A column past the
 * saved ones (one added with Add Box and never filled in) holds nothing:
 * the same object comes back, so nothing is saved.
 */
export function removeSafedonBox(data: DispensingSafedonData, size: string, index: number): DispensingSafedonData {
  const boxes = boxesOf(data, size);
  if (!Number.isInteger(index) || index < 0 || index >= boxes.length) return data;
  const kept = withoutTrailingBlanks(boxes.filter((_, at) => at !== index));
  return { ...data, sizes: { ...data.sizes, [size]: { ...data.sizes[size], boxes: kept } } };
}

/**
 * Whether row `index` of the box list offers Delete: a row holding a box
 * number or a count, or any row past the plan (added with Add Box). The
 * plan's own blank rows do not, saved blank or not (a box number typed in
 * row 7 first saves rows 1 to 6 blank), since the list never shows fewer
 * rows than the plan.
 */
export function canRemoveBox(index: number, boxes: readonly SafedonBox[], planned: number): boolean {
  if (index >= planned) return true;
  const box = boxes[index];
  return box !== undefined && !isBlankSafedonBox(box);
}

/** The box column chosen once column `removed` is deleted: the same box, one place up when it was below. */
export function activeAfterRemoval(active: number, removed: number, rowsAfter: number): number {
  const moved = active > removed ? active - 1 : active;
  return Math.min(Math.max(moved, 0), Math.max(rowsAfter - 1, 0));
}

/** A box's defects over `codes` (the template's): "2" of the list's "2/125". Counts under other codes are left out, as calc does. */
export function boxDefects(box: SafedonBox, codes: readonly string[]): number {
  return codes.reduce((sum, code) => sum + countOf(box, code), 0);
}
