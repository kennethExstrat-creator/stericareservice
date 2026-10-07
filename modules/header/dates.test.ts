import { describe, expect, it } from "vitest";
import { formatInspectionDate } from "@/lib/inspections/format";
import { datePart, formatDate, formatDay, monthDate, yearMonth } from "./dates";

describe("header dates", () => {
  it("compares at the template's precision, as ISO text", () => {
    expect(datePart("2025-04-01", "day")).toBe("2025-04-01");
    expect(datePart("2025-04-01", "month")).toBe("2025-04");
    expect(monthDate(2025, 2)).toBe("2025-02-01");
    expect(yearMonth("2025-02-01")).toEqual({ year: 2025, month: 2 });
  });

  it("words a day as the list and the review do: 19 Feb 2025, never ISO", () => {
    expect(formatDay("2025-02-19")).toBe("19 Feb 2025");
    expect(formatDay("2025-04-01")).toBe("1 Apr 2025");
    // The same words as lib/inspections' formatInspectionDate, which a module may not import, every month.
    for (let month = 1; month <= 12; month += 1) {
      const day = `2025-${String(month).padStart(2, "0")}-28`;
      expect(formatDay(day), day).toBe(formatInspectionDate(day));
    }
    // A calendar date never shifts with the time zone: the last day of the year stays in it.
    expect(formatDay("2025-12-31")).toBe("31 Dec 2025");
  });

  it("shows anything that is not a calendar date as it is", () => {
    expect(formatDay("2025-02")).toBe("2025-02");
    expect(formatDay("")).toBe("");
  });

  it("words a date at the template's precision: the day, or month and year (SAFEDON_EG)", () => {
    expect(formatDate("2025-02-19", "day")).toBe("19 Feb 2025");
    expect(formatDate("2025-02-01", "month")).toBe("Feb 2025");
    expect(formatDate("2030-01-01", "month")).toBe("Jan 2030");
    expect(formatDate("2025-02", "month")).toBe("2025-02");
  });
});
