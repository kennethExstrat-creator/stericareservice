// The seed templates against the data dictionary (lib/coverage, the source of
// truth) and against the real module registry. Every module the seeds switch
// on is built, so each seed's config is checked by that module's real schema;
// a placeholder (which takes any config) fails these tests. Each seed is
// checked against the dictionary entry of its flow: STD_EG runs SAFEDON_EG's
// since 26 October 2026, under its own identity.
import { describe, expect, it } from "vitest";
import {
  labelOverrides,
  moduleConfig,
  moduleTitle,
  templateModuleKeys,
  TEMPLATE_CODES,
  TEMPLATES,
  writtenConfig,
  type TemplateCode,
} from "@/lib/coverage";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { ResolvedTemplateSchema, TemplateDefinitionSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import {
  customShortTitle,
  lookupFrom,
  resolveTemplate,
  resolveTemplateOrThrow,
  selectTemplate,
  SHORT_TITLE_MAX,
  shortTitleFor,
  templateSections,
  type TemplateCandidate,
} from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  definitionFromCoverage,
  REPORT_TITLE_SEPARATOR,
  SAFEDON_EG_CLIENT,
  SAFEDON_EG_SEED,
  SEED_TEMPLATES,
  STD_EG_IDENTITY,
  STD_EG_REPORT_SEED,
  STD_EG_SEED,
  STD_SG_SEED,
  type SeedTemplate,
} from ".";

/** A placeholder client id: the seed looks up the real one by name. */
const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";

function definitions() {
  return SEED_TEMPLATES.map((seed) => seed.definition(seed.client === null ? undefined : CLIENT_ID));
}

function resolveAll(): Map<string, ResolvedTemplate> {
  const all = definitions();
  const getBase = lookupFrom(all.map((definition) => ({ definition, version: 1 })));
  return new Map(
    all.map((definition) => {
      const resolution = resolveTemplate(definition, { getBase, registry: MODULE_REGISTRY });
      if (!resolution.ok) {
        const lines = resolution.problems.map((problem) => `${problem.path.join(".")}: ${problem.message}`);
        throw new Error(`${definition.code} does not resolve:\n${lines.join("\n")}`);
      }
      return [definition.code, resolution.template];
    }),
  );
}

function resolved(code: TemplateCode): ResolvedTemplate {
  const template = resolveAll().get(code);
  if (!template) throw new Error(`No seed template ${code}`);
  return template;
}

function included(template: ResolvedTemplate) {
  return template.modules.filter((entry) => entry.include);
}

/** STD_EG as versions 1 to 4 have it: its report's flow, resolved on its own. */
function reportStdEg(): ResolvedTemplate {
  return resolveTemplateOrThrow(STD_EG_REPORT_SEED.definition(), { getBase: lookupFrom([]), registry: MODULE_REGISTRY });
}

/** What a seed holds of a module: its flow's config, with the header rows its identity sets (STD_EG's client row). */
function expectedConfig(seed: SeedTemplate, key: ModuleKey) {
  const config = moduleConfig(seed.flow, key) as Record<string, unknown> | undefined;
  if (seed === STD_EG_SEED && key === "header" && config) {
    return { ...config, fields: { ...(config.fields as object), ...STD_EG_IDENTITY.headerFields } };
  }
  return config;
}

