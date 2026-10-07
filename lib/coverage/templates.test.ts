import { describe, expect, it } from "vitest";
import { ALWAYS_ON_MODULE_KEYS, isModuleKey, MODULE_KEYS, type ModuleKey } from "@/lib/schemas/module-result";
import { LABEL_KEY_PATTERN } from "@/lib/schemas/template";
import { formatSpec } from "@/lib/stats/spec";
import { defaultLabels, DIMENSION_DECIMALS, fieldLabel, moduleSpec } from "./fields";
import { DEFECT_CLASSES, LABELLING_CHECKS, MEASURES } from "./keys";
import { configEqual, droppedKeys, mergeConfig, type ConfigObject } from "./merge";
import {
  defaultConfig,
  fieldShown,
  labelOverrides,
  moduleConfig,
  SAFEDON_EG_DIMENSION_SPECS,
  seedConfig,
  seedModuleConfigs,
  templateModuleKeys,
  templateOfSource,
  TEMPLATES,
  type DimensionSpecRow,
} from "./templates";
import { SOURCE_IDS, TEMPLATE_CODES, TEMPLATE_PROPERTIES, type TemplateCode } from "./types";

/** phase2/framework, lib/schemas/template.ts: FIELD_KEY_PATTERN (a custom module's Field keys). */
const FRAMEWORK_FIELD_KEY = /^[A-Za-z][A-Za-z0-9_]*$/;
/** phase2/framework, lib/schemas/template.ts: CUSTOM_KEY_PATTERN. */
const FRAMEWORK_CUSTOM_KEY = /^[a-z][a-z0-9_]*$/;

/** BUILD_SPEC 11, "Modules on (in order)". */
const BUILD_SPEC_11_ORDER: Readonly<Record<(typeof TEMPLATE_CODES)[number], readonly ModuleKey[]>> = {
  STD_EG: [
    "header",
    "glove_info",
    "order_lots",
    "packing_config",
    "sampling_plan",
    "carton_sampling",
    "dimensions",
    "force_at_break",
    "weight",
    "watertight",
    "visual",
    "dispensing_packing",
    "labeling",
    "conclusion",
  ],
  // "as STD_EG, with ... tensile instead of force_at_break; ... dispensing_safedon instead of dispensing_packing"
  SAFEDON_EG: [
    "header",
    "glove_info",
    "order_lots",
    "packing_config",
    "sampling_plan",
    "carton_sampling",
    "dimensions",
    "tensile",
    "weight",
    "watertight",
    "visual",
    "dispensing_safedon",
    "labeling",
    "conclusion",
  ],
  STD_SG: [
    "header",
    "order_lots",
    "packing_config",
    "sampling_plan",
    "watertight",
    "visual",
    "dimensions",
    "dye_leak",
    "conclusion",
  ],
};

/** Specs as each report prints them, size by size. */
function printedSpecs(rows: readonly DimensionSpecRow[] | undefined) {
  return Object.fromEntries(
    (rows ?? []).map(({ size, specs }) => [
      size,
      Object.fromEntries(Object.entries(specs).map(([measure, spec]) => [measure, spec ? formatSpec(spec) : null])),
    ]),
  );
}

/** The template's chain from the root down: [STD_EG, SAFEDON_EG]. */
function chainOf(code: TemplateCode): TemplateCode[] {
  const chain: TemplateCode[] = [];
  for (let at: TemplateCode | null = code; at !== null; at = TEMPLATES[at].extends) chain.unshift(at);
  return chain;
}

type SeedOf = (code: TemplateCode, key: ModuleKey) => ConfigObject | undefined;

/** What lib/templates resolves: the module's defaults, then each template's seed from the root down. */
function resolveConfig(code: TemplateCode, key: ModuleKey, seedOf: SeedOf): ConfigObject {
  return chainOf(code).reduce((config, at) => {
    const seed = seedOf(at, key);
    return seed === undefined ? config : mergeConfig(config, seed);
  }, defaultConfig(key) as ConfigObject);
}

/** A seed that writes every top-level config key that differs from the base, with its whole value. */
const topLevelSeed: SeedOf = (code, key) => {
  const own = moduleConfig(code, key) as ConfigObject | undefined;
  const parent = TEMPLATES[code].extends;
  const base = parent === null ? undefined : (moduleConfig(parent, key) as ConfigObject | undefined);
  if (own === undefined || base === undefined) return own;
  return Object.fromEntries(Object.entries(own).filter(([name, value]) => !configEqual(base[name], value)));
};

