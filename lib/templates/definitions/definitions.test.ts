// The seed templates against the data dictionary (lib/coverage, the source of
// truth) and against the real module registry. Every module the seeds switch
// on is built, so each seed's config is checked by that module's real schema;
// a placeholder (which takes any config) fails these tests.
import { describe, expect, it } from "vitest";
import {
  labelOverrides,
  moduleConfig,
  moduleTitle,
  templateModuleKeys,
  TEMPLATE_CODES,
  TEMPLATES,
  type TemplateCode,
} from "@/lib/coverage";
import { ResolvedTemplateSchema, TemplateDefinitionSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { lookupFrom, resolveTemplate, selectTemplate, type TemplateCandidate } from "@/lib/templates";
import { MODULE_REGISTRY } from "@/modules/registry";
import {
  definitionFromCoverage,
  REPORT_TITLE_SEPARATOR,
  SAFEDON_EG_CLIENT,
  SAFEDON_EG_SEED,
  SEED_TEMPLATES,
  STD_EG_SEED,
  STD_SG_SEED,
} from ".";

/** A placeholder client id: the seed looks up the real one by name. */
const CLIENT_ID = "00000000-0000-4000-8000-0000000000c1";
const MANUFACTURER_ID = "00000000-0000-4000-8000-0000000000d1";

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

describe("the seed templates (BUILD_SPEC 11)", () => {
  it("are STD_EG, SAFEDON_EG and STD_SG, each base before the templates that extend it", () => {
    expect(SEED_TEMPLATES.map((seed) => seed.code)).toEqual(["STD_EG", "SAFEDON_EG", "STD_SG"]);
    expect([...SEED_TEMPLATES.map((seed) => seed.code)].sort()).toEqual([...TEMPLATE_CODES].sort());
    const seen = new Set<string>();
    for (const definition of definitions()) {
      if (definition.extends) expect(seen, `${definition.code} before its base`).toContain(definition.extends);
      seen.add(definition.code);
    }
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

describe.each(TEMPLATE_CODES)("%s against the data dictionary", (code) => {
  it("switches on the dictionary's modules, in its order", () => {
    expect(included(resolved(code)).map((entry) => entry.key)).toEqual(templateModuleKeys(code));
  });

  it("titles each module in the source's wording", () => {
    for (const entry of included(resolved(code))) expect(entry.title, entry.key).toBe(moduleTitle(code, entry.key));
  });

  it("keeps the source's wording where it differs from the module's defaults", () => {
    for (const entry of included(resolved(code))) {
      expect(entry.labels, entry.key).toMatchObject(labelOverrides(code, entry.key));
    }
  });

  it("gives every module the dictionary's config, and each module's config schema accepts it", () => {
    for (const entry of included(resolved(code))) {
      // Strict once the module is built: its real schema parses the seed's config.
      const parsed = MODULE_REGISTRY[entry.key].configSchema.safeParse(entry.config);
      expect(parsed.success, `${entry.key}: ${parsed.error?.message}`).toBe(true);
      expect(entry.config, entry.key).toMatchObject(moduleConfig(code, entry.key) as Record<string, unknown>);
    }
  });

  it("has the dictionary's sizes, unit, scope and report settings", () => {
    const spec = TEMPLATES[code];
    const template = resolved(code);
    expect(template.sizes.map((size) => size.value)).toEqual(spec.sizes.map((size) => size.value));
    expect(template.unit).toBe(spec.unit);
    expect(template.scope.productType).toBe(spec.scope.productType);
    expect(template.scope.standard).toBe(spec.scope.standard);
    expect(template.scope.clientId).toBe(spec.scope.clientScoped ? CLIENT_ID : undefined);
    expect(template.scope.manufacturerId).toBeUndefined();
    expect(template.name).toBe(spec.name);
    expect(template.report).toEqual({
      title: spec.report.titleLines?.join(REPORT_TITLE_SEPARATOR) ?? spec.name,
      showClientLogo: spec.report.showClientLogo,
    });
    expect(template.sourceFile).toBeNull();
  });

  it("carries the dictionary's custom modules", () => {
    expect(resolved(code).customModules.map((custom) => [custom.key, custom.after, custom.layout])).toEqual(
      TEMPLATES[code].customModules.map((custom) => [custom.key, custom.after, custom.layout]),
    );
    for (const custom of resolved(code).customModules) {
      const spec = TEMPLATES[code].customModules.find((entry) => entry.key === custom.key);
      expect(custom.title).toBe(spec?.title);
      expect(custom.fields.map((field) => [field.key, field.label, field.type])).toEqual(
        spec?.fields.map((field) => [field.key, field.label, field.type]),
      );
    }
  });
});

describe("STD_EG and STD_SG are root templates", () => {
  it.each([STD_EG_SEED, STD_SG_SEED])("$code lists every module it switches on, whole", (seed) => {
    const definition = seed.definition();
    expect(definition.extends).toBeUndefined();
    expect(seed.client).toBeNull();
    expect(definition.modules.map((entry) => entry.key)).toEqual(templateModuleKeys(seed.code));
    for (const entry of definition.modules) {
      expect(entry.include, entry.key).toBe(true);
      expect(entry.title, entry.key).toBe(moduleTitle(seed.code, entry.key));
      expect(entry.config ?? {}, entry.key).toEqual(moduleConfig(seed.code, entry.key));
    }
  });

  it("STD_SG has no report title until a filled SG report exists: the resolver uses its name", () => {
    expect(STD_SG_SEED.definition().report).toBeUndefined();
    expect(resolved("STD_SG").report).toEqual({ title: "Standard sterile surgical gloves", showClientLogo: false });
  });

  it("refuses a client id for a template that is not client-scoped", () => {
    expect(() => definitionFromCoverage("STD_EG", { clientId: CLIENT_ID })).toThrow(/not scoped to a client/);
  });
});

describe("SAFEDON_EG extends STD_EG", () => {
  const definition = SAFEDON_EG_SEED.definition(CLIENT_ID);
  const byKey = new Map(definition.modules.map((entry) => [entry.key, entry]));

  it("belongs to the client its report carries, looked up by name when seeded", () => {
    expect(SAFEDON_EG_SEED.client).toBe(SAFEDON_EG_CLIENT);
    expect(SAFEDON_EG_CLIENT).toBe("Polyco Healthline");
    expect(definition.scope).toEqual({ productType: "examination", standard: "ASTM_D6319", clientId: CLIENT_ID });
    expect(SAFEDON_EG_SEED.definition().scope.clientId).toBeUndefined();
  });

  it("lists only what differs from STD_EG", () => {
    expect(definition.extends).toBe("STD_EG");
    // Unchanged modules are left out: they come from STD_EG as they are.
    for (const key of ["glove_info", "carton_sampling", "conclusion"] as const) expect(byKey.has(key), key).toBe(false);
    expect(byKey.get("header")).toEqual({
      key: "header",
      include: true,
      labels: { poNo: "PO Number", productName: "Product Name (Brand & code)" },
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

  it("gives SAFEDON_EG to its client, STD_EG to everyone else and STD_SG to surgical gloves", () => {
    expect(pick({ productType: "examination", clientId: CLIENT_ID, manufacturerId: MANUFACTURER_ID })).toBe(
      "SAFEDON_EG (client)",
    );
    expect(pick({ productType: "examination", clientId: null, manufacturerId: MANUFACTURER_ID })).toBe(
      "STD_EG (standard)",
    );
    expect(
      pick({ productType: "examination", clientId: "00000000-0000-4000-8000-0000000000c2", manufacturerId: null }),
    ).toBe("STD_EG (standard)");
    expect(pick({ productType: "surgical", clientId: CLIENT_ID, manufacturerId: MANUFACTURER_ID })).toBe(
      "STD_SG (standard)",
    );
  });

  it("never ties: one standard template per product type", () => {
    for (const productType of ["examination", "surgical"] as const) {
      const selection = selectTemplate(candidates(), { productType });
      expect(selection.ok && selection.ties).toEqual([]);
    }
  });
});