describe("the seed templates (BUILD_SPEC 11)", () => {
  it("are STD_EG, SAFEDON_EG (retired) and STD_SG, each base before the templates that extend it", () => {
    expect(SEED_TEMPLATES.map((seed) => seed.code)).toEqual(["STD_EG", "SAFEDON_EG", "STD_SG"]);
    expect([...SEED_TEMPLATES.map((seed) => seed.code)].sort()).toEqual([...TEMPLATE_CODES].sort());
    expect(SEED_TEMPLATES.filter((seed) => seed.retired).map((seed) => seed.code)).toEqual(["SAFEDON_EG"]);
    const seen = new Set<string>();
    for (const definition of definitions()) {
      if (definition.extends) expect(seen, `${definition.code} before its base`).toContain(definition.extends);
      seen.add(definition.code);
    }
  });

  it("run their own flows, except STD_EG, which runs SAFEDON_EG's (Kenneth, 26 October 2026)", () => {
    expect(SEED_TEMPLATES.map((seed) => [seed.code, seed.flow])).toEqual([
      ["STD_EG", "SAFEDON_EG"],
      ["SAFEDON_EG", "SAFEDON_EG"],
      ["STD_SG", "STD_SG"],
    ]);
  });

  it.each(SEED_TEMPLATES.map((seed) => seed.code))("%s is a valid template definition", (code) => {
    const definition = definitions().find((entry) => entry.code === code);
    const parsed = TemplateDefinitionSchema.safeParse(definition);
    expect(parsed.success, parsed.error?.message).toBe(true);
  });

  it.each(SEED_TEMPLATES.map((seed) => seed.code))("%s resolves against the module registry", (code) => {
    const template = resolved(code);
    expect(ResolvedTemplateSchema.safeParse(template).success).toBe(true);
    expect(template.chain).toEqual(code === "SAFEDON_EG" ? ["SAFEDON_EG", "STD_EG"] : [code]);
  });

  it.each(SEED_TEMPLATES.map((seed) => seed.code))("%s switches on only built modules, checked by their real schemas", (code) => {
    const placeholders = included(resolved(code)).filter((entry) => MODULE_REGISTRY[entry.key].stub);
    expect(placeholders.map((entry) => entry.key)).toEqual([]);
  });
});

describe.each(SEED_TEMPLATES.map((seed) => [seed.code, seed.flow, seed] as const))(
  "%s against the dictionary entry of its flow, %s",
  (code, flow, seed) => {
    it("switches on the flow's modules, in its order", () => {
      expect(included(resolved(code)).map((entry) => entry.key)).toEqual(templateModuleKeys(flow));
    });

    it("titles each module in the source's wording", () => {
      for (const entry of included(resolved(code))) expect(entry.title, entry.key).toBe(moduleTitle(flow, entry.key));
    });

    it("keeps the source's wording where it differs from the module's defaults", () => {
      for (const entry of included(resolved(code))) {
        expect(entry.labels, entry.key).toMatchObject(labelOverrides(flow, entry.key));
      }
    });

    it("gives every module the dictionary's config, and each module's config schema accepts it", () => {
      for (const entry of included(resolved(code))) {
        // Strict once the module is built: its real schema parses the seed's config.
        const parsed = MODULE_REGISTRY[entry.key].configSchema.safeParse(entry.config);
        expect(parsed.success, `${entry.key}: ${parsed.error?.message}`).toBe(true);
        expect(entry.config, entry.key).toMatchObject(expectedConfig(seed, entry.key) as Record<string, unknown>);
      }
    });

    it("has the flow's sizes and unit, and its identity's name, scope and report settings", () => {
      const spec = TEMPLATES[flow];
      const template = resolved(code);
      expect(template.sizes.map((size) => size.value)).toEqual(spec.sizes.map((size) => size.value));
      expect(template.unit).toBe(spec.unit);
      expect(template.scope.productType).toBe(spec.scope.productType);
      expect(template.scope.manufacturerId).toBeUndefined();
      expect(template.sourceFile).toBeNull();
      if (seed === STD_EG_SEED) {
        expect(template.name).toBe(STD_EG_IDENTITY.name);
        expect(template.scope.standard).toBe(STD_EG_IDENTITY.standard);
        expect(template.scope.clientId).toBeUndefined();
        expect(template.report).toEqual({
          title: STD_EG_IDENTITY.report.titleLines.join(REPORT_TITLE_SEPARATOR),
          showClientLogo: false,
        });
        return;
      }
      expect(template.name).toBe(spec.name);
      expect(template.scope.standard).toBe(spec.scope.standard);
      expect(template.scope.clientId).toBe(spec.scope.clientScoped ? CLIENT_ID : undefined);
      expect(template.report).toEqual({
        title: spec.report.titleLines?.join(REPORT_TITLE_SEPARATOR) ?? spec.name,
        showClientLogo: spec.report.showClientLogo,
      });
    });

    it("carries the flow's custom modules", () => {
      const spec = TEMPLATES[flow];
      const base = spec.extends === null ? [] : TEMPLATES[spec.extends].customModules;
      const own = new Set(spec.customModules.map((custom) => custom.key));
      const expected = [...base.filter((custom) => !own.has(custom.key)), ...spec.customModules];
      expect(resolved(code).customModules.map((custom) => [custom.key, custom.after, custom.layout])).toEqual(
        expected.map((custom) => [custom.key, custom.after, custom.layout]),
      );
      for (const custom of resolved(code).customModules) {
        const found = expected.find((entry) => entry.key === custom.key);
        expect(custom.title).toBe(found?.title);
        expect(custom.fields.map((field) => [field.key, field.label, field.type])).toEqual(
          found?.fields.map((field) => [field.key, field.label, field.type]),
        );
      }
    });
  },
);

