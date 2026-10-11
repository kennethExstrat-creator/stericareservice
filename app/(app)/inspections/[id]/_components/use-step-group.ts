"use client";

// The sidebar's Inspection Steps group (section-list.tsx): whether it is
// open, and the viewer's last choice, kept on this device. Collapsed at
// first, so Source Documents, the group's header and the Conclusion show
// (Kenneth, 12 October 2026). Whenever the open page moves to one of its
// steps (Next from Source Documents, an issue link, a switch, the iPad's
// swipe) or the screen opens on one (?module=), the group opens, so the step
// in view is on the list; going on to the Conclusion or back to Source
// Documents leaves it as it is, so nothing moves under the pointer. The
// inspector can open or collapse it at any time, and that choice is what the
// screen starts from next time, per user on this device (localStorage).
// Storage may be missing or refuse (private browsing): the group still opens
// and closes, only it is not remembered. The server and hydration see no
// choice; the first render after hydration reads the stored one
// (useSyncExternalStore), so nothing differs between them. It is read that
// once, where the screen starts: a choice made later in another tab waits
// for the next time the screen opens, instead of moving this one at its next
// render (opening Pending, a save), so the group never moves on its own.
import { useCallback, useState, useSyncExternalStore } from "react";

export type StepGroupChoice = "open" | "closed";

/** The stored choice: none kept (null), or not read yet (undefined: the server and hydration). */
export type StoredStepGroupChoice = StepGroupChoice | null | undefined;

const STORAGE_PREFIX = "stericare:capture-steps:";

/** Where a viewer's last choice is kept: per user, as the screen's other keys are. */
export function stepGroupStorageKey(viewerId: string): string {
  return `${STORAGE_PREFIX}${viewerId}`;
}

/** The group as shown, with the open page and the stored choice last read. */
export type StepGroupState = { open: boolean; activeKey: string; stored: StoredStepGroupChoice };

/** Open when the screen opens on one of the group's steps, collapsed otherwise. */
export function initialStepGroup(activeKey: string, holdsActive: boolean): StepGroupState {
  return { open: holdsActive, activeKey, stored: undefined };
}

/**
 * The group once the open page or the stored choice has changed. The stored
 * choice is where the screen starts: followed when it is first read (after
 * hydration) unless the open step is in the group, never after (the
 * inspector's own toggle has already set `open`; another tab's waits for the
 * next time the screen opens). A step of the group that opens opens it. The
 * same state when neither changed.
 */
export function followStepGroup(
  state: StepGroupState,
  activeKey: string,
  holdsActive: boolean,
  stored: StoredStepGroupChoice,
): StepGroupState {
  if (state.activeKey === activeKey && state.stored === stored) return state;
  let { open } = state;
  if (state.stored === undefined && stored != null && !holdsActive) open = stored === "open";
  if (activeKey !== state.activeKey && holdsActive) open = true;
  return { open, activeKey, stored };
}

/** Nothing to subscribe to: the stored choice matters once, where the screen starts (followStepGroup). */
function subscribe(): () => void {
  return () => {};
}

function readChoice(key: string | null): StepGroupChoice | null {
  if (key === null) return null;
  try {
    const value = window.localStorage.getItem(key);
    return value === "open" || value === "closed" ? value : null;
  } catch {
    return null;
  }
}

function keepChoice(key: string | null, choice: StepGroupChoice): void {
  if (key === null) return;
  try {
    window.localStorage.setItem(key, choice);
  } catch {
    // Blocked or full: the group follows the toggle all the same, only it is not remembered.
  }
}

/**
 * Whether the group is open, and the toggle that opens or collapses it and
 * keeps that choice. `holdsActive`: the open page is one of its steps.
 * Without a viewer, nothing is kept.
 */
export function useStepGroup(
  viewerId: string | null,
  activeKey: string,
  holdsActive: boolean,
): [open: boolean, setOpen: (open: boolean) => void] {
  const key = viewerId === null ? null : stepGroupStorageKey(viewerId);
  // Not read on the server or while hydrating (undefined): the first render after brings it.
  const stored = useSyncExternalStore(subscribe, () => readChoice(key), () => undefined);
  const [state, setState] = useState(() => initialStepGroup(activeKey, holdsActive));
  // Followed while rendering, as state that follows props is: the open step's row shows in the same paint.
  const followed = followStepGroup(state, activeKey, holdsActive, stored);
  if (followed !== state) setState(followed);
  const setOpen = useCallback(
    (open: boolean) => {
      setState((current) => ({ ...current, open }));
      keepChoice(key, open ? "open" : "closed");
    },
    [key],
  );
  return [followed.open, setOpen];
}
