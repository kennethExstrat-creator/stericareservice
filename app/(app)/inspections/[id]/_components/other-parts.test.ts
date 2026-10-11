import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/capture/photos", () => ({ photoUploadsSettled: vi.fn() }));
vi.mock("@/lib/offline/db", () => ({ getOfflineDatabase: vi.fn() }));

import { photoUploadsSettled } from "@/components/capture/photos";
import type { InspectionPart } from "@/lib/inspections/parts";
import { getOfflineDatabase } from "@/lib/offline/db";
import { draftKey, type LocalDraft } from "@/lib/offline/drafts";
import { createMemoryDatabase } from "@/lib/offline/kv";
import { otherPartsHeldUp } from "./other-parts";

const USER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const HERE = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const PART_2 = "8d3e5f2b-1c4a-4b6d-8e9f-2a3b4c5d6e7f";
const PART_3 = "9e4f6a3c-2d5b-4c7e-9fa0-3b4c5d6e7f80";

const PARTS: InspectionPart[] = [
  { id: HERE, refNo: "INS-2026-0001", poNo: "2680276", productName: null, status: "draft", primary: true },
  { id: PART_2, refNo: "INS-2026-0002", poNo: "2680277", productName: null, status: "draft", primary: false },
  { id: PART_3, refNo: "INS-2026-0003", poNo: null, productName: null, status: "submitted", primary: false },
];

function localCopy(inspectionId: string, revision: number, syncedRevision: number): LocalDraft {
  return {
    v: 1,
    userId: USER,
    inspectionId,
    data: { modules: {}, custom: {} },
    revision,
    syncedRevision,
    baseUpdatedAt: "2026-10-06T09:14:03.123456+00:00",
    baseHash: "0123456789abcdef",
    sentHashes: [],
    changedAt: 0,
    savedAt: null,
  };
}

let db: ReturnType<typeof createMemoryDatabase<"drafts">>;

beforeEach(() => {
  vi.resetAllMocks();
  db = createMemoryDatabase(["drafts"] as const);
  vi.mocked(getOfflineDatabase).mockResolvedValue(db as never);
  vi.mocked(photoUploadsSettled).mockResolvedValue(true);
});

describe("otherPartsHeldUp", () => {
  it("holds nothing up when the other open parts have nothing waiting on this device", async () => {
    await db.store("drafts").put(draftKey({ userId: USER, inspectionId: PART_2 }), localCopy(PART_2, 4, 4));
    await expect(otherPartsHeldUp(PARTS, HERE, USER)).resolves.toBeNull();
    // This part is the screen's own business, and a submitted part is not sent again.
    expect(vi.mocked(photoUploadsSettled).mock.calls).toEqual([[PART_2]]);
  });

  it("waits for another part's photos to upload", async () => {
    vi.mocked(photoUploadsSettled).mockImplementation(async (id) => id !== PART_2);
    await expect(otherPartsHeldUp(PARTS, HERE, USER)).resolves.toEqual({
      message: "Photos or files of PO 2680277 are still uploading on this device. Submit once they are done.",
      parts: [],
    });
  });

  it("names a part with changes only this device has, to open so they are saved", async () => {
    await db.store("drafts").put(draftKey({ userId: USER, inspectionId: PART_2 }), localCopy(PART_2, 5, 3));
    await expect(otherPartsHeldUp(PARTS, HERE, USER)).resolves.toEqual({
      message: "PO 2680277 has changes on this device that are not saved yet. Open it so they are saved, then submit.",
      parts: [{ id: PART_2, label: "PO 2680277", message: "PO 2680277 has changes on this device that are not saved yet." }],
    });
    // Another user's copy on a shared iPad is theirs to save.
    await expect(otherPartsHeldUp(PARTS, HERE, "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f")).resolves.toBeNull();
  });
});
