import { describe, expect, it, vi } from "vitest";
import { AUTOSAVE_BACKOFF, UPLOAD_BACKOFF, backoffDelay } from "./backoff";
import { browserConnectivity, browserLifecycle, manualConnectivity } from "./connectivity";
import { FAILURE_REASONS, isRetryable, reasonForStatus, thrownFailure } from "./failures";
import { UUID_PATTERN, newId } from "./id";
import { saveOutcomeSchema, saveRequestSchema } from "./protocol";
import { compareVersions, timestampMicros } from "./version";
import { z } from "zod";

describe("newId", () => {
  it("uses crypto.randomUUID where it exists", () => {
    const id = newId();
    expect(id).toMatch(UUID_PATTERN);
    expect(newId()).not.toBe(id);
  });

  it("builds a v4 UUID from getRandomValues outside secure contexts (an iPad on the dev server over http)", () => {
    const insecure = { getRandomValues: (array: Uint8Array) => globalThis.crypto.getRandomValues(array) };
    const id = newId(insecure as unknown as Crypto);
    expect(id).toMatch(UUID_PATTERN);
    expect(id[14]).toBe("4");
    expect("89ab").toContain(id[19]);

    const zeros = { getRandomValues: (array: Uint8Array) => array };
    expect(newId(zeros as unknown as Crypto)).toBe("00000000-0000-4000-8000-000000000000");
  });
});

describe("compareVersions", () => {
  it("orders Postgres timestamps to the microsecond", () => {
    expect(compareVersions("2026-10-06T09:14:03.123456+00:00", "2026-10-06T09:14:03.123457+00:00")).toBe(-1);
    expect(compareVersions("2026-10-06T09:14:03.123457+00:00", "2026-10-06T09:14:03.123456+00:00")).toBe(1);
    expect(compareVersions("2026-10-06T09:14:03.1+00:00", "2026-10-06T09:14:03.100000+00:00")).toBe(0);
  });

  it("compares instants across zones and formats", () => {
    expect(compareVersions("2026-10-06T17:14:03+08:00", "2026-10-06T09:14:03Z")).toBe(0);
    expect(compareVersions("2026-10-06 09:14:03.5+0000", "2026-10-06T09:14:03.4Z")).toBe(1);
    expect(timestampMicros("2026-10-06T09:14:03.123456789-01:30")).toBe(
      Date.UTC(2026, 9, 6, 10, 44, 3, 123) * 1000 + 456,
    );
  });

  it("returns null for text that is not a timestamp with a zone", () => {
    expect(compareVersions("yesterday", "2026-10-06T09:14:03Z")).toBeNull();
    expect(timestampMicros("2026-10-06T09:14:03")).toBeNull();
    expect(timestampMicros("2026-02-30T09:14:03Z")).toBeNull();
    expect(timestampMicros("2026-13-01T09:14:03Z")).toBeNull();
    expect(compareVersions("same", "same")).toBe(0);
  });
});

describe("backoffDelay", () => {
  it("doubles from the first delay up to the cap", () => {
    const none = () => 0;
    expect([1, 2, 3, 4, 5, 6, 7].map((n) => backoffDelay(n, AUTOSAVE_BACKOFF, none))).toEqual([
      1000, 2000, 4000, 8000, 16000, 30000, 30000,
    ]);
    expect(backoffDelay(500, UPLOAD_BACKOFF, none)).toBe(60_000);
    expect(backoffDelay(0, UPLOAD_BACKOFF, none)).toBe(2000);
  });

  it("takes up to the jitter share off at random", () => {
    expect(backoffDelay(3, AUTOSAVE_BACKOFF, () => 1)).toBe(3200);
    expect(backoffDelay(3, AUTOSAVE_BACKOFF, () => 0.5)).toBe(3600);
    for (let i = 0; i < 50; i++) {
      const delay = backoffDelay(2, AUTOSAVE_BACKOFF);
      expect(delay).toBeGreaterThanOrEqual(1600);
      expect(delay).toBeLessThanOrEqual(2000);
    }
  });
});

