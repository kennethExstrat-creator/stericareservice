import { afterEach, describe, expect, it, vi } from "vitest";
import { LOCAL_COPY_DAYS, PRUNED_KEY, pruneOldLocalCopies } from "./prune-local-copies";

// The page's real database needs a browser; the housekeeping gets these instead.
const device = vi.hoisted(() => ({
  drafts: { name: "drafts" },
  getOfflineDatabase: vi.fn(),
  pruneSyncedDrafts: vi.fn(),
}));
vi.mock("@/lib/offline/db", () => ({ getOfflineDatabase: device.getOfflineDatabase }));
vi.mock("@/lib/offline/drafts", () => ({ pruneSyncedDrafts: device.pruneSyncedDrafts }));

const NOW = Date.UTC(2026, 9, 7, 12);
const DAY_MS = 24 * 60 * 60 * 1000;

function tab(): Pick<Storage, "getItem" | "setItem"> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => void values.set(key, value),
  };
}

describe("pruneOldLocalCopies", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  function deviceHolds(pruned: number) {
    device.getOfflineDatabase.mockResolvedValue({ store: (name: string) => (name === "drafts" ? device.drafts : null) });
    device.pruneSyncedDrafts.mockResolvedValue(pruned);
  }

  it("removes what was last touched more than 30 days ago, from the drafts store", async () => {
    deviceHolds(3);
    expect(await pruneOldLocalCopies(NOW, tab())).toBe(3);
    expect(device.pruneSyncedDrafts).toHaveBeenCalledWith(device.drafts, NOW - LOCAL_COPY_DAYS * DAY_MS);
  });

  it("runs once per tab", async () => {
    deviceHolds(1);
    const storage = tab();
    expect(await pruneOldLocalCopies(NOW, storage)).toBe(1);
    expect(storage.getItem(PRUNED_KEY)).toBe("1");
    expect(await pruneOldLocalCopies(NOW + 1, storage)).toBeNull();
    expect(device.pruneSyncedDrafts).toHaveBeenCalledTimes(1);
  });

  it("still runs when the tab's storage is refused", async () => {
    deviceHolds(0);
    const refused = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("SecurityError");
      },
    };
    expect(await pruneOldLocalCopies(NOW, refused)).toBe(0);
    expect(await pruneOldLocalCopies(NOW, null)).toBe(0);
    expect(device.pruneSyncedDrafts).toHaveBeenCalledTimes(2);
  });

  it("never rejects when the device's database cannot open", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    device.getOfflineDatabase.mockRejectedValue(new Error("IndexedDB unavailable"));
    expect(await pruneOldLocalCopies(NOW, tab())).toBeNull();
    expect(device.pruneSyncedDrafts).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledOnce();
    warn.mockRestore();
  });
});
