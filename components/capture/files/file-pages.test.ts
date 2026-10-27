// Source Documents' files ten to a page, newest first (Kenneth, 27 October
// 2026): which rows a page holds, the numbers offered, the order, and where
// the page goes as files are added, deleted, read or asked for.
import { describe, expect, it } from "vitest";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import {
  FILES_PER_PAGE,
  FIRST_PAGE,
  newestFirst,
  PAGE_GAP,
  pageCountOf,
  pageHolding,
  pageNumbers,
  pageRows,
  pageSpan,
  pageViewAfter,
  type PageEvent,
  type PageView,
} from "./file-pages";

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function slotFile(n: number, overrides: Partial<SlotFile> = {}): SlotFile {
  return {
    id: id(n),
    queued: false,
    moduleKey: "source_documents",
    kind: "other",
    name: `Document ${n}.pdf`,
    state: "uploaded",
    progress: 1,
    error: null,
    url: `https://storage.example/file/${n}`,
    ...overrides,
  };
}

/** n files, numbered from 1. */
const filesOf = (count: number) => Array.from({ length: count }, (_, index) => slotFile(index + 1));

const listed = (rows: readonly SlotFile[], focusFileId: string | null = null): PageEvent => ({
  type: "listed",
  rows,
  pageSize: FILES_PER_PAGE,
  focusFileId,
});

const onPage = (page: number): PageView => ({ ...FIRST_PAGE, page });

describe("pages of ten", () => {
  it("is ten a page", () => {
    expect(FILES_PER_PAGE).toBe(10);
  });

  it("splits 23 files into 1–10, 11–20 and the last 3", () => {
    const files = filesOf(23);
    expect(pageCountOf(23, 10)).toBe(3);
    expect(pageRows(files, 1, 10).map((file) => file.name)).toEqual(files.slice(0, 10).map((file) => file.name));
    expect(pageSpan(1, 23, 10)).toEqual({ from: 1, to: 10 });
    expect(pageRows(files, 2, 10)[0].name).toBe("Document 11.pdf");
    expect(pageSpan(2, 23, 10)).toEqual({ from: 11, to: 20 });
    expect(pageRows(files, 3, 10).map((file) => file.name)).toEqual(["Document 21.pdf", "Document 22.pdf", "Document 23.pdf"]);
    expect(pageSpan(3, 23, 10)).toEqual({ from: 21, to: 23 });
  });

  it("is one page for ten files or fewer, none of them included", () => {
    expect(pageCountOf(10, 10)).toBe(1);
    expect(pageCountOf(1, 10)).toBe(1);
    expect(pageCountOf(0, 10)).toBe(1);
    expect(pageSpan(1, 0, 10)).toEqual({ from: 0, to: 0 });
  });

  it("finds the page holding a file", () => {
    const files = filesOf(23);
    expect(pageHolding(files, id(1), 10)).toBe(1);
    expect(pageHolding(files, id(10), 10)).toBe(1);
    expect(pageHolding(files, id(11), 10)).toBe(2);
    expect(pageHolding(files, id(23), 10)).toBe(3);
    expect(pageHolding(files, id(99), 10)).toBeNull();
  });
});

