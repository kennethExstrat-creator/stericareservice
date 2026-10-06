// Where keyboard focus can go when the control that had it leaves the list
// (list-focus.tsx): the search box, or the start of the results, which is the
// count above the table or the heading of the state shown instead of rows.
// Shared by server and client components, so no "use client" here: a client
// module's exports reach server components only as references.

export type ListFocusTarget = "search" | "results";

const ATTRIBUTE = "data-list-focus";

/** The search box. */
export const SEARCH_FOCUS_TARGET = { [ATTRIBUTE]: "search" } as const;

/**
 * The start of the results. Text, not a control: focusable from script only
 * (tabIndex -1), and it takes `outline-none` because nothing on it can be
 * operated.
 */
export const RESULTS_FOCUS_TARGET = { [ATTRIBUTE]: "results", tabIndex: -1 } as const;

export function focusTargetSelector(target: ListFocusTarget): string {
  return `[${ATTRIBUTE}="${target}"]`;
}
