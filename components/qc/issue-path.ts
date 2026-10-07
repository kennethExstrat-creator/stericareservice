// Issue links (BUILD_SPEC 6.2: errors list each problem with a link). A
// module marks the control that holds a value with the data path an issue
// would point at: `issuePathProps(["sizes", "M", "boxes", 3])`, or the
// `issuePath` / `cellIssuePath` props of kit components. A message with no
// control of its own (readings past the plan, a plan too large) is marked
// with `issueNoticeProps`, so the link lands on the message itself.
// useIssueFocus (use-issue-focus.ts) then finds and focuses it from the
// screen's focusPath.

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
 * Spread onto a message an issue link should land on, such as a notice
 * beside a grid: it takes the focus itself (tabIndex -1, out of the Tab
 * order), so a screen reader reads it and Tab goes on to whatever follows,
 * instead of the link landing on a button inside it. Give it a visible focus
 * style (`outline-none focus-ring`).
 */
export function issueNoticeProps(path: IssuePath | null | undefined): { "data-issue-path"?: string; tabIndex?: number } {
  return path ? { ...issuePathProps(path), tabIndex: -1 } : {};
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

/** What the issue link needs to know about one marked element. */
export type MarkedElement = {
  /** Its issuePathKey. */
  readonly key: string;
  /** A control, or an element with a tabindex (a notice): it is focused itself, not the first control inside it. */
  readonly focusesItself: boolean;
};

/**
 * Which marked element an issue link lands on: the one marked with the
 * exact path, else with its nearest parent path. Where several carry that
 * path, one that takes the focus itself (a notice, a control) comes before a
 * container, such as a size's panel marked with the same path. -1 when none.
 */
export function issueTargetIndex(marked: readonly MarkedElement[], path: IssuePath): number {
  for (const key of issuePathCandidates(path)) {
    const indices = marked.flatMap((element, index) => (element.key === key ? [index] : []));
    if (indices.length === 0) continue;
    return indices.find((index) => marked[index].focusesItself) ?? indices[0];
  }
  return -1;
}

const FOCUSABLE =
  'input:not([type="hidden"]):not([disabled]), button:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
/** What takes the focus itself: a control, or anything given a tabindex (-1 included). */
const FOCUSES_ITSELF = `${FOCUSABLE}, [tabindex]`;

/**
 * Scrolls to and focuses the marked element closest to `path` inside `root`
 * (issueTargetIndex): the element itself when it takes the focus, else the
 * first control inside it. Hidden elements (another size's panel) do not
 * count. Returns false when nothing matches, e.g. because the size is not on
 * screen yet.
 */
export function focusIssuePath(root: ParentNode, path: IssuePath): boolean {
  const marked = Array.from(root.querySelectorAll<HTMLElement>(`[${ISSUE_PATH_ATTRIBUTE}]`)).filter(
    (element) => element.getClientRects().length > 0,
  );
  const index = issueTargetIndex(
    marked.map((element) => ({
      key: element.getAttribute(ISSUE_PATH_ATTRIBUTE) ?? "",
      focusesItself: element.matches(FOCUSES_ITSELF),
    })),
    path,
  );
  const target = marked[index];
  if (!target) return false;
  const focusable = target.matches(FOCUSES_ITSELF) ? target : target.querySelector<HTMLElement>(FOCUSABLE);
  target.scrollIntoView({ block: "center", inline: "nearest" });
  focusable?.focus({ preventScroll: true });
  return true;
}
