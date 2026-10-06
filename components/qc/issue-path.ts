// Issue links (BUILD_SPEC 6.2: errors list each problem with a link). A
// module marks the control that holds a value with the data path an issue
// would point at: `issuePathProps(["sizes", "M", "boxes", 3])`, or the
// `issuePath` / `cellIssuePath` props of kit components. useIssueFocus
// (use-issue-focus.ts) then finds and focuses it from the screen's focusPath.

/** Where an issue points, relative to the module's data: `["sizes", "M", 12]`. */
export type IssuePath = readonly (string | number)[];

export const ISSUE_PATH_ATTRIBUTE = "data-issue-path";

/** A stable text form of a path. JSON, because sizes such as "7.0" contain dots. */
export function issuePathKey(path: IssuePath): string {
  return JSON.stringify(path);
}

/** Spread onto the element that holds the value at `path`. */
export function issuePathProps(path: IssuePath | null | undefined): { "data-issue-path"?: string } {
  return path ? { [ISSUE_PATH_ATTRIBUTE]: issuePathKey(path) } : {};
}

/**
 * The issue that points exactly at `path`, errors before warnings: the
 * message to show under that field (`error` on NumberField).
 */
export function findIssue<T extends { readonly path: IssuePath; readonly level?: string }>(
  issues: readonly T[] | null | undefined,
  path: IssuePath,
): T | undefined {
  const key = issuePathKey(path);
  const matching = (issues ?? []).filter((issue) => issuePathKey(issue.path) === key);
  return matching.find((issue) => issue.level === "error") ?? matching[0];
}

/** The keys to try for a path: itself, then each shorter prefix down to one segment. */
export function issuePathCandidates(path: IssuePath): string[] {
  const keys: string[] = [];
  for (let length = path.length; length > 0; length -= 1) keys.push(issuePathKey(path.slice(0, length)));
  return keys;
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Scrolls to and focuses the marked element closest to `path` inside `root`
 * (the exact path, else its nearest marked parent path). Hidden elements
 * (another size's panel) do not count. Returns false when nothing matches,
 * e.g. because the size is not on screen yet.
 */
export function focusIssuePath(root: ParentNode, path: IssuePath): boolean {
  const marked = Array.from(root.querySelectorAll<HTMLElement>(`[${ISSUE_PATH_ATTRIBUTE}]`)).filter(
    (element) => element.getClientRects().length > 0,
  );
  for (const key of issuePathCandidates(path)) {
    const target = marked.find((element) => element.getAttribute(ISSUE_PATH_ATTRIBUTE) === key);
    if (!target) continue;
    const focusable = target.matches(FOCUSABLE) ? target : target.querySelector<HTMLElement>(FOCUSABLE);
    target.scrollIntoView({ block: "center", inline: "nearest" });
    focusable?.focus({ preventScroll: true });
    return true;
  }
  return false;
}
