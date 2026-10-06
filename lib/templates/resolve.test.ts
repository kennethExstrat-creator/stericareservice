import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate, TemplateDefinition } from "@/lib/schemas/template";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { labelFor } from "@/modules/_framework/labels";
import { baseEg, clientEg, clientFactoryEg } from "./__fixtures__/definitions";
import {
  lookupFrom,
  MAX_EXTENDS_DEPTH,
  resolveTemplate,
  resolveTemplateOrThrow,
  type TemplateLookup,
  type TemplateProblem,
} from "./resolve";

const library = () => lookupFrom([baseEg(), clientEg(), clientFactoryEg()]);

function resolved(definition: unknown, getBase: TemplateLookup = library()): ResolvedTemplate {
  return resolveTemplateOrThrow(definition, { getBase, registry: TEST_REGISTRY });
}

function problemsOf(definition: unknown, getBase: TemplateLookup = library()): TemplateProblem[] {
  const resolution = resolveTemplate(definition, { getBase, registry: TEST_REGISTRY });
  if (resolution.ok) throw new Error("Expected resolution problems");
  return resolution.problems;
}

const keys = (template: ResolvedTemplate) => template.modules.map((module) => module.key);
const included = (template: ResolvedTemplate) =>
  template.modules.filter((module) => module.include).map((module) => module.key);

function moduleOf(template: ResolvedTemplate, key: ModuleKey) {
  const found = template.modules.find((module) => module.key === key);
  if (!found) throw new Error(`No ${key} in ${template.code}`);
  return found;
}

const STD_ORDER: ModuleKey[] = [
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
];

describe("resolveTemplate: a template without a base", () => {
  it("keeps the report order and fills in the module defaults", () => {
    const template = resolved(baseEg());
    expect(template.format).toBe(1);
    expect(template.chain).toEqual(["BASE_EG"]);
    expect(keys(template)).toEqual(STD_ORDER);
    expect(included(template)).toEqual(STD_ORDER);
    expect(moduleOf(template, "glove_info").title).toBe("Glove Information");
    expect(moduleOf(template, "weight").title).toBe("Weight (g) - average of 13 gloves per size");
    expect(moduleOf(template, "weight").config).toEqual({ n: 13, warnThresholdPct: 10 });
    expect(moduleOf(template, "header").labels).toEqual({
      poNo: "PO / SO Number",
      productName: "Product Name (Brand, code & description)",
      client: "Client Name",
    });
    expect(template.report.title).toBe("Preshipment Inspection: Nitrile Disposable Examination Gloves");
    expect(template.sourceFile).toBe("BASE_EG/v1/report.xlsx");
  });

  it("adds header and conclusion when left out: header first, conclusion last (BUILD_SPEC 4.1)", () => {
    const definition = {
      ...baseEg(),
      modules: [
        { key: "packing_config", include: true },
        { key: "conclusion", include: true },
        { key: "glove_info", include: true },
      ],
    };
    const template = resolved(definition);
    expect(keys(template)).toEqual(["header", "packing_config", "glove_info", "conclusion"]);
    expect(moduleOf(template, "header")).toMatchObject({ include: true, title: "Manufacturer Information" });
  });

  it("writes sizes in their canonical spelling, labelled", () => {
    const template = resolved({ ...baseEg(), sizes: [{ value: "m", label: "Medium" }, { value: "xl" }] });
    expect(template.sizes).toEqual([
      { value: "M", label: "Medium" },
      { value: "XL", label: "XL" },
    ]);
  });

  it("titles the report after the template when it sets no report", () => {
    const definition: TemplateDefinition = { ...baseEg() };
    delete definition.report;
    delete definition.sourceFile;
    const template = resolved(definition);
    expect(template.report).toEqual({ title: "Standard examination gloves", showClientLogo: false });
    expect(template.sourceFile).toBeNull();
  });
});

