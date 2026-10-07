import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLeaveGuards } from "./leave-guard";
import {
  isNavigationSignal,
  loadPhotoQueue,
  reasonsBeforeSignOut,
  sendSignOut,
  SIGN_OUT_SLOW,
  SIGN_OUT_SLOW_DETAIL,
  UPLOADS_UNCHECKED,
  UPLOADS_WAITING,
  uploadsOnDevice,
  type PhotoQueueApi,
} from "./sign-out-check";

const photos = vi.hoisted(() => ({
  photoUploadsSettled: vi.fn<(inspectionId?: string) => Promise<boolean>>(async () => true),
  stopPhotoQueue: vi.fn(),
}));

vi.mock("@/components/capture/photos", () => photos);

afterEach(() => {
  vi.restoreAllMocks();
});

function queue(settled: () => Promise<boolean>): () => Promise<PhotoQueueApi> {
  return async () => ({ settled, stop: () => undefined });
}

const never = <T>() => new Promise<T>(() => undefined);

describe("uploadsOnDevice", () => {
  it("is none when the queue has settled, waiting when it has not", async () => {
    expect(await uploadsOnDevice(queue(async () => true))).toBe("none");
    expect(await uploadsOnDevice(queue(async () => false))).toBe("waiting");
  });

  it("is unknown when the queue's code does not load or its check fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await uploadsOnDevice(() => Promise.reject(new Error("offline")))).toBe("unknown");
    expect(await uploadsOnDevice(queue(() => Promise.reject(new Error("no IndexedDB"))))).toBe("unknown");
  });

  it("is unknown when either step takes too long, so Sign out never hangs", async () => {
    const limits = { loadTimeoutMs: 20, checkTimeoutMs: 20 };
    expect(await uploadsOnDevice(() => never<PhotoQueueApi>(), limits)).toBe("unknown");
    expect(await uploadsOnDevice(queue(() => never<boolean>()), limits)).toBe("unknown");
  });
});

describe("reasonsBeforeSignOut", () => {
  it("has nothing to ask when nothing waits and no page has unsaved work", async () => {
    expect(await reasonsBeforeSignOut({ uploads: async () => "none", guards: createLeaveGuards() })).toEqual([]);
  });

  it("says photos and files are still only on this device, and will not upload signed out", async () => {
    const reasons = await reasonsBeforeSignOut({ uploads: async () => "waiting", guards: createLeaveGuards() });
    expect(reasons).toEqual([UPLOADS_WAITING]);
    expect(UPLOADS_WAITING).toMatch(/still only on this device/);
    expect(UPLOADS_WAITING).toMatch(/will not upload while you are signed out/);
  });

  it("asks too when the uploads could not be checked", async () => {
    expect(await reasonsBeforeSignOut({ uploads: async () => "unknown", guards: createLeaveGuards() })).toEqual([
      UPLOADS_UNCHECKED,
    ]);
  });

  it("adds each page's unsaved work after the uploads, asking the guards about signing out", async () => {
    const guards = createLeaveGuards();
    const guard = vi.fn(() => "Your changes to INS-2026-0001 are not saved yet.");
    guards.register(guard);
    expect(await reasonsBeforeSignOut({ uploads: async () => "waiting", guards })).toEqual([
      UPLOADS_WAITING,
      "Your changes to INS-2026-0001 are not saved yet.",
    ]);
    expect(guard).toHaveBeenCalledWith("sign-out");
  });

  it("runs both checks together", async () => {
    const order: string[] = [];
    const guards = createLeaveGuards();
    guards.register(async () => {
      order.push("guard started");
      return null;
    });
    await reasonsBeforeSignOut({
      uploads: async () => {
        order.push("uploads started");
        await new Promise((resolve) => setTimeout(resolve, 5));
        order.push("uploads done");
        return "none";
      },
      guards,
    });
    expect(order.indexOf("guard started")).toBeLessThan(order.indexOf("uploads done"));
  });
});

