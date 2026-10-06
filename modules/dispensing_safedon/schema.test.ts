import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  labelOverrides,
  moduleConfig,
  moduleTitle,
  SAFEDON_DISPENSING_DEFECTS,
  seedConfig,
  TEMPLATE_CODES,
  TEMPLATES,
  templateModuleKeys,
  type TemplateCode,
} from "@/lib/coverage";
import { lookupFrom, mergeConfig, resolveTemplateOrThrow, type JsonObject } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import {
  DISPENSING_SAFEDON_DEFAULT_CONFIG,
  DISPENSING_SAFEDON_LABELS,
  DISPENSING_SAFEDON_TITLE,
  DispensingSafedonConfigSchema,
} from "./config";
import {
  countOf,
  DispensingSafedonDataSchema,
  emptyDispensingSafedon,
  emptySafedonBox,
  isBlankSafedonBox,
} from "./schema";

describe("dispensing_safedon data", () => {
  it("starts empty and accepts a draft with anything missing, per size and per box", () => {
    expect(emptyDispensingSafedon()).toEqual({ sizes: {} });
    expect(emptySafedonBox()).toEqual({ boxNo: null, counts: {} });
    expect(DispensingSafedonDataSchema.parse({ sizes: { XS: {} } })).toEqual({ sizes: { XS: { boxes: [] } } });
    expect(DispensingSafedonDataSchema.parse({ sizes: { XS: { boxes: [{ boxNo: 33 }, { counts: { sticky: 1 } }] } } })).toEqual({
      sizes: { XS: { boxes: [{ boxNo: 33, counts: {} }, { boxNo: null, counts: { sticky: 1 } }] } },
    });
  });

  it("stores counts as whole numbers keyed by defect code, never as text, dates or ratios (6.2 rules 1 and 3)", () => {
    for (const count of ["1", "1/125", "2025-01-01", -1, 1.5]) {
      expect(DispensingSafedonDataSchema.safeParse({ sizes: { XS: { boxes: [{ counts: { no_cuff: count } }] } } }).success).toBe(
        false,
      );
    }
    for (const code of ["No cuff", "noCuff", "1st", ""]) {
      expect(DispensingSafedonDataSchema.safeParse({ sizes: { XS: { boxes: [{ counts: { [code]: 1 } }] } } }).success).toBe(false);
    }
    for (const box of ["33", 0, 2.5]) {
      expect(DispensingSafedonDataSchema.safeParse({ sizes: { XS: { boxes: [{ boxNo: box }] } } }).success).toBe(false);
    }
  });

  it("reads a defect not counted yet as 0", () => {
    const box = DispensingSafedonDataSchema.parse({ sizes: { XS: { boxes: [{ counts: { sticky: 2, no_cuff: null } }] } } }).sizes.XS
      .boxes[0];
    expect([countOf(box, "sticky"), countOf(box, "no_cuff"), countOf(box, "stuck")]).toEqual([2, 0, 0]);
  });

  it("rejects fields it does not have, the reserved comment and computed values included (6.2 rule 2)", () => {
    expect(DispensingSafedonDataSchema.safeParse({ comment: "x" }).success).toBe(false);
    expect(DispensingSafedonDataSchema.safeParse({ sizes: { XS: { boxes: [], totalDefects: 3 } } }).success).toBe(false);
    expect(DispensingSafedonDataSchema.safeParse({ sizes: { XS: { boxes: [{ boxNo: 1, boxRatePct: 0.8 }] } } }).success).toBe(
      false,
    );
  });

  it("holds exactly the dictionary's entered keys per box (docs/DATA_DICTIONARY.md)", () => {
    expect(Object.keys(emptySafedonBox()).sort()).toEqual(dataKeys("dispensing_safedon", "entered").sort());
  });

  it("tells a blank column from a started one", () => {
    expect(isBlankSafedonBox(emptySafedonBox())).toBe(true);
    expect(isBlankSafedonBox({ boxNo: null, counts: { sticky: 0, stuck: null } })).toBe(true);
    expect(isBlankSafedonBox({ boxNo: null, counts: { sticky: 1 } })).toBe(false);
    expect(isBlankSafedonBox({ boxNo: 33, counts: {} })).toBe(false);
  });
});

/** A template's config as lib/templates resolves it: the module defaults, then each seed from the root down. */
function resolvedConfig(code: TemplateCode): JsonObject {
  const chain: TemplateCode[] = [];
  for (let at: TemplateCode | null = code; at !== null; at = TEMPLATES[at].extends) chain.unshift(at);
  return chain.reduce<JsonObject>((config, at) => {
    const seed = seedConfig(at, "dispensing_safedon") as JsonObject | undefined;
    return seed === undefined ? config : mergeConfig(config, seed);
  }, DISPENSING_SAFEDON_DEFAULT_CONFIG as unknown as JsonObject);
}