describe("failures", () => {
  it("retries what fixes itself and stops on what needs a person", () => {
    expect(FAILURE_REASONS.filter(isRetryable)).toEqual(["network", "server", "unauthorized"]);
  });

  it("reads HTTP statuses", () => {
    expect([0, 400, 401, 403, 404, 408, 409, 413, 415, 422, 429, 500, 503].map(reasonForStatus)).toEqual([
      "network",
      "invalid",
      "unauthorized",
      "forbidden",
      "not_found",
      "server",
      "invalid",
      "too_large",
      "invalid",
      "invalid",
      "server",
      "server",
      "server",
    ]);
  });

  it("treats a thrown error as a network failure and keeps its message", () => {
    expect(thrownFailure(new TypeError("Load failed"))).toEqual({
      reason: "network",
      message: expect.stringContaining("(Load failed)"),
    });
    expect(thrownFailure("??").reason).toBe("network");
  });
});

describe("protocol schemas", () => {
  const data = z.object({ modules: z.record(z.string(), z.unknown()) });

  it("checks a save request crossing to the server", () => {
    const request = saveRequestSchema(data);
    expect(
      request.safeParse({
        inspectionId: "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10",
        data: { modules: {} },
        baseUpdatedAt: "2026-10-06T09:14:03.123456+00:00",
      }).success,
    ).toBe(true);
    expect(request.safeParse({ inspectionId: "x", data: { modules: {} }, baseUpdatedAt: "v" }).success).toBe(false);
    expect(
      request.safeParse({ inspectionId: "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10", data: {}, baseUpdatedAt: "" }).success,
    ).toBe(false);
  });

  it("checks the outcomes a transport may answer", () => {
    const outcome = saveOutcomeSchema(data);
    expect(outcome.safeParse({ ok: true, updatedAt: "v2" }).success).toBe(true);
    expect(
      outcome.safeParse({ ok: false, reason: "conflict", server: { data: { modules: {} }, updatedAt: "v3" } }).success,
    ).toBe(true);
    expect(outcome.safeParse({ ok: false, reason: "conflict" }).success).toBe(false);
    expect(outcome.safeParse({ ok: false, reason: "forbidden", message: "Submitted." }).success).toBe(true);
    expect(outcome.safeParse({ ok: false, reason: "teapot" }).success).toBe(false);
    expect(outcome.safeParse({ ok: true }).success).toBe(false);
  });
});

describe("connectivity", () => {
  it("reports changes once each from a manual switch", () => {
    const net = manualConnectivity(true);
    const seen: boolean[] = [];
    const stop = net.subscribe((online) => seen.push(online));
    net.set(false);
    net.set(false);
    net.set(true);
    stop();
    net.set(false);
    expect(seen).toEqual([false, true]);
    expect(net.isOnline()).toBe(false);
  });

  it("reads navigator.onLine and the window's online and offline events", () => {
    const target = new EventTarget();
    const navigatorLike = { onLine: true };
    const net = browserConnectivity(target as unknown as Window, navigatorLike);
    const seen: boolean[] = [];
    const stop = net.subscribe((online) => seen.push(online));
    expect(net.isOnline()).toBe(true);
    navigatorLike.onLine = false;
    expect(net.isOnline()).toBe(false);
    target.dispatchEvent(new Event("offline"));
    target.dispatchEvent(new Event("online"));
    stop();
    target.dispatchEvent(new Event("offline"));
    expect(seen).toEqual([false, true]);
    expect(browserConnectivity(target as unknown as Window, undefined).isOnline()).toBe(true);
  });

  it("calls back on pagehide and when the page turns hidden", () => {
    const win = new EventTarget();
    const doc = Object.assign(new EventTarget(), { visibilityState: "visible" as DocumentVisibilityState });
    const hidden = vi.fn();
    const stop = browserLifecycle(win as unknown as Window, doc as unknown as Document).onHidden(hidden);
    doc.dispatchEvent(new Event("visibilitychange"));
    expect(hidden).not.toHaveBeenCalled();
    doc.visibilityState = "hidden";
    doc.dispatchEvent(new Event("visibilitychange"));
    win.dispatchEvent(new Event("pagehide"));
    expect(hidden).toHaveBeenCalledTimes(2);
    stop();
    win.dispatchEvent(new Event("pagehide"));
    expect(hidden).toHaveBeenCalledTimes(2);
  });
});
