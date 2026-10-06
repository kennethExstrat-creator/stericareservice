// Edits the capture screen makes, as pure functions: each returns the whole
// new data for onChange, starting from the saved data so sizes taken out of
// the order keep theirs (docs/MODULES.md section 10).
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
 * Boxes inspected. Picks past the new count stay saved, so a slip of the
 * stepper loses nothing; calc flags them until the count or the picks agree.
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

/** Box pickers to show: one per box inspected (the planned n until it is recorded). */
export function boxSlots(entry: LabelingLevelData, planned: number): number {
  return entry.inspected ?? planned;
}