describe("STD_EG and STD_SG are root templates", () => {
  it.each([STD_EG_SEED, STD_SG_SEED])("$code lists every module it switches on, whole", (seed) => {
    const definition = seed.definition();
    expect(definition.extends).toBeUndefined();
    expect(seed.client).toBeNull();
    expect(seed.retired).toBeUndefined();
    expect(definition.modules.map((entry) => entry.key)).toEqual(templateModuleKeys(seed.flow));
    for (const entry of definition.modules) {
      expect(entry.include, entry.key).toBe(true);
      expect(entry.title, entry.key).toBe(moduleTitle(seed.flow, entry.key));
      expect(entry.config ?? {}, entry.key).toEqual(
        seed === STD_EG_SEED && entry.key === "header" ? expectedConfig(seed, "header") : writtenConfig(seed.flow, entry.key),
      );
    }
  });

  // Kenneth, 12 October 2026: Skin Visual and Flow Mark for STD_EG and SAFEDON_EG only; STD_SG stays version 2.
  it("keeps STD_SG's definition as its live version 2 has it: no # Gloves for Weight switch, no Skin Visual or Flow Mark", () => {
    const configOf = (key: string) => STD_SG_SEED.definition().modules.find((entry) => entry.key === key)?.config;
    expect(configOf("sampling_plan")?.columns).not.toHaveProperty("glovesWeight");
    const visual = configOf("visual") as { classes: Record<string, { defects: { code: string }[] }> };
    const codes = Object.values(visual.classes).flatMap((cls) => cls.defects.map((defect) => defect.code));
    expect(codes).not.toContain("skin_visual");
    expect(codes).not.toContain("flow_mark");
    // The module reads the missing switch as off, so STD_SG plans no gloves for weight.
    const sampling = included(resolved("STD_SG")).find((entry) => entry.key === "sampling_plan");
    expect(sampling?.config).toMatchObject({ columns: { glovesWeight: false } });
    expect(moduleConfig("STD_SG", "sampling_plan")?.columns.glovesWeight).toBe(false);
  });

  it("STD_SG has no report title until a filled SG report exists: the resolver uses its name", () => {
    expect(STD_SG_SEED.definition().report).toBeUndefined();
    expect(resolved("STD_SG").report).toEqual({ title: "Standard sterile surgical gloves", showClientLogo: false });
  });

  it("refuses a client id for a template that is not client-scoped", () => {
    expect(() => definitionFromCoverage("STD_EG", { clientId: CLIENT_ID })).toThrow(/not scoped to a client/);
  });
});

