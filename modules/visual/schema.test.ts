import { describe, expect, it } from "vitest";
import { z } from "zod";
import { moduleConfig, TEMPLATE_CODES } from "@/lib/coverage";
import { VISUAL_DEFAULT_CONFIG, VisualConfigSchema, type VisualConfig } from "./config";
import { emptyVisual, emptyVisualSize, VisualDataSchema, VisualSizeSchema } from "./schema";

const EMPTY_CLASS = { inspected: null, counts: {}, unmapped: [] };

describe("visual data", () => {
  it("starts empty and accepts a draft with anything missing", () => {
    expect(emptyVisual()).toEqual({ sizes: {} });
    expect(emptyVisualSize()).toEqual({ critical: EMPTY_CLASS, major: EMPTY_CLASS, minor: EMPTY_CLASS });
    expect(VisualDataSchema.parse({ sizes: { M: { major: { counts: { thin_spot: 5 } } } } })).toEqual({
      sizes: { M: { critical: EMPTY_CLASS, major: { ...EMPTY_CLASS, counts: { thin_spot: 5 } }, minor: EMPTY_CLASS } },
    });
  });

  it("keeps defects per hand and class under R and L, the gloves inspected per class on the size", () => {
    const parsed = VisualSizeSchema.parse({ major: { inspected: 125 }, R: { major: { counts: { stain: 1 } } } });
    expect(parsed.major.inspected).toBe(125);
    expect(parsed.R).toEqual({
      critical: { counts: {}, unmapped: [] },
      major: { counts: { stain: 1 }, unmapped: [] },
      minor: { counts: {}, unmapped: [] },
    });
    expect(parsed.L).toBeUndefined();
  });

  it("keeps the same code apart in two classes: severity is the class", () => {
    const parsed = VisualSizeSchema.parse({ major: { counts: { bead_defective: 1 } }, minor: { counts: { bead_defective: 3 } } });
    expect([parsed.major.counts.bead_defective, parsed.minor.counts.bead_defective]).toEqual([1, 3]);
  });

  it("stores counts as whole numbers, never as text or a date (6.2 rules 1 and 3)", () => {
    for (const text of ["0/500", "8/500", "Jan-80", "2 42", "5"]) {
      expect(VisualSizeSchema.safeParse({ major: { inspected: text } }).success).toBe(false);
      expect(VisualSizeSchema.safeParse({ major: { counts: { thin_spot: text } } }).success).toBe(false);
    }
    for (const count of [-1, 0.5]) {
      expect(VisualSizeSchema.safeParse({ critical: { inspected: count } }).success).toBe(false);
      expect(VisualSizeSchema.safeParse({ critical: { counts: { embedded_insect: count } } }).success).toBe(false);
    }
  });

  it("never stores what is computed (6.2 rule 2), and rejects keys it does not have", () => {
    for (const key of ["total", "accept", "reject", "codeLetter", "result"]) {
      expect(VisualSizeSchema.safeParse({ major: { inspected: 500, [key]: 1 } }).success).toBe(false);
    }
    expect(VisualSizeSchema.safeParse({ cosmetic: { inspected: 500 } }).success).toBe(false);
    expect(VisualSizeSchema.safeParse({ major: { counts: { "Thin spot": 1 } } }).success).toBe(false);
    expect(VisualDataSchema.safeParse({ sizes: {}, comment: "x" }).success).toBe(false);
  });

  it("keeps a one-off defect with its own words, which must not be blank", () => {
    expect(VisualSizeSchema.parse({ minor: { unmapped: [{ label: "Faint print", count: 1 }] } }).minor.unmapped).toEqual([
      { label: "Faint print", count: 1 },
    ]);
    expect(VisualSizeSchema.safeParse({ minor: { unmapped: [{ label: "", count: 1 }] } }).success).toBe(false);
  });
});

describe("visual config", () => {
  it("defaults to every class on with STD_EG's lists, critical at AQL 0 and the context's AQLs otherwise", () => {
    const config = VisualConfigSchema.parse(VISUAL_DEFAULT_CONFIG);
    expect(config.handSplit).toBe(false);
    expect(config.classes.critical).toMatchObject({ include: true, aql: 0 });
    expect(config.classes.major).toMatchObject({ include: true, aql: null });
    expect(config.classes.minor).toMatchObject({ include: true, aql: null });
    expect(config.classes.critical.defects.map((defect) => defect.code)).toEqual(["embedded_insect", "embedded_metal"]);
    expect(config.classes.major.defects).toHaveLength(11);
    expect(config.classes.major.defects.slice(-2).map((defect) => defect.code)).toEqual(["skin_visual", "flow_mark"]);
    const stdEg = moduleConfig("STD_EG", "visual");
    for (const cls of ["critical", "major", "minor"] as const) expect(config.classes[cls].defects, cls).toEqual(stdEg?.classes[cls].defects);
    expect(config.classes.minor.defects).toContainEqual({ code: "bead_defective", label: "Defective Beads" });
  });

  it.each(TEMPLATE_CODES)("accepts the %s template's values (lib/coverage)", (code) => {
    const config = moduleConfig(code, "visual");
    expect(config).toBeDefined();
    expect(VisualConfigSchema.parse(config)).toEqual(config);
  });

  it("keeps critical at AQL 0 and takes only ISO 2859-1 AQLs for the other classes", () => {
    const withClass = (cls: "critical" | "major", aql: unknown) => ({
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, [cls]: { ...VISUAL_DEFAULT_CONFIG.classes[cls], aql } },
    });
    expect(VisualConfigSchema.safeParse(withClass("critical", 0.65)).success).toBe(false);
    expect(VisualConfigSchema.safeParse(withClass("critical", null)).success).toBe(false);
    for (const aql of [0.65, 1.5, 6.5, null]) expect(VisualConfigSchema.safeParse(withClass("major", aql)).success).toBe(true);
    for (const aql of [3, -2.5, "2.5"]) expect(VisualConfigSchema.safeParse(withClass("major", aql)).success).toBe(false);
  });

  it("lists a code once per class, and switches classes on and off", () => {
    const major = VISUAL_DEFAULT_CONFIG.classes.major;
    const twice: VisualConfig = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, major: { ...major, defects: [...major.defects, major.defects[0]] } },
    };
    expect(VisualConfigSchema.safeParse(twice).success).toBe(false);
    const noMinor = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, minor: { ...VISUAL_DEFAULT_CONFIG.classes.minor, include: false } },
    };
    expect(VisualConfigSchema.safeParse(noMinor).success).toBe(true);
    const noCosmetic = { ...VISUAL_DEFAULT_CONFIG, classes: { ...VISUAL_DEFAULT_CONFIG.classes, cosmetic: major } };
    expect(VisualConfigSchema.safeParse(noCosmetic).success).toBe(false);
  });

  it("becomes JSON Schema with descriptions, for the template editor's form", () => {
    type Node = { description?: string; properties?: Record<string, Node> };
    const schema = z.toJSONSchema(VisualConfigSchema) as Node;
    expect(schema.properties?.handSplit.description).toContain("right and left");
    expect(schema.properties?.classes.description).toContain("Severity");
    const major = schema.properties?.classes.properties?.major;
    expect(major?.properties?.aql.description).toContain("AQL");
    expect(major?.properties?.defects.description).toContain("defect code");
  });
});
