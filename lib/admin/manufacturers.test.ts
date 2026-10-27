import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BrandInputSchema,
  CompanyInputSchema,
  DELETABLE,
  FactoryInputSchema,
  NO_PERMISSION,
  brandDeleteBlocker,
  brandValues,
  changedMeanwhile,
  companyDeleteBlocker,
  companySnapshot,
  companyValues,
  countrySuggestions,
  deletedMeanwhile,
  describeBrandSaveError,
  describeCompanySaveError,
  describeFactorySaveError,
  describeManufacturerDeleteError,
  factoryCount,
  factoryLabel,
  factorySnapshot,
  factoryTitle,
  factoryValues,
  indexManufacturers,
  loadManufacturerTree,
  manufacturerRows,
  manufacturerTree,
  readBrand,
  readBrandSnapshot,
  readCompany,
  readCompanySnapshot,
  readFactory,
  readFactorySnapshot,
  searchManufacturers,
  type BrandItem,
  type CompanyItem,
  type FactoryItem,
} from "./manufacturers";
import { MESSAGES, fieldErrors, type DatabaseClient } from "./reference";

const BRAND = "4168842d-a1f3-4f09-b6ee-0a6f6c787280";
const COMPANY = "bc4886cc-1703-4eb9-998f-34d5a4d8f046";
const FACTORY = "10000000-0000-4000-8000-000000000002";
const VERSION = "2026-10-27T07:41:32.592604+00:00";

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * what the test's responder returns.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

function fakeClient(respond: (query: Query) => Result) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => {
      query.calls.push(["maybeSingle", []]);
      return Promise.resolve(respond(query));
    };
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  });
  return { client: { from } as unknown as DatabaseClient, queries };
}

const usage = (templates: number, inspections: number) => ({
  templates: [{ count: templates }],
  inspections: [{ count: inspections }],
});

/* ------------------------------------------------------------------ *
 * Items for the tree, the rows and the search
 * ------------------------------------------------------------------ */

function factory(id: string, factoryName: string | null, extra: Partial<FactoryItem> = {}): FactoryItem {
  return {
    id,
    companyId: "company",
    factoryName,
    address: null,
    country: "Malaysia",
    notes: null,
    updatedAt: VERSION,
    usage: { templates: 0, inspections: 0 },
    ...extra,
  };
}

function company(id: string, name: string, factories: FactoryItem[]): CompanyItem {
  return { id, brandId: "brand", name, updatedAt: VERSION, factories: factories.map((item) => ({ ...item, companyId: id })) };
}

function brand(id: string, name: string, companies: CompanyItem[]): BrandItem {
  return { id, name, updatedAt: VERSION, companies: companies.map((item) => ({ ...item, brandId: id })) };
}

const TOP_GLOVE = brand("b-top", "Top Glove", [
  company("c-terang", "Terang Nusa Sdn. Bhd.", [
    factory("f-40", "TG-F40", {
      address: "Lot 67330, Lorong Bougainvillae/KU8\n41050 Klang, Selangor",
      usage: { templates: 0, inspections: 11 },
    }),
    factory("f-41", "TG-F41", { address: "Lot 2, Jalan Meru\n41050 Klang", country: "Malaysia" }),
  ]),
  company("c-new", "TG Medical Sdn. Bhd.", []),
]);
const HARTALEGA = brand("b-hart", "Hartalega", [
  company("c-ngc", "Hartalega NGC", [factory("f-ngc", null, { address: "No. 1, Persiaran Tanjung\n43900 Sepang" })]),
]);
const SRI_TRANG = brand("b-sri", "Sri Trang", []);
const BRANDS = [HARTALEGA, SRI_TRANG, TOP_GLOVE];

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

describe("BrandInputSchema", () => {
  it("cleans the name", () => {
    expect(BrandInputSchema.parse({ name: "  Top \t Glove " })).toEqual({ name: "Top Glove" });
  });

  it("needs a name of 120 characters or fewer", () => {
    expect(fieldErrors(BrandInputSchema.safeParse({ name: "  " }).error!)).toEqual({ name: "Enter the brand's name." });
    expect(fieldErrors(BrandInputSchema.safeParse({ name: "x".repeat(121) }).error!)).toEqual({
      name: "Keep the name to 120 characters or fewer.",
    });
  });
});

