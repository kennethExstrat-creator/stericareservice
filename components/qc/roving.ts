// Arrow-key movement for single-choice groups (WAI-ARIA tabs and radio
// groups): SizeTabs and HandToggle. Kept pure so it can be tested.

export type RovingOptions = {
  /** Past the last item go to the first, and back (tabs and radios do). */
  wrap?: boolean;
  /** Radio groups also move with ArrowUp and ArrowDown. */
  vertical?: boolean;
};

/** The index a key moves to, or null when the key is not a movement key. */
export function rovingIndex(
  key: string,
  index: number,
  count: number,
  { wrap = true, vertical = false }: RovingOptions = {},
): number | null {
  if (count <= 0) return null;
  const step = (delta: 1 | -1) => {
    const next = index + delta;
    if (next >= 0 && next < count) return next;
    if (!wrap) return index;
    return delta === 1 ? 0 : count - 1;
  };
  switch (key) {
    case "ArrowRight":
      return step(1);
    case "ArrowLeft":
      return step(-1);
    case "ArrowDown":
      return vertical ? step(1) : null;
    case "ArrowUp":
      return vertical ? step(-1) : null;
    case "Home":
      return 0;
    case "End":
      return count - 1;
    default:
      return null;
  }
}
