// Edits the capture screen makes, as pure functions: each returns the whole
// new data from the data it is given, never changing it, and keeps sizes
// taken out of the order (docs/MODULES.md section 10). Capture applies them
// to the latest data through useDataUpdater (docs/CAPTURE_KIT.md), so edits
// made in one event build on each other.
import type { LabelingCheck, LabelingLevel } from "./config";
import { emptyLabelingSize, type LabelingData, type LabelingLevelData } from "./schema";

/** The saved entry of a size and level, empty when nothing is saved. */
export function levelEntry(data: LabelingData, size: string, level: LabelingLevel): LabelingLevelData {
  return (data.sizes[size] ?? emptyLabelingSize())[level];
}

export function withLevel(
  data: LabelingData,
  size: string,
  level: LabelingLevel,
  patch: Partial<LabelingLevelData>,
): LabelingData {
  const entry = data.sizes[size] ?? emptyLabelingSize();
  return { ...data, sizes: { ...data.sizes, [size]: { ...entry, [level]: { ...entry[level], ...patch } } } };
}

/**
 * Boxes inspected. Box/carton numbers past the new count stay saved, so a
 * slip of the stepper loses nothing; calc flags them until the count and
 * the box/carton numbers agree.
 */
export function withInspected(data: LabelingData, size: string, level: LabelingLevel, inspected: number): LabelingData {
  return withLevel(data, size, level, { inspected: Math.max(0, Math.floor(inspected)) });
}

export function withDefectCount(
  data: LabelingData,
  size: string,
  level: LabelingLevel,
  check: LabelingCheck,
  count: number,
): LabelingData {
  const { defects } = levelEntry(data, size, level);
  return withLevel(data, size, level, { defects: { ...defects, [check]: Math.max(0, Math.floor(count)) } });
}

/** Sets the box at `index`, appends it at the end of the list, or removes it with null. */
export function withBox(
  data: LabelingData,
  size: string,
  level: LabelingLevel,
  index: number,
  box: number | null,
): LabelingData {
  const boxNos = [...levelEntry(data, size, level).boxNos];
  if (box === null) boxNos.splice(index, 1);
  else if (index >= boxNos.length) boxNos.push(box);
  else boxNos[index] = box;
  return withLevel(data, size, level, { boxNos });
}

/** Appends a box after the boxes already entered (the next empty field). */
export function withAddedBox(data: LabelingData, size: string, level: LabelingLevel, box: number): LabelingData {
  return withBox(data, size, level, levelEntry(data, size, level).boxNos.length, box);
}

/** Box/carton number fields to show: one per box inspected (the planned n until it is recorded). */
export function boxSlots(entry: LabelingLevelData, planned: number): number {
  return entry.inspected ?? planned;
}

/**
 * The box/carton number fields on screen, by position: each box entered,
 * then one empty field (null) for the next box while fewer are entered than
 * boxSlots. Kept by position, the field a box was just typed in stays on
 * screen with the focus, and the next empty one follows it.
 */
export function boxFields(entry: LabelingLevelData, planned: number, readOnly: boolean): (number | null)[] {
  const next = !readOnly && entry.boxNos.length < boxSlots(entry, planned);
  return next ? [...entry.boxNos, null] : [...entry.boxNos];
}
