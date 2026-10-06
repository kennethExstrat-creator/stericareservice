import { describe, expect, it } from "vitest";
import { nextAnnouncement } from "./use-announcement";

describe("nextAnnouncement", () => {
  it("passes a new message through", () => {
    expect(nextAnnouncement("", "Pasted 13 values.")).toBe("Pasted 13 values.");
    expect(nextAnnouncement("Pasted 13 values.", "Pasted 12 values.")).toBe("Pasted 12 values.");
  });

  it("changes the text when the same message repeats, so a live region says it again", () => {
    const first = nextAnnouncement("", "Width, No. 3: “2 42” is not stored.");
    const second = nextAnnouncement(first, "Width, No. 3: “2 42” is not stored.");
    const third = nextAnnouncement(second, "Width, No. 3: “2 42” is not stored.");
    expect(second).not.toBe(first);
    expect(second.trim()).toBe(first);
    expect(second.endsWith(" ")).toBe(true);
    expect(third).toBe(first);
  });
});
