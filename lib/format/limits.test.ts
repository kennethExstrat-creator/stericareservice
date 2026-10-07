import { describe, expect, it } from "vitest";
import { formatLimits } from "./limits";

describe("formatLimits", () => {
  it("prints Ac / Re by default", () => {
    expect(formatLimits({ ac: 3, re: 4 })).toBe("Ac 3 / Re 4");
    expect(formatLimits({ ac: 0, re: 1 })).toBe("Ac 0 / Re 1");
  });

  it("spells the words out in the long style", () => {
    expect(formatLimits({ ac: 10, re: 11 }, { style: "long" })).toBe("Accept 10 / Reject 11");
  });

  it("takes the template's wording", () => {
    expect(formatLimits({ ac: 0, re: 1 }, { accept: "Acc. =", reject: "Rej. =" })).toBe("Acc. = 0 / Rej. = 1");
  });

  it("is the empty text without limits", () => {
    expect(formatLimits(null)).toBe("");
    expect(formatLimits(undefined, { empty: "No plan" })).toBe("No plan");
  });

  it("falls back to Ac and Re only where the template gives no word", () => {
    expect(formatLimits({ ac: 0, re: 1 }, { accept: "Accept", reject: "Reject" })).toBe("Accept 0 / Reject 1");
    expect(formatLimits({ ac: 0, re: 1 }, { accept: undefined, reject: "Reject" })).toBe("Ac 0 / Reject 1");
    expect(formatLimits({ ac: 0, re: 1 }, { accept: " ", reject: "" })).toBe("Ac 0 / Re 1");
  });
});
