// Pure edits of the saved data, for Capture's `update((current) => ...)`
// (useDataUpdater, docs/CAPTURE_KIT.md). Each starts from the latest data, so
// two changes in one event both land, and returns the whole new value: items
// the template switches off keep what was entered, in case they come back.
import type { DocumentItem } from "./config";
import type { DocumentEntry, DocumentsData } from "./schema";

/** Some values of one item replaced; null clears a value. */
export function withItemValues(data: DocumentsData, item: DocumentItem, values: Partial<DocumentEntry>): DocumentsData {
  return { ...data, items: { ...data.items, [item]: { ...data.items[item], ...values } } };
}

/** A file of the module was deleted: every item that kept it lets go; the same data when none did. */
export function withoutFile(data: DocumentsData, fileId: string): DocumentsData {
  let next = data;
  for (const item of Object.keys(data.items) as DocumentItem[]) {
    if (data.items[item].file === fileId) next = withItemValues(next, item, { file: null });
  }
  return next;
}
