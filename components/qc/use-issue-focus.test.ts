import { describe, expect, it } from "vitest";
import { isRevealOnly, revealOnlyPath } from "./use-issue-focus";

describe("revealOnlyPath", () => {
  it("is a new array with the same path, marked to reveal only; the path it came from is not", () => {
    const path = ["sizes", "S", "boxes", 2, "counts", "no_cuff"] as const;
    const reveal = revealOnlyPath(path);
    expect(reveal).toEqual(path);
    expect(reveal).not.toBe(path);
    expect(isRevealOnly(reveal)).toBe(true);
    expect(isRevealOnly(path)).toBe(false);
    // A copy of it, as an issue link makes, focuses as usual.
    expect(isRevealOnly([...reveal])).toBe(false);
  });
});
