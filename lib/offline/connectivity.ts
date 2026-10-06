/* ------------------------------------------------------------------ *
 * Connection and page lifecycle signals, behind interfaces so the
 * controllers run (and are tested) without a browser.
 * ------------------------------------------------------------------ */

export interface Connectivity {
  isOnline(): boolean;
  /** Called with the new state on every change. Returns the unsubscribe function. */
  subscribe(listener: (online: boolean) => void): () => void;
}

export interface ManualConnectivity extends Connectivity {
  set(online: boolean): void;
}

/** Connectivity the app drives itself (for example from next/offline's useOffline), and the tests' switch. */
export function manualConnectivity(initial = true): ManualConnectivity {
  let online = initial;
  const listeners = new Set<(online: boolean) => void>();
  return {
    isOnline: () => online,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(next) {
      if (next === online) return;
      online = next;
      for (const listener of [...listeners]) listener(online);
    },
  };
}

type EventSource = Pick<Window, "addEventListener" | "removeEventListener">;

/**
 * navigator.onLine plus the online and offline events. "Offline" is
 * reliable (no network at all); "online" only means a network interface is
 * up, so a failed request still counts as offline in the controllers.
 */
export function browserConnectivity(
  target: EventSource = window,
  navigatorLike: { onLine?: boolean } | undefined = globalThis.navigator,
): Connectivity {
  return {
    isOnline: () => navigatorLike?.onLine !== false,
    subscribe(listener) {
      const online = () => listener(true);
      const offline = () => listener(false);
      target.addEventListener("online", online);
      target.addEventListener("offline", offline);
      return () => {
        target.removeEventListener("online", online);
        target.removeEventListener("offline", offline);
      };
    },
  };
}

/** Browser connectivity in the browser; always online elsewhere (server rendering, tests). */
export function defaultConnectivity(): Connectivity {
  return typeof window === "undefined" ? manualConnectivity(true) : browserConnectivity();
}

export interface PageLifecycle {
  /** Called when the page may be suspended or closed. Returns the unsubscribe function. */
  onHidden(listener: () => void): () => void;
}

export const noLifecycle: PageLifecycle = { onHidden: () => () => undefined };

/**
 * pagehide and visibilitychange to hidden: the last moments iPadOS reliably
 * gives a page before it suspends or discards it (beforeunload is not
 * fired there).
 */
export function browserLifecycle(
  win: EventSource = window,
  doc: Pick<Document, "addEventListener" | "removeEventListener" | "visibilityState"> = document,
): PageLifecycle {
  return {
    onHidden(listener) {
      const onVisibility = () => {
        if (doc.visibilityState === "hidden") listener();
      };
      win.addEventListener("pagehide", listener);
      doc.addEventListener("visibilitychange", onVisibility);
      return () => {
        win.removeEventListener("pagehide", listener);
        doc.removeEventListener("visibilitychange", onVisibility);
      };
    },
  };
}

/** Browser lifecycle in the browser; nothing elsewhere. */
export function defaultLifecycle(): PageLifecycle {
  return typeof window === "undefined" || typeof document === "undefined" ? noLifecycle : browserLifecycle();
}
