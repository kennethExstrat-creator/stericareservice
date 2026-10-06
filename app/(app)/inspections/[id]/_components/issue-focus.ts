"use client";

// Issue links into the screen's own forms (custom modules, and modules
// without a capture form of their own). Controls are marked with the data
// path an issue would carry, in the capture kit's format
// (components/qc/issue-path.ts: `data-issue-path` holding the path as
// JSON), so the kit's useIssueFocus and this hook find the same marks.
// A module's own Capture follows `focusPath` itself.
import { useEffect, useEffectEvent, type RefObject } from "react";
import type { IssuePath } from "@/lib/validation";

export const ISSUE_PATH_ATTRIBUTE = "data-issue-path";

/** Spread onto the element that holds the value at `path`. */
export function issuePathAttribute(path: IssuePath): Record<typeof ISSUE_PATH_ATTRIBUTE, string> {
  return { [ISSUE_PATH_ATTRIBUTE]: JSON.stringify(path) };
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** Scrolls to and focuses the marked control closest to `path` (the path itself, else its nearest parent). */
export function focusIssueTarget(root: ParentNode, path: IssuePath): boolean {
  const marked = Array.from(root.querySelectorAll<HTMLElement>(`[${ISSUE_PATH_ATTRIBUTE}]`)).filter(
    (element) => element.getClientRects().length > 0,
  );
  for (let length = path.length; length > 0; length -= 1) {
    const key = JSON.stringify(path.slice(0, length));
    const target = marked.find((element) => element.getAttribute(ISSUE_PATH_ATTRIBUTE) === key);
    if (!target) continue;
    const focusable = target.matches(FOCUSABLE) ? target : target.querySelector<HTMLElement>(FOCUSABLE);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    focusable?.focus({ preventScroll: true });
    return true;
  }
  return false;
}

/** Follows `focusPath` inside `root` once the marked control is on screen (about half a second at most). */
export function useFocusPath(focusPath: IssuePath | null, root: RefObject<HTMLElement | null>): void {
  const key = focusPath && focusPath.length > 0 ? JSON.stringify(focusPath) : null;
  const follow = useEffectEvent((path: IssuePath) => {
    let frame = 0;
    let tries = 0;
    const attempt = () => {
      if (root.current && focusIssueTarget(root.current, path)) return;
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
