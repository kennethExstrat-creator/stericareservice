import { describe, expect, it } from "vitest";
import { evidenceValueLayout, INLINE_VALUE_MAX } from "./format";

describe("evidenceValueLayout", () => {
  it("keeps a number, a status or a short word beside its label", () => {
    expect(evidenceValueLayout("2.9", "g")).toBe("inline");
    expect(evidenceValueLayout("17.1%", null)).toBe("inline");
    expect(evidenceValueLayout("not_done", null)).toBe("inline");
    expect(evidenceValueLayout("Nitrile, powder free", null)).toBe("inline");
  });

  it("gives a quoted sentence a line of its own", () => {
    expect(
      evidenceValueLayout("Manufacturer Information is not done: Missing: Supplier Factory Address / Location.", null),
    ).toBe("block");
    expect(evidenceValueLayout("Two lines\nof notes", null)).toBe("block");
  });

  it("counts the unit with the value", () => {
    const value = "1".repeat(INLINE_VALUE_MAX - 2);
    expect(evidenceValueLayout(value, null)).toBe("inline");
    expect(evidenceValueLayout(value, "MPa")).toBe("block");
  });
});
