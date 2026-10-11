// Media's board rules: where an item is listed, a move shown before its
// answer, where a drop lands and how the page scrolls under a drag, and
// how Auto-Sort batches its calls and reports a run.
import { describe, expect, it } from "vitest";
import { SOURCE_MEDIA_KEY } from "@/lib/inspections/source-documents";
import {
  autoSortLine,
  edgeScroll,
  moduleKeyFor,
  placeItems,
  sectionAt,
  sectionOf,
  sortBatches,
  SORT_BATCH_CHARS,
  withMove,
  withoutMove,
  type MediaItem,
} from "./media-board";

describe("sections", () => {
  it("lists a photo or video by its key, Other for the rest of Media, and leaves out what is not media", () => {
    expect(sectionOf("photo", "media_proof")).toBe("media_proof");
    expect(sectionOf("photo", null)).toBe("other");
    expect(sectionOf("photo", "visual")).toBe("other");
    expect(sectionOf("video", SOURCE_MEDIA_KEY)).toBe("other");
    expect(sectionOf("video", "source_documents")).toBeNull();
    // Moved into Other: no tag on a photo, the first Media tab's on a video, as moveMedia writes them.
    expect(moduleKeyFor("photo", "other")).toBeNull();
    expect(moduleKeyFor("video", "other")).toBe(SOURCE_MEDIA_KEY);
    expect(moduleKeyFor("video", "media_samples")).toBe("media_samples");
  });

  it("shows a move at once, and an older answer arriving late leaves a newer move be", () => {
    const item = { key: "photo:p1", section: "other" } as MediaItem;
    let moves = withMove({}, item.key, "media_warehouse", 1);
    moves = withMove(moves, item.key, "media_defects", 2);
    expect(placeItems([item], moves)[0].section).toBe("media_defects");
    moves = withoutMove(moves, item.key, 1);
    expect(placeItems([item], moves)[0].section).toBe("media_defects");
    moves = withoutMove(moves, item.key, 2);
    expect(placeItems([item], moves)[0]).toBe(item);
  });

  it("drops on the section under the pointer, and scrolls near the window's edges", () => {
    const boxes = [
      ["media_warehouse", { top: 100, right: 800, bottom: 200, left: 0 }],
      ["other", { top: 200, right: 800, bottom: 300, left: 0 }],
    ] as const;
    expect(sectionAt({ x: 10, y: 150 }, boxes)).toBe("media_warehouse");
    expect(sectionAt({ x: 10, y: 250 }, boxes)).toBe("other");
    expect(sectionAt({ x: 900, y: 150 }, boxes)).toBeNull();
    // Below sticky bars 100 px tall, in a 900 px window.
    expect(edgeScroll(500, 100, 900)).toBe(0);
    expect(edgeScroll(101, 100, 900)).toBeLessThan(0);
    expect(edgeScroll(899, 100, 900)).toBeGreaterThan(0);
    expect(Math.abs(edgeScroll(899, 100, 900))).toBeGreaterThan(Math.abs(edgeScroll(860, 100, 900)));
  });
});

describe("Auto-Sort", () => {
  it("sends at most 12 items a call, and no more preview text than a request may carry", () => {
    const small = Array.from({ length: 25 }, (_, index) => ({ id: String(index), preview: "x" }));
    expect(sortBatches(small).map((batch) => batch.length)).toEqual([12, 12, 1]);
    const large = Array.from({ length: 3 }, (_, index) => ({ id: String(index), preview: "x".repeat(SORT_BATCH_CHARS / 2) }));
    expect(sortBatches(large).map((batch) => batch.length)).toEqual([2, 1]);
  });

  it("reports a run in one line", () => {
    const sorted = [
      ...Array.from({ length: 3 }, () => ({ category: "media_warehouse" as const })),
      ...Array.from({ length: 5 }, () => ({ category: "media_samples" as const })),
      { category: "media_proof" as const },
      { category: null },
    ];
    expect(autoSortLine({ sorted, total: 10, error: null })).toBe(
      "Sorted 9: Warehouse 3, Product and Package Samples 5, Inspection Proof 1. 1 in Other.",
    );
    expect(autoSortLine({ sorted: [{ category: "media_defects" }], total: 1, error: null })).toBe("Sorted 1: Product Defects 1.");
    expect(autoSortLine({ sorted: [], total: 2, error: null })).toBe("None sorted. 2 in Other.");
    expect(autoSortLine({ sorted: [], total: 2, error: "Auto-Sort is not ready yet." })).toBe(
      "Auto-Sort is not ready yet. They are in Other to drag into place.",
    );
    expect(autoSortLine({ sorted: [{ category: "media_proof" }], total: 3, error: "The AI did not answer" })).toBe(
      "Sorted 1: Inspection Proof 1. The AI did not answer. The rest are in Other to drag into place.",
    );
  });
});
