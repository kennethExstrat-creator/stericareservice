import { describe, expect, expectTypeOf, it } from "vitest";
import { UnitSchema } from "@/lib/schemas/common";
import { ALWAYS_ON_MODULE_KEYS, MODULE_KEYS, OPTIONAL_MODULE_KEYS, isModuleKey } from "@/lib/schemas/module-result";
import {
  captionLabel,
  dataField,
  dataKeys,
  defaultLabels,
  fieldLabel,
  groupLabelKey,
  MODULE_DICTIONARY,
  moduleSpec,
  moduleTitle,
  type ComputedKey,
  type EnteredKey,
  type SystemKey,
} from "./fields";
import { DEFECT_CLASSES, GLOVE_INFO_FIELDS, HEADER_FIELDS, LABELLING_LEVELS, LOADING_FIELDS, MEASURES, SAMPLING_COLUMNS } from "./keys";
import { TEMPLATE_CODES, type Nesting } from "./types";

const modules = MODULE_KEYS.map((key) => moduleSpec(key));

/** Values the app fills into captions (docs/DATA_DICTIONARY.md, Labels). */
const PLACEHOLDERS = new Set([
  "size",
  "codeLetters",
  "aql",
  "minLayeringPct",
  "minDispensingPct",
  "standardLabel",
]);

function duplicates(values: readonly string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) !== index);
}

describe("the dictionary covers the module library", () => {
  it("has one entry per ModuleKey, under its own key", () => {
    expect(Object.keys(MODULE_DICTIONARY).sort()).toEqual([...MODULE_KEYS].sort());
    for (const [key, spec] of Object.entries(MODULE_DICTIONARY)) {
      expect(isModuleKey(key)).toBe(true);
      expect(spec.key).toBe(key);
    }
  });

  it("marks report, optional and always-on modules as BUILD_SPEC 6.1 does", () => {
    for (const spec of modules) {
      expect(spec.kind, spec.key).toBe((OPTIONAL_MODULE_KEYS as readonly string[]).includes(spec.key) ? "optional" : "report");
      expect(spec.alwaysOn, spec.key).toBe((ALWAYS_ON_MODULE_KEYS as readonly string[]).includes(spec.key));
    }
  });

  it("gives every module a title, what it captures, its result and at least one field", () => {
    for (const spec of modules) {
      expect(spec.title, spec.key).not.toBe("");
      expect(spec.captures, spec.key).not.toBe("");
      expect(spec.result, spec.key).not.toBe("");
      expect(spec.data.length, spec.key).toBeGreaterThan(0);
    }
  });
});

