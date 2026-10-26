import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  labelOverrides,
  moduleConfig,
  moduleTitle,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
  type TemplateCode,
} from "@/lib/coverage";
import { lookupFrom, resolveTemplateOrThrow } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import { TENSILE_DEFAULT_CONFIG, TENSILE_LABELS, TENSILE_TITLE, TensileConfigSchema } from "./config";
import { emptyTensile, emptyTensileSize, TensileDataSchema } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000402";
const OTHER_REPORT_ID = "00000000-0000-4000-8000-000000000409";

describe("tensile data", () => {
  it("starts empty and accepts a draft with an average still missing", () => {
    expect(emptyTensile()).toEqual({ sizes: {}, labReports: [] });
    expect(emptyTensileSize()).toEqual({ tensileStrength: null, elongationAtBreak: null });
    expect(TensileDataSchema.parse({ sizes: { XS: { tensileStrength: 34.18 } } })).toEqual({
      sizes: { XS: { tensileStrength: 34.18, elongationAtBreak: null } },
      labReports: [],
    });
  });

  it("stores the averages as numbers, never as text (6.2 rule 1)", () => {
    for (const text of ["34.18", "34 18", "34.18 MPa", "536%"]) {
      expect(TensileDataSchema.safeParse({ sizes: { XS: { tensileStrength: text } } }).success).toBe(false);
      expect(TensileDataSchema.safeParse({ sizes: { XS: { elongationAtBreak: text } } }).success).toBe(false);
    }
  });

  it("keeps the results out of the data (6.2 rule 2)", () => {
    expect(TensileDataSchema.safeParse({ sizes: { XS: { tensileResult: "pass" } } }).success).toBe(false);
    expect(TensileDataSchema.safeParse({ sizes: { XS: { elongationResult: "pass" } } }).success).toBe(false);
  });

  it("keeps its lab reports by their inspection_files ids, each with the sizes it gives results for", () => {
    const reports = [
      { fileId: LAB_REPORT_ID, sizes: ["XS"] },
      { fileId: OTHER_REPORT_ID, sizes: [] },
    ];
    expect(TensileDataSchema.parse({ labReports: reports }).labReports).toEqual(reports);
    expect(TensileDataSchema.parse({ labReports: [{ fileId: LAB_REPORT_ID }] }).labReports).toEqual([{ fileId: LAB_REPORT_ID, sizes: [] }]);
    for (const labReports of [[{ fileId: "tensile-report.pdf" }], [LAB_REPORT_ID], [{ fileId: LAB_REPORT_ID, sizes: [""] }], LAB_REPORT_ID]) {
      expect(TensileDataSchema.safeParse({ labReports }).success, JSON.stringify(labReports)).toBe(false);
    }
  });

  it("reads data saved with one lab report (before 26 October 2026) as one report with no sizes", () => {
    expect(TensileDataSchema.parse({ sizes: {}, labReport: LAB_REPORT_ID })).toEqual({
      sizes: {},
      labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }],
    });
    expect(TensileDataSchema.parse({ sizes: {}, labReport: null })).toEqual({ sizes: {}, labReports: [] });
    // Beside a list, once: never twice, never in place of another report.
    const listed = [{ fileId: OTHER_REPORT_ID, sizes: ["XS"] }];
    expect(TensileDataSchema.parse({ labReport: LAB_REPORT_ID, labReports: listed }).labReports).toEqual([
      ...listed,
      { fileId: LAB_REPORT_ID, sizes: [] },
    ]);
    expect(TensileDataSchema.parse({ labReport: OTHER_REPORT_ID, labReports: listed }).labReports).toEqual(listed);
    // One that is no file id stays for the schema to reject, so it is reported and can be taken out.
    const invalid = TensileDataSchema.safeParse({ labReport: "tensile-report.pdf" });
    expect(invalid.success).toBe(false);
    expect(invalid.error?.issues).toEqual([expect.objectContaining({ code: "unrecognized_keys", keys: ["labReport"] })]);
  });

  it("rejects fields it does not have, the reserved comment included", () => {
    expect(TensileDataSchema.safeParse({ comment: "x" }).success).toBe(false);
    expect(TensileDataSchema.safeParse({ sizes: { XS: { tensile: 34.18 } } }).success).toBe(false);
    expect(TensileDataSchema.safeParse({ sizes: {}, labReportFiles: [] }).success).toBe(false);
  });

  it("holds exactly the dictionary's entered keys (docs/DATA_DICTIONARY.md)", () => {
    // The list of lab reports is the dictionary's labReport, whose key the line keeps for its label (labels.labReport).
    const keys = [...Object.keys(emptyTensileSize()), ...Object.keys(emptyTensile()).filter((key) => key !== "sizes")].map((key) =>
      key === "labReports" ? "labReport" : key,
    );
    expect(keys.sort()).toEqual(dataKeys("tensile", "entered").sort());
  });
});

