"use client";

// Keeps keyboard focus in the list when the control that had it goes away.
// Clear Filters, Go to the List, Try Again and a page link that turns into a
// switched-off button all leave the page once the new list renders; without
// this, focus falls back to <body> and a keyboard or screen-reader user starts
// again at the top of the page.
//
// A control asks while it has focus (ListLink, the filter bar). Once the list
// it asked for has rendered, and only if focus was lost on the way, focus
// moves to the search box or to the start of the results (list-focus-target.ts).
// A tap that never focused the control (Safari on the iPad) asks for nothing,
// so it never opens the on-screen keyboard.
import { createContext, use, useCallback, useEffect, useRef, type ReactNode } from "react";
import { focusTargetSelector, type ListFocusTarget } from "./list-focus-target";

type FocusRequest = {
  /** The canonical href of the list the control navigates to. */
  href: string;
  /** Preferred target; the start of the results when it is not on the page. */
  target: ListFocusTarget;
};

const RequestListFocus = createContext<(request: FocusRequest) => void>(() => {});

/** Asks for focus to move on once the list at `href` has rendered (a no-op outside a ListFocusScope). */
export function useRequestListFocus() {
  return use(RequestListFocus);
}

export function ListFocusScope({
  href,
  view,
  className,
  children,
}: {
  /** The canonical href of the list on screen. */
  href: string;
  /** Which state is on screen (rows, no matches, ...), so a retry that loads the same href still counts. */
  view: string;
  className?: string;
  children: ReactNode;
}) {
  const scope = useRef<HTMLDivElement>(null);
  const pending = useRef<FocusRequest | null>(null);
  const requestFocus = useCallback((request: FocusRequest) => {
    pending.current = request;
  }, []);

  // Runs after the new list is in the document.
  useEffect(() => {
    const request = pending.current;
    if (!request) return;
    pending.current = null;
    // Another list arrived first: the user has moved on.
    if (request.href !== href) return;
    // The control survived, or the user put focus somewhere else meanwhile.
    const active = document.activeElement;
    if (active && active !== document.body) return;
    const root = scope.current;
    if (!root) return;
    const preferred = request.target === "search" ? root.querySelector<HTMLElement>(focusTargetSelector("search")) : null;
    (preferred ?? root.querySelector<HTMLElement>(focusTargetSelector("results")))?.focus();
  }, [href, view]);

  return (
    <RequestListFocus value={requestFocus}>
      <div ref={scope} className={className}>
        {children}
      </div>
    </RequestListFocus>
  );
}