describe("CompanyInputSchema", () => {
  it("takes the brand it goes under and the cleaned name", () => {
    expect(CompanyInputSchema.parse({ brand_id: BRAND, name: " Terang  Nusa Sdn. Bhd. " })).toEqual({
      brand_id: BRAND,
      name: "Terang Nusa Sdn. Bhd.",
    });
  });

  it("asks for a brand and a name", () => {
    expect(fieldErrors(CompanyInputSchema.safeParse({ brand_id: "", name: "" }).error!)).toEqual({
      brand_id: "Choose the brand.",
      name: "Enter the company's name.",
    });
  });

  it("calls a brand that is not a uuid a stale page", () => {
    expect(fieldErrors(CompanyInputSchema.safeParse({ brand_id: "1; drop table", name: "X" }).error!)).toEqual({
      brand_id: MESSAGES.stale,
    });
  });
});

describe("FactoryInputSchema", () => {
  const valid = { company_id: COMPANY, factory_name: "", address: "", country: "", notes: "" };

  it("cleans the fields and stores empty ones as null: a company's only plant may have no name", () => {
    expect(
      FactoryInputSchema.parse({
        company_id: COMPANY,
        factory_name: " TG-F40 ",
        address: "Lot 67330  \r\nKlang\n",
        country: " Malaysia",
        notes: "   ",
      }),
    ).toEqual({ company_id: COMPANY, factory_name: "TG-F40", address: "Lot 67330\nKlang", country: "Malaysia", notes: null });
    expect(FactoryInputSchema.parse(valid)).toEqual({
      company_id: COMPANY,
      factory_name: null,
      address: null,
      country: null,
      notes: null,
    });
  });

  it("asks for the company and caps each field", () => {
    const result = FactoryInputSchema.safeParse({
      ...valid,
      company_id: "",
      factory_name: "x".repeat(121),
      address: "y".repeat(401),
      country: "z".repeat(61),
      notes: "n".repeat(2001),
    });
    expect(fieldErrors(result.error!)).toEqual({
      company_id: "Choose the company.",
      factory_name: "Keep the factory name to 120 characters or fewer.",
      address: "Keep the address to 400 characters or fewer.",
      country: "Keep the country to 60 characters or fewer.",
      notes: "Keep the notes to 2,000 characters or fewer.",
    });
  });

  it("never takes the company's name: a trigger keeps manufacturers.name", () => {
    expect(Object.keys(FactoryInputSchema.shape)).not.toContain("name");
  });
});

describe("form values", () => {
  it("show each field as text, with empty ones blank", () => {
    expect(brandValues({ name: "Top Glove" })).toEqual({ name: "Top Glove" });
    expect(companyValues({ brandId: BRAND, name: "Hartalega NGC" })).toEqual({ brand_id: BRAND, name: "Hartalega NGC" });
    expect(factoryValues(factory("f", null, { companyId: COMPANY, notes: "Gate 2" }))).toEqual({
      company_id: COMPANY,
      factory_name: "",
      address: "",
      country: "Malaysia",
      notes: "Gate 2",
    });
  });

  it("start a new row blank, under the brand or company it was added from", () => {
    expect(brandValues(null)).toEqual({ name: "" });
    expect(companyValues(null, BRAND)).toEqual({ brand_id: BRAND, name: "" });
    expect(factoryValues(null, COMPANY)).toEqual({ company_id: COMPANY, factory_name: "", address: "", country: "", notes: "" });
  });

  it("make snapshots at the row's version", () => {
    expect(companySnapshot({ brandId: BRAND, name: "Hartalega NGC", updatedAt: VERSION })).toEqual({
      version: VERSION,
      values: { brand_id: BRAND, name: "Hartalega NGC" },
    });
    expect(factorySnapshot(factory("f", "TG-F40", { companyId: COMPANY })).values.company_id).toBe(COMPANY);
  });
});

/* ------------------------------------------------------------------ *
 * Labels, deleting and errors
 * ------------------------------------------------------------------ */