describe("resolveTemplate: extends", () => {
  it("applies the client template's removals, additions and reordering", () => {
    const template = resolved(clientEg());
    expect(template.chain).toEqual(["CLIENT_EG", "BASE_EG"]);
    expect(keys(template)).toEqual([
      "header",
      "glove_info",
      "order_lots",
      "packing_config",
      "sampling_plan",
      "carton_sampling",
      "dimensions",
      "weight",
      "tensile",
      "force_at_break",
      "dispensing_safedon",
      "watertight",
      "visual",
      "dispensing_packing",
      "labeling",
      "conclusion",
    ]);
    expect(included(template)).not.toContain("force_at_break");
    expect(included(template)).not.toContain("dispensing_packing");
    expect(included(template)).toEqual(expect.arrayContaining(["tensile", "dispensing_safedon"]));
  });

  it("merges labels key by key: child over base over module default", () => {
    expect(moduleOf(resolved(clientEg()), "header").labels).toEqual({
      poNo: "PO Number",
      productName: "Product Name (Brand, code & description)",
      client: "Client Name",
    });
  });

  it("merges config objects key by key and replaces lists, then validates", () => {
    const template = resolved(clientEg());
    expect(moduleOf(template, "visual").config).toEqual({
      handSplit: false,
      classes: {
        critical: { aql: 0, defects: ["embedded_insect", "embedded_metal"] },
        major: { aql: 2.5, defects: ["thin_spot", "powder_mark"] },
        minor: { aql: 4, defects: ["dirt_small", "bead_defective"] },
      },
    });
    expect(moduleOf(template, "weight").config).toEqual({ n: 1, warnThresholdPct: 10 });
    expect(moduleOf(template, "packing_config").config).toEqual({ innerUnit: "plastic pack" });
  });

  it("replaces a spec the child changes to another kind instead of merging it (XS width ≤ 80 becomes 76 ± 4)", () => {
    expect(moduleOf(resolved(baseEg()), "dimensions").config).toMatchObject({
      statistic: "median",
      specs: { XS: { width: { kind: "max", max: 80 } } },
    });
    expect(moduleOf(resolved(clientEg()), "dimensions").config).toEqual({
      statistic: "average",
      specs: {
        XS: { length: { kind: "min", min: 240 }, width: { kind: "tolerance", nominal: 76, tolerance: 4 } },
        M: { length: { kind: "min", min: 240 }, width: { kind: "tolerance", nominal: 95, tolerance: 10 } },
      },
    });
  });

  it("reports a spec the child gives without its kind, instead of keeping the base's limit", () => {
    const child = clientEg();
    const dimensions = child.modules.find((entry) => entry.key === "dimensions");
    if (!dimensions) throw new Error("fixture");
    dimensions.config = { specs: { XS: { width: { nominal: 76, tolerance: 4 } } } };
    expect(problemsOf(child).map((problem) => problem.path.join("."))).toEqual([
      "modules.dimensions.config.specs.XS.width.kind",
    ]);
  });

  it("takes each value from the nearest template that sets it", () => {
    const template = resolved(clientEg());
    expect(moduleOf(template, "weight").title).toBe("Weight (g)");
    expect(template.name).toBe("Client A examination gloves");
    expect(template.scope.standard).toBe("ASTM_D6319");
    expect(template.sizes.map((size) => size.value)).toEqual(["XS", "S", "M", "L"]);
    expect(template.report).toEqual({ title: "Preshipment Inspection: Client A Nitrile Gloves", showClientLogo: true });
    // The base's source file is the base's form, not the client's.
    expect(template.sourceFile).toBeNull();
  });

  it("carries custom modules down the chain", () => {
    expect(resolved(clientEg()).customModules.map((custom) => custom.key)).toEqual(["dispensing_spec"]);
    expect(resolved(clientFactoryEg()).customModules.map((custom) => custom.key)).toEqual(["dispensing_spec"]);
  });

  it("resolves three levels: switched back on, relabelled, reconfigured, report inherited", () => {
    const template = resolved(clientFactoryEg());
    expect(template.chain).toEqual(["CLIENT_FACTORY_EG", "CLIENT_EG", "BASE_EG"]);
    expect(keys(template)).toEqual(keys(resolved(clientEg())));
    expect(included(template)).toContain("force_at_break");
    const visual = moduleOf(template, "visual");
    expect(visual.labels.thin_spot).toBe("Thin spot");
    expect(visual.labels.stain).toBe("Oil stain");
    // One defect worded per class (4.2 rule 4): the template's major wording, the module's minor one.
    expect(labelFor(visual.labels, "major", "bead_defective")).toBe("Bead defect");
    expect(labelFor(visual.labels, "minor", "bead_defective")).toBe("Defective beads");
    expect(labelFor(visual.labels, "major", "thin_spot")).toBe("Thin spot");
    expect(visual.config).toMatchObject({ handSplit: true, classes: { major: { defects: ["thin_spot", "powder_mark"] } } });
    expect(template.report.showClientLogo).toBe(true);
  });

  it("replaces a base custom module with the child's of the same key, in place", () => {
    const base = {
      ...baseEg(),
      customModules: [
        { key: "first", title: "First", after: "header", layout: "fields", fields: [{ key: "a", label: "A", type: "text" }] },
        { key: "second", title: "Second", after: "labeling", layout: "fields", fields: [{ key: "b", label: "B", type: "text" }] },
      ],
    };
    const child = {
      ...clientEg(),
      customModules: [
        { key: "first", title: "First, reworded", after: "weight", layout: "fields", fields: [{ key: "a", label: "A", type: "text" }] },
      ],
    };
    const template = resolved(child, lookupFrom([base]));
    expect(template.customModules.map((custom) => [custom.key, custom.title, custom.after])).toEqual([
      ["first", "First, reworded", "weight"],
      ["second", "Second", "labeling"],
    ]);
  });
});

