// Cell helpers every size-table adapter shares. Kept apart from
// ../size-table.ts, which imports the adapters: an adapter that took these
// from there would import its own importer, and could find them undefined
// when it loads first. Types only from there, which leave nothing at runtime.
import type { InspectionContext } from "@/modules/_framework";
import type { SizeTableCell } from "../size-table";

/** A cell with nothing to show. */
export const EMPTY_CELL: SizeTableCell = { text: null };

/** One cell per ordered size, from a function of the size. */
export function cellsBySize(context: Pick<InspectionContext, "sizes">, cell: (size: string) => SizeTableCell): SizeTableCell[] {
  return context.sizes.map((size) => cell(size));
}