describe("pageNumbers", () => {
  it("offers every page up to seven", () => {
    expect(pageNumbers(1, 3)).toEqual([1, 2, 3]);
    expect(pageNumbers(4, 7)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it("puts an ellipsis for the pages left out, seven places every time", () => {
    expect(pageNumbers(1, 12)).toEqual([1, 2, 3, 4, 5, PAGE_GAP, 12]);
    expect(pageNumbers(4, 12)).toEqual([1, 2, 3, 4, 5, PAGE_GAP, 12]);
    expect(pageNumbers(6, 12)).toEqual([1, PAGE_GAP, 5, 6, 7, PAGE_GAP, 12]);
    expect(pageNumbers(9, 12)).toEqual([1, PAGE_GAP, 8, 9, 10, 11, 12]);
    expect(pageNumbers(12, 12)).toEqual([1, PAGE_GAP, 8, 9, 10, 11, 12]);
    for (let page = 1; page <= 30; page++) expect(pageNumbers(page, 30)).toHaveLength(7);
  });

  it("never hides a single page behind an ellipsis, and always offers the page shown", () => {
    for (const count of [8, 9, 12, 30]) {
      for (let page = 1; page <= count; page++) {
        const numbers = pageNumbers(page, count);
        expect(numbers).toContain(page);
        numbers.forEach((item, index) => {
          if (item !== PAGE_GAP) return;
          const before = numbers[index - 1] as number;
          const after = numbers[index + 1] as number;
          expect(after - before, `${count} pages, on ${page}`).toBeGreaterThan(2);
        });
      }
    }
  });
});

describe("newestFirst", () => {
  const row = (n: number, createdAt: string) => ({ id: id(n), createdAt });

  it("puts the latest upload first, whatever order the rows were read in", () => {
    // Rows read together after their uploads come in any order.
    const rows = [
      row(1, "2026-10-27T01:00:00+00:00"),
      row(3, "2026-10-27T03:00:00.5+00:00"),
      row(2, "2026-10-27T02:00:00.123456+00:00"),
    ];
    const files = [slotFile(1), slotFile(3), slotFile(2)];
    expect(newestFirst(files, rows).map((file) => file.name)).toEqual(["Document 3.pdf", "Document 2.pdf", "Document 1.pdf"]);
  });

  it("lists a file just added here first, before the uploaded rows: a new upload lands on page 1", () => {
    const rows = filesOf(23).map((file, index) => row(index + 1, `2026-10-27T01:${String(index).padStart(2, "0")}:00+00:00`));
    // slotFiles: the uploaded rows oldest first, then those uploaded whose rows are not read yet, then the queued ones.
    const finishing = slotFile(24, { url: null });
    const queued = slotFile(25, { queued: true, state: "waiting", progress: 0, url: null });
    const ordered = newestFirst([...filesOf(23), finishing, queued], rows);
    expect(ordered.map((file) => file.name).slice(0, 4)).toEqual(["Document 25.pdf", "Document 24.pdf", "Document 23.pdf", "Document 22.pdf"]);
    expect(ordered.at(-1)?.name).toBe("Document 1.pdf");
    expect(pageHolding(ordered, queued.id, FILES_PER_PAGE)).toBe(1);
  });

  it("keeps several files still on this device newest first, an upload stopped among them", () => {
    const first = slotFile(1, { queued: true, state: "failed", url: null, error: "Upload Stopped" });
    const second = slotFile(2, { queued: true, state: "uploading", progress: 0.4, url: null });
    expect(newestFirst([first, second], []).map((file) => file.id)).toEqual([id(2), id(1)]);
  });
});

describe("which page shows", () => {
  it("turns to the page chosen", () => {
    const next = pageViewAfter(FIRST_PAGE, { type: "turn", page: 2 });
    expect(next.page).toBe(2);
    expect(pageSpan(next.page, 23, 10)).toEqual({ from: 11, to: 20 });
    expect(pageViewAfter(next, { type: "turn", page: 3 }).page).toBe(3);
  });

  it("goes to page 1 when files are added, and brings the list's top into view", () => {
    const onThird = pageViewAfter(FIRST_PAGE, { type: "turn", page: 3 });
    const added = pageViewAfter(onThird, { type: "added" });
    expect(added.page).toBe(1);
    expect(added.turns).toBeGreaterThan(onThird.turns);
    // Already on page 1, scrolled down it: the top comes into view again, where the new file shows.
    expect(pageViewAfter(FIRST_PAGE, { type: "added" }).turns).toBe(1);
  });

  it("shows the page before when a delete empties the last page", () => {
    // Page 3 of 21 files holds one file; it is deleted.
    const third = onPage(3);
    expect(pageViewAfter(third, listed(filesOf(21)))).toBe(third);
    const afterDelete = pageViewAfter(third, listed(filesOf(20)));
    expect(afterDelete.page).toBe(2);
    expect(pageSpan(afterDelete.page, 20, 10)).toEqual({ from: 11, to: 20 });
    // And to page 1 once ten or fewer are left.
    expect(pageViewAfter(onPage(2), listed(filesOf(10))).page).toBe(1);
  });

  it("stays where it is as files upload, are read or change status, or another device adds one", () => {
    const view = onPage(2);
    expect(pageViewAfter(view, listed(filesOf(23)))).toBe(view);
    const reading = filesOf(23).map((file, index) => (index === 14 ? { ...file, state: "uploading" as const, progress: 0.5 } : file));
    expect(pageViewAfter(view, listed(reading))).toBe(view);
    expect(pageViewAfter(view, listed(filesOf(24)))).toBe(view);
  });

  it("opens the page holding a file asked for, once it is listed", () => {
    const files = filesOf(23);
    const asked = pageViewAfter(FIRST_PAGE, listed(files, id(15)));
    expect(asked).toMatchObject({ page: 2, focused: id(15) });
    // Not listed yet (still loading): the page waits for it.
    expect(pageViewAfter(FIRST_PAGE, listed(files, id(30)))).toBe(FIRST_PAGE);
    const loaded = filesOf(30);
    expect(pageViewAfter(FIRST_PAGE, listed(loaded, id(30)))).toMatchObject({ page: 3, focused: id(30) });
  });

  it("follows a request once: the pages turn away from it freely, and the same file asked again opens its page again", () => {
    const files = filesOf(23);
    const asked = pageViewAfter(FIRST_PAGE, listed(files, id(21)));
    expect(asked.page).toBe(3);
    const turned = pageViewAfter(asked, { type: "turn", page: 1 });
    expect(pageViewAfter(turned, listed(files, id(21)))).toBe(turned);
    const cleared = pageViewAfter(turned, listed(files, null));
    expect(cleared.focused).toBeNull();
    expect(pageViewAfter(cleared, listed(files, id(21))).page).toBe(3);
  });
});