/** The error a Server Action's client call rejects with after the action redirected to /login. */
function redirectToLogin(): unknown {
  try {
    redirect("/login");
  } catch (error) {
    return error;
  }
}

/** A Server Action call the test answers by hand. */
function pendingCall() {
  let answer!: { resolve: () => void; reject: (error: unknown) => void };
  const promise = new Promise<void>((resolve, reject) => {
    answer = { resolve, reject };
  });
  return { action: () => promise, ...answer };
}

describe("sendSignOut", () => {
  it("signs out on the redirect to /login, and lets the uploads go first", async () => {
    const order: string[] = [];
    const outcome = await sendSignOut(() => Promise.reject(redirectToLogin()), {
      onSignedOut: () => order.push("uploads stopped"),
    }).then((result) => {
      order.push(result);
      return result;
    });
    expect(outcome).toBe("signed-out");
    expect(order).toEqual(["uploads stopped", "signed-out"]);
  });

  it("counts an action that returns without a redirect as signed out too", async () => {
    const onSignedOut = vi.fn();
    expect(await sendSignOut(async () => undefined, { onSignedOut })).toBe("signed-out");
    expect(onSignedOut).toHaveBeenCalledTimes(1);
  });

  it("fails, keeping the session and the uploads, when the request does not reach the server", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const onSignedOut = vi.fn();
    expect(await sendSignOut(() => Promise.reject(new TypeError("Failed to fetch")), { onSignedOut })).toBe("failed");
    expect(
      await sendSignOut(
        () => {
          throw new Error("No router yet");
        },
        { onSignedOut },
      ),
    ).toBe("failed");
    expect(onSignedOut).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(2);
  });

  it("gives the page back when the server does not answer in time", async () => {
    const onSignedOut = vi.fn();
    const started = Date.now();
    expect(await sendSignOut(() => new Promise<void>(() => undefined), { timeoutMs: 20, onSignedOut })).toBe("no-answer");
    expect(Date.now() - started).toBeLessThan(1000);
    expect(onSignedOut).not.toHaveBeenCalled();
    // Not "still signed in": the request may yet go through.
    expect(`${SIGN_OUT_SLOW}. ${SIGN_OUT_SLOW_DETAIL}`).not.toMatch(/still signed in/i);
  });

  it("still lets the uploads go when a late answer signs out; a late failure changes nothing", async () => {
    const late = pendingCall();
    const onSignedOut = vi.fn();
    expect(await sendSignOut(late.action, { timeoutMs: 20, onSignedOut })).toBe("no-answer");
    late.reject(redirectToLogin());
    await vi.waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));

    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const failing = pendingCall();
    const notCalled = vi.fn();
    expect(await sendSignOut(failing.action, { timeoutMs: 20, onSignedOut: notCalled })).toBe("no-answer");
    failing.reject(new TypeError("Failed to fetch"));
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(notCalled).not.toHaveBeenCalled();
  });
});

describe("isNavigationSignal", () => {
  it("knows the Server Action's redirect to /login: signed out", () => {
    expect(isNavigationSignal(redirectToLogin())).toBe(true);
  });

  it("treats anything else as a failed sign-out", () => {
    expect(isNavigationSignal(new TypeError("Failed to fetch"))).toBe(false);
    expect(isNavigationSignal(undefined)).toBe(false);
  });
});

describe("loadPhotoQueue", () => {
  it("asks the photo queue about every inspection on this device (no id), and stops it", async () => {
    const api = await loadPhotoQueue();
    photos.photoUploadsSettled.mockResolvedValueOnce(false);
    expect(await api.settled()).toBe(false);
    expect(photos.photoUploadsSettled).toHaveBeenLastCalledWith();
    api.stop();
    expect(photos.stopPhotoQueue).toHaveBeenCalledTimes(1);
  });

  it("loads the code once", async () => {
    expect(loadPhotoQueue()).toBe(loadPhotoQueue());
  });
});
