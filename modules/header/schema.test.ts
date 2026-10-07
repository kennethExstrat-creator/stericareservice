import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  HEADER_FIELDS as DICTIONARY_HEADER_FIELDS,
  labelOverrides,
  moduleConfig,
  moduleTitle,
  TEMPLATE_CODES,
} from "@/lib/coverage";
import { resolvedModule, resolveSeedTemplate } from "./__fixtures__/templates";
import { HEADER_DEFAULT_CONFIG, HEADER_FIELDS, HEADER_LABELS, HEADER_TITLE, HeaderConfigSchema } from "./config";
import { datePart, monthDate, yearMonth } from "./dates";
import { emptyHeader, HEADER_TEXT_FIELDS, HeaderDataSchema, TEXT_MAX_LENGTH } from "./schema";

describe("header data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyHeader()).toEqual({
      factoryAddress: null,
      poNo: null,
      productName: null,
      productCode: null,
      factoryGloveCode: null,
      inspectionDate: null,
      mfgDate: null,
      expiryDate: null,
    });
    expect(HeaderDataSchema.parse({ poNo: "PO-0001 (SO-0001)" })).toEqual({ ...emptyHeader(), poNo: "PO-0001 (SO-0001)" });
  });

  it("holds the dictionary's entered keys; the manufacturer and the client stay on the inspection row", () => {
    const entered = dataKeys("header", "entered").filter((key) => key !== "manufacturer" && key !== "client");
    expect(Object.keys(emptyHeader()).sort()).toEqual([...entered].sort());
    expect(dataKeys("header", "system")).toEqual(["inspector"]);
  });

  it("takes dates from a date picker only: never a count, a typed date or a month alone (6.2 rule 3)", () => {
    expect(HeaderDataSchema.parse({ mfgDate: "2025-04-01", expiryDate: "2028-02-29" })).toMatchObject({
      mfgDate: "2025-04-01",
      expiryDate: "2028-02-29",
    });
    for (const value of ["4/1/2025", "1/4/2025", "Feb-25", "2025-02", "2025-02-30", "2027-02-29", "", 29221, 45383]) {
      expect(HeaderDataSchema.safeParse({ mfgDate: value }).success).toBe(false);
    }
  });

  it("keeps the PO and the product name as printed, one text value each", () => {
    const data = HeaderDataSchema.parse({
      poNo: "PO-0001 (SO-0001)",
      productName: "Brand A PC-A01 Blue Nitrile\nBlue",
      productCode: "PC-A01",
    });
    expect(data).toMatchObject({ poNo: "PO-0001 (SO-0001)", productName: "Brand A PC-A01 Blue Nitrile\nBlue" });
    expect(HeaderDataSchema.safeParse({ poNo: 2466264 }).success).toBe(false);
    expect(HeaderDataSchema.safeParse({ productCode: ["PC-A01"] }).success).toBe(false);
  });

  it("keeps text up to TEXT_MAX_LENGTH in every text field, the fields' limit", () => {
    for (const field of HEADER_TEXT_FIELDS) {
      expect(HeaderDataSchema.safeParse({ [field]: "x".repeat(TEXT_MAX_LENGTH) }).success).toBe(true);
      expect(HeaderDataSchema.safeParse({ [field]: "x".repeat(TEXT_MAX_LENGTH + 1) }).success).toBe(false);
    }
  });

  it("rejects fields it does not have: the inspector, the manufacturer, the client and the reserved comment", () => {
    for (const key of ["inspector", "manufacturer", "client", "comment", "reportDate", "productcode"]) {
      expect(HeaderDataSchema.safeParse({ [key]: "x" }).success).toBe(false);
    }
  });
});

describe("header dates", () => {
  it("prints and compares a date at the template's precision", () => {
    expect(datePart("2025-02-19", "day")).toBe("2025-02-19");
    expect(datePart("2025-02-19", "month")).toBe("2025-02");
  });

  it("stores a month as its first day and reads it back", () => {
    expect(monthDate(2025, 2)).toBe("2025-02-01");
    expect(monthDate(2030, 12)).toBe("2030-12-01");
    expect(HeaderDataSchema.safeParse({ mfgDate: monthDate(2025, 2) }).success).toBe(true);
    expect(yearMonth("2030-01-01")).toEqual({ year: 2030, month: 1 });
  });
});

describe("header config", () => {
  it("shows every row with full dates by default: the dictionary's defaults", () => {
    expect(HeaderConfigSchema.parse(HEADER_DEFAULT_CONFIG)).toEqual(HEADER_DEFAULT_CONFIG);
    expect(HEADER_DEFAULT_CONFIG).toEqual(defaultConfig("header"));
  });

  it("accepts every seed template's header config", () => {
    for (const code of TEMPLATE_CODES) {
      const config = moduleConfig(code, "header");
      expect(HeaderConfigSchema.parse(config)).toEqual(config);
    }
  });

  it("resolves from the seeds down the extends chain to each template's config", () => {
    for (const code of TEMPLATE_CODES) {
      const header = resolvedModule(resolveSeedTemplate(code, ["header"]), "header");
      expect(header.config).toEqual(moduleConfig(code, "header"));
      expect(header.title).toBe(moduleTitle(code, "header"));
      expect(header.labels).toEqual({ ...HEADER_LABELS, ...labelOverrides(code, "header") });
    }
    const safedon = resolvedModule(resolveSeedTemplate("SAFEDON_EG", ["header"]), "header");
    expect(safedon.config).toMatchObject({ fields: { client: false, factoryGloveCode: false }, mfgExpiryPrecision: "month" });
  });

  it("rejects a mistyped field, a missing one and a precision it does not know", () => {
    const fields = HEADER_DEFAULT_CONFIG.fields;
    expect(HeaderConfigSchema.safeParse({ ...HEADER_DEFAULT_CONFIG, fields: { ...fields, poNumber: true } }).success).toBe(
      false,
    );
    const withoutCode = Object.fromEntries(Object.entries(fields).filter(([key]) => key !== "productCode"));
    expect(HeaderConfigSchema.safeParse({ ...HEADER_DEFAULT_CONFIG, fields: withoutCode }).success).toBe(false);
    expect(HeaderConfigSchema.safeParse({ ...HEADER_DEFAULT_CONFIG, mfgExpiryPrecision: "year" }).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(HeaderConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.fields.description).toContain("Fields shown");
    expect(schema.properties.mfgExpiryPrecision.description).toContain("month");
  });
});

describe("header wording", () => {
  it("defaults to STD_EG's wording, as the dictionary has it", () => {
    expect(HEADER_TITLE).toBe(moduleTitle("STD_EG", "header"));
    expect({ ...HEADER_LABELS }).toEqual(defaultLabels("header"));
    expect([...HEADER_FIELDS]).toEqual([...DICTIONARY_HEADER_FIELDS]);
  });

  it("has a default for every label another template rewords", () => {
    for (const code of TEMPLATE_CODES) {
      for (const key of Object.keys(labelOverrides(code, "header"))) expect(HEADER_LABELS).toHaveProperty(key);
    }
    expect(labelOverrides("SAFEDON_EG", "header")).toEqual({
      poNo: "PO Number",
      productName: "Product Name (Brand & Code)",
    });
  });
});
