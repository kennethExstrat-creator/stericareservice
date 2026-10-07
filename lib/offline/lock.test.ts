import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { pageLock, webLock, type WriterLock } from "./lock";

// Node implements Web Locks as browsers do. Real timers, short waits; each test uses its own names.
const name = () => `test-${randomUUID()}`;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

describe.each<[string, () => WriterLock]>([
  ["Web Locks", () => webLock(navigator.locks)],
  ["this page only", () => pageLock()],
])("WriterLock (%s)", (_, makeLock) => {
  it("gives the lock to one holder at a time", async () => {
    const lock = makeLock();
    const key = name();
    const release = await lock.acquire(key, 0);
    expect(release).toBeTypeOf("function");
    expect(await lock.acquire(key, 0)).toBeNull();
    expect(await lock.acquire(key, 30)).toBeNull();

    release?.();
    release?.();
    // Web Locks let go a moment after release(), so the next holder waits a little.
    const next = await lock.acquire(key, 200);
    expect(next).toBeTypeOf("function");
    next?.();
  });

  it("waits for a holder that lets go within the wait", async () => {
    const lock = makeLock();
    const key = name();
    const release = await lock.acquire(key, 0);
    const waiting = lock.acquire(key, 1_000);
    await sleep(20);
    release?.();
    const next = await waiting;
    expect(next).toBeTypeOf("function");
    next?.();
  });

  it("hands a released lock to one waiter only", async () => {
    const lock = makeLock();
    const key = name();
    const release = await lock.acquire(key, 0);
    const waiters = [lock.acquire(key, 200), lock.acquire(key, 200)];
    release?.();
    const [first, second] = await Promise.all(waiters);
    expect([first, second].filter((granted) => granted !== null)).toHaveLength(1);
    first?.();
    second?.();
  });

  it("keeps names apart", async () => {
    const lock = makeLock();
    const a = await lock.acquire(name(), 0);
    const b = await lock.acquire(name(), 0);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    a?.();
    b?.();
  });
});

describe("webLock", () => {
  it("says its hold spans every tab; a page lock's does not", async () => {
    const web = await webLock(navigator.locks).acquire(name(), 0);
    expect(web?.exclusive).toBe(true);
    web?.();
    const page = await pageLock().acquire(name(), 0);
    expect(page?.exclusive).toBeFalsy();
    page?.();
  });

  it("falls back to the page lock when the Locks API itself fails", async () => {
    const broken = {
      request: () => Promise.reject(new DOMException("The request is not allowed.", "SecurityError")),
    } as unknown as LockManager;
    const lock = webLock(broken, pageLock());
    const key = name();
    const release = await lock.acquire(key, 0);
    expect(release).toBeTypeOf("function");
    // A page's own lock: another tab could still write.
    expect(release?.exclusive).toBeFalsy();
    expect(await lock.acquire(key, 0)).toBeNull();
    release?.();
  });
});
