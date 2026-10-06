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
  templateModuleKeys,
  type TemplateCode,
} from "@/lib/coverage";
import { lookupFrom, mergeConfig, resolveTemplateOrThrow, type JsonObject } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  DISPENSING_PACKING_DEFAULT_CONFIG,
  DISPENSING_PACKING_LABELS,
  DISPENSING_PACKING_TITLE,
  DispensingPackingConfigSchema,
} from "./config";
import { DispensingPackingDataSchema, emptyDispensingPacking, emptyPackingBox, isBlankPackingBox } from "./schema";

const BOX = { boxNo: 13, layeringPct: 90, dispensingPct: 92, stickiness: "A", note: null };

describe("dispensing_packing data", () => {
  it("starts empty and accepts a draft with anything missing, per size and per box", () => {
    expect(emptyDispensingPacking()).toEqual({ sizes: {} });
    expect(emptyPackingBox()).toEqual({ boxNo: null, layeringPct: null, dispensingPct: null, stickiness: null, note: null });
    expect(DispensingPackingDataSchema.parse({ sizes: { M: {} } })).toEqual({ sizes: { M: { boxes: [] } } });
    expect(DispensingPackingDataSchema.parse({ sizes: { M: { boxes: [{ layeringPct: 88 }] } } })).toEqual({
      sizes: { M: { boxes: [{ ...emptyPackingBox(), layeringPct: 88 }] } },
    });
    expect(DispensingPackingDataSchema.parse({ sizes: { M: { boxes: [BOX] }, XL: { boxes: [] } } }).sizes.M.boxes).toEqual([BOX]);
  });

  it("stores percentages and box numbers as numbers, never as text (6.2 rule 1)", () => {
    for (const text of ["88", "2 42", "88%", "0.88 "]) {
      expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ layeringPct: text }] } } }).success).toBe(false);
      expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ dispensingPct: text }] } } }).success).toBe(false);
    }
    for (const box of ["2336", 0, -1, 12.5]) {
      expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ boxNo: box }] } } }).success).toBe(false);
    }
    expect(DispensingPackingDataSchema.parse({ sizes: { M: { boxes: [{ boxNo: 2336, layeringPct: 88.5 }] } } }).sizes.M.boxes[0])
      .toMatchObject({ boxNo: 2336, layeringPct: 88.5 });
  });

  it("keeps a stickiness code as a code; which codes exist is the template's business (calc)", () => {
    for (const code of ["A", "B1", "C", "E"]) {
      expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ stickiness: code }] } } }).success).toBe(true);
    }
    for (const code of ["", "A B", " A", 1]) {
      expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ stickiness: code }] } } }).success).toBe(false);
    }
  });

  it("rejects fields it does not have, the reserved comment and computed values included (6.2 rule 2)", () => {
    expect(DispensingPackingDataSchema.safeParse({ comment: "x" }).success).toBe(false);
    expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [], layeringAverage: 88.3 } } }).success).toBe(false);
    expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ ...BOX, box: 13 }] } } }).success).toBe(false);
    expect(DispensingPackingDataSchema.safeParse({ sizes: { M: { boxes: [{ ...BOX, result: "pass" }] } } }).success).toBe(false);
  });

  it("holds exactly the dictionary's entered keys per box (docs/DATA_DICTIONARY.md)", () => {
    expect(Object.keys(emptyPackingBox()).sort()).toEqual(dataKeys("dispensing_packing", "entered").sort());
  });

  it("tells a blank row from a started one", () => {
    expect(isBlankPackingBox(emptyPackingBox())).toBe(true);
    expect(isBlankPackingBox({ ...emptyPackingBox(), note: "  " })).toBe(true);
    expect(isBlankPackingBox({ ...emptyPackingBox(), note: "torn" })).toBe(false);
    expect(isBlankPackingBox({ ...emptyPackingBox(), stickiness: "A" })).toBe(false);
  });
});

/** A template's config as lib/templates resolves it: the module defaults, then each seed from the root down. */
function resolvedConfig(code: TemplateCode): JsonObject {
  const chain: TemplateCode[] = [];
  for (let at: TemplateCode | null = code; at !== null; at = TEMPLATES[at].extends) chain.unshift(at);
  return chain.reduce<JsonObject>((config, at) => {
    const seed = seedConfig(at, "dispensing_packing") as JsonObject | undefined;
    return seed === undefined ? config : mergeConfig(config, seed);
  }, DISPENSING_PACKING_DEFAULT_CONFIG as unknown as JsonObject);
}