describe("tensile config", () => {
  it("defaults to ASTM D6319: at least 14 MPa and 500%, printed with 2 and 0 decimals", () => {
    expect(TensileConfigSchema.parse(TENSILE_DEFAULT_CONFIG)).toEqual({
      tensileMin: 14,
      elongationMin: 500,
      standardLabel: "ASTM D6319",
      decimals: { tensileStrength: 2, elongationAtBreak: 0 },
    });
    expect(TENSILE_DEFAULT_CONFIG).toEqual(defaultConfig("tensile"));
  });

  it.each(TEMPLATE_CODES)("accepts what the %s template sets (lib/coverage/templates.ts)", (code) => {
    const config = moduleConfig(code, "tensile");
    if (config === undefined) return;
    expect(TensileConfigSchema.parse(config)).toEqual(config);
  });

  it("is on in SAFEDON_EG only, as BUILD_SPEC 11 has it", () => {
    expect(TEMPLATE_CODES.filter((code) => moduleConfig(code, "tensile") !== undefined)).toEqual(["SAFEDON_EG"]);
  });

  it("resolves SAFEDON_EG's seed down its extends chain into the template's config, with this schema", () => {
    // Only the physical test modules are seeded; order_lots is on because per-size modules need it.
    const definition = (code: TemplateCode, modules: readonly { key: "force_at_break" | "tensile"; include: boolean }[]) => {
      const spec = TEMPLATES[code];
      return {
        code: spec.code,
        name: spec.name,
        ...(spec.extends === null ? {} : { extends: spec.extends }),
        scope: { productType: spec.scope.productType, standard: spec.scope.standard },
        unit: spec.unit,
        sizes: spec.sizes.map((size) => ({ ...size })),
        modules: [
          { key: "order_lots", include: true },
          ...modules.map(({ key, include }) => ({ key, include, ...(include ? { config: seedConfig(code, key) } : {}) })),
        ],
      };
    };
    const base = definition("STD_EG", [{ key: "force_at_break", include: true }]);
    const child = definition("SAFEDON_EG", [
      { key: "tensile", include: true },
      { key: "force_at_break", include: false },
    ]);
    const template = resolveTemplateOrThrow(child, { getBase: lookupFrom([{ definition: base, version: 1 }]), registry: MODULE_REGISTRY });
    expect(template.modules.find((entry) => entry.key === "tensile")).toMatchObject({
      include: true,
      config: moduleConfig("SAFEDON_EG", "tensile"),
    });
    expect(template.modules.find((entry) => entry.key === "force_at_break")?.include).toBe(false);
  });

  it("takes an empty standard label, which prints the caption alone", () => {
    expect(TensileConfigSchema.parse({ ...TENSILE_DEFAULT_CONFIG, standardLabel: "" }).standardLabel).toBe("");
  });

  it("rejects impossible settings and mistyped keys", () => {
    const invalid = [
      { tensileMin: 0 },
      { tensileMin: -14 },
      { elongationMin: 0 },
      { standardLabel: null },
      { decimals: { tensileStrength: 2 } },
      { decimals: { tensileStrength: 2, elongationAtBreak: -1 } },
      { decimals: { tensileStrength: 2.5, elongationAtBreak: 0 } },
      { decimals: { tensileStrength: 2, elongationAtBreak: 0, weight: 2 } },
      { tensileMinimum: 14 },
    ];
    for (const change of invalid) {
      expect(TensileConfigSchema.safeParse({ ...TENSILE_DEFAULT_CONFIG, ...change }).success, JSON.stringify(change)).toBe(false);
    }
  });

  it("becomes JSON Schema with descriptions and units, for the template editor's form", () => {
    const schema = z.toJSONSchema(TensileConfigSchema) as {
      properties: Record<string, { description?: string; unit?: string }>;
    };
    for (const key of ["tensileMin", "elongationMin", "standardLabel", "decimals"]) {
      expect(schema.properties[key].description, key).toBeTruthy();
    }
    expect([schema.properties.tensileMin.unit, schema.properties.elongationMin.unit]).toEqual(["MPa", "%"]);
  });
});

describe("tensile wording", () => {
  it("uses the dictionary's title and labels: SAFEDON_EG's wording, which the template does not override", () => {
    expect(TENSILE_TITLE).toBe(moduleTitle("SAFEDON_EG", "tensile"));
    expect(TENSILE_LABELS).toEqual(defaultLabels("tensile"));
    expect(labelOverrides("SAFEDON_EG", "tensile")).toEqual({});
  });
});
