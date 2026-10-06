import { describe, expect, it } from "vitest";
import {
  CustomModuleSchema,
  FieldSchema,
  ModuleOverridesSchema,
  ResolvedTemplateSchema,
  TemplateDefinitionSchema,
  type CustomModule,
  type ResolvedTemplate,
  type TemplateDefinition,
} from "./template";

const CLIENT_ID = "20000000-0000-4000-8000-000000000001";
const ADMIN_ID = "00000000-0000-4000-8000-000000000102";

function baseDefinition(): TemplateDefinition {
  return {
    code: "BASE_EG",
    name: "Base examination gloves",
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: [{ value: "XS" }, { value: "S" }, { value: "M", label: "Medium" }, { value: "L" }, { value: "XL" }],
    modules: [
      { key: "header", include: true, labels: { factoryGloveCode: "Factory glove code" } },
      { key: "glove_info", include: true, config: { fields: { colour: false } } },
      { key: "order_lots", include: true },
      { key: "conclusion", include: true },
    ],
  };
}

function customModule(): CustomModule {
  return {
    key: "safedon_spec",
    title: "Specification / Requirement",
    after: "dispensing_safedon",
    layout: "table",
    fields: [
      { key: "requirement", label: "Specification / Requirement", type: "text" },
      { key: "conclusion", label: "Conclusion", type: "select", options: ["Passed", "Failed"] },
    ],
  };
}

function issuePaths(schema: { safeParse: (value: unknown) => { success: boolean; error?: { issues: { path: PropertyKey[] }[] } } }, value: unknown) {
  const result = schema.safeParse(value);
  return result.success ? [] : (result.error?.issues ?? []).map((issue) => issue.path.map(String).join("."));
}

describe("TemplateDefinitionSchema", () => {
  it("accepts a base template and a client template that extends it", () => {
    expect(TemplateDefinitionSchema.parse(baseDefinition())).toEqual(baseDefinition());
    const child: TemplateDefinition = {
      ...baseDefinition(),
      code: "CLIENT_EG",
      extends: "BASE_EG",
      scope: { productType: "examination", standard: "ASTM_D6319", clientId: CLIENT_ID },
      modules: [{ key: "force_at_break", include: false }],
      customModules: [customModule()],
      report: { title: "Preshipment Inspection", showClientLogo: true },
      sourceFile: "CLIENT_EG/v1/report.xlsx",
    };
    expect(TemplateDefinitionSchema.safeParse(child).success).toBe(true);
  });

  it.each([
    ["code", { code: "std_eg" }],
    ["code", { code: "1EG" }],
    ["extends", { extends: "base-eg" }],
    ["extends", { extends: "BASE_EG" }],
    ["unit", { unit: "boxes" }],
    ["scope.productType", { scope: { productType: "industrial", standard: "EN455" } }],
    ["scope.standard", { scope: { productType: "examination", standard: "EN374" } }],
    ["scope.clientId", { scope: { productType: "examination", standard: "EN455", clientId: "client-1" } }],
    ["sizes", { sizes: [] }],
    ["sizes.0.value", { sizes: [{ value: "XXXL" }] }],
    ["sizes.1.value", { sizes: [{ value: "7" }, { value: "7.0" }] }],
  ])("rejects a bad %s", (path, change) => {
    expect(issuePaths(TemplateDefinitionSchema, { ...baseDefinition(), ...change })).toContain(path);
  });

  it("rejects unknown keys at every level, so a typo is never silently dropped", () => {
    expect(issuePaths(TemplateDefinitionSchema, { ...baseDefinition(), extend: "BASE_EG" })).toContain("");
    const definition = baseDefinition();
    Object.assign(definition.modules[1], { inculde: true });
    expect(issuePaths(TemplateDefinitionSchema, definition)).toContain("modules.1");
  });

  it("rejects unknown and repeated modules", () => {
    const definition = baseDefinition();
    definition.modules.push({ key: "glove_info", include: false });
    expect(issuePaths(TemplateDefinitionSchema, definition)).toEqual(["modules.4.key"]);
    expect(
      issuePaths(TemplateDefinitionSchema, { ...baseDefinition(), modules: [{ key: "labelling", include: true }] }),
    ).toEqual(["modules.0.key"]);
  });

  it("keeps header and conclusion on (BUILD_SPEC 4.1)", () => {
    const definition = baseDefinition();
    definition.modules[0].include = false;
    definition.modules[3].include = false;
    expect(issuePaths(TemplateDefinitionSchema, definition)).toEqual(["modules.0.include", "modules.3.include"]);
  });

  it("requires module config to be a JSON object and labels to be words", () => {
    const definition = baseDefinition();
    Object.assign(definition.modules[1], { config: ["colour"] });
    expect(issuePaths(TemplateDefinitionSchema, definition)).toContain("modules.1.config");
    const labelled = baseDefinition();
    labelled.modules[0].labels = { factoryGloveCode: " " };
    expect(issuePaths(TemplateDefinitionSchema, labelled)).toContain("modules.0.labels.factoryGloveCode");
  });

  it("accepts label keys for one class or level, such as minor.bead_defective, and rejects malformed ones", () => {
    const labelled = baseDefinition();
    labelled.modules[0].labels = { "major.bead_defective": "Defective bead", "minor.bead_defective": "Defective beads" };
    expect(issuePaths(TemplateDefinitionSchema, labelled)).toEqual([]);
    for (const key of ["minor.", ".bead_defective", "minor..bead_defective", "1st.label", "minor bead"]) {
      const broken = baseDefinition();
      broken.modules[0].labels = { [key]: "Label" };
      expect(issuePaths(TemplateDefinitionSchema, broken)).toContain(`modules.0.labels.${key}`);
    }
  });

  it("rejects repeated custom module keys", () => {
    const definition = { ...baseDefinition(), customModules: [customModule(), customModule()] };
    expect(issuePaths(TemplateDefinitionSchema, definition)).toEqual(["customModules.1.key"]);
  });
});