describe("module order (BUILD_SPEC 11)", () => {
  it.each(TEMPLATE_CODES)("%s switches on the modules of BUILD_SPEC 11, in its order", (code) => {
    expect(templateModuleKeys(code)).toEqual(BUILD_SPEC_11_ORDER[code]);
  });

  it("uses known module keys, once each, with header and conclusion always on", () => {
    for (const code of TEMPLATE_CODES) {
      const keys = templateModuleKeys(code);
      for (const key of keys) expect(isModuleKey(key), `${code} ${key}`).toBe(true);
      expect(new Set(keys).size, code).toBe(keys.length);
      for (const key of ALWAYS_ON_MODULE_KEYS) expect(keys, code).toContain(key);
    }
  });

  it("builds SAFEDON_EG from STD_EG, swapping only the physical test and the dispensing check", () => {
    expect(TEMPLATES.SAFEDON_EG.extends).toBe("STD_EG");
    const swapped = templateModuleKeys("STD_EG").map((key) =>
      key === "force_at_break" ? "tensile" : key === "dispensing_packing" ? "dispensing_safedon" : key,
    );
    expect(templateModuleKeys("SAFEDON_EG")).toEqual(swapped);
  });
});

describe("config values use the dictionary's keys", () => {
  it("sets only config keys fields.ts defines", () => {
    for (const code of TEMPLATE_CODES) {
      for (const { key, config } of TEMPLATES[code].modules) {
        const defined = moduleSpec(key).config.map((field) => field.key);
        expect(Object.keys(config).sort(), `${code} ${key}`).toEqual([...defined].sort());
      }
    }
  });

  it("points every 'to confirm' at a module config, a module or a template property", () => {
    for (const code of TEMPLATE_CODES) {
      for (const { path } of TEMPLATES[code].toConfirm) {
        const dot = path.indexOf(".");
        const head = dot === -1 ? path : path.slice(0, dot);
        const rest = dot === -1 ? undefined : path.slice(dot + 1);
        if (isModuleKey(head) && rest !== undefined) {
          expect(templateModuleKeys(code), `${code} ${path}`).toContain(head);
          expect(moduleSpec(head).config.map((field) => field.key), `${code} ${path}`).toContain(rest);
        } else {
          expect(["modules", "scope.standard", "scope.clientScoped", ...TEMPLATE_PROPERTIES], `${code} ${path}`).toContain(
            path,
          );
        }
      }
    }
  });
});

