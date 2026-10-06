import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  dataKeys,
  defaultConfig,
  defaultLabels,
  INNER_UNITS as DICTIONARY_INNER_UNITS,
  labelOverrides,
  moduleConfig,
  moduleTitle,
  TEMPLATE_CODES,
} from "@/lib/coverage";
import { resolvedModule, resolveSeedTemplate } from "@/modules/header/__fixtures__/templates";
import {
  INNER_UNITS,
  PACKING_CONFIG_DEFAULT_CONFIG,
  PACKING_CONFIG_LABELS,
  PACKING_CONFIG_TITLE,
  PackingConfigConfigSchema,
} from "./config";
import { emptyPackingConfig, PackingConfigDataSchema } from "./schema";

describe("packing_config data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyPackingConfig()).toEqual({ glovesPerInner: null, innersPerCase: null, glovesPerCase: null, packingMode: null });
    expect(PackingConfigDataSchema.parse({ glovesPerInner: 200 })).toEqual({ ...emptyPackingConfig(), glovesPerInner: 200 });
  });

  it("holds the dictionary's entered keys", () => {
    expect(Object.keys(emptyPackingConfig()).sort()).toEqual([...dataKeys("packing_config", "entered")].sort());
  });

  it("stores the counts as whole numbers, never as text (6.2 rules 1 and 3)", () => {
    for (const field of ["glovesPerInner", "innersPerCase", "glovesPerCase"]) {
      expect(PackingConfigDataSchema.safeParse({ [field]: 125 }).success).toBe(true);
      for (const value of ["125", "1 25", "2,000", 12.5, -1, "2025-01-01"]) {
        expect(PackingConfigDataSchema.safeParse({ [field]: value }).success).toBe(false);
      }
    }
  });

  it("keeps the packing mode as written on site", () => {
    expect(PackingConfigDataSchema.parse({ packingMode: "10 dispenser boxes per carton" }).packingMode).toBe(
      "10 dispenser boxes per carton",
    );
  });

  it("rejects fields it does not have: the computed check and the reserved comment included (6.2 rule 2)", () => {
    for (const key of ["glovesPerCaseCheck", "innerUnit", "comment", "glovesPerPack"]) {
      expect(PackingConfigDataSchema.safeParse({ [key]: 1 }).success).toBe(false);
    }
  });
});

describe("packing_config config", () => {
  it("is an inner box without the packing mode by default: the dictionary's defaults", () => {
    expect(PackingConfigConfigSchema.parse(PACKING_CONFIG_DEFAULT_CONFIG)).toEqual(PACKING_CONFIG_DEFAULT_CONFIG);
    expect(PACKING_CONFIG_DEFAULT_CONFIG).toEqual(defaultConfig("packing_config"));
  });

  it("names the four inner units of BUILD_SPEC 6.1, as the dictionary does", () => {
    expect([...INNER_UNITS]).toEqual([...DICTIONARY_INNER_UNITS]);
    for (const innerUnit of INNER_UNITS) {
      expect(PackingConfigConfigSchema.safeParse({ ...PACKING_CONFIG_DEFAULT_CONFIG, innerUnit }).success).toBe(true);
    }
    expect(PackingConfigConfigSchema.safeParse({ ...PACKING_CONFIG_DEFAULT_CONFIG, innerUnit: "plastic pack" }).success).toBe(
      false,
    );
  });

  it("accepts every seed template's config, and resolves to it from the seeds", () => {
    for (const code of TEMPLATE_CODES) {
      const config = moduleConfig(code, "packing_config");
      expect(PackingConfigConfigSchema.parse(config)).toEqual(config);
      const resolved = resolvedModule(resolveSeedTemplate(code, ["packing_config"]), "packing_config");
      expect(resolved.config).toEqual(config);
      expect(resolved.title).toBe(moduleTitle(code, "packing_config"));
      expect(resolved.labels).toEqual({ ...PACKING_CONFIG_LABELS, ...labelOverrides(code, "packing_config") });
    }
    expect(moduleConfig("SAFEDON_EG", "packing_config")?.innerUnit).toBe("plastic_pack");
    expect(moduleConfig("STD_SG", "packing_config")?.innerUnit).toBe("pouch");
  });

  it("rejects a mistyped switch", () => {
    const fields = { packingMode: true, packingSite: true };
    expect(PackingConfigConfigSchema.safeParse({ ...PACKING_CONFIG_DEFAULT_CONFIG, fields }).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    const schema = z.toJSONSchema(PackingConfigConfigSchema) as { properties: Record<string, { description?: string }> };
    expect(schema.properties.innerUnit.description).toContain("plastic pack");
    expect(schema.properties.fields.description).toContain("Packing Mode");
  });
});

describe("packing_config wording", () => {
  it("defaults to STD_EG's wording, as the dictionary has it", () => {
    expect(PACKING_CONFIG_TITLE).toBe(moduleTitle("STD_EG", "packing_config"));
    expect({ ...PACKING_CONFIG_LABELS }).toEqual(defaultLabels("packing_config"));
    expect(labelOverrides("SAFEDON_EG", "packing_config")).toEqual({
      glovesPerInner: "# glove per plastic pack",
      innersPerCase: "# packs per case",
    });
  });
});
