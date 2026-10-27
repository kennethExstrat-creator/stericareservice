// The app's own matching of a document's client and manufacturer with the
// lists (Kenneth, 27 October 2026): never a near-duplicate, and a listed
// brand or company reused. Placeholder names throughout.
import { describe, expect, it } from "vitest";
import {
  directoryFromRows,
  directoryFullNames,
  directoryOptions,
  findByName,
  manufacturerDraft,
  nameKey,
  planManufacturer,
  shortName,
  type ManufacturerDirectory,
} from "./reference-match";

describe("names as the lists compare them", () => {
  it("leaves case, punctuation, spacing and legal suffixes aside", () => {
    const key = nameKey("Placeholder Gloves Sdn. Bhd.");
    for (const same of [
      "PLACEHOLDER GLOVES SDN BHD",
      "placeholder gloves sdn.bhd.",
      "Placeholder-Gloves Sdn Bhd",
      "PlaceholderGloves",
      "Placeholder Gloves Berhad",
      "Placeholder Gloves Corporation Bhd.",
      "Placeholder Gloves (M) Sdn. Bhd.",
      "Placeholder Gloves Sendirian Berhad",
      "Placeholder Gloves Co., Ltd.",
      "Placeholder Gloves Pte. Ltd.",
      "Placeholder Gloves Inc.",
      "Placeholder Glóves Limited",
    ]) {
      expect(nameKey(same), same).toBe(key);
    }
    expect(key).toBe("placeholdergloves");
    expect(nameKey("Placeholder Gloves (Thailand) Public Company Limited")).toBe("placeholderglovesthailand");
    expect(nameKey("PT Placeholder Dynamics Indonesia Tbk")).toBe("placeholderdynamicsindonesia");
    expect(nameKey("Smith & Co")).toBe(nameKey("Smith and Co."));
    expect(nameKey("TG-F40")).toBe(nameKey("tg f40"));
  });

  it("keeps a word that only looks like a legal form, and never takes the whole name", () => {
    expect(nameKey("The Glove Company")).toBe("theglovecompany");
    expect(nameKey("Company Limited")).toBe("company");
    expect(nameKey("")).toBe("");
    expect(nameKey("  - ")).toBe("");
  });

  it("shortens a company to the name a brand would carry, as written", () => {
    expect(shortName("Placeholder Nusa Sdn. Bhd.")).toBe("Placeholder Nusa");
    expect(shortName("Placeholder Gloves Corporation Berhad")).toBe("Placeholder Gloves");
    expect(shortName("Placeholder Lanka (Pvt) Ltd")).toBe("Placeholder Lanka");
    expect(shortName("Placeholder Gloves (Thailand) Public Company Limited")).toBe("Placeholder Gloves (Thailand)");
    expect(shortName("PT Placeholder Dynamics Indonesia Tbk")).toBe("Placeholder Dynamics Indonesia");
    expect(shortName("Placeholder Rubber Industries (M) Bhd")).toBe("Placeholder Rubber Industries");
    expect(shortName("Smith & Co.")).toBe("Smith");
    expect(shortName("Placeholder Healthcare")).toBe("Placeholder Healthcare");
  });
});

describe("finding a listed entry by name", () => {
  const clients = [
    { id: "c1", name: "Test Buyer Sdn. Bhd." },
    { id: "c2", name: "Other Buyer" },
    { id: "c3", name: "Twin Buyer Sdn. Bhd." },
    { id: "c4", name: "Twin Buyer Pte. Ltd." },
  ];
  const find = (name: string) => findByName(name, clients, (client) => client.name);

  it("finds the one that reads the same", () => {
    expect(find("TEST BUYER SDN BHD")).toEqual({ kind: "one", entry: clients[0] });
    expect(find("Test Buyer")).toEqual({ kind: "one", entry: clients[0] });
    expect(find("Other Buyer Co., Ltd.")).toEqual({ kind: "one", entry: clients[1] });
    expect(find("New Buyer Sdn. Bhd.")).toEqual({ kind: "none" });
    expect(find("")).toEqual({ kind: "none" });
  });

  it("prefers the one that reads the same in full, and says when the name alone cannot tell", () => {
    expect(find("Twin Buyer Pte Ltd")).toEqual({ kind: "one", entry: clients[3] });
    expect(find("Twin Buyer")).toEqual({ kind: "several", entries: [clients[2], clients[3]] });
  });
});