// Kenneth, 26 October 2026: "all the inspection flow will be standardized", with the flow INS-2026-2210 uses.
describe("STD_EG runs SAFEDON_EG's flow as the standard template for every client", () => {
  const standard = resolved("STD_EG");
  const safedon = resolved("SAFEDON_EG");

  it("has SAFEDON_EG's modules, titles, wording and config, the header's client row aside", () => {
    const shape = (template: ResolvedTemplate) =>
      included(template).map(({ key, title, labels, config }) => ({ key, title, labels, config }));
    const header = (template: ResolvedTemplate) => included(template).find((entry) => entry.key === "header")!;
    const withoutClientRow = (template: ResolvedTemplate) =>
      shape(template).map((entry) =>
        entry.key === "header"
          ? { ...entry, config: { ...entry.config, fields: { ...(entry.config.fields as object), client: null } } }
          : entry,
      );
    expect(withoutClientRow(standard)).toEqual(withoutClientRow(safedon));
    // No logo names the client, so the header does; no factory glove code, as in SAFEDON_EG's flow.
    expect(header(standard).config).toMatchObject({ fields: { client: true, factoryGloveCode: false }, mfgExpiryPrecision: "month" });
    expect(header(safedon).config).toMatchObject({ fields: { client: false } });
    expect(standard.customModules).toEqual(safedon.customModules);
    expect(standard.sizes).toEqual(safedon.sizes);
    expect(standard.unit).toBe("pcs");
  });

  it("keeps everything that flow has: the dispensing check with its box table, tensile, glove burst and the expiry date", () => {
    const keys = included(standard).map((entry) => entry.key);
    expect(keys).toEqual(expect.arrayContaining(["dispensing_safedon", "tensile", "weight", "watertight", "labeling"]));
    expect(keys).not.toContain("force_at_break");
    expect(keys).not.toContain("dispensing_packing");
    expect(standard.customModules.map((custom) => custom.key)).toEqual(["safedon_dispensing_notes"]);
    for (const key of ["dispensing_safedon", "watertight", "labeling", "dimensions", "weight"] as const) {
      expect(included(standard).find((entry) => entry.key === key)?.config, key).toMatchObject(
        moduleConfig("SAFEDON_EG", key) as Record<string, unknown>,
      );
    }
  });

  it("is a standard template: no client, ASTM D6319, the STD_EG report's title and no client logo", () => {
    expect(STD_EG_SEED.definition().scope).toEqual({ productType: "examination", standard: "ASTM_D6319" });
    expect(standard.name).toBe("Standard examination gloves (ASTM D6319)");
    expect(standard.report).toEqual({
      title: "Preshipment Inspection: Nitrile Disposable Examination Gloves",
      showClientLogo: false,
    });
  });

  it("leaves the STD_EG report's flow to its versions 1 to 4 (STD_EG_REPORT_SEED), not seeded", () => {
    expect(STD_EG_REPORT_SEED.definition()).toEqual(definitionFromCoverage("STD_EG"));
    expect(SEED_TEMPLATES).not.toContain(STD_EG_REPORT_SEED);
    expect(included(reportStdEg()).map((entry) => entry.key)).toEqual(templateModuleKeys("STD_EG"));
  });
});

describe("SAFEDON_EG, retired, extends STD_EG's report flow", () => {
  const definition = SAFEDON_EG_SEED.definition(CLIENT_ID);
  const byKey = new Map(definition.modules.map((entry) => [entry.key, entry]));

  it("belongs to the client its report carries, looked up by name, and is retired", () => {
    expect(SAFEDON_EG_SEED.client).toBe(SAFEDON_EG_CLIENT);
    expect(SAFEDON_EG_CLIENT).toBe("Polyco Healthline");
    expect(SAFEDON_EG_SEED.retired).toBe(true);
    expect(definition.scope).toEqual({ productType: "examination", standard: "ASTM_D6319", clientId: CLIENT_ID });
    expect(SAFEDON_EG_SEED.definition().scope.clientId).toBeUndefined();
  });

  it("lists only what differs from STD_EG's report flow", () => {
    expect(definition.extends).toBe("STD_EG");
    // Unchanged modules are left out: they come from STD_EG as they are.
    for (const key of ["glove_info", "carton_sampling", "conclusion"] as const) expect(byKey.has(key), key).toBe(false);
    expect(byKey.get("header")).toEqual({
      key: "header",
      include: true,
      labels: { poNo: "PO Number", productName: "Product Name (Brand & Code)" },
      config: { fields: { client: false, factoryGloveCode: false }, mfgExpiryPrecision: "month" },
    });
    expect(byKey.get("weight")?.title).toBe("Weight (g)");
    expect(byKey.get("dimensions")?.title).toBeUndefined();
    // Only the onsite notes are its own; Glove Type comes from STD_EG.
    expect(definition.customModules?.map((custom) => custom.key)).toEqual(["safedon_dispensing_notes"]);
    expect(definition.report).toEqual({
      title: "Preshipment Inspection: Safedon Nitrile PF Exam Gloves",
      showClientLogo: true,
    });
  });

  it("swaps force_at_break for tensile and dispensing_packing for dispensing_safedon, in the same places", () => {
    expect(byKey.get("force_at_break")).toEqual({ key: "force_at_break", include: false });
    expect(byKey.get("dispensing_packing")).toEqual({ key: "dispensing_packing", include: false });
    expect(byKey.get("tensile")?.config).toEqual(moduleConfig("SAFEDON_EG", "tensile"));
    expect(byKey.get("dispensing_safedon")?.config).toEqual(moduleConfig("SAFEDON_EG", "dispensing_safedon"));

    const order = resolved("SAFEDON_EG").modules.map((entry) => `${entry.key}${entry.include ? "" : " (off)"}`);
    expect(order).toEqual([
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "dimensions",
      "tensile",
      "force_at_break (off)",
      "weight",
      "watertight",
      "visual",
      "dispensing_safedon",
      "dispensing_packing (off)",
      "labeling",
      "conclusion",
    ]);
  });

  it("records the STD_EG version it was resolved against", () => {
    expect(resolved("SAFEDON_EG").bases).toEqual([{ code: "STD_EG", version: 1 }]);
  });
});

