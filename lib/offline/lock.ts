/* ------------------------------------------------------------------ *
 * A lock held across awaits: one autosave per user and inspection in
 * this browser (docs/OFFLINE.md, "One writer per inspection"). Web Locks
 * span the tabs, and the browser releases them when a tab is closed or
 * discarded. Without Web Locks (an insecure origin, such as the dev
 * server reached over the LAN) the lock covers this page only.
 * ------------------------------------------------------------------ */

/** Gives the lock up. Calling it again does nothing. */
export type ReleaseLock = () => void;

export interface WriterLock {
  /**
   * Waits up to `waitMs` for `name`. Resolves with the function that
   * releases it, or null when another holder kept it all that time.
   */
  acquire(name: string, waitMs: number): Promise<ReleaseLock | null>;
}

type LockRequester = Pick<LockManager, "request">;

/** Web Locks (navigator.locks). If the API itself fails, `fallback` decides. */
export function webLock(locks: LockRequester, fallback: WriterLock = pageLock()): WriterLock {
  return {
    acquire(name, waitMs) {
      return new Promise<ReleaseLock | null>((resolve) => {
        let release: () => void = () => undefined;
        const held = new Promise<void>((done) => (release = done));
        const abort = new AbortController();
        // ifAvailable and signal cannot be combined: no wait means ifAvailable.
        const options: LockOptions = waitMs > 0 ? { signal: abort.signal } : { ifAvailable: true };
        const timer = waitMs > 0 ? setTimeout(() => abort.abort(), waitMs) : undefined;
        let granted = false;
        let request: Promise<unknown>;
        try {
          request = locks.request(name, options, (lock) => {
            clearTimeout(timer);
            if (!lock) {
              resolve(null);
              return undefined;
            }
            granted = true;
            resolve(once(release));
            return held;
          });
        } catch (error) {
          request = Promise.reject(error);
        }
        request.catch(() => {
          clearTimeout(timer);
          if (granted) return;
          if (abort.signal.aborted) resolve(null);
          else void fallback.acquire(name, waitMs).then(resolve);
        });
      });
    },
  };
}

/** A lock within this page only. */
export function pageLock(): WriterLock {
  const holders = new Map<string, Promise<void>>();
  return {
    async acquire(name, waitMs) {
      if (holders.has(name)) {
        let expired = false;
        let wake: () => void = () => undefined;
        const timer = setTimeout(
          () => {
            expired = true;
            wake();
          },
          Math.max(0, waitMs),
        );
        try {
          for (let holder = holders.get(name); holder; holder = holders.get(name)) {
            if (expired) return null;
            await new Promise<void>((resolve) => {
              wake = resolve;
              void holder.then(resolve);
            });
          }
        } finally {
          clearTimeout(timer);
        }
      }
      let release: () => void = () => undefined;
      const released = new Promise<void>((done) => (release = done));
      holders.set(name, released);
      return once(() => {
        if (holders.get(name) === released) holders.delete(name);
        release();
      });
    },
  };
}

let shared: WriterLock | null = null;

/**
 * Web Locks in a browser that has them, a lock for this page in one that
 * has not. Outside a browser (server rendering, tests) a lock of its own,
 * shared with nothing: tests that need tabs pass one lock to several
 * controllers.
 */
export function defaultWriterLock(): WriterLock {
  if (typeof window === "undefined") return pageLock();
  const locks = globalThis.navigator?.locks;
  shared ??= locks && typeof locks.request === "function" ? webLock(locks) : pageLock();
  return shared;
}

function once(fn: () => void): ReleaseLock {
  let done = false;
  return () => {
    if (done) return;
    done = true;
    fn();
  };
}
