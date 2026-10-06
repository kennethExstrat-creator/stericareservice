import { redirect } from "next/navigation";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLeaveGuards } from "./leave-guard";
import {
  isNavigationSignal,
  loadPhotoQueue,
  reasonsBeforeSignOut,
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

describe("isNavigationSignal", () => {
  it("knows the Server Action's redirect to /login: signed out, to be rethrown", () => {
    let thrown: unknown;
    try {
      redirect("/login");
    } catch (error) {
      thrown = error;
    }
    expect(isNavigationSignal(thrown)).toBe(true);
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