describe("factory labels", () => {
  it("name a factory by its own name, or by its company's when it has none", () => {
    expect(factoryLabel("TG-F40", "Terang Nusa Sdn. Bhd.")).toBe("TG-F40");
    expect(factoryLabel(null, "Hartalega NGC")).toBe("Hartalega NGC's factory");
    expect(factoryLabel(null, "Supermax Holdings")).toBe("Supermax Holdings' factory");
  });

  it("are Title Case in a control's name", () => {
    expect(factoryTitle(null, "Hartalega NGC")).toBe("Hartalega NGC's Factory");
    expect(factoryTitle("TG-F40", "Terang Nusa Sdn. Bhd.")).toBe("TG-F40");
  });
});

describe("delete blockers", () => {
  it("keep a brand with companies and a company with factories", () => {
    expect(brandDeleteBlocker(2)).toBe("Has 2 companies, so it cannot be deleted.");
    expect(brandDeleteBlocker(1)).toBe("Has 1 company, so it cannot be deleted.");
    expect(brandDeleteBlocker(0)).toBeNull();
    expect(companyDeleteBlocker(1)).toBe("Has 1 factory, so it cannot be deleted.");
    expect(companyDeleteBlocker(3)).toBe("Has 3 factories, so it cannot be deleted.");
    expect(companyDeleteBlocker(0)).toBeNull();
    expect(DELETABLE).toEqual({
      brand: "Has no companies, so it can be deleted.",
      company: "Has no factories, so it can be deleted.",
    });
  });
});

describe("database errors", () => {
  it("put a duplicate name under the name", () => {
    expect(describeBrandSaveError({ code: "23505" })).toEqual({ field: "name", message: "There is already a brand with this name." });
    expect(describeCompanySaveError({ code: "23505" })).toEqual({
      field: "name",
      message: "There is already a company with this name.",
    });
  });

  it("put a factory name the company already has under the factory, with or without a name", () => {
    expect(describeFactorySaveError({ code: "23505" }, { factory_name: "TG-F40" })).toEqual({
      field: "factory_name",
      message: "This company already has a factory with this name.",
    });
    expect(describeFactorySaveError({ code: "23505" }, { factory_name: null })).toEqual({
      field: "factory_name",
      message: "This company already has a factory without a name.",
    });
  });

  it("say when the brand or company chosen has gone", () => {
    expect(describeCompanySaveError({ code: "23503" })).toEqual({
      field: "brand_id",
      message: "That brand is no longer on the list. Reload the page.",
    });
    expect(describeFactorySaveError({ code: "23503" }, { factory_name: null })).toEqual({
      field: "company_id",
      message: "That company is no longer on the list. Reload the page.",
    });
  });

  it("explain a refusal and anything else in plain words", () => {
    expect(describeBrandSaveError({ code: "42501" })).toEqual({ message: NO_PERMISSION.change });
    expect(describeFactorySaveError({ code: "XX000" }, { factory_name: "A" })).toEqual({
      message: "The factory could not be saved. Try again.",
    });
  });

  it("say what keeps a row the database would not delete, for both codes Postgres uses", () => {
    for (const code of ["23001", "23503"]) {
      expect(describeManufacturerDeleteError("brand", { code })).toBe("This brand has companies, so it cannot be deleted.");
      expect(describeManufacturerDeleteError("company", { code })).toBe(
        "This company has factories, so it cannot be deleted.",
      );
      expect(describeManufacturerDeleteError("factory", { code })).toBe(
        "Templates or inspections use this factory, so it cannot be deleted.",
      );
    }
    expect(describeManufacturerDeleteError("company", { code: "42501" })).toBe(NO_PERMISSION.delete);
    expect(describeManufacturerDeleteError("brand", { code: "XX000" })).toBe("The brand could not be deleted. Try again.");
  });

  it("word a save someone else got to first", () => {
    expect(changedMeanwhile("company")).toMatch(/^Someone else changed this company while you were editing\./);
    expect(deletedMeanwhile("factory")).toBe("This factory has been deleted, so your changes were not saved.");
  });
});

/* ------------------------------------------------------------------ *
 * The tree
 * ------------------------------------------------------------------ */

