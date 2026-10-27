import { describe, expect, it } from "vitest";
import {
  formatInspectionDate,
  INSPECTION_STATUS_LABEL,
  MANUFACTURER_NAMES_SELECT,
  manufacturerFullName,
  manufacturerLabel,
  manufacturerOptions,
  personLabel,
  type ManufacturerNames,
} from "./format";

/** A factory as the selects embed it: brand, company, then the factory's own name (null: none). */
function factory(brand: string | null, company: string, factoryName: string | null = null): ManufacturerNames {
  return { factory_name: factoryName, company: { name: company, brand: brand === null ? null : { name: brand } } };
}

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
  it("names the brand, then the factory, never the company of a named factory", () => {
    expect(manufacturerLabel(factory("Top Glove", "Terang Nusa Sdn. Bhd.", "TG-F40"))).toBe("Top Glove · TG-F40");
    expect(manufacturerLabel(factory("Acme", "Beta Gloves Sdn. Bhd.", "Plant 2"))).toBe("Acme · Plant 2");
  });

  it("names a factory without a name by its company", () => {
    expect(manufacturerLabel(factory("Acme", "Beta Gloves"))).toBe("Acme · Beta Gloves");
    expect(manufacturerLabel(factory("Acme", "Beta Gloves", ""))).toBe("Acme · Beta Gloves");
    expect(manufacturerLabel(factory("Acme", "Beta Gloves", "   "))).toBe("Acme · Beta Gloves");
  });

  it("leaves the brand out when the factory or company already starts with it as whole words, in any case", () => {
    expect(manufacturerLabel(factory("Hartalega", "Hartalega NGC"))).toBe("Hartalega NGC");
    expect(manufacturerLabel(factory("Top Glove", "Terang Nusa Sdn. Bhd.", "Top Glove F-35"))).toBe("Top Glove F-35");
    expect(manufacturerLabel(factory("Top Glove", "Terang Nusa Sdn. Bhd.", "TOP GLOVE F-35"))).toBe("TOP GLOVE F-35");
    expect(manufacturerLabel(factory("top glove", "Terang Nusa Sdn. Bhd.", "Top Glove F-35"))).toBe("Top Glove F-35");
    // The brand's words end where a word does: punctuation counts as well as a space.
    expect(manufacturerLabel(factory("Top Glove", "Terang Nusa Sdn. Bhd.", "Top Glove-F35"))).toBe("Top Glove-F35");
    expect(manufacturerLabel(factory("Acme Inc.", "Acme Inc.Plant"))).toBe("Acme Inc.Plant");
    // Nothing but the brand: said once.
    expect(manufacturerLabel(factory("Hartalega", "Hartalega"))).toBe("Hartalega");
    expect(manufacturerLabel(factory("Hartalega", "Hartalega NGC", "HARTALEGA"))).toBe("HARTALEGA");
  });

  it("keeps the brand when the factory or company only starts with its letters, or names it later", () => {
    expect(manufacturerLabel(factory("Hartalega", "Hartalegas Sdn. Bhd."))).toBe("Hartalega · Hartalegas Sdn. Bhd.");
    expect(manufacturerLabel(factory("TG", "Terang Nusa Sdn. Bhd.", "TG40"))).toBe("TG · TG40");
    expect(manufacturerLabel(factory("Café", "Cafés Gloves"))).toBe("Café · Cafés Gloves");
    expect(manufacturerLabel(factory("Café", "Café Gloves"))).toBe("Café Gloves");
    // An accent typed as its own mark is part of the word.
    expect(manufacturerLabel(factory("Cafe\u0301", "Cafe\u0301s Gloves"))).toBe("Cafe\u0301 · Cafe\u0301s Gloves");
    expect(manufacturerLabel(factory("Glove", "Terang Nusa Sdn. Bhd.", "Top Glove F-35"))).toBe("Glove · Top Glove F-35");
    expect(manufacturerLabel(factory("Top Glove", "Terang Nusa Sdn. Bhd.", "Top"))).toBe("Top Glove · Top");
  });

  it("reads a company the migration made its own brand as before the brands: company, then factory", () => {
    expect(manufacturerLabel(factory("Terang Nusa Sdn. Bhd.", "Terang Nusa Sdn. Bhd.", "TG Factory 40"))).toBe(
      "Terang Nusa Sdn. Bhd. · TG Factory 40",
    );
    expect(manufacturerLabel(factory("Hartalega NGC", "Hartalega NGC"))).toBe("Hartalega NGC");
  });

  it("trims every part", () => {
    expect(manufacturerLabel(factory("  Top Glove ", " Terang Nusa Sdn. Bhd. ", "  TG-F40  "))).toBe("Top Glove · TG-F40");
    expect(manufacturerLabel(factory(" Hartalega ", "  Hartalega NGC "))).toBe("Hartalega NGC");
    expect(manufacturerLabel(factory(" Acme ", "  Beta Gloves  "))).toBe("Acme · Beta Gloves");
  });

  it("gives just the factory or company without a brand", () => {
    expect(manufacturerLabel(factory(null, "Terang Nusa Sdn. Bhd.", "TG-F40"))).toBe("TG-F40");
    expect(manufacturerLabel(factory(null, "Hartalega NGC"))).toBe("Hartalega NGC");
    expect(manufacturerLabel(factory("  ", "Hartalega NGC"))).toBe("Hartalega NGC");
    expect(manufacturerLabel({ factory_name: "TG-F40", company: null })).toBe("TG-F40");
    expect(manufacturerLabel({ factory_name: null, company: null })).toBe("");
  });
});

