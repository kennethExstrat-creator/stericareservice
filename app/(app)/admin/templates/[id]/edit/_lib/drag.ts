// Drag to reorder (BUILD_SPEC 10), the arithmetic: where a dragged row lands
// and how far the rows it passes step aside. Rows are measured once when the
// drag starts, in page coordinates, so scrolling while dragging is just a
// larger offset.

export type RowBox = { top: number; height: number };

/**
 * The position a dragged row lands at: the number of other rows whose middle
 * is above the dragged row's middle, kept between `first` and `last` (header
 * and conclusion stay where they are).
 */
export function dropIndex(rows: readonly RowBox[], from: number, offset: number, first: number, last: number): number {
  const dragged = rows[from];
  if (!dragged) return from;
  const middle = dragged.top + dragged.height / 2 + offset;
  let target = 0;
  rows.forEach((row, index) => {
    if (index !== from && row.top + row.height / 2 < middle) target += 1;
  });
  return Math.min(Math.max(target, first), last);
}

/** How far a row moves to make room: up or down by the dragged row's height and gap, or not at all. */
export function stepAside(index: number, from: number, target: number, distance: number): number {
  if (index === from) return 0;
  if (from < target && index > from && index <= target) return -distance;
  if (from > target && index >= target && index < from) return distance;
  return 0;
}

/** Scroll speed near the top or bottom edge while dragging, in pixels per frame; 0 elsewhere. */
export function edgeScroll(pointerY: number, top: number, bottom: number, zone = 72, fastest = 14): number {
  if (pointerY < top + zone) return -Math.ceil(fastest * Math.min(1, (top + zone - pointerY) / zone));
  if (pointerY > bottom - zone) return Math.ceil(fastest * Math.min(1, (pointerY - (bottom - zone)) / zone));
  return 0;
}
