// Source Documents' files ten to a page (Kenneth, 27 October 2026:
// "pagination with 10 files per page, the uplaod section should be pin at the
// top"), newest first, so a file just added is always on page 1. The parts
// without React: the order, which rows a page holds, the page numbers with
// their gaps, and which page shows as the list changes. file-slot.tsx keeps
// the page; FilePagination draws the pages under the rows.
import type { SlotFile } from "@/components/capture/photos/photo-model";
import type { MediaFile } from "@/lib/inspections/photos/view";

/** Rows on a page of Source Documents' files. */
export const FILES_PER_PAGE = 10;

/** How many pages `total` rows fill: one at least, empty or not. */
export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** The page, within the pages `total` rows fill. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(1, page), pageCountOf(total, pageSize));
}

/** The rows one page holds. */
export function pageRows<T>(rows: readonly T[], page: number, pageSize: number): readonly T[] {
  const start = (clampPage(page, rows.length, pageSize) - 1) * pageSize;
  return rows.slice(start, start + pageSize);
}

/** The first and last row a page shows, counted from 1: "Showing 11–20 of 23". */
export function pageSpan(page: number, total: number, pageSize: number): { from: number; to: number } {
  const shown = clampPage(page, total, pageSize);
  return { from: total === 0 ? 0 : (shown - 1) * pageSize + 1, to: Math.min(total, shown * pageSize) };
}

/** The page holding the row with this id; null while no row has it. */
export function pageHolding(rows: readonly { readonly id: string }[], id: string, pageSize: number): number | null {
  const index = rows.findIndex((row) => row.id === id);
  return index === -1 ? null : Math.floor(index / pageSize) + 1;
}

/** Pages left out of the numbers: an ellipsis. */
export const PAGE_GAP = "gap";

/**
 * The page numbers to offer: every page up to seven, else seven places, the
 * first and the last page always, the page shown with one either side, and
 * an ellipsis for the pages left out ("1 … 4 5 6 … 12"; an ellipsis always
 * stands for two pages or more). Seven every time, so the numbers do not
 * move about as the pages turn.
 */
export function pageNumbers(page: number, count: number): (number | typeof PAGE_GAP)[] {
  if (count <= 7) return Array.from({ length: count }, (_, index) => index + 1);
  if (page <= 4) return [1, 2, 3, 4, 5, PAGE_GAP, count];
  if (page >= count - 3) return [1, PAGE_GAP, count - 4, count - 3, count - 2, count - 1, count];
  return [1, PAGE_GAP, page - 1, page, page + 1, PAGE_GAP, count];
}

/** Later first, for created_at as the database writes it: ISO 8601 with its one offset, so the text sorts as the time does. */
function laterFirst(a: string, b: string): number {
  return a < b ? 1 : a > b ? -1 : 0;
}

/**
 * Newest first, so a file just added is on page 1: the files still on this
 * device (the last added first), then the uploaded ones whose rows are not
 * read yet, then the uploaded rows by when they went in. slotFiles lists
 * them the other way round, and rows read together after their uploads
 * arrive in any order, so the uploaded rows are sorted by their created_at.
 */
export function newestFirst(files: readonly SlotFile[], rows: readonly Pick<MediaFile, "id" | "createdAt">[]): SlotFile[] {
  const created = new Map(rows.map((row) => [row.id, row.createdAt] as const));
  const isRow = (file: SlotFile) => !file.queued && created.has(file.id);
  const reversed = [...files].reverse();
  return [
    ...reversed.filter((file) => !isRow(file)),
    ...reversed.filter(isRow).sort((a, b) => laterFirst(created.get(a.id) ?? "", created.get(b.id) ?? "")),
  ];
}

/** The page shown, and what last moved it. */
export type PageView = {
  page: number;
  /** Pages turned and files added here so far: each brings the list's top into view. */
  turns: number;
  /** The file asked for (an issue link, a link to one file) whose page was opened; null for none. */
  focused: string | null;
};

export const FIRST_PAGE: PageView = { page: 1, turns: 0, focused: null };

/** What moves the page. */
export type PageEvent =
  /** Previous, Next or a page's number. */
  | { type: "turn"; page: number }
  /** Files added on this screen: the newest are on page 1. */
  | { type: "added" }
  /**
   * The list as it is now (it changes as files upload, are read, go): a
   * file asked for opens its page once it is listed, and a delete that
   * emptied the last page shows the one before. Anything else, a reading's
   * status included, leaves the page where it is.
   */
  | { type: "listed"; rows: readonly { readonly id: string }[]; pageSize: number; focusFileId: string | null };

/** The page after an event; the same view when nothing moved, so a screen can tell. */
export function pageViewAfter(view: PageView, event: PageEvent): PageView {
  switch (event.type) {
    case "turn":
      return { ...view, page: event.page, turns: view.turns + 1 };
    case "added":
      return { ...view, page: 1, turns: view.turns + 1 };
    case "listed": {
      const { rows, pageSize, focusFileId } = event;
      let { page, focused } = view;
      if (focusFileId === null) {
        // Asked no longer: the same file asked again opens its page again.
        focused = null;
      } else if (focusFileId !== focused) {
        const holding = pageHolding(rows, focusFileId, pageSize);
        if (holding !== null) {
          page = holding;
          focused = focusFileId;
        }
      }
      page = clampPage(page, rows.length, pageSize);
      return page === view.page && focused === view.focused ? view : { ...view, page, focused };
    }
  }
}
