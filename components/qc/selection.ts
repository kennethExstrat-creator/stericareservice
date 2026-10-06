// What is on screen when a module's view state is stale: a size taken out of
// the order, or a size set before any was ordered (useState(context.sizes[0]
// ?? "")). SizeTabs shows the first ordered size and tells the module;
// CounterTable shows the same column, so the tab that looks selected is the
// size on screen. Pure, so it is tested.

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
