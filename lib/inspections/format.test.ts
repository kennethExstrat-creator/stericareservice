import { describe, expect, it } from "vitest";
import { formatInspectionDate, INSPECTION_STATUS_LABEL, manufacturerLabel, personLabel } from "./format";

describe("formatInspectionDate", () => {
  it("writes calendar dates the British way", () => {
    expect(formatInspectionDate("2026-10-06")).toBe("6 Oct 2026");
    expect(formatInspectionDate("2026-01-31")).toBe("31 Jan 2026");
  });

  it("never shifts the day, whatever the server's time zone", () => {
    expect(formatInspectionDate("2026-12-31")).toBe("31 Dec 2026");
    expect(formatInspectionDate("2027-01-01")).toBe("1 Jan 2027");
  });

  it("shows anything else as it is", () => {
    expect(formatInspectionDate("not a date")).toBe("not a date");
  });
});

describe("manufacturerLabel", () => {
  it("adds the factory when there is one", () => {
    expect(manufacturerLabel({ name: "Terang Nusa Sdn. Bhd.", factory_name: "TG Factory 40" })).toBe(
      "Terang Nusa Sdn. Bhd. · TG Factory 40",
    );
    expect(manufacturerLabel({ name: "Hartalega NGC", factory_name: null })).toBe("Hartalega NGC");
    expect(manufacturerLabel({ name: "Hartalega NGC", factory_name: "  " })).toBe("Hartalega NGC");
  });
});

describe("personLabel", () => {
  it("prefers the name, then the email", () => {
    expect(personLabel({ full_name: "Test Inspector", email: "inspector@test.local" })).toBe("Test Inspector");
    expect(personLabel({ full_name: null, email: "inspector@test.local" })).toBe("inspector@test.local");
    expect(personLabel({ full_name: " ", email: null })).toBeNull();
    expect(personLabel(null)).toBeNull();
  });
});

describe("INSPECTION_STATUS_LABEL", () => {
  it("names every workflow status", () => {
    expect(Object.values(INSPECTION_STATUS_LABEL)).toEqual(["Draft", "Submitted", "Approved", "Reopened"]);
  });
});