/* ------------------------------------------------------------------ *
 * Manufacturers: brand, company, factory
 * ------------------------------------------------------------------ */

const ID = {
  brandA: "b0000000-0000-4000-8000-000000000001",
  brandB: "b0000000-0000-4000-8000-000000000002",
  companyA: "c0000000-0000-4000-8000-000000000001",
  companyA2: "c0000000-0000-4000-8000-000000000002",
  companyB: "c0000000-0000-4000-8000-000000000003",
  f1: "f0000000-0000-4000-8000-000000000001",
  f2: "f0000000-0000-4000-8000-000000000002",
  f3: "f0000000-0000-4000-8000-000000000003",
} as const;

/** Brand A: Company A Sdn. Bhd. with factories F-1 and F-2, Company A Two Sdn. Bhd. with none; Brand B: Brand B Sdn. Bhd. with one unnamed. */
const directory: ManufacturerDirectory = directoryFromRows([
  {
    id: ID.brandA,
    name: "Brand A",
    companies: [
      {
        id: ID.companyA,
        name: "Company A Sdn. Bhd.",
        factories: [
          { id: ID.f1, factory_name: "F-1", country: "Malaysia" },
          { id: ID.f2, factory_name: "F-2", country: "Malaysia" },
        ],
      },
      { id: ID.companyA2, name: "Company A Two Sdn. Bhd.", factories: [] },
    ],
  },
  {
    id: ID.brandB,
    name: "Brand B",
    companies: [{ id: ID.companyB, name: "Brand B Sdn. Bhd.", factories: [{ id: ID.f3, factory_name: null, country: "Thailand" }] }],
  },
]);

describe("the manufacturers as brands, companies and factories", () => {
  it("reads one query's rows into the three levels", () => {
    expect(directory.brands).toEqual([
      { id: ID.brandA, name: "Brand A" },
      { id: ID.brandB, name: "Brand B" },
    ]);
    expect(directory.companies.map((company) => [company.name, company.brandId])).toEqual([
      ["Company A Sdn. Bhd.", ID.brandA],
      ["Company A Two Sdn. Bhd.", ID.brandA],
      ["Brand B Sdn. Bhd.", ID.brandB],
    ]);
    expect(directory.factories).toContainEqual({ id: ID.f3, companyId: ID.companyB, factoryName: null, country: "Thailand" });
  });

  it("labels each factory as the pickers do, and names it in full for Steri-AI", () => {
    expect(directoryOptions(directory)).toEqual([
      { id: ID.f1, label: "Brand A · F-1" },
      { id: ID.f2, label: "Brand A · F-2" },
      { id: ID.f3, label: "Brand B Sdn. Bhd." },
    ]);
    expect(directoryFullNames(directory)).toContainEqual({ id: ID.f1, name: "Brand A · Company A Sdn. Bhd. · F-1" });
  });
});

