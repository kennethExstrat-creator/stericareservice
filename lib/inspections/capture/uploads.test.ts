import { describe, expect, it } from "vitest";
import { countWaitingUploads, describeWaitingUploads } from "./uploads";

const OWNER = { userId: "user-a", inspectionId: "inspection-1" };

describe("countWaitingUploads", () => {
  it("counts this user's items for this inspection, of any format version", () => {
    const rows = [
      { v: 1, userId: "user-a", inspectionId: "inspection-1", kind: "photo" },
      { v: 2, userId: "user-a", inspectionId: "inspection-1" },
      { v: 1, userId: "user-a", inspectionId: "inspection-2" },
      { v: 1, userId: "user-b", inspectionId: "inspection-1" },
      "not an item",
      null,
    ];
    expect(countWaitingUploads(rows, OWNER)).toBe(2);
    expect(countWaitingUploads([], OWNER)).toBe(0);
  });

  it("words the count", () => {
    expect(describeWaitingUploads(1)).toBe("1 photo or file is still uploading");
    expect(describeWaitingUploads(3)).toBe("3 photos or files are still uploading");
  });
});