describe("manufacturerTree", () => {
  const row = (id: string, factoryName: string | null) => ({
    id,
    factory_name: factoryName,
    address: null,
    country: null,
    notes: null,
    updated_at: VERSION,
    ...usage(0, 0),
  });

  it("sorts each level by name, numbers by value, a factory without a name first", () => {
    const tree = manufacturerTree([
      {
        id: "b2",
        name: "top glove",
        updated_at: VERSION,
        companies: [
          { id: "c2", name: "TG Medical", updated_at: VERSION, factories: [] },
          {
            id: "c1",
            name: "Terang Nusa",
            updated_at: VERSION,
            factories: [row("f10", "Plant 10"), row("f2", "Plant 2"), row("f0", null), row("fa", "plant 1")],
          },
        ],
      },
      { id: "b1", name: "Hartalega", updated_at: VERSION, companies: [] },
    ]);

    expect(tree.map((item) => item.name)).toEqual(["Hartalega", "top glove"]);
    expect(tree[1].companies.map((item) => item.name)).toEqual(["Terang Nusa", "TG Medical"]);
    expect(tree[1].companies[0].factories.map((item) => item.factoryName)).toEqual([null, "plant 1", "Plant 2", "Plant 10"]);
  });

  it("carries each parent's id and each factory's usage", () => {
    const [top] = manufacturerTree([
      {
        id: BRAND,
        name: "Top Glove",
        updated_at: VERSION,
        companies: [
          {
            id: COMPANY,
            name: "Terang Nusa Sdn. Bhd.",
            updated_at: "t2",
            factories: [{ ...row(FACTORY, "TG-F40"), address: "Klang", country: "Malaysia", notes: "n", ...usage(1, 11) }],
          },
        ],
      },
    ]);
    expect(top).toEqual({
      id: BRAND,
      name: "Top Glove",
      updatedAt: VERSION,
      companies: [
        {
          id: COMPANY,
          brandId: BRAND,
          name: "Terang Nusa Sdn. Bhd.",
          updatedAt: "t2",
          factories: [
            {
              id: FACTORY,
              companyId: COMPANY,
              factoryName: "TG-F40",
              address: "Klang",
              country: "Malaysia",
              notes: "n",
              updatedAt: VERSION,
              usage: { templates: 1, inspections: 11 },
            },
          ],
        },
      ],
    });
  });
});

describe("loadManufacturerTree", () => {
  it("reads brands, companies and factories in one query, never manufacturers.name", async () => {
    const { client, queries } = fakeClient(() => ({ data: [], error: null }));
    await expect(loadManufacturerTree(client)).resolves.toEqual([]);
    expect(queries).toHaveLength(1);
    expect(queries[0].table).toBe("manufacturer_brands");
    const columns = String(queries[0].calls[0][1][0]);
    expect(columns).toContain("companies:manufacturer_companies(");
    expect(columns).toContain("factories:manufacturers(id, factory_name, address, country, notes, updated_at, templates(count), inspections(count))");
  });

  it("fails loudly when the list cannot be read, for the error page", async () => {
    const { client } = fakeClient(() => ({ data: null, error: { message: "permission denied" } }));
    await expect(loadManufacturerTree(client)).rejects.toThrow("Could not load the manufacturers: permission denied");
  });
});

describe("indexManufacturers and factoryCount", () => {
  it("find each company and factory with what it sits under", () => {
    const index = indexManufacturers(BRANDS);
    expect(index.brands.get("b-sri")).toBe(SRI_TRANG);
    expect(index.companies.get("c-new")?.brand).toBe(TOP_GLOVE);
    expect(index.factories.get("f-ngc")?.company.name).toBe("Hartalega NGC");
    expect(factoryCount(BRANDS)).toBe(3);
    expect(factoryCount([])).toBe(0);
  });
});

/* ------------------------------------------------------------------ *
 * Table rows
 * ------------------------------------------------------------------ */