describe("what the reports fix", () => {
  it("covers sizes XS to XL in pieces for the examination templates, and normalised surgical sizes", () => {
    for (const code of ["STD_EG", "SAFEDON_EG"] as const) {
      expect(TEMPLATES[code].sizes.map((size) => size.value)).toEqual(["XS", "S", "M", "L", "XL"]);
      expect(TEMPLATES[code].unit).toBe("pcs");
    }
    for (const { value } of TEMPLATES.STD_SG.sizes) expect(value).toMatch(/^\d+\.\d$/);
  });

  it("names the inner unit as each report does", () => {
    expect(moduleConfig("STD_EG", "packing_config")?.innerUnit).toBe("inner_box");
    expect(moduleConfig("SAFEDON_EG", "packing_config")?.innerUnit).toBe("plastic_pack");
    expect(moduleConfig("STD_SG", "packing_config")?.innerUnit).toBe("pouch");
  });

  it("words the packing counts by each template's inner unit, as the export names it", () => {
    // What is typed per inner unit is what the export and the AI report say it is per (config.innerUnit).
    const named: Readonly<Record<string, RegExp>> = {
      inner_box: /\binners?\b/,
      plastic_pack: /\bpacks?\b/,
      dispenser_box: /\bdispenser/,
      pouch: /\bpouch(es)?\b/,
    };
    for (const template of TEMPLATE_CODES) {
      const unit = moduleConfig(template, "packing_config")?.innerUnit;
      if (unit === undefined) continue;
      for (const key of ["glovesPerInner", "innersPerCase"]) {
        expect(fieldLabel(template, "packing_config", key), `${template} ${key}`).toMatch(named[unit]);
      }
    }
    expect(fieldLabel("STD_SG", "packing_config", "glovesPerInner")).toBe("# gloves per pouch");
    expect(fieldLabel("STD_SG", "packing_config", "innersPerCase")).toBe("# pouches per case");
    expect(labelOverrides("STD_SG", "packing_config")).toMatchObject({
      glovesPerInner: "# gloves per pouch",
      innersPerCase: "# pouches per case",
    });
  });

  it("uses the median for STD_EG and the average for SAFEDON_EG", () => {
    expect(moduleConfig("STD_EG", "dimensions")?.statistic).toBe("median");
    expect(moduleConfig("SAFEDON_EG", "dimensions")?.statistic).toBe("average");
  });

  it("measures cuff thickness in STD_EG only", () => {
    expect(moduleConfig("STD_EG", "dimensions")?.measures).toEqual([
      "length",
      "width",
      "fingerThickness",
      "palmThickness",
      "cuffThickness",
    ]);
    expect(moduleConfig("SAFEDON_EG", "dimensions")?.measures).toEqual(["length", "width", "fingerThickness", "palmThickness"]);
  });

  it("prints the STD_EG dimension specs as the report does", () => {
    const na = { fingerThickness: "NA", palmThickness: "NA", cuffThickness: "NA" };
    expect(printedSpecs(moduleConfig("STD_EG", "dimensions")?.specs)).toEqual({
      XS: { length: "≥ 240", width: "≤ 80", ...na },
      S: { length: "≥ 240", width: "80 ± 10", ...na },
      M: { length: "≥ 240", width: "95 ± 10", ...na },
      L: { length: "≥ 240", width: "110 ± 10", ...na },
      XL: { length: "≥ 240", width: "≥ 110", ...na },
    });
  });

  it("prints the SAFEDON_EG dimension specs as the report does", () => {
    const thickness = { fingerThickness: "0.18 ± 0.04", palmThickness: "0.14 ± 0.04" };
    expect(printedSpecs(moduleConfig("SAFEDON_EG", "dimensions")?.specs)).toEqual({
      XS: { length: "≥ 230", width: "76 ± 4", ...thickness },
      S: { length: "≥ 230", width: "86 ± 4", ...thickness },
      M: { length: "≥ 230", width: "98 ± 4", ...thickness },
      L: { length: "≥ 230", width: "107 ± 4", ...thickness },
    });
    expect(moduleConfig("SAFEDON_EG", "weight")?.specs.map(({ size, spec }) => `${size} ${formatSpec(spec)}`)).toEqual([
      "XS NA",
      "S NA",
      "M NA",
      "L NA",
    ]);
  });

  it("takes provisional dimension values for STD_SG, each listed to confirm", () => {
    expect(moduleConfig("STD_SG", "dimensions")).toEqual({
      measures: [...MEASURES],
      statistic: "median",
      specs: [],
      decimals: DIMENSION_DECIMALS,
      rows: 13,
    });
    expect(TEMPLATES.STD_SG.toConfirm.map((item) => item.path)).toEqual(
      expect.arrayContaining(["dimensions.measures", "dimensions.statistic", "dimensions.specs", "dimensions.decimals"]),
    );
  });

  it("shows the statistic with the decimals the reports print", () => {
    expect(moduleConfig("STD_EG", "dimensions")?.decimals).toEqual({
      length: 0,
      width: 0,
      fingerThickness: 2,
      palmThickness: 2,
      cuffThickness: 2,
    });
    expect(moduleConfig("STD_EG", "force_at_break")?.decimals).toBe(3);
    expect(moduleConfig("STD_EG", "weight")?.decimals).toBe(2);
    expect(moduleConfig("SAFEDON_EG", "tensile")?.decimals).toEqual({ tensileStrength: 2, elongationAtBreak: 0 });
  });

  it("weighs 13 gloves in STD_EG with no spec, one value with NA in SAFEDON_EG, warning beyond 10%", () => {
    expect(moduleConfig("STD_EG", "weight")).toMatchObject({ n: 13, specs: [], warnThresholdPct: 10 });
    expect(moduleConfig("SAFEDON_EG", "weight")).toMatchObject({ n: 1, warnThresholdPct: 10 });
  });

  it("sets force at break ≥ 6 N on 13 gloves, and tensile ≥ 14 MPa and elongation ≥ 500% to ASTM D6319", () => {
    expect(moduleConfig("STD_EG", "force_at_break")).toMatchObject({ n: 13, specMin: 6, standardLabel: null });
    expect(moduleConfig("SAFEDON_EG", "tensile")).toMatchObject({
      tensileMin: 14,
      elongationMin: 500,
      standardLabel: "ASTM D6319",
    });
  });

  it("uses AQL 1.5 for watertight and 0 / 2.5 / 4.0 for critical / major / minor in every template", () => {
    for (const code of TEMPLATE_CODES) {
      expect(moduleConfig(code, "watertight")?.aql, code).toBe(1.5);
      const classes = moduleConfig(code, "visual")?.classes;
      expect(DEFECT_CLASSES.map((cls) => [cls, classes?.[cls].include, classes?.[cls].aql]), code).toEqual([
        ["critical", true, 0],
        ["major", true, 2.5],
        ["minor", true, 4],
      ]);
    }
  });

  it("splits hands in the surgical template only", () => {
    for (const code of TEMPLATE_CODES) {
      const surgical = code === "STD_SG";
      expect(moduleConfig(code, "watertight")?.handSplit, code).toBe(surgical);
      expect(moduleConfig(code, "visual")?.handSplit, code).toBe(surgical);
    }
  });

  it("checks dispensing at 70% layering and 80% dispensing on 13 boxes, 5 in the XL block, codes A to C passing", () => {
    expect(moduleConfig("STD_EG", "dispensing_packing")).toMatchObject({
      minLayeringPct: 70,
      minDispensingPct: 80,
      boxesPerSize: { default: 13, bySize: { XL: 5 } },
    });
    expect(
      moduleConfig("STD_EG", "dispensing_packing")?.stickinessCodes.map(({ code, pass }) => `${code}:${pass ? "pass" : "fail"}`),
    ).toEqual(["A:pass", "B:pass", "B1:pass", "C:pass", "D:fail"]);
  });

  it("checks Safedon dispensing at 5% or less on packs of 125, 13 boxes per size", () => {
    const config = moduleConfig("SAFEDON_EG", "dispensing_safedon");
    expect(config).toMatchObject({ glovesPerPack: 125, maxRatePct: 5, boxesPerSize: { default: 13 } });
    expect(config?.defects.map((defect) => defect.code)).toEqual([
      "no_cuff",
      "finger_out",
      "multiple_out",
      "stuck",
      "sticky",
      "faulty_cuff",
    ]);
  });

  it("inspects labelling on 3 inner units and 1 carton, with each report's checks", () => {
    const checks = (code: "STD_EG" | "SAFEDON_EG", level: "inner" | "carton") =>
      moduleConfig(code, "labeling")?.levels[level].checks.map((check) => `${check.code}: ${check.label}`);
    for (const code of ["STD_EG", "SAFEDON_EG"] as const) {
      const levels = moduleConfig(code, "labeling")?.levels;
      expect([levels?.inner.n, levels?.carton.n], code).toEqual([3, 1]);
      for (const level of ["inner", "carton"] as const) {
        for (const check of levels?.[level].checks ?? []) expect(LABELLING_CHECKS).toContain(check.code);
      }
    }
    expect(checks("STD_EG", "inner")).toEqual([
      "lot_no: Wrong / No lot number",
      "mfg_date: Wrong / No mfg. date",
      "artwork: Wrong artwork print",
    ]);
    expect(checks("STD_EG", "carton")).toEqual([
      "lot_no: Wrong / No lot number",
      "mfg_date: Wrong / No mfg. date",
      "artwork: Wrong artwork print",
      "carton_no: No carton number printed",
    ]);
    expect(checks("SAFEDON_EG", "inner")).toEqual([
      "lot_no: Wrong / No lot number",
      "mfg_date: Wrong / No mfg. date",
      "expiry_date: Wrong / No expiry date",
      "artwork: Wrong artwork print",
    ]);
    expect(checks("SAFEDON_EG", "carton")).toEqual([
      "lot_no: Wrong / No lot number",
      "mfg_date: Wrong / No mfg. date",
      "expiry_date: Wrong / No expiry date",
      "artwork: Wrong artwork print",
      "carton_no: No carton number",
    ]);
  });

  it("switches header fields as each source prints them", () => {
    const off = (code: (typeof TEMPLATE_CODES)[number]) =>
      Object.entries(moduleConfig(code, "header")?.fields ?? {})
        .filter(([, on]) => !on)
        .map(([key]) => key);
    // STD_EG shows Inspected by: its report has no row, its EG onsite form does (rule 4.2.1).
    expect(off("STD_EG")).toEqual([]);
    expect(off("SAFEDON_EG")).toEqual(["client", "factoryGloveCode"]);
    expect(off("STD_SG")).toEqual(["factoryAddress", "client", "factoryGloveCode"]);
    expect(moduleConfig("SAFEDON_EG", "header")?.mfgExpiryPrecision).toBe("month");
  });

  it("knows which fields a template shows", () => {
    expect(fieldShown("STD_EG", { module: "header", field: "inspector" })).toBe(true);
    expect(fieldShown("SAFEDON_EG", { module: "header", field: "client" })).toBe(false);
    expect(fieldShown("SAFEDON_EG", { module: "dimensions", field: "cuffThickness" })).toBe(false);
    expect(fieldShown("SAFEDON_EG", { module: "dimensions", field: "statistic" })).toBe(true);
    expect(fieldShown("STD_EG", { module: "order_lots", field: "packingSite" })).toBe(false);
    expect(fieldShown("SAFEDON_EG", { module: "order_lots", field: "packingSite" })).toBe(true);
    expect(fieldShown("STD_SG", { module: "sampling_plan", field: "gloves" })).toBe(false);
    expect(fieldShown("STD_SG", { module: "sampling_plan", field: "pouches" })).toBe(true);
    expect(fieldShown("STD_EG", { module: "tensile", field: "tensileStrength" })).toBe(false);
    expect(fieldShown("STD_EG", { module: "visual", field: "counts", group: "critical" })).toBe(true);
    expect(fieldShown("STD_EG", { module: "visual", field: "counts", group: "nope" })).toBe(false);
    expect(fieldShown("STD_EG", { module: "labeling", field: "result", group: "carton" })).toBe(true);
  });

  it("shows the packing site in SAFEDON_EG only", () => {
    expect(moduleConfig("STD_EG", "order_lots")?.fields.packingSite).toBe(false);
    expect(moduleConfig("SAFEDON_EG", "order_lots")?.fields.packingSite).toBe(true);
  });

  it("samples pouches in the surgical template only", () => {
    for (const code of TEMPLATE_CODES) {
      const columns = moduleConfig(code, "sampling_plan")?.columns;
      expect([columns?.pouches, columns?.pouchesDyeLeak], code).toEqual(code === "STD_SG" ? [true, true] : [false, false]);
    }
  });

  it("prints the client logo on SAFEDON_EG only", () => {
    expect(TEMPLATES.STD_EG.report.showClientLogo).toBe(false);
    expect(TEMPLATES.SAFEDON_EG.report.showClientLogo).toBe(true);
    expect(TEMPLATES.SAFEDON_EG.scope).toEqual({ productType: "examination", standard: "ASTM_D6319", clientScoped: true });
    expect(TEMPLATES.STD_EG.scope).toEqual({ productType: "examination", standard: "EN455", clientScoped: false });
  });

  it("gives STD_SG a standard the template schema accepts, to confirm", () => {
    expect(TEMPLATES.STD_SG.scope).toEqual({ productType: "surgical", standard: "custom", clientScoped: false });
    expect(TEMPLATES.STD_SG.toConfirm.map((item) => item.path)).toContain("scope.standard");
  });
});

