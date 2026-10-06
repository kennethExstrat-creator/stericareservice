"use client";

// Follows the capture screen's `focusPath` (CaptureProps): the module reveals
// the right size or hand, then the closest control marked with
// issuePathProps is scrolled into view and focused (issue-path.ts).
import { useEffect, useEffectEvent, type RefObject } from "react";
import { focusIssuePath, type IssuePath } from "./issue-path";

/**
 * Calls `reveal` (switch size or hand), then focuses the closest marked
 * control inside `root` once it is on screen. Runs once for every new
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
