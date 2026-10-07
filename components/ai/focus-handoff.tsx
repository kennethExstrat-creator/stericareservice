"use client";

import { useEffect, useLayoutEffect, useRef, type ComponentProps } from "react";
import { cn } from "@/lib/utils";

/* ------------------------------------------------------------------ *
 * Keyboard focus across a refresh (docs/DESIGN.md, Focus). A control
 * that is disabled while its action runs, or that goes once it has done
 * its job, drops focus to the top of the page: "Save Decision" gives way
 * to the saved decision, "Request AI Second Opinion" to the notice that
 * the opinion is being written, and that notice to the opinion when it
 * lands. Focus moves to what took the control's place, unless the user
 * has already put it somewhere else.
 * ------------------------------------------------------------------ */

/** How long a requested target may take to arrive: one refresh, not a whole review. */
export const HANDOFF_WAIT_MS = 15_000;

type Focusable = { focus: () => void; readonly isConnected?: boolean };

/**
 * Focus has nowhere useful to be: on the page itself, or on a control that
 * is disabled while its action runs (some browsers leave it there).
 * `within` also counts focus anywhere inside the form that was just sent.
 */
export function focusIsLost(within?: Element | null): boolean {
  const active = document.activeElement;
  if (active === null || active === document.body) return true;
  if (within?.contains(active)) return true;
  return active instanceof HTMLElement && active.matches(":disabled");
}

/** Focuses `target` unless the user has moved focus somewhere else meanwhile. */
export function focusIfLost(target: HTMLElement | null | undefined, within?: Element | null): void {
  if (target && focusIsLost(within)) target.focus();
}

export type FocusHandoff = {
  /**
   * Focuses the target now if it is on the page and focus is free, else the
   * next target of that name to arrive (within HANDOFF_WAIT_MS).
   */
  request: (name: string) => void;
  /** A target arrived on the page; returns its removal. */
  register: (name: string, node: Focusable) => () => void;
};

export function createFocusHandoff({
  now = Date.now,
  focusIsFree = () => focusIsLost(),
}: { now?: () => number; focusIsFree?: () => boolean } = {}): FocusHandoff {
  const targets = new Map<string, Focusable>();
  let wanted: { name: string; until: number } | null = null;
  return {
    request(name) {
      wanted = { name, until: now() + HANDOFF_WAIT_MS };
      // A target already on the page takes focus at once, if nothing holds it.
      // While something does (the notice handing focus on is still on the
      // page as it goes), the next target of that name takes it instead.
      const node = targets.get(name);
      if (node && node.isConnected !== false && focusIsFree()) {
        wanted = null;
        node.focus();
      }
    },
    register(name, node) {
      targets.set(name, node);
      if (wanted?.name === name) {
        const due = now() <= wanted.until;
        wanted = null;
        // Not if the user has put focus somewhere else meanwhile.
        if (due && focusIsFree()) node.focus();
      }
      return () => {
        if (targets.get(name) === node) targets.delete(name);
      };
    },
  };
}

const handoff = createFocusHandoff();

/** Moves focus to a FocusTarget, now or when it arrives with the next refresh. */
export function moveFocusTo(name: string): void {
  handoff.request(name);
}

/**
 * A region focus can be handed to (tabIndex -1, with the focus ring).
 * `passTo` names the target that takes focus when this region leaves the
 * page while it has focus: the notice of an opinion being written passes
 * it on to the opinion.
 */
export function FocusTarget({
  name,
  passTo,
  className,
  ...props
}: ComponentProps<"div"> & { name: string; passTo?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const node = ref.current;
    return node ? handoff.register(name, node) : undefined;
  }, [name]);

  // A layout effect's cleanup runs while the region is still on the page, so
  // it can tell whether the region had focus when it was taken away.
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || !passTo) return;
    return () => {
      if (node.contains(document.activeElement)) handoff.request(passTo);
    };
  }, [passTo]);

  return <div ref={ref} tabIndex={-1} className={cn("focus-ring", className)} {...props} />;
}