describe("custom modules", () => {
  it("holds the onsite forms' Glove Type in every template, after the header", () => {
    for (const code of TEMPLATE_CODES) {
      const [gloveType] = TEMPLATES[code].customModules;
      expect(gloveType).toMatchObject({ key: "glove_type", after: "header", layout: "fields" });
      expect(gloveType.fields.map((field) => [field.key, field.label, field.type])).toEqual([["gloveType", "Glove Type", "text"]]);
    }
  });

  it("keeps the Safedon onsite sheet's free text per size, after the Safedon dispensing check (SAFEDON_EG only)", () => {
    const notes = TEMPLATES.SAFEDON_EG.customModules.find((module) => module.key === "safedon_dispensing_notes");
    expect(notes).toMatchObject({ after: "dispensing_safedon", layout: "table" });
    expect(notes?.fields.map((field) => [field.key, field.label, field.type])).toEqual([
      ["specRequirement", "Specification / Requirement", "text"],
      ["conclusion", "Conclusion", "text"],
    ]);
    expect(TEMPLATES.STD_EG.customModules.map((module) => module.key)).toEqual(["glove_type"]);
    expect(TEMPLATES.STD_SG.customModules.map((module) => module.key)).toEqual(["glove_type"]);
  });

  it("uses keys the framework's CustomModuleSchema accepts, after a module the template has", () => {
    for (const code of TEMPLATE_CODES) {
      for (const custom of TEMPLATES[code].customModules) {
        expect(custom.key, code).toMatch(FRAMEWORK_CUSTOM_KEY);
        expect(isModuleKey(custom.key), `${code} ${custom.key}`).toBe(false);
        expect(templateModuleKeys(code), `${code} ${custom.key}`).toContain(custom.after);
        for (const field of custom.fields) expect(field.key, `${code} ${custom.key}`).toMatch(FRAMEWORK_FIELD_KEY);
      }
    }
  });
});