describe("dispensing_safedon config", () => {
  it("defaults to BUILD_SPEC 6.1: the six Safedon defects, 125 gloves per pack, at most 5%, 13 boxes", () => {
    expect(DispensingSafedonConfigSchema.parse(DISPENSING_SAFEDON_DEFAULT_CONFIG)).toEqual(DISPENSING_SAFEDON_DEFAULT_CONFIG);
    expect(DISPENSING_SAFEDON_DEFAULT_CONFIG.defects.map((defect) => defect.code)).toEqual([
      "no_cuff",
      "finger_out",
      "multiple_out",
      "stuck",
      "sticky",
      "faulty_cuff",
    ]);
  });

  it("is the data dictionary's: defaults, title and labels; the hints are the app's definitions, typos fixed", () => {
    expect(DISPENSING_SAFEDON_DEFAULT_CONFIG).toEqual(defaultConfig("dispensing_safedon"));
    expect(DISPENSING_SAFEDON_TITLE).toBe(moduleTitle("SAFEDON_EG", "dispensing_safedon"));
    expect(DISPENSING_SAFEDON_LABELS).toEqual(defaultLabels("dispensing_safedon"));
    expect(DISPENSING_SAFEDON_DEFAULT_CONFIG.defects.map((defect) => defect.hint)).toEqual(
      SAFEDON_DISPENSING_DEFECTS.map((defect) => defect.hint),
    );
    // The printed rows, in the template's order and labels.
    expect(DISPENSING_SAFEDON_DEFAULT_CONFIG.defects.map(({ code, label }) => ({ code, label }))).toEqual(
      SAFEDON_EG_EXAMPLE.dispensingSafedon.rows.map(({ code, label }) => ({ code, label })),
    );
  });

  it("accepts every seed template's values (lib/coverage/templates.ts), merged as lib/templates merges them", () => {
    const using = TEMPLATE_CODES.filter((code) => templateModuleKeys(code).includes("dispensing_safedon"));
    expect(using).toEqual(["SAFEDON_EG"]);
    for (const code of using) {
      const config = moduleConfig(code, "dispensing_safedon");
      expect(DispensingSafedonConfigSchema.parse(config), code).toEqual(config);
      expect(DispensingSafedonConfigSchema.parse(resolvedConfig(code)), code).toEqual(config);
      expect(labelOverrides(code, "dispensing_safedon"), code).toEqual({});
    }
    const { glovesPerPack, maxRatePct } = SAFEDON_EG_EXAMPLE.dispensingSafedon;
    expect(moduleConfig("SAFEDON_EG", "dispensing_safedon")).toMatchObject({ glovesPerPack, maxRatePct });
  });

  it("resolves in a child template with the real module registry", () => {
    const base = {
      code: "STD_EG",
      name: TEMPLATES.STD_EG.name,
      scope: { productType: "examination", standard: "EN455" },
      unit: "pcs",
      sizes: TEMPLATES.STD_EG.sizes,
      modules: [{ key: "order_lots", include: true }],
    };
    const template = resolveTemplateOrThrow(
      {
        code: "SAFEDON_EG",
        name: TEMPLATES.SAFEDON_EG.name,
        extends: "STD_EG",
        scope: { productType: "examination", standard: "ASTM_D6319" },
        unit: "pcs",
        sizes: TEMPLATES.SAFEDON_EG.sizes,
        modules: [
          { key: "dispensing_safedon", include: true, config: seedConfig("SAFEDON_EG", "dispensing_safedon") as JsonObject },
        ],
      },
      { getBase: lookupFrom([{ definition: base, version: 1 }]), registry: MODULE_REGISTRY },
    );
    const resolved = template.modules.find((entry) => entry.key === "dispensing_safedon");
    expect(resolved).toMatchObject({
      title: "Glove Dispensing Inspection",
      config: moduleConfig("SAFEDON_EG", "dispensing_safedon"),
    });
    expect(resolved?.labels).toEqual(DISPENSING_SAFEDON_LABELS);
  });

  it("rejects impossible settings", () => {
    const base = DISPENSING_SAFEDON_DEFAULT_CONFIG;
    const invalid = [
      { ...base, defects: [] },
      { ...base, defects: [...base.defects, { code: "sticky", label: "Sticky again", hint: "" }] },
      { ...base, defects: [{ code: "No cuff", label: "No cuff", hint: "" }] },
      { ...base, defects: [{ code: "no_cuff", label: "", hint: "" }] },
      { ...base, defects: [{ code: "no_cuff", label: "No cuff" }] },
      { ...base, glovesPerPack: 0 },
      { ...base, glovesPerPack: 12.5 },
      { ...base, maxRatePct: -1 },
      { ...base, maxRatePct: 101 },
      { ...base, boxesPerSize: { default: 0 } },
      { ...base, boxesPerSize: { default: 13, bySize: { m: 8 } } },
      { ...base, maxRate: 5 },
    ];
    for (const config of invalid) expect(DispensingSafedonConfigSchema.safeParse(config).success, JSON.stringify(config)).toBe(false);
    expect(DispensingSafedonConfigSchema.safeParse({ ...base, maxRatePct: 2.5, boxesPerSize: { default: 13, bySize: { XS: 5 } } }).success).toBe(true);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(DispensingSafedonConfigSchema) as {
      properties: Record<string, { description?: string }>;
    };
    expect(schema.properties.defects.description).toContain("hint");
    expect(schema.properties.glovesPerPack.description).toContain("denominator");
    expect(schema.properties.maxRatePct.description).toContain("Maximum");
  });
});