describe("choosing among the seeds (BUILD_SPEC 4.4)", () => {
  function candidates(): TemplateCandidate[] {
    return definitions().map((definition, index) => ({
      id: `00000000-0000-4000-8000-00000000000${index + 1}`,
      code: definition.code,
      version: 1,
      status: "active",
      productType: definition.scope.productType,
      standard: definition.scope.standard,
      clientId: definition.scope.clientId ?? null,
      manufacturerId: definition.scope.manufacturerId ?? null,
    }));
  }
  const pick = (criteria: Parameters<typeof selectTemplate>[1]) => {
    const selection = selectTemplate(candidates(), criteria);
    return selection.ok ? `${selection.template.code} (${selection.specificity})` : selection.reason;
  };

  it("gives every client STD_EG for examination gloves and STD_SG for surgical gloves, even with SAFEDON_EG still active", () => {
    expect(pick({ productType: "examination" })).toBe("STD_EG (standard)");
    expect(pick({ productType: "surgical" })).toBe("STD_SG (standard)");
  });

  it("never ties: one standard template per product type", () => {
    for (const productType of ["examination", "surgical"] as const) {
      const selection = selectTemplate(candidates(), { productType });
      expect(selection.ok && selection.ties).toEqual([]);
    }
  });
});

describe("the seeds' step names (docs/DESIGN.md, Step Names)", () => {
  /** Each section of a resolved template by the name the capture screen's menus, Pending and photo tags give it. */
  const namesOf = (template: ResolvedTemplate) =>
    templateSections(template).map((section) =>
      section.kind === "module" ? shortTitleFor(section.key, section.module.title) : customShortTitle(section.custom),
    );
  const shortNames = (code: TemplateCode) => namesOf(resolved(code));

  const SAFEDON_FLOW = [
    "Manufacturer",
    "Glove Information",
    "Order",
    "Packing Configuration",
    "Sampling Plan",
    "Box/Carton Numbers",
    "Dimension",
    "Physical Properties",
    "Weight",
    "Watertight Test",
    "Visual Inspection",
    "Dispensing",
    "Dispensing Notes",
    "Labeling",
    "Conclusion",
  ];

  it("names STD_EG's steps as SAFEDON_EG's, with Physical Properties, Dispensing and Dispensing Notes", () => {
    expect(shortNames("STD_EG")).toEqual(SAFEDON_FLOW);
    expect(shortNames("SAFEDON_EG")).toEqual(SAFEDON_FLOW);
  });

  it("keeps the STD_EG report flow's names for its versions 1 to 4", () => {
    expect(namesOf(reportStdEg())).toEqual([
      "Manufacturer",
      "Glove Information",
      "Order",
      "Packing Configuration",
      "Sampling Plan",
      "Box/Carton Numbers",
      "Dimension",
      "Force at Break",
      "Weight",
      "Watertight Test",
      "Visual Inspection",
      "Packing Check",
      "Labeling",
      "Conclusion",
    ]);
  });

  it("keeps STD_SG's own words: Shipment, PO Info and Packing Mode", () => {
    expect(shortNames("STD_SG")).toEqual([
      "Shipment",
      "Glove Type",
      "PO Info",
      "Packing Mode",
      "Sampling Plan",
      "Watertight Test",
      "Visual Inspection",
      "Dimension",
      "Dye Leak Test",
      "Conclusion",
    ]);
  });

  it.each(TEMPLATE_CODES)("keeps every step of %s to one sidebar line", (code) => {
    for (const name of shortNames(code)) expect(name.length, name).toBeLessThanOrEqual(SHORT_TITLE_MAX);
  });
});