describe("module defaults (fields.ts) and how config resolves (BUILD_SPEC 4.2 rule 9)", () => {
  it("takes STD_EG's lists as the defaults of the lists BUILD_SPEC leaves to the template", () => {
    expect(defaultConfig("watertight").locations).toEqual(moduleConfig("STD_EG", "watertight")?.locations);
    expect(defaultConfig("visual").classes).toEqual(moduleConfig("STD_EG", "visual")?.classes);
    expect(defaultConfig("labeling").levels).toEqual(moduleConfig("STD_EG", "labeling")?.levels);
    expect(defaultConfig("dispensing_packing").stickinessCodes).toEqual(
      moduleConfig("STD_EG", "dispensing_packing")?.stickinessCodes,
    );
    expect(defaultConfig("dispensing_safedon").defects).toEqual(moduleConfig("SAFEDON_EG", "dispensing_safedon")?.defects);
    expect(defaultConfig("dimensions")).toMatchObject({ statistic: "median", specs: [], decimals: DIMENSION_DECIMALS });
    expect(defaultConfig("weight").specs).toEqual([]);
  });

  it("never needs a merge to remove a key: each template keeps every key of the module defaults and of its base", () => {
    for (const code of TEMPLATE_CODES) {
      const parent = TEMPLATES[code].extends;
      for (const key of templateModuleKeys(code)) {
        const own = moduleConfig(code, key) as ConfigObject;
        expect(droppedKeys(defaultConfig(key) as ConfigObject, own), `${code} ${key} against the defaults`).toEqual([]);
        const base = parent === null ? undefined : (moduleConfig(parent, key) as ConfigObject | undefined);
        if (base !== undefined) expect(droppedKeys(base, own), `${code} ${key} against ${parent}`).toEqual([]);
      }
    }
  });

  it.each(TEMPLATE_CODES)("resolves %s from the module defaults and the seeds (seedConfig) to its config", (code) => {
    for (const key of templateModuleKeys(code)) {
      expect(resolveConfig(code, key, seedConfig), `${code} ${key}`).toEqual(moduleConfig(code, key));
    }
  });

  it.each(TEMPLATE_CODES)("resolves %s the same when a child's seed writes whole top-level values", (code) => {
    for (const key of templateModuleKeys(code)) {
      expect(resolveConfig(code, key, topLevelSeed), `${code} ${key}`).toEqual(moduleConfig(code, key));
    }
  });

  it("writes SAFEDON_EG's seed as what differs from STD_EG, the spec rows replaced whole", () => {
    expect(seedConfig("SAFEDON_EG", "dimensions")).toEqual({
      measures: ["length", "width", "fingerThickness", "palmThickness"],
      statistic: "average",
      specs: SAFEDON_EG_DIMENSION_SPECS,
    });
    expect(seedConfig("SAFEDON_EG", "header")).toEqual({
      fields: { client: false, factoryGloveCode: false },
      mfgExpiryPrecision: "month",
    });
    expect(seedConfig("SAFEDON_EG", "glove_info")).toEqual({});
    expect(seedConfig("SAFEDON_EG", "tensile")).toEqual(moduleConfig("SAFEDON_EG", "tensile"));
    expect(seedConfig("STD_EG", "dimensions")).toEqual(moduleConfig("STD_EG", "dimensions"));
    expect(seedConfig("STD_EG", "tensile")).toBeUndefined();
  });

  it("would catch specs kept in an object keyed by size: the merge mixes two specs into one", () => {
    const stdEg = { XS: { width: { kind: "max", max: 80 } } };
    const safedon = { XS: { width: { kind: "tolerance", nominal: 76, tolerance: 4 } } };
    expect(mergeConfig(stdEg, safedon)).toEqual({ XS: { width: { kind: "tolerance", max: 80, nominal: 76, tolerance: 4 } } });
    expect(droppedKeys(stdEg, safedon)).toEqual(["XS.width.max"]);
  });
});