describe("FieldSchema", () => {
  it("accepts every field type of BUILD_SPEC 4.3", () => {
    const fields = [
      { key: "boxes", label: "Boxes checked", type: "counter", unit: "pcs", min: 0, max: 50 },
      { key: "rh", label: "Relative humidity", type: "number", unit: "%", min: 0, max: 100, required: true },
      { key: "note", label: "Note", type: "text", hint: "As printed on the carton" },
      { key: "remark", label: "Remark", type: "textarea" },
      { key: "seal", label: "Seal", type: "select", options: ["Intact", "Broken"] },
      { key: "sealed", label: "Sealed", type: "yes_no" },
      { key: "loadedOn", label: "Loaded on", type: "date" },
      { key: "evidence", label: "Photo", type: "photo" },
      { key: "weight", label: "Indicative weight", type: "number", unit: "g", mapsTo: "modules.glove_info.indicativeWeight" },
    ];
    for (const field of fields) expect(FieldSchema.safeParse(field).success).toBe(true);
  });

  it.each([
    ["type", { key: "a", label: "A", type: "slider" }],
    ["unit", { key: "a", label: "A", type: "number", unit: "kg" }],
    ["options", { key: "a", label: "A", type: "select" }],
    ["options", { key: "a", label: "A", type: "select", options: ["X", "X"] }],
    ["options", { key: "a", label: "A", type: "text", options: ["X"] }],
    ["unit", { key: "a", label: "A", type: "text", unit: "mm" }],
    ["min", { key: "a", label: "A", type: "date", min: 1 }],
    ["max", { key: "a", label: "A", type: "number", min: 5, max: 1 }],
    ["key", { key: "1a", label: "A", type: "text" }],
    ["label", { key: "a", label: " ", type: "text" }],
    ["mapsTo", { key: "a", label: "A", type: "text", mapsTo: "glove_info.colour" }],
    ["mapsTo", { key: "a", label: "A", type: "text", mapsTo: "modules.gloves.colour" }],
  ])("rejects a bad %s", (path, field) => {
    expect(issuePaths(FieldSchema, field)).toContain(path);
  });
});

