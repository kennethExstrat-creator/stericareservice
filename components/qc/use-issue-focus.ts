"use client";

// Follows the capture screen's `focusPath` (CaptureProps): the module reveals
// the right size or hand, then the closest control marked with
// issuePathProps, or the message marked with issueNoticeProps, is scrolled
// into view and focused (issue-path.ts). A path made with revealOnlyPath only
// reveals: the module turns to its size, hand or box, and nothing is
// scrolled or focused (the capture screen landing after a reload).
import { useEffect, useEffectEvent, type RefObject } from "react";
import { focusIssuePath, type IssuePath } from "./issue-path";

const REVEAL_ONLY = new WeakSet<IssuePath>();

/**
 * A focusPath that only reveals `path`: the module's reveal switches size,
 * hand or box, and no control is scrolled to or focused, so no keyboard comes
 * up on the iPad. A new array, like every focusPath, followed once.
 */
export function revealOnlyPath(path: IssuePath): IssuePath {
  const copy = [...path];
  REVEAL_ONLY.add(copy);
  return copy;
}

/** Made with revealOnlyPath. */
export function isRevealOnly(path: IssuePath): boolean {
  return REVEAL_ONLY.has(path);
}

/**
 * Calls `reveal` (switch size or hand), then focuses the closest marked
 * element inside `root` once it is on screen: a notice itself, a control, or
 * the first control inside a marked container. Runs once for every new
 * focusPath array, so a second click on the same issue works when the screen
 * passes a new array per click (`setFocusPath([...issue.path])`); a re-render
 * with the same array does nothing. A null or empty path does nothing.
 */
export function useIssueFocus(
  focusPath: IssuePath | null | undefined,
  { root, reveal }: { root: RefObject<HTMLElement | null>; reveal?: (path: IssuePath) => void },
): void {
  const follow = useEffectEvent((path: IssuePath) => {
    reveal?.(path);
    if (isRevealOnly(path)) return;
    let frame = 0;
    let tries = 0;
    // The revealed size renders on a later frame: keep trying for about half a second.
    const attempt = () => {
      if (root.current && focusIssuePath(root.current, path)) return;
      tries += 1;
      if (tries < 30) frame = requestAnimationFrame(attempt);
    };
    frame = requestAnimationFrame(attempt);
    return () => cancelAnimationFrame(frame);
  });

  useEffect(() => {
    if (!focusPath || focusPath.length === 0) return;
    return follow(focusPath);
  }, [focusPath]);
}