describe("dispensing_packing config", () => {
  it("defaults to BUILD_SPEC 6.1: 70% layering, 80% dispensing, A, B, B1 and C pass, D fails, 13 boxes", () => {
    expect(DispensingPackingConfigSchema.parse(DISPENSING_PACKING_DEFAULT_CONFIG)).toEqual(DISPENSING_PACKING_DEFAULT_CONFIG);
    expect(DISPENSING_PACKING_DEFAULT_CONFIG.stickinessCodes.map(({ code, pass }) => [code, pass])).toEqual([
      ["A", true],
      ["B", true],
      ["B1", true],
      ["C", true],
      ["D", false],
    ]);
  });

  it("is the data dictionary's: defaults, title and labels (STD_EG wording, [sic] fixed)", () => {
    expect(DISPENSING_PACKING_DEFAULT_CONFIG).toEqual(defaultConfig("dispensing_packing"));
    expect(DISPENSING_PACKING_TITLE).toBe(moduleTitle("STD_EG", "dispensing_packing"));
    expect(DISPENSING_PACKING_LABELS).toEqual(defaultLabels("dispensing_packing"));
    expect(DISPENSING_PACKING_DEFAULT_CONFIG.stickinessCodes[2].label).toBe(
      "A mix of non sticky to light stickiness at the bead",
    );
  });

  it("accepts every seed template's values (lib/coverage/templates.ts), merged as lib/templates merges them", () => {
    const using = TEMPLATE_CODES.filter((code) => templateModuleKeys(code).includes("dispensing_packing"));
    expect(using).toEqual(["STD_EG"]);
    for (const code of using) {
      const config = moduleConfig(code, "dispensing_packing");
      expect(DispensingPackingConfigSchema.parse(config), code).toEqual(config);
      expect(DispensingPackingConfigSchema.parse(resolvedConfig(code)), code).toEqual(config);
      expect(labelOverrides(code, "dispensing_packing"), code).toEqual({});
    }
    expect(moduleConfig("STD_EG", "dispensing_packing")?.boxesPerSize).toEqual({ default: 13, bySize: { XL: 5 } });
  });

  it("resolves in a template with the real module registry", () => {
    const template = resolveTemplateOrThrow(
      {
        code: "STD_EG",
        name: TEMPLATES.STD_EG.name,
        scope: { productType: "examination", standard: "EN455" },
        unit: "pcs",
        sizes: TEMPLATES.STD_EG.sizes,
        modules: [
          { key: "order_lots", include: true },
          { key: "dispensing_packing", include: true, config: seedConfig("STD_EG", "dispensing_packing") as JsonObject },
        ],
      },
      { getBase: lookupFrom([]), registry: MODULE_REGISTRY },
    );
    const resolved = template.modules.find((entry) => entry.key === "dispensing_packing");
    expect(resolved).toMatchObject({ title: "Glove Packing Check", config: moduleConfig("STD_EG", "dispensing_packing") });
    expect(resolved?.labels).toEqual(DISPENSING_PACKING_LABELS);
  });

  it("rejects impossible settings", () => {
    const base = DISPENSING_PACKING_DEFAULT_CONFIG;
    const invalid = [
      { ...base, minLayeringPct: 101 },
      { ...base, minDispensingPct: -1 },
      { ...base, stickinessCodes: [] },
      { ...base, stickinessCodes: [...base.stickinessCodes, { code: "A", label: "Again", pass: true }] },
      { ...base, stickinessCodes: [{ code: "A A", label: "Non sticky", pass: true }] },
      { ...base, stickinessCodes: [{ code: "A", label: " ", pass: true }] },
      { ...base, boxesPerSize: { default: 0 } },
      { ...base, boxesPerSize: { default: 13, bySize: { xl: 5 } } },
      { ...base, boxesPerSize: { default: 13, bySize: { XL: 2.5 } } },
      { ...base, boxesPerSize: { default: 13, perSize: { XL: 5 } } },
      { ...base, minLayering: 70 },
    ];
    for (const config of invalid) expect(DispensingPackingConfigSchema.safeParse(config).success, JSON.stringify(config)).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(DispensingPackingConfigSchema) as {
      properties: Record<string, { description?: string }>;
    };
    expect(schema.properties.minLayeringPct.description).toContain("layering");
    expect(schema.properties.stickinessCodes.description).toContain("pass");
    expect(schema.properties.boxesPerSize.description).toContain("sampling plan");
  });
});