describe("manufacturerRows", () => {
  const rows = manufacturerRows(BRANDS);
  const shape = rows.map((row) => [
    row.key,
    row.brandSpan,
    row.company?.name ?? null,
    row.companySpan,
    row.factory ? (row.factory.factoryName ?? "(unnamed)") : null,
  ]);

  it("gives each factory a row, and the brand's and company's cells span theirs", () => {
    expect(shape).toEqual([
      ["f-ngc", 1, "Hartalega NGC", 1, "(unnamed)"],
      ["brand:b-sri", 1, null, 0, null],
      ["f-40", 3, "Terang Nusa Sdn. Bhd.", 2, "TG-F40"],
      ["f-41", 0, "Terang Nusa Sdn. Bhd.", 0, "TG-F41"],
      ["company:c-new", 0, "TG Medical Sdn. Bhd.", 1, null],
    ]);
  });

  it("is empty with no brands", () => {
    expect(manufacturerRows([])).toEqual([]);
  });
});

/* ------------------------------------------------------------------ *
 * Search
 * ------------------------------------------------------------------ */

describe("searchManufacturers", () => {
  const names = (brands: BrandItem[]) =>
    brands.map((item) => [
      item.name,
      item.companies.map((entry) => [entry.name, entry.factories.map((one) => one.factoryName ?? "(unnamed)")]),
    ]);

  it("keeps everything for an empty query", () => {
    expect(searchManufacturers(BRANDS, "  ")).toEqual(BRANDS);
  });

  it("keeps a brand's whole branch when the brand matches", () => {
    expect(names(searchManufacturers(BRANDS, "top"))).toEqual([
      ["Top Glove", [["Terang Nusa Sdn. Bhd.", ["TG-F40", "TG-F41"]], ["TG Medical Sdn. Bhd.", []]]],
    ]);
    // A brand with no company yet is found by its name.
    expect(names(searchManufacturers(BRANDS, "sri trang"))).toEqual([["Sri Trang", []]]);
  });

  it("keeps a company's factories when the company matches, and its brand around it", () => {
    expect(names(searchManufacturers(BRANDS, "terang"))).toEqual([["Top Glove", [["Terang Nusa Sdn. Bhd.", ["TG-F40", "TG-F41"]]]]]);
    expect(names(searchManufacturers(BRANDS, "medical"))).toEqual([["Top Glove", [["TG Medical Sdn. Bhd.", []]]]]);
  });

  it("keeps just the factories that match by name, address, country or notes", () => {
    expect(names(searchManufacturers(BRANDS, "tg-f40"))).toEqual([["Top Glove", [["Terang Nusa Sdn. Bhd.", ["TG-F40"]]]]]);
    expect(names(searchManufacturers(BRANDS, "sepang"))).toEqual([["Hartalega", [["Hartalega NGC", ["(unnamed)"]]]]]);
    expect(names(searchManufacturers(BRANDS, "meru"))).toEqual([["Top Glove", [["Terang Nusa Sdn. Bhd.", ["TG-F41"]]]]]);
  });

  it("finds the words across the levels, in any order, ignoring case and accents", () => {
    expect(names(searchManufacturers(BRANDS, "klang TOP glove bougainvillae"))).toEqual([
      ["Top Glove", [["Terang Nusa Sdn. Bhd.", ["TG-F40"]]]],
    ]);
    expect(names(searchManufacturers(BRANDS, "hártalega"))).toEqual([["Hartalega", [["Hartalega NGC", ["(unnamed)"]]]]]);
    expect(searchManufacturers(BRANDS, "malaysia").map((item) => item.name)).toEqual(["Hartalega", "Top Glove"]);
  });

  it("finds nothing when a word matches nowhere", () => {
    expect(searchManufacturers(BRANDS, "top sepang")).toEqual([]);
  });

  it("leaves the page's items as they are", () => {
    searchManufacturers(BRANDS, "tg-f40");
    expect(TOP_GLOVE.companies[0].factories).toHaveLength(2);
    expect(searchManufacturers(BRANDS, "hartalega")[0]).toBe(HARTALEGA);
  });
});

describe("countrySuggestions", () => {
  it("offers the countries in use and the common ones, once each, by name", () => {
    const vietnam = brand("b-v", "V", [company("c-v", "V Co", [factory("f-v", null, { country: "vietnam" })])]);
    const suggestions = countrySuggestions([...BRANDS, vietnam]);
    expect(suggestions).toContain("Malaysia");
    expect(suggestions.filter((country) => country.toLowerCase() === "vietnam")).toEqual(["vietnam"]);
    expect(suggestions).toEqual([...suggestions].sort((a, b) => a.localeCompare(b, "en-GB", { sensitivity: "base" })));
  });
});