describe("resolveTemplate: problems", () => {
  it("reports a base that does not exist", () => {
    expect(problemsOf(clientEg(), lookupFrom([]))).toEqual([
      { template: "CLIENT_EG", path: ["extends"], message: "Base template BASE_EG was not found." },
    ]);
  });

  it("detects templates that extend each other", () => {
    const a = { ...baseEg(), code: "LOOP_A", extends: "LOOP_B" };
    const b = { ...baseEg(), code: "LOOP_B", extends: "LOOP_A" };
    expect(problemsOf(a, lookupFrom([a, b]))).toEqual([
      { template: "LOOP_A", path: ["extends"], message: "Templates extend each other in a loop: LOOP_A -> LOOP_B -> LOOP_A." },
    ]);
  });

  it("stops a chain longer than the limit", () => {
    const chain = Array.from({ length: MAX_EXTENDS_DEPTH + 1 }, (_, index) => ({
      ...baseEg(),
      code: `LEVEL_${index}`,
      ...(index < MAX_EXTENDS_DEPTH ? { extends: `LEVEL_${index + 1}` } : {}),
    }));
    const problems = problemsOf(chain[0], lookupFrom(chain));
    expect(problems).toHaveLength(1);
    expect(problems[0].message).toContain(`More than ${MAX_EXTENDS_DEPTH}`);
  });

  it("reports a base's own schema problems under the base's code", () => {
    const base = { ...baseEg(), modules: [{ key: "labelling", include: true }] };
    expect(problemsOf(clientEg(), lookupFrom([base]))).toEqual([
      expect.objectContaining({ template: "BASE_EG", path: ["modules", 0, "key"] }),
    ]);
  });

  it("reports a lookup that answers with another template", () => {
    expect(problemsOf(clientEg(), () => clientFactoryEg())).toEqual([
      expect.objectContaining({ template: "CLIENT_FACTORY_EG", path: ["code"] }),
    ]);
  });

  it("validates each module's merged config with its schema", () => {
    const child = clientEg();
    child.modules.push({ key: "sampling_plan", include: true, config: { inspectionLevel: "IV" } });
    const weight = child.modules.find((module) => module.key === "weight");
    if (!weight) throw new Error("fixture");
    weight.config = { n: 0, warnThreshold: 5 };
    const paths = problemsOf(child).map((problem) => problem.path.join("."));
    expect(paths).toEqual(
      expect.arrayContaining(["modules.weight.config.n", "modules.weight.config", "modules.sampling_plan.config.inspectionLevel"]),
    );
  });

  it("keeps header and conclusion on", () => {
    const child = clientEg();
    const index = child.modules.push({ key: "conclusion", include: false }) - 1;
    expect(problemsOf(child)).toEqual([expect.objectContaining({ template: "CLIENT_EG", path: ["modules", index, "include"] })]);
  });

  it("requires order_lots while a per-size module is on: it gives them their sizes (6.2 rule 4)", () => {
    const child = clientEg();
    child.modules.push({ key: "order_lots", include: false });
    expect(problemsOf(child)).toEqual([
      {
        template: "CLIENT_EG",
        path: ["modules", "order_lots", "include"],
        message:
          "sampling_plan, carton_sampling, dimensions, weight, tensile, dispensing_safedon, watertight, visual, labeling show only the sizes ordered in order_lots, so order_lots must be on.",
      },
    ]);
    const withoutPerSize = {
      ...baseEg(),
      modules: [
        { key: "glove_info", include: true },
        { key: "packing_config", include: true },
      ],
    };
    expect(keys(resolved(withoutPerSize))).toEqual(["header", "glove_info", "packing_config", "conclusion"]);
  });

  it("checks that a custom module follows a module of the template", () => {
    const definition = {
      ...baseEg(),
      customModules: [
        { key: "extra", title: "Extra", after: "tensile", layout: "fields", fields: [{ key: "a", label: "A", type: "text" }] },
      ],
    };
    expect(problemsOf(definition)).toEqual([
      { template: "BASE_EG", path: ["customModules", "extra", "after"], message: "tensile is not a module of this template." },
    ]);
  });
});