describe("canonical keys", () => {
  it("has no duplicate data, caption or config keys within a module", () => {
    for (const spec of modules) {
      // Data fields and captions share ModuleConfig.labels, so they share one namespace.
      const labelKeys = [...spec.data.map((field) => field.key), ...spec.labels.map((label) => label.key)];
      expect(duplicates(labelKeys), spec.key).toEqual([]);
      expect(duplicates(spec.config.map((field) => field.key)), spec.key).toEqual([]);
      expect(labelKeys, spec.key).not.toContain("title");
    }
  });

  it("uses camelCase keys", () => {
    for (const spec of modules) {
      for (const key of [...spec.data, ...spec.config, ...spec.labels].map((item) => item.key)) {
        expect(key, `${spec.key}.${key}`).toMatch(/^[a-z][a-zA-Z0-9]*$/);
      }
    }
  });

  it("keys class and level wording apart from data and caption keys (one ModuleConfig.labels namespace)", () => {
    for (const spec of modules) {
      const groupKeys = spec.data.flatMap((field) =>
        Object.keys(field.groupLabels ?? {}).map((group) => groupLabelKey(field.key, group)),
      );
      const all = [...spec.data.map((field) => field.key), ...spec.labels.map((label) => label.key), ...groupKeys];
      expect(duplicates(all), spec.key).toEqual([]);
      expect(Object.keys(defaultLabels(spec.key)).sort(), spec.key).toEqual([...all].sort());
      for (const key of groupKeys) expect(key, spec.key).toMatch(/^[a-z][a-zA-Z0-9]*$/);
    }
    expect(groupLabelKey("total", "major")).toBe("majorTotal");
    expect(defaultLabels("visual")).toMatchObject({
      majorTotal: 'Total number of "Major Defects" found',
      criticalResult: "Disposition - Visual Critical (Passed / Failed)",
      minorCounts: "Minor Defects",
    });
    expect(defaultLabels("labeling")).toMatchObject({ cartonResult: "Disposition - Carton Box (Passed / Failed)" });
  });

  it("types the keys by entry, so a module's data never holds a computed key", () => {
    expectTypeOf<EnteredKey<"order_lots">>().toEqualTypeOf<"qtyCases" | "lotNumbers" | "packingSite">();
    expectTypeOf<ComputedKey<"order_lots">>().toEqualTypeOf<"lotSizeGloves" | "totalCartons" | "totalGloves">();
    expectTypeOf<SystemKey<"header">>().toEqualTypeOf<"inspector">();
    expectTypeOf<SystemKey<"order_lots">>().toEqualTypeOf<never>();
    expect(dataKeys("order_lots", "entered")).toEqual(["qtyCases", "lotNumbers", "packingSite"]);
    expect(dataKeys("order_lots", "computed")).toEqual(["lotSizeGloves", "totalCartons", "totalGloves"]);
    expect(dataKeys("header", "system")).toEqual(["inspector"]);
    for (const spec of modules) {
      const keys = (["entered", "system", "computed"] as const).flatMap((entry) => dataKeys(spec.key, entry));
      expect(keys.sort(), spec.key).toEqual(spec.data.map((field) => field.key).sort());
    }
  });

  it("matches the closed key lists in keys.ts", () => {
    const keysOf = (module: Parameters<typeof moduleSpec>[0], filter?: (per: readonly Nesting[]) => boolean) =>
      moduleSpec(module)
        .data.filter((field) => field.entry !== "computed" && (filter ? filter(field.per) : true))
        .map((field) => field.key);
    expect(keysOf("dimensions", (per) => per.includes("glove"))).toEqual([...MEASURES]);
    expect(keysOf("sampling_plan")).toEqual([...SAMPLING_COLUMNS]);
    expect(moduleSpec("header").data.map((field) => field.key)).toEqual([...HEADER_FIELDS]);
    expect(moduleSpec("glove_info").data.map((field) => field.key)).toEqual([...GLOVE_INFO_FIELDS]);
    expect(keysOf("loading")).toEqual([...LOADING_FIELDS]);
  });
});