/* ------------------------------------------------------------------ *
 * Queries for the actions
 * ------------------------------------------------------------------ */

describe("readBrand, readCompany and readFactory", () => {
  it("read a brand with how many companies it has", async () => {
    const { client, queries } = fakeClient(() => ({
      data: { id: BRAND, name: "Top Glove", manufacturer_companies: [{ count: 2 }] },
      error: null,
    }));
    await expect(readBrand(client, BRAND)).resolves.toEqual({ id: BRAND, name: "Top Glove", companies: 2 });
    expect(queries[0].table).toBe("manufacturer_brands");
    expect(queries[0].calls).toContainEqual(["eq", ["id", BRAND]]);
  });

  it("read a company with how many factories it has", async () => {
    const { client, queries } = fakeClient(() => ({
      data: { id: COMPANY, name: "Terang Nusa Sdn. Bhd.", manufacturers: [{ count: 1 }] },
      error: null,
    }));
    await expect(readCompany(client, COMPANY)).resolves.toEqual({ id: COMPANY, name: "Terang Nusa Sdn. Bhd.", factories: 1 });
    expect(queries[0].table).toBe("manufacturer_companies");
  });

  it("read a factory with its company's name and its usage", async () => {
    const { client, queries } = fakeClient(() => ({
      data: { id: FACTORY, factory_name: null, company: { name: "Hartalega NGC" }, ...usage(0, 3) },
      error: null,
    }));
    await expect(readFactory(client, FACTORY)).resolves.toEqual({
      id: FACTORY,
      factoryName: null,
      companyName: "Hartalega NGC",
      usage: { templates: 0, inspections: 3 },
    });
    expect(String(queries[0].calls[0][1][0])).not.toMatch(/(^|[ ,])name/);
  });

  it("answer null for a row that does not exist, and throw on a database error", async () => {
    await expect(readCompany(fakeClient(() => ({ data: null, error: null })).client, COMPANY)).resolves.toBeNull();
    await expect(readFactory(fakeClient(() => ({ data: null, error: null })).client, FACTORY)).resolves.toBeNull();
    const failing = fakeClient(() => ({ data: null, error: { message: "timeout" } }));
    await expect(readBrand(failing.client, BRAND)).rejects.toThrow("timeout");
  });
});

describe("snapshots", () => {
  it("read each row's editable fields as the form shows them, at its current version", async () => {
    await expect(
      readBrandSnapshot(fakeClient(() => ({ data: { name: "Top Glove", updated_at: VERSION }, error: null })).client, BRAND),
    ).resolves.toEqual({ version: VERSION, values: { name: "Top Glove" } });

    await expect(
      readCompanySnapshot(
        fakeClient(() => ({ data: { brand_id: BRAND, name: "Terang", updated_at: VERSION }, error: null })).client,
        COMPANY,
      ),
    ).resolves.toEqual({ version: VERSION, values: { brand_id: BRAND, name: "Terang" } });

    const factories = fakeClient(() => ({
      data: { company_id: COMPANY, factory_name: null, address: "Lot 1", country: null, notes: null, updated_at: VERSION },
      error: null,
    }));
    await expect(readFactorySnapshot(factories.client, FACTORY)).resolves.toEqual({
      version: VERSION,
      values: { company_id: COMPANY, factory_name: "", address: "Lot 1", country: "", notes: "" },
    });
    expect(factories.queries[0].calls).toContainEqual(["eq", ["id", FACTORY]]);
  });

  it("answer null for a row that has gone, and throw on a database error", async () => {
    await expect(readBrandSnapshot(fakeClient(() => ({ data: null, error: null })).client, BRAND)).resolves.toBeNull();
    const failing = fakeClient(() => ({ data: null, error: { message: "timeout" } }));
    await expect(readFactorySnapshot(failing.client, FACTORY)).rejects.toThrow("timeout");
  });
});
