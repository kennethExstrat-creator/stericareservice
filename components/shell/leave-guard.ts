// Work a page would lose if the shell took the user away from it: a field
// still being typed, a save on its way, changes kept only in memory.
//
// A screen with such work registers a guard while it is on screen
// (useLeaveGuard in ./use-leave-guard.ts). Before the shell leaves the page,
// through its own links (sidebar, top bar, the admin row, the logo) or
// through Sign out, it asks every guard. A guard saves what it can, then
// answers with one plain sentence saying what would still be lost, or null
// when nothing would. With an answer the shell asks the user first (Stay /
// Leave anyway); without one it goes. A guard that throws or takes longer
// than LEAVE_CHECK_TIMEOUT_MS counts as unsaved work, so nothing is dropped
// unasked.
//
// Pure functions and one registry per page, no React, so the rules are
// unit-tested. Links inside a page and the browser's own ways out (Back, a
// reload, closing the tab) stay with the screen: its links, beforeunload and
// pagehide.

export type LeaveReason = "navigate" | "sign-out";

/** What would be lost by leaving now, in one plain sentence; null or undefined when nothing would. */
export type LeaveAnswer = string | null | undefined;

/**
 * One screen's check. `reason` says how the user is leaving: Sign out also
 * ends the session, so changes waiting for a connection cannot sync until the
 * same user signs in on this device again.
 */
export type LeaveGuard = (reason: LeaveReason) => LeaveAnswer | Promise<LeaveAnswer>;

/** How long the shell waits for a guard (a save on its way) before asking the user instead. */
export const LEAVE_CHECK_TIMEOUT_MS = 3000;

/** For a guard that did not answer in time. */
export const STILL_SAVING = "This page is still saving your last changes.";

/** For a guard that failed. */
export const CHECK_FAILED = "This page could not confirm that your changes are saved.";

export type LeaveGuards = {
  /** Adds a guard; the function returned removes it. */
  register(guard: LeaveGuard): () => void;
  /** True while any guard is registered: the shell only steps in then. */
  active(): boolean;
  /**
   * Asks every guard at once and returns what would be lost, in the order
   * the guards were registered, without repeats. Empty: nothing would be.
   */
  check(reason: LeaveReason, options?: { timeoutMs?: number }): Promise<string[]>;
};

export function createLeaveGuards(): LeaveGuards {
  const guards = new Set<LeaveGuard>();
  return {
    register(guard) {
      // A wrapper of its own, so registering the same function twice needs two removals.
      const entry: LeaveGuard = (reason) => guard(reason);
      guards.add(entry);
      return () => {
        guards.delete(entry);
      };
    },
    active: () => guards.size > 0,
    async check(reason, { timeoutMs = LEAVE_CHECK_TIMEOUT_MS } = {}) {
      const answers = await Promise.all([...guards].map((guard) => ask(guard, reason, timeoutMs)));
      return [...new Set(answers.filter((answer): answer is string => answer !== null))];
    },
  };
}

async function ask(guard: LeaveGuard, reason: LeaveReason, timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(STILL_SAVING), timeoutMs);
  });
  try {
    // Through then(), so a guard that throws at once counts like one that rejects.
    const answer = await Promise.race([Promise.resolve().then(() => guard(reason)), late]);
    return typeof answer === "string" && answer.trim() !== "" ? answer.trim() : null;
  } catch (error) {
    console.error("A page's check before leaving failed", error);
    return CHECK_FAILED;
  } finally {
    clearTimeout(timer);
  }
}

/** The page's registry. Screens register through useLeaveGuard; the shell's links and Sign out check it. */
export const leaveGuards: LeaveGuards = createLeaveGuards();

/* ---- Which clicks leave the page ---------------------------------------- */

export type LinkClick = {
  /** The link's href, resolved (HTMLAnchorElement.href) or as written. */
  href: string;
  /** Its target attribute: "" for none. */
  target: string;
  /** Whether it has a download attribute. */
  download: boolean;
  /** MouseEvent.button: 0 for a plain click, a tap or Enter. */
  button: number;
  /** Meta, Ctrl, Shift or Alt held. */
  modified: boolean;
};

/**
 * Where a click on a link takes the user inside the app (path, query and
 * hash), or null when it does not leave this page: another tab or window, a
 * download, another site, or a place on this same page. Next.js's Link
 * follows the same rules, so the shell steps in exactly where Link would
 * navigate.
 */
export function leaveDestination(click: LinkClick, here: string): string | null {
  if (click.button !== 0 || click.modified || click.download) return null;
  if (click.target !== "" && click.target !== "_self") return null;
  let current: URL;
  let to: URL;
  try {
    current = new URL(here);
    to = new URL(click.href, current);
  } catch {
    return null;
  }
  if (to.origin !== current.origin || (to.protocol !== "http:" && to.protocol !== "https:")) return null;
  if (to.pathname === current.pathname && to.search === current.search) return null;
  return `${to.pathname}${to.search}${to.hash}`;
}

/**
 * Where the shell must stop a click on one of its links and ask the guards
 * first, or null to let the link go as usual: nothing registered, a click
 * the page already handled (its default prevented), or one that does not
 * leave the page. The shell sees a click after a page's own listeners on
 * document or window (leave-guard-area.tsx), so a page that stops the click
 * itself, as the template editor's guard does, keeps it.
 */
export function guardedDestination(
  click: LinkClick & { defaultPrevented: boolean },
  here: string,
  guards: Pick<LeaveGuards, "active">,
): string | null {
  if (click.defaultPrevented || !guards.active()) return null;
  return leaveDestination(click, here);
}

/* ---- One way out at a time ------------------------------------------------ */

/** A tap on a shell link that leaves the page: where it goes, and the link (focus goes back to it if the user stays). */
export type LeaveRequest<Link> = { to: string; link: Link };

export type LeaveRequests<Link> = {
  /** The tap waiting for the guards' answer, or null. */
  waiting(): LeaveRequest<Link> | null;
  /**
   * Asks the guards about leaving. `before` runs first, once per check (it
   * commits the field being typed in). A tap made while they answer, in any
   * of the shell's bars, only changes where to go and resolves null. The
   * first tap resolves with the last one and what the guards said, so the
   * shell goes to, or asks about, the link the user chose last.
   */
  ask(request: LeaveRequest<Link>, before?: () => unknown): Promise<{ request: LeaveRequest<Link>; reasons: string[] } | null>;
};

export function createLeaveRequests<Link>(guards: Pick<LeaveGuards, "check">): LeaveRequests<Link> {
  let latest: LeaveRequest<Link> | null = null;
  return {
    waiting: () => latest,
    async ask(request, before) {
      const answering = latest !== null;
      latest = request;
      if (answering) return null;
      try {
        await before?.();
        const reasons = await guards.check("navigate");
        return { request: latest ?? request, reasons };
      } finally {
        latest = null;
      }
    },
  };
}

/** The page's taps on the shell's links, shared by the sidebar, the top bar and the admin row. */
export const leaveRequests: LeaveRequests<HTMLAnchorElement> = createLeaveRequests(leaveGuards);