describe("resolveTemplate: custom fields mapped to modules (Field.mapsTo)", () => {
  function withFields(fields: unknown[], modules = baseEg().modules) {
    return {
      ...baseEg(),
      modules,
      customModules: [{ key: "client_form", title: "Client form", after: "glove_info", layout: "fields", fields }],
    };
  }

  it("accepts a field mapped to a path the module declares", () => {
    const template = resolved(
      withFields([{ key: "weight", label: "Glove weight", type: "number", unit: "g", mapsTo: "modules.glove_info.indicativeWeight" }]),
    );
    expect(template.customModules[0].fields[0].mapsTo).toBe("modules.glove_info.indicativeWeight");
  });

  it.each([
    [
      "an undeclared path",
      { key: "a", label: "A", type: "text", mapsTo: "modules.glove_info.texture" },
      "glove_info has no field texture. It accepts: indicativeWeight, colour.",
    ],
    [
      "a module without mappable paths",
      { key: "a", label: "A", type: "text", mapsTo: "modules.dimensions.length" },
      "dimensions has no fields a custom field can map to.",
    ],
    [
      "a module the template does not have",
      { key: "a", label: "A", type: "text", mapsTo: "modules.tensile.strength" },
      "modules.tensile.strength points at a module this template does not have.",
    ],
    [
      "a field type that cannot hold the value",
      { key: "a", label: "A", type: "date", mapsTo: "modules.glove_info.indicativeWeight" },
      "A date field cannot hold modules.glove_info.indicativeWeight, which is number.",
    ],
    [
      "another unit",
      { key: "a", label: "A", type: "number", unit: "mm", mapsTo: "modules.glove_info.indicativeWeight" },
      "modules.glove_info.indicativeWeight is in g, not mm.",
    ],
  ])("rejects %s", (_name, field, message) => {
    expect(problemsOf(withFields([field])).map((problem) => problem.message)).toEqual([message]);
  });

  it("rejects a mapping into a module the template switches off", () => {
    const modules = baseEg().modules.map((module) => (module.key === "glove_info" ? { ...module, include: false } : module));
    const definition = withFields([{ key: "a", label: "A", type: "text", mapsTo: "modules.glove_info.colour" }], modules);
    expect(problemsOf(definition).map((problem) => problem.message)).toEqual([
      "modules.glove_info.colour points at glove_info, which this template switches off.",
    ]);
  });

  it("rejects two fields mapped to one value: it is entered once (6.2 rule 10)", () => {
    const definition = withFields([
      { key: "a", label: "A", type: "text", mapsTo: "modules.header.poNo" },
      { key: "b", label: "B", type: "textarea", mapsTo: "modules.header.poNo" },
    ]);
    expect(problemsOf(definition)).toEqual([
      {
        template: "BASE_EG",
        path: ["customModules", "client_form", "fields", "b", "mapsTo"],
        message: "modules.header.poNo is already mapped by client_form.a: a value is entered once.",
      },
    ]);
  });
});

describe("resolveTemplateOrThrow and lookupFrom", () => {
  it("lists every problem in the error", () => {
    expect(() => resolveTemplateOrThrow(clientEg(), { getBase: lookupFrom([]), registry: TEST_REGISTRY })).toThrow(
      "CLIENT_EG extends: Base template BASE_EG was not found.",
    );
  });

  it("finds definitions by code and ignores values without one", () => {
    const lookup = lookupFrom([baseEg(), null, "STD_EG", { name: "no code" }]);
    expect(lookup("BASE_EG")).toEqual(baseEg());
    expect(lookup("STD_EG")).toBeUndefined();
  });
});