describe("field definitions", () => {
  const fields = modules.flatMap((spec) => spec.data.map((field) => ({ module: spec.key, field })));

  it("uses the canonical units only (rule 4.2.5)", () => {
    for (const { module, field } of fields) {
      if (field.unit !== undefined) expect(UnitSchema.safeParse(field.unit).success, `${module}.${field.key}`).toBe(true);
    }
  });

  it("gives every measurement a unit", () => {
    for (const { module, field } of fields) {
      if (field.type === "decimal" || field.type === "decimal_list") {
        expect(field.unit, `${module}.${field.key}`).toBeDefined();
      }
    }
  });

  it("computes totals, averages, medians, rates, code letters, limits and results, never types them (rule 6.2.2)", () => {
    const computedName =
      /^total|^(average|median|statistic|codeLetter|accept|reject|result|ratePct)$|Average$|Result$|RatePct$|Summary$|Check$/;
    // The inspector's own decision, next to the computed suggestion (BUILD_SPEC 6.1 conclusion).
    const decisions = new Set(["conclusion.finalResult"]);
    const matched: string[] = [];
    for (const { module, field } of fields) {
      const name = `${module}.${field.key}`;
      if (!computedName.test(field.key) || decisions.has(name)) continue;
      matched.push(name);
      expect(field.entry, name).toBe("computed");
    }
    expect(matched).toEqual(expect.arrayContaining(["watertight.totalDefects", "dispensing_safedon.ratePct", "visual.accept"]));
  });

  it("lists on each module every 6.2 rule its fields cite", () => {
    for (const spec of modules) {
      const cited = new Set(spec.data.flatMap((field) => field.rules ?? []));
      for (const rule of cited) expect(spec.rules, `${spec.key}: a field cites rule ${rule}`).toContain(rule);
    }
  });

  it("explains every computed field and cites rule 6.2.2 exactly on computed fields", () => {
    for (const { module, field } of fields) {
      const name = `${module}.${field.key}`;
      if (field.entry === "computed") {
        expect(field.formula, name).toBeTruthy();
        expect(field.rules ?? [], name).toContain(2);
      } else {
        expect(field.formula, name).toBeUndefined();
        expect(field.rules ?? [], name).not.toContain(2);
      }
    }
  });

  it("records the inspector automatically (rule 6.2.11)", () => {
    expect(dataField("header", "inspector")?.entry).toBe("system");
    expect(dataField("conclusion", "inspector")?.entry).toBe("system");
  });

  it("nests by hand, class, level, glove, box and item only where the module has them", () => {
    const allowed: Partial<Record<Nesting, readonly string[]>> = {
      hand: ["watertight", "visual"],
      class: ["visual"],
      level: ["labeling"],
      glove: ["dimensions"],
      box: ["dispensing_packing", "dispensing_safedon"],
      item: ["documents"],
    };
    for (const { module, field } of fields) {
      for (const nesting of field.per) {
        if (nesting !== "size") expect(allowed[nesting], `${module}.${field.key} per ${nesting}`).toContain(module);
      }
      if (field.per.includes("hand")) expect(field.per[0], `${module}.${field.key}`).toBe("size");
    }
  });

  it("keys group labels by the module's classes or levels", () => {
    for (const { module, field } of fields) {
      for (const group of Object.keys(field.groupLabels ?? {})) {
        expect(moduleSpec(module).groups ?? [], `${module}.${field.key}`).toContain(group);
      }
    }
  });

  it("names the source of every field BUILD_SPEC 6.1 does not list", () => {
    const additions = fields.filter(({ field }) => field.addition).map(({ module, field }) => `${module}.${field.key}`);
    expect(additions.sort()).toEqual([
      "dispensing_packing.note",
      "labeling.boxNos",
      "packing_config.packingMode",
      "watertight.otherDescription",
    ]);
  });
});

describe("labels", () => {
  it("defaults to STD_EG's wording: no STD_EG override anywhere", () => {
    for (const spec of modules) {
      expect(spec.titles?.STD_EG, spec.key).toBeUndefined();
      for (const item of [...spec.data, ...spec.labels]) {
        expect(item.labels?.STD_EG, `${spec.key}.${item.key}`).toBeUndefined();
      }
      for (const field of spec.data) {
        for (const group of Object.values(field.groupLabels ?? {})) expect(group.labels?.STD_EG).toBeUndefined();
      }
    }
  });

  it("only overrides a label with different wording", () => {
    for (const spec of modules) {
      for (const item of [...spec.data, ...spec.labels]) {
        for (const value of Object.values(item.labels ?? {})) expect(value, `${spec.key}.${item.key}`).not.toBe(item.label);
      }
      for (const value of Object.values(spec.titles ?? {})) expect(value, spec.key).not.toBe(spec.title);
    }
  });

  it("uses only known placeholders in captions", () => {
    for (const spec of modules) {
      for (const caption of spec.labels) {
        const texts = [caption.label, ...Object.values(caption.labels ?? {})];
        for (const text of texts) {
          for (const [, name] of text.matchAll(/\{(\w+)\}/g)) {
            expect(PLACEHOLDERS.has(name), `${spec.key}.${caption.key}: {${name}}`).toBe(true);
          }
        }
      }
    }
  });

  it("resolves titles, field labels and captions per template", () => {
    expect(moduleTitle("STD_EG", "watertight")).toBe("Freedom from Holes by watertight test");
    expect(moduleTitle("STD_SG", "watertight")).toBe("Watertight Inspection");
    expect(fieldLabel("SAFEDON_EG", "header", "poNo")).toBe("PO Number");
    expect(fieldLabel("STD_EG", "header", "poNo")).toBe("PO / SO Number");
    expect(fieldLabel("STD_EG", "visual", "result", "critical")).toBe("Disposition - Visual Critical (Passed / Failed)");
    expect(fieldLabel("STD_SG", "visual", "total", "major")).toBe("Total Major");
    expect(fieldLabel("STD_EG", "header", "nope")).toBeUndefined();
    expect(captionLabel("SAFEDON_EG", "labeling", "innerLevel")).toBe("Inner Boxes/Packs");
    expect(captionLabel("STD_EG", "labeling", "title")).toBe("Packaging Labeling Inspection");
    for (const template of TEMPLATE_CODES) expect(captionLabel(template, "header", "nope")).toBeUndefined();
  });
});

