"use client";

// Follows the capture screen's `focusPath` (CaptureProps): the module reveals
// the right size or hand, then the closest control marked with
// issuePathProps is scrolled into view and focused (issue-path.ts).
import { useEffect, useEffectEvent, type RefObject } from "react";
import { focusIssuePath, issuePathKey, type IssuePath } from "./issue-path";

/**
 * Calls `reveal` (switch size or hand), then focuses the closest marked
 * control inside `root` once it is on screen. Runs again whenever the path
 * changes; a null or empty path does nothing.
 */
export function useIssueFocus(
  focusPath: IssuePath | null | undefined,
  { root, reveal }: { root: RefObject<HTMLElement | null>; reveal?: (path: IssuePath) => void },
): void {
  const key = focusPath && focusPath.length > 0 ? issuePathKey(focusPath) : null;

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
    if (key === null) return;
    return follow(JSON.parse(key) as IssuePath);
  }, [key]);
}