describe("what Add does with a manufacturer's names", () => {
  const plan = (brand: string, company: string, factory: string | null = null) => planManufacturer({ brand, company, factory }, directory);

  it("finds a listed factory instead of adding it again", () => {
    expect(plan("Brand A", "COMPANY A SDN BHD", "f1")).toEqual({ kind: "listed", factoryId: ID.f1 });
    // A company's only factory is the one, named or not.
    expect(plan("Brand B", "Brand B Sdn Bhd")).toEqual({ kind: "listed", factoryId: ID.f3 });
    // The brand's factory of that name, under a company the document names otherwise.
    expect(plan("Brand A", "Brand A Holdings Bhd.", "F-2")).toEqual({ kind: "listed", factoryId: ID.f2 });
  });

  it("adds only the factory under a listed company, whatever brand was named", () => {
    expect(plan("Another Brand", "Company A Sdn. Bhd.", "F-40")).toEqual({
      kind: "add",
      brand: { id: ID.brandA, name: "Brand A" },
      company: { id: ID.companyA, name: "Company A Sdn. Bhd." },
      factory: "F-40",
    });
    // A company with no factory yet gets one, which needs no name.
    expect(plan("Brand A", "Company A Two")).toMatchObject({ kind: "add", company: { id: ID.companyA2 }, factory: null });
  });

  it("adds a company under a listed brand, and all three when nothing is listed", () => {
    expect(plan("brand a", "Brand A Gloves Sdn. Bhd.", "F-9")).toEqual({
      kind: "add",
      brand: { id: ID.brandA, name: "Brand A" },
      company: { id: null, name: "Brand A Gloves Sdn. Bhd." },
      factory: "F-9",
    });
    expect(plan("New Brand", "New Brand Sdn. Bhd.")).toEqual({
      kind: "add",
      brand: { id: null, name: "New Brand" },
      company: { id: null, name: "New Brand Sdn. Bhd." },
      factory: null,
    });
  });

  it("asks for a choice where the names lead to several factories", () => {
    // The company has two, and the document names neither.
    expect(plan("Brand A", "Company A Sdn. Bhd.")).toEqual({ kind: "choose", name: "Company A Sdn. Bhd.", factories: 2 });
    // Only the brand is named.
    expect(plan("Brand A", "Brand A")).toEqual({ kind: "choose", name: "Brand A", factories: 2 });
  });

  it("says when more than one listed company reads like the name", () => {
    const twins = directoryFromRows([
      {
        id: ID.brandA,
        name: "Brand A",
        companies: [
          { id: ID.companyA, name: "Twin Gloves Sdn. Bhd.", factories: [] },
          { id: ID.companyA2, name: "Twin Gloves Pte. Ltd.", factories: [] },
        ],
      },
    ]);
    expect(planManufacturer({ brand: "Brand A", company: "Twin Gloves", factory: null }, twins)).toEqual({ kind: "unclear", field: "company" });
    expect(planManufacturer({ brand: "Brand A", company: "Twin Gloves Pte Ltd", factory: null }, twins)).toMatchObject({
      kind: "add",
      company: { id: ID.companyA2 },
    });
  });
});

describe("New Manufacturer's fields as a document fills them", () => {
  it("takes the brand printed, else the company's short name", () => {
    expect(
      manufacturerDraft({ brand: "Brand A", company: "Company A Sdn. Bhd.", factory: "F-40", address: "Lot 1\nPlaceholder Park", country: "Malaysia" }, "Company A"),
    ).toEqual({ brand: "Brand A", company: "Company A Sdn. Bhd.", factory: "F-40", address: "Lot 1\nPlaceholder Park", country: "Malaysia" });
    expect(manufacturerDraft({ brand: null, company: "Placeholder Nusa Sdn. Bhd.", factory: null, address: null, country: null }, null)).toEqual({
      brand: "Placeholder Nusa",
      company: "Placeholder Nusa Sdn. Bhd.",
      factory: "",
      address: "",
      country: "",
    });
  });

  it("names the company by the brand, else by the name as printed, when no registered name is printed", () => {
    expect(manufacturerDraft({ brand: "Brand A", company: null, factory: "F-1", address: null, country: null }, "Brand A F-1")).toMatchObject({
      brand: "Brand A",
      company: "Brand A",
    });
    expect(manufacturerDraft(null, "Placeholder Supplier Co., Ltd.")).toMatchObject({ brand: "Placeholder Supplier", company: "Placeholder Supplier Co., Ltd." });
    expect(manufacturerDraft(null, null).company).toBe("");
  });
});
