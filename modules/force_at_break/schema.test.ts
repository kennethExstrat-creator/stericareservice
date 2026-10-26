import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  moduleConfig,
  moduleTitle,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
} from "@/lib/coverage";
import { resolveTemplateOrThrow } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  FORCE_AT_BREAK_DEFAULT_CONFIG,
  FORCE_AT_BREAK_LABELS,
  FORCE_AT_BREAK_TITLE,
  ForceAtBreakConfigSchema,
} from "./config";
import { emptyForceAtBreak, emptyForceAtBreakSize, ForceAtBreakDataSchema } from "./schema";

const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000401";
const OTHER_REPORT_ID = "00000000-0000-4000-8000-000000000409";

describe("force_at_break data", () => {
  it("starts empty and accepts a draft with readings still missing", () => {
    expect(emptyForceAtBreak()).toEqual({ sizes: {}, labReports: [] });
    expect(emptyForceAtBreakSize()).toEqual({ values: [] });
    expect(ForceAtBreakDataSchema.parse({ sizes: { M: { values: [6.47, null, 6.301] } } })).toEqual({
      sizes: { M: { values: [6.47, null, 6.301] } },
      labReports: [],
    });
    expect(ForceAtBreakDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { values: [] } }, labReports: [] });
  });

  it("stores readings as numbers, never as text (6.2 rule 1)", () => {
    for (const text of ["6.47", "6 47", "6.47 N", ""]) {
      expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [6.5, text] } } }).success).toBe(false);
    }
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [Number.POSITIVE_INFINITY] } } }).success).toBe(false);
  });

  it("keeps the median and the result out of the data (6.2 rule 2)", () => {
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [6.5], median: 6.5 } } }).success).toBe(false);
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { values: [6.5], result: "pass" } } }).success).toBe(false);
  });

  it("keeps its lab reports by their inspection_files ids, each with the sizes it gives results for", () => {
    const reports = [
      { fileId: LAB_REPORT_ID, sizes: ["M"] },
      { fileId: OTHER_REPORT_ID, sizes: [] },
    ];
    expect(ForceAtBreakDataSchema.parse({ labReports: reports }).labReports).toEqual(reports);
    expect(ForceAtBreakDataSchema.parse({ labReports: [{ fileId: LAB_REPORT_ID }] }).labReports).toEqual([{ fileId: LAB_REPORT_ID, sizes: [] }]);
    for (const labReports of [[{ fileId: "lab-report.pdf" }], [LAB_REPORT_ID], [{ fileId: LAB_REPORT_ID, sizes: [""] }], LAB_REPORT_ID]) {
      expect(ForceAtBreakDataSchema.safeParse({ labReports }).success, JSON.stringify(labReports)).toBe(false);
    }
  });

  it("reads data saved with one lab report (before 26 October 2026) as one report with no sizes", () => {
    expect(ForceAtBreakDataSchema.parse({ sizes: {}, labReport: LAB_REPORT_ID })).toEqual({
      sizes: {},
      labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }],
    });
    expect(ForceAtBreakDataSchema.parse({ sizes: {}, labReport: null })).toEqual({ sizes: {}, labReports: [] });
    // Beside a list, once: never twice, never in place of another report.
    const listed = [{ fileId: OTHER_REPORT_ID, sizes: ["M"] }];
    expect(ForceAtBreakDataSchema.parse({ labReport: LAB_REPORT_ID, labReports: listed }).labReports).toEqual([
      ...listed,
      { fileId: LAB_REPORT_ID, sizes: [] },
    ]);
    expect(ForceAtBreakDataSchema.parse({ labReport: OTHER_REPORT_ID, labReports: listed }).labReports).toEqual(listed);
    // One that is no file id stays for the schema to reject, so it is reported and can be taken out.
    const invalid = ForceAtBreakDataSchema.safeParse({ labReport: "lab-report.pdf" });
    expect(invalid.success).toBe(false);
    expect(invalid.error?.issues).toEqual([expect.objectContaining({ code: "unrecognized_keys", keys: ["labReport"] })]);
  });

  it("rejects fields it does not have, the reserved comment included", () => {
    expect(ForceAtBreakDataSchema.safeParse({ sizes: {}, forces: [] }).success).toBe(false);
    expect(ForceAtBreakDataSchema.safeParse({ comment: "x" }).success).toBe(false);
    expect(ForceAtBreakDataSchema.safeParse({ sizes: { M: { readings: [6.5] } } }).success).toBe(false);
  });

  it("holds exactly the dictionary's entered keys (docs/DATA_DICTIONARY.md)", () => {
    // The list of lab reports is the dictionary's labReport, whose key the line keeps for its label (labels.labReport).
    const keys = [...Object.keys(emptyForceAtBreakSize()), ...Object.keys(emptyForceAtBreak()).filter((key) => key !== "sizes")].map((key) =>
      key === "labReports" ? "labReport" : key,
    );
    expect(keys.sort()).toEqual(dataKeys("force_at_break", "entered").sort());
  });
});