describe("CustomModuleSchema", () => {
  it("accepts each layout", () => {
    expect(CustomModuleSchema.safeParse(customModule()).success).toBe(true);
    expect(
      CustomModuleSchema.safeParse({
        key: "box_check",
        title: "Box check",
        after: "labeling",
        layout: "grid",
        fields: [{ key: "sealIntact", label: "Seal intact", type: "yes_no" }],
        grid: { repeatPer: "size", columns: { label: "Box #", default: 13, addable: true } },
      }).success,
    ).toBe(true);
    expect(
      CustomModuleSchema.safeParse({
        key: "humidity",
        title: "Warehouse humidity",
        after: "packing_config",
        layout: "fields",
        fields: [{ key: "rh", label: "Relative humidity", type: "number", unit: "%" }],
      }).success,
    ).toBe(true);
  });

  it.each([
    ["key", { key: "weight" }],
    ["key", { key: "Custom" }],
    ["after", { after: "nowhere" }],
    ["layout", { layout: "cards" }],
    ["fields", { fields: [] }],
    ["grid", { layout: "grid" }],
    ["grid", { grid: { columns: { label: "Box #", default: 13, addable: true } } }],
    ["fields.1.key", { fields: [{ key: "a", label: "A", type: "text" }, { key: "a", label: "B", type: "text" }] }],
    ["fields.0.mapsTo", { fields: [{ key: "a", label: "A", type: "text", mapsTo: "modules.glove_info.colour" }] }],
  ])("rejects a bad %s", (path, change) => {
    expect(issuePaths(CustomModuleSchema, { ...customModule(), ...change })).toContain(path);
  });
});

describe("ModuleOverridesSchema", () => {
  const override = { reason: "Lab report not available", by: ADMIN_ID, at: "2026-10-06T08:00:00.000Z" };

  it("accepts modules switched off with a reason, by an admin, at a time", () => {
    expect(ModuleOverridesSchema.safeParse({}).success).toBe(true);
    expect(ModuleOverridesSchema.safeParse({ force_at_break: override }).success).toBe(true);
  });

  it("rejects unknown modules and a missing reason", () => {
    expect(ModuleOverridesSchema.safeParse({ labelling: override }).success).toBe(false);
    expect(ModuleOverridesSchema.safeParse({ weight: { ...override, reason: "  " } }).success).toBe(false);
    expect(ModuleOverridesSchema.safeParse({ weight: { reason: "x" } }).success).toBe(false);
  });
});

describe("ResolvedTemplateSchema", () => {
  function resolved(): ResolvedTemplate {
    return {
      format: 2,
      code: "BASE_EG",
      name: "Base examination gloves",
      chain: ["BASE_EG"],
      bases: [],
      scope: { productType: "examination", standard: "EN455" },
      unit: "pcs",
      sizes: [{ value: "M", label: "M" }],
      modules: [
        { key: "header", include: true, title: "Manufacturer Information", labels: {}, config: {} },
        { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
      ],
      customModules: [],
      report: { title: "Base examination gloves", showClientLogo: false },
      sourceFile: null,
    };
  }

  it("accepts a resolved template and round-trips through JSON", () => {
    expect(ResolvedTemplateSchema.parse(JSON.parse(JSON.stringify(resolved())))).toEqual(resolved());
  });

  it("stores sizes in their canonical spelling only", () => {
    expect(issuePaths(ResolvedTemplateSchema, { ...resolved(), sizes: [{ value: "7", label: "7" }] })).toEqual([
      "sizes.0.value",
    ]);
  });

  it("rejects another format, such as format 1 without base versions", () => {
    expect(issuePaths(ResolvedTemplateSchema, { ...resolved(), format: 1 })).toEqual(["format"]);
  });

  it("records the version of each base, in chain order", () => {
    const child = { ...resolved(), code: "CHILD_EG", chain: ["CHILD_EG", "BASE_EG"], bases: [{ code: "BASE_EG", version: 3 }] };
    expect(issuePaths(ResolvedTemplateSchema, child)).toEqual([]);
    expect(issuePaths(ResolvedTemplateSchema, { ...child, bases: [] })).toEqual(["bases"]);
    expect(issuePaths(ResolvedTemplateSchema, { ...child, bases: [{ code: "OTHER_EG", version: 3 }] })).toEqual(["bases"]);
    expect(issuePaths(ResolvedTemplateSchema, { ...child, bases: [{ code: "BASE_EG", version: 0 }] })).toEqual([
      "bases.0.version",
    ]);
    expect(issuePaths(ResolvedTemplateSchema, { ...child, chain: ["BASE_EG", "BASE_EG"] })).toEqual(["bases"]);
  });
});
