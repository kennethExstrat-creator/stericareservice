// What is on screen when a module's view state is stale: a size taken out of
// the order, or a size set before any was ordered (useState(context.sizes[0]
// ?? "")). SizeTabs shows the first ordered size and tells the module;
// CounterTable shows the same column, so the tab that looks selected is the
// size on screen. And where ColumnSwitcher steps to. Pure, so it is tested.

/** The size on screen: `value` when it is ordered, else the first ordered size; undefined with none. */
export function activeSize(sizes: readonly string[], value: string): string | undefined {
  return sizes.includes(value) ? value : sizes[0];
}

/**
 * The column a CounterTable shows one at a time: `requested` when it is a
 * column, else the size SizeTabs shows, else the first column.
 */
export function activeColumnKey(
  columns: readonly { readonly key: string }[],
  requested: string,
  shownSize?: string,
): string | undefined {
  if (columns.some((column) => column.key === requested)) return requested;
  if (shownSize !== undefined && columns.some((column) => column.key === shownSize)) return shownSize;
  return columns[0]?.key;
}

/**
 * Whether SizeTabs shows every size side by side from 1280 px: wide="all" was
 * asked for and the widest child fits. `available` is null until measured
 * (server render, first paint), when the layout follows the CSS alone.
 */
export function showsSideBySide(wide: "tabs" | "all", available: number | null, needed: number): boolean {
  return wide === "all" && (available === null || needed <= available);
}

/** ColumnSwitcher's column on screen: `index` kept inside the `count` columns there are. */
export function switcherIndex(index: number, count: number): number {
  return Math.min(Math.max(index, 0), Math.max(count - 1, 0));
}

/**
 * Where ColumnSwitcher's Previous (-1) or Next (1) leads, or null at that
 * end: there the button stays focusable (aria-disabled), so the focus is
 * never dropped, and pressing it changes nothing.
 */
export function switcherStep(index: number, count: number, step: -1 | 1): number | null {
  const next = switcherIndex(index, count) + step;
  return next >= 0 && next < count ? next : null;
}
