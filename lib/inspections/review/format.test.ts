import { describe, expect, it } from "vitest";
import { formatDateTime, inTemplateOrder, plural, RESULT_LABEL } from "./format";

describe("formatDateTime", () => {
  it("shows a timestamp in Malaysia time, as the team reads it", () => {
    expect(formatDateTime("2026-10-06T06:05:03.123456+00:00")).toBe("6 Oct 2026, 14:05");
  });

  it("moves to the next day in Malaysia when it is still the evening before in UTC", () => {
    expect(formatDateTime("2026-10-06T16:30:00Z")).toBe("7 Oct 2026, 00:30");
  });

  it("shows anything unreadable as it is", () => {
    expect(formatDateTime("not a time")).toBe("not a time");
  });
});

describe("inTemplateOrder", () => {
  it("orders sizes as the order, then the template, lists them, unknown sizes last", () => {
    const context = { sizes: ["M", "S"], templateSizes: ["XS", "S", "M", "L"].map((value) => ({ value, label: value })) };
    expect(inTemplateOrder(context, ["XL", "L", "S", "M"])).toEqual(["M", "S", "L", "XL"]);
  });
});

describe("words", () => {
  it("counts in plain English", () => {
    expect(plural(1, "photo")).toBe("1 photo");
    expect(plural(3, "photo")).toBe("3 photos");
    expect(plural(0, "module")).toBe("0 modules");
  });

  it("names every overall result", () => {
    expect(RESULT_LABEL).toEqual({ pass: "Passed", fail: "Failed", hold: "On hold" });
  });
});
