// Module order down an extends chain (BUILD_SPEC 4.2 rule 9: modules added,
// removed, reordered). The root template lists its modules in report order.
// A child's list is read top to bottom: each module it lists ends up after
// the module listed before it.
//
// - A module the base has stays where it is if it already comes after the
//   previous entry; otherwise it moves to just after it.
// - A module the base lacks goes just after the previous entry; listed first,
//   it goes to the top (just after header).
// - Modules the child does not list keep their place.
//
// So listing every module gives exactly that order, and listing a module
// right after its neighbour places it there. `header` is then moved first
// and `conclusion` last, wherever they were listed.

export function applyListedOrder<K extends string>(base: readonly K[], listed: readonly K[]): K[] {
  const order = [...base];
  let previous: K | null = null;
  for (const key of listed) {
    const at = order.indexOf(key);
    if (previous === null) {
      if (at === -1) order.unshift(key);
    } else if (at === -1) {
      order.splice(order.indexOf(previous) + 1, 0, key);
    } else if (at < order.indexOf(previous)) {
      order.splice(at, 1);
      order.splice(order.indexOf(previous) + 1, 0, key);
    }
    previous = key;
  }
  return order;
}

/** `first` at the start and `last` at the end, when present; the rest keep their order. */
export function pinEnds<K extends string>(order: readonly K[], first: K, last: K): K[] {
  const middle = order.filter((key) => key !== first && key !== last);
  return [...(order.includes(first) ? [first] : []), ...middle, ...(order.includes(last) ? [last] : [])];
}