describe("config defaults (BUILD_SPEC 6.1 and 7)", () => {
  const defaultOf = (module: Parameters<typeof moduleSpec>[0], key: string) =>
    moduleSpec(module).config.find((field) => field.key === key)?.default;

  it("gives every config field a default, so a module's defaultConfig is complete", () => {
    for (const spec of modules) {
      for (const config of spec.config) expect(config.default, `${spec.key}.${config.key}`).not.toBeUndefined();
    }
  });

  it("carries the defaults BUILD_SPEC gives", () => {
    expect(defaultOf("watertight", "aql")).toBe(1.5);
    expect(defaultOf("watertight", "handSplit")).toBe(false);
    const classes = defaultOf("visual", "classes") as Record<string, { include: boolean; aql: number; defects: unknown[] }>;
    expect(DEFECT_CLASSES.map((cls) => [cls, classes[cls].include, classes[cls].aql, classes[cls].defects.length > 0])).toEqual([
      ["critical", true, 0, true],
      ["major", true, 2.5, true],
      ["minor", true, 4, true],
    ]);
    expect(defaultOf("force_at_break", "specMin")).toBe(6);
    expect(defaultOf("force_at_break", "n")).toBe(13);
    expect(defaultOf("tensile", "tensileMin")).toBe(14);
    expect(defaultOf("tensile", "elongationMin")).toBe(500);
    expect(defaultOf("weight", "warnThresholdPct")).toBe(10);
    expect(defaultOf("dimensions", "rows")).toBe(13);
    expect(defaultOf("dispensing_packing", "minLayeringPct")).toBe(70);
    expect(defaultOf("dispensing_packing", "minDispensingPct")).toBe(80);
    expect(defaultOf("dispensing_safedon", "glovesPerPack")).toBe(125);
    expect(defaultOf("dispensing_safedon", "maxRatePct")).toBe(5);
    const levels = defaultOf("labeling", "levels") as Record<string, { include: boolean; n: number; checks: unknown[] }>;
    expect(LABELLING_LEVELS.map((level) => [level, levels[level].include, levels[level].n, levels[level].checks.length > 0])).toEqual([
      ["inner", true, 3, true],
      ["carton", true, 1, true],
    ]);
    const codes = defaultOf("dispensing_packing", "stickinessCodes") as { code: string; label: string; pass: boolean }[];
    expect(codes.map(({ code, pass }) => `${code}:${pass}`)).toEqual(["A:true", "B:true", "B1:true", "C:true", "D:false"]);
    for (const code of codes) expect(code.label, code.code).not.toBe("");
  });

  it("switches every header and glove information field on by default", () => {
    expect(Object.keys(defaultOf("header", "fields") as object)).toEqual([...HEADER_FIELDS]);
    expect(Object.keys(defaultOf("glove_info", "fields") as object)).toEqual([...GLOVE_INFO_FIELDS]);
    expect(Object.keys(defaultOf("sampling_plan", "columns") as object)).toEqual([...SAMPLING_COLUMNS]);
  });

  it("has no config for carton_sampling and conclusion (BUILD_SPEC: none)", () => {
    expect(moduleSpec("carton_sampling").config).toEqual([]);
    expect(moduleSpec("conclusion").config).toEqual([]);
  });
});