describe("force_at_break config", () => {
  it("defaults to 13 readings, a 6 N minimum, no standard label and 3 decimals: the dictionary's defaults", () => {
    expect(ForceAtBreakConfigSchema.parse(FORCE_AT_BREAK_DEFAULT_CONFIG)).toEqual({
      n: 13,
      specMin: 6,
      standardLabel: null,
      decimals: 3,
    });
    expect(FORCE_AT_BREAK_DEFAULT_CONFIG).toEqual(defaultConfig("force_at_break"));
  });

  it.each(TEMPLATE_CODES)("accepts what the %s template sets (lib/coverage/templates.ts)", (code) => {
    const config = moduleConfig(code, "force_at_break");
    if (config === undefined) return;
    expect(ForceAtBreakConfigSchema.parse(config)).toEqual(config);
  });

  it("is on in STD_EG only, as BUILD_SPEC 11 has it", () => {
    expect(TEMPLATE_CODES.filter((code) => moduleConfig(code, "force_at_break") !== undefined)).toEqual(["STD_EG"]);
  });

  it("resolves STD_EG's seed over its defaults into the template's config, with this schema", () => {
    const spec = TEMPLATES.STD_EG;
    // Only this module is seeded; order_lots is on because a per-size module needs it.
    const definition = {
      code: spec.code,
      name: spec.name,
      scope: { productType: spec.scope.productType, standard: spec.scope.standard },
      unit: spec.unit,
      sizes: spec.sizes.map((size) => ({ ...size })),
      modules: [
        { key: "order_lots", include: true },
        { key: "force_at_break", include: true, config: seedConfig("STD_EG", "force_at_break") },
      ],
    };
    const template = resolveTemplateOrThrow(definition, { getBase: () => undefined, registry: MODULE_REGISTRY });
    expect(template.modules.find((entry) => entry.key === "force_at_break")?.config).toEqual(
      moduleConfig("STD_EG", "force_at_break"),
    );
  });

  it("takes a standard label to print with the spec", () => {
    const config = { ...FORCE_AT_BREAK_DEFAULT_CONFIG, standardLabel: "EN 455" };
    expect(ForceAtBreakConfigSchema.parse(config).standardLabel).toBe("EN 455");
  });

  it("rejects impossible settings and mistyped keys", () => {
    const invalid = [
      { n: 0 },
      { n: 12.5 },
      { n: 501 },
      { specMin: 0 },
      { specMin: -6 },
      { decimals: -1 },
      { decimals: 1.5 },
      { decimals: 7 },
      { standardLabel: "  " },
      { standardLabel: 455 },
      { minimum: 6 },
    ];
    for (const change of invalid) {
      expect(ForceAtBreakConfigSchema.safeParse({ ...FORCE_AT_BREAK_DEFAULT_CONFIG, ...change }).success, JSON.stringify(change)).toBe(
        false,
      );
    }
  });

  it("becomes JSON Schema with descriptions and units, for the template editor's form", () => {
    const schema = z.toJSONSchema(ForceAtBreakConfigSchema) as {
      properties: Record<string, { description?: string; unit?: string }>;
    };
    for (const key of ["n", "specMin", "standardLabel", "decimals"]) {
      expect(schema.properties[key].description, key).toBeTruthy();
    }
    expect(schema.properties.specMin.unit).toBe("N");
  });
});

describe("force_at_break wording", () => {
  it("uses the dictionary's title and labels: STD_EG's wording", () => {
    expect(FORCE_AT_BREAK_TITLE).toBe(moduleTitle("STD_EG", "force_at_break"));
    expect(FORCE_AT_BREAK_LABELS).toEqual(defaultLabels("force_at_break"));
  });
});
