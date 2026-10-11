import { describe, expect, it } from "vitest";
import type { InspectionPart } from "@/lib/inspections/parts";
import { partHref, partPosition, partTitle } from "./part-nav";

const FIRST = "11111111-1111-4111-8111-111111111111";
const SECOND = "22222222-2222-4222-8222-222222222222";
const THIRD = "33333333-3333-4333-8333-333333333333";

/** An inspection of three POs, first part first (loadParts); the third has no PO number yet. */
const PARTS: InspectionPart[] = [
  { id: FIRST, refNo: "INS-2026-0001", poNo: "1000001", productName: null, status: "draft", primary: true },
  { id: SECOND, refNo: "INS-2026-0004", poNo: " 1000002 (2000002) ", productName: null, status: "draft", primary: false },
  { id: THIRD, refNo: "INS-2026-0007", poNo: null, productName: null, status: "submitted", primary: false },
];

describe("partHref", () => {
  it("opens the part on the page the inspector is on, or on its first page", () => {
    expect(partHref(SECOND, "glove_info")).toBe(`/inspections/${SECOND}?module=glove_info`);
    expect(partHref(SECOND, null)).toBe(`/inspections/${SECOND}`);
    expect(partHref(SECOND, "")).toBe(`/inspections/${SECOND}`);
  });

  it("encodes a page key as an address carries it", () => {
    expect(partHref(SECOND, "a b&c")).toBe(`/inspections/${SECOND}?module=a+b%26c`);
  });
});

describe("partPosition", () => {
  it("says which PO this is, which part of how many, and both reference numbers", () => {
    expect(partPosition(PARTS, SECOND)).toEqual({
      label: "PO 1000002 (2000002)",
      position: "Part 2 of 3",
      refNo: "INS-2026-0004",
      groupRefNo: "INS-2026-0001",
    });
  });

  it("numbers a part without a PO number by its place", () => {
    expect(partPosition(PARTS, THIRD)).toMatchObject({ label: "PO 3", position: "Part 3 of 3" });
  });

  it("takes the inspection's reference from the first part, wherever it is listed", () => {
    const [first, ...rest] = PARTS;
    expect(partPosition([...rest, first], SECOND)?.groupRefNo).toBe("INS-2026-0001");
  });

  it("says nothing for an inspection of one PO, or a part that is not listed", () => {
    expect(partPosition(PARTS.slice(0, 1), FIRST)).toBeNull();
    expect(partPosition(PARTS, "44444444-4444-4444-8444-444444444444")).toBeNull();
  });
});

describe("partTitle", () => {
  it("names the inspection and the part's PO, so two parts' tabs differ", () => {
    expect(partTitle("INS-2026-0004", PARTS, SECOND)).toBe("INS-2026-0001 · PO 1000002 (2000002)");
    expect(partTitle("INS-2026-0001", PARTS, FIRST)).toBe("INS-2026-0001 · PO 1000001");
  });

  it("is the reference number alone for one PO, or when the parts could not be read", () => {
    expect(partTitle("INS-2026-0001", PARTS.slice(0, 1), FIRST)).toBe("INS-2026-0001");
    expect(partTitle("INS-2026-0004", null, SECOND)).toBe("INS-2026-0004");
  });
});