describe("manufacturerFullName", () => {
  it("gives every name a document may print: brand, company and factory", () => {
    expect(manufacturerFullName(factory("Top Glove", "Terang Nusa Sdn. Bhd.", "TG-F40"))).toBe(
      "Top Glove · Terang Nusa Sdn. Bhd. · TG-F40",
    );
    // The brand stays, even where the label leaves it out.
    expect(manufacturerFullName(factory("Hartalega", "Hartalega NGC"))).toBe("Hartalega · Hartalega NGC");
  });

  it("says a name twice only once, in any case", () => {
    expect(manufacturerFullName(factory("Terang Nusa Sdn. Bhd.", "Terang Nusa Sdn. Bhd.", "TG Factory 40"))).toBe(
      "Terang Nusa Sdn. Bhd. · TG Factory 40",
    );
    expect(manufacturerFullName(factory("Hartalega NGC", "HARTALEGA NGC"))).toBe("Hartalega NGC");
    expect(manufacturerFullName(factory("Hartalega", "Hartalega NGC", "Hartalega NGC "))).toBe("Hartalega · Hartalega NGC");
  });

  it("trims every part and skips those missing or blank", () => {
    expect(manufacturerFullName(factory(" Top Glove ", "  Terang Nusa Sdn. Bhd.", "TG-F40 "))).toBe(
      "Top Glove · Terang Nusa Sdn. Bhd. · TG-F40",
    );
    expect(manufacturerFullName(factory(null, "Hartalega NGC", "  "))).toBe("Hartalega NGC");
    expect(manufacturerFullName(factory("", "Terang Nusa Sdn. Bhd.", "TG-F40"))).toBe("Terang Nusa Sdn. Bhd. · TG-F40");
    expect(manufacturerFullName({ factory_name: "TG-F40", company: null })).toBe("TG-F40");
    expect(manufacturerFullName({ factory_name: null, company: null })).toBe("");
  });
});

describe("manufacturerOptions", () => {
  it("lists each factory by its label, in the labels' order as people read it", () => {
    const rows = [
      { id: "m1", ...factory("Top Glove", "Terang Nusa Sdn. Bhd.", "TG-F40") },
      { id: "m2", ...factory("Top Glove", "Terang Nusa Sdn. Bhd.", "TG-F9") },
      { id: "m3", ...factory("Hartalega", "Hartalega NGC") },
      { id: "m4", ...factory("acme", "Beta Gloves") },
    ];
    expect(manufacturerOptions(rows)).toEqual([
      { id: "m4", label: "acme · Beta Gloves" },
      { id: "m3", label: "Hartalega NGC" },
      // Numbers by value: F9 before F40.
      { id: "m2", label: "Top Glove · TG-F9" },
      { id: "m1", label: "Top Glove · TG-F40" },
    ]);
    expect(rows.map((row) => row.id)).toEqual(["m1", "m2", "m3", "m4"]);
  });

  it("puts factories with the same label in their companies' order", () => {
    const rows = [
      { id: "m1", ...factory("Top Glove", "TG Two Sdn. Bhd.", "F1") },
      { id: "m2", ...factory("Top Glove", "TG One Sdn. Bhd.", "F1") },
    ];
    expect(manufacturerOptions(rows)).toEqual([
      { id: "m2", label: "Top Glove · F1" },
      { id: "m1", label: "Top Glove · F1" },
    ]);
  });

  it("lists none for none", () => {
    expect(manufacturerOptions([])).toEqual([]);
  });
});

describe("MANUFACTURER_NAMES_SELECT", () => {
  it("embeds the factory's name, its company and the company's brand, never the old name column", () => {
    expect(MANUFACTURER_NAMES_SELECT).toBe("factory_name, company:manufacturer_companies(name, brand:manufacturer_brands(name))");
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