describe("sources and seeds", () => {
  it("knows which template each source document seeds", () => {
    expect(SOURCE_IDS.map((source) => templateOfSource(source))).toEqual([
      "STD_EG",
      "SAFEDON_EG",
      "STD_EG",
      "STD_SG",
      "SAFEDON_EG",
    ]);
  });

  it("needs no label overrides for STD_EG: the modules' defaults are its wording", () => {
    for (const key of templateModuleKeys("STD_EG")) expect(labelOverrides("STD_EG", key), key).toEqual({});
  });

  it("overrides SAFEDON_EG's wording where its report differs", () => {
    expect(labelOverrides("SAFEDON_EG", "header")).toEqual({ poNo: "PO Number", productName: "Product Name (Brand & code)" });
    expect(labelOverrides("SAFEDON_EG", "labeling")).toEqual({
      innerLevel: "Inner Boxes/Packs",
      cartonLevel: "Carton Boxes",
      defectLimit: "Limit : Accept / Reject",
      innerAccept: "Acc. =",
      innerReject: "Rej. =",
      cartonAccept: "Acc. =",
      cartonReject: "Rej. =",
    });
    // The critical limit row: STD_EG prints Acc. = 0 / Rej. = 1 (the default), SAFEDON_EG Accept 0 / Reject 1.
    expect(labelOverrides("SAFEDON_EG", "visual")).toMatchObject({ criticalAccept: "Accept", criticalReject: "Reject" });
    expect(labelOverrides("STD_SG", "visual")).toMatchObject({ majorCounts: "Major defect", minorTotal: "Total Minor" });
  });

  it("keys every label as the framework's ModuleConfig.labels accepts, and only with keys the module's defaults have", () => {
    for (const key of MODULE_KEYS) {
      for (const label of Object.keys(defaultLabels(key))) expect(label, key).toMatch(LABEL_KEY_PATTERN);
    }
    for (const code of TEMPLATE_CODES) {
      for (const key of templateModuleKeys(code)) {
        const defaults = Object.keys(defaultLabels(key));
        for (const label of Object.keys(labelOverrides(code, key))) {
          expect(label, `${code} ${key}`).toMatch(LABEL_KEY_PATTERN);
          expect(defaults, `${code} ${key}`).toContain(label);
        }
      }
    }
  });

  it("produces BUILD_SPEC 4.3 ModuleConfig values for a seed: whole config for a root, the diff for a child", () => {
    const seed = seedModuleConfigs("SAFEDON_EG");
    expect(seed.find((module) => module.key === "header")).toEqual({
      key: "header",
      include: true,
      title: "Manufacturer Information",
      labels: { poNo: "PO Number", productName: "Product Name (Brand & code)" },
      config: { fields: { client: false, factoryGloveCode: false }, mfgExpiryPrecision: "month" },
    });
    expect(seed.find((module) => module.key === "glove_info")?.config).toEqual({});
    expect(seed.find((module) => module.key === "tensile")?.config).toEqual(moduleConfig("SAFEDON_EG", "tensile"));
    const sg = seedModuleConfigs("STD_SG");
    expect(sg.find((module) => module.key === "watertight")?.title).toBe("Watertight Inspection");
    expect(sg.find((module) => module.key === "visual")?.config).toEqual(moduleConfig("STD_SG", "visual"));
  });
});
