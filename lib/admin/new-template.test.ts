import { describe, expect, it } from "vitest";
import { TemplateDefinitionSchema, type TemplateDefinition } from "@/lib/schemas/template";
import { lookupFrom } from "@/lib/templates";
import { resolveTemplate } from "@/modules";
import {
  ANY,
  defaultSizing,
  NewTemplateInputSchema,
  newTemplateDefinition,
  NO_BASE,
  normaliseTemplateCode,
  readNewTemplateForm,
} from "./new-template";

const CLIENT_ID = "20000000-0000-4000-8000-000000000001";
const MAKER_ID = "10000000-0000-4000-8000-000000000001";

function form(fields: Record<string, string>) {
  return {
    code: "CLIENT_EG",
    name: "Client A nitrile gloves",
    base: "STD_EG",
    productType: "examination",
    standard: "ASTM_D6319",
    clientId: CLIENT_ID,
    manufacturerId: ANY,
    ...fields,
  };
}

function messagesOf(fields: Record<string, string>): Record<string, string> {
  const parsed = NewTemplateInputSchema.safeParse(form(fields));
  if (parsed.success) return {};
  return Object.fromEntries(parsed.error.issues.map((issue) => [String(issue.path[0]), issue.message]));
}

const STD_EG: TemplateDefinition = {
  code: "STD_EG",
  name: "Standard examination gloves (EN 455)",
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [{ value: "XS" }, { value: "S" }, { value: "M", label: "Medium" }, { value: "L" }, { value: "XL" }],
  modules: [
    { key: "header", include: true },
    { key: "glove_info", include: true },
    { key: "order_lots", include: true },
    { key: "watertight", include: true, title: "Freedom from Holes" },
    { key: "conclusion", include: true },
  ],
  report: { title: "Preshipment Inspection", showClientLogo: false },
  sourceFile: "STD_EG/v1/0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d/report.xlsx",
};

describe("the new template form", () => {
  it("writes a code as it is stored: capitals, spaces and hyphens as underscores", () => {
    expect(normaliseTemplateCode("  client a-eg ")).toBe("CLIENT_A_EG");
    expect(NewTemplateInputSchema.parse(form({ code: "safedon eg" })).code).toBe("SAFEDON_EG");
  });

  it("reads the choices: a base or none, a client or any", () => {
    expect(NewTemplateInputSchema.parse(form({}))).toEqual({
      code: "CLIENT_EG",
      name: "Client A nitrile gloves",
      base: "STD_EG",
      productType: "examination",
      standard: "ASTM_D6319",
      clientId: CLIENT_ID,
      manufacturerId: null,
    });
    expect(NewTemplateInputSchema.parse(form({ base: NO_BASE, clientId: ANY, manufacturerId: MAKER_ID }))).toMatchObject({
      base: null,
      clientId: null,
      manufacturerId: MAKER_ID,
    });
  });

  it("says plainly what is missing or wrong, field by field", () => {
    expect(messagesOf({ code: "", name: " ", base: "", productType: "", standard: "", clientId: "" })).toEqual({
      code: "Enter a code, e.g. CLIENT_EG.",
      name: "Enter a name, e.g. Client A nitrile gloves.",
      base: "Choose the template to build on, or None.",
      productType: "Choose the product type.",
      standard: "Choose the standard.",
      clientId: "Choose from the list.",
    });
    expect(messagesOf({ code: "1EG" }).code).toBe("Start the code with a letter, e.g. CLIENT_EG.");
    expect(messagesOf({ code: "EG/2026" }).code).toBe("Use only capital letters, digits and underscores: remove “/”.");
    expect(messagesOf({ code: "A".repeat(41) }).code).toMatch(/40 characters or fewer/);
  });

  it("reads the form's fields by name, missing ones as empty", () => {
    const data = new FormData();
    data.set("code", "X_EG");
    expect(readNewTemplateForm(data)).toMatchObject({ code: "X_EG", name: "", base: "" });
  });
});

describe("newTemplateDefinition", () => {
  it("lists only what it must on a base: code, name, base, scope, and the base's unit and sizes", () => {
    const input = NewTemplateInputSchema.parse(form({}));
    const definition = newTemplateDefinition(input, STD_EG);
    expect(definition).toEqual({
      code: "CLIENT_EG",
      name: "Client A nitrile gloves",
      extends: "STD_EG",
      scope: { productType: "examination", standard: "ASTM_D6319", clientId: CLIENT_ID },
      unit: "pcs",
      sizes: STD_EG.sizes,
      modules: [],
    });
    // A copy: the base's sizes stay its own.
    expect(definition.sizes).not.toBe(STD_EG.sizes);
    expect(TemplateDefinitionSchema.safeParse(definition).success).toBe(true);

    // It resolves to the base's modules, in the base's wording, with its report; never its source file.
    const resolution = resolveTemplate(definition, lookupFrom([{ definition: STD_EG, version: 3 }]));
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    expect(resolution.template.modules.map((entry) => entry.key)).toEqual(STD_EG.modules.map((entry) => entry.key));
    expect(resolution.template.modules.find((entry) => entry.key === "watertight")?.title).toBe("Freedom from Holes");
    expect(resolution.template.bases).toEqual([{ code: "STD_EG", version: 3 }]);
    expect(resolution.template.report).toEqual(STD_EG.report);
    expect(resolution.template.sourceFile).toBeNull();
  });

  it("starts a template of its own with the header and conclusion, sized for its product type", () => {
    const surgical = newTemplateDefinition(
      NewTemplateInputSchema.parse(form({ base: NO_BASE, productType: "surgical", standard: "ASTM_D3577", clientId: ANY })),
      null,
    );
    expect(surgical).toEqual({
      code: "CLIENT_EG",
      name: "Client A nitrile gloves",
      scope: { productType: "surgical", standard: "ASTM_D3577" },
      unit: "pairs",
      sizes: defaultSizing("surgical").sizes,
      modules: [],
    });
    expect(defaultSizing("surgical").sizes.map((size) => size.value)).toEqual(["5.5", "6.0", "6.5", "7.0", "7.5", "8.0", "8.5", "9.0"]);
    expect(defaultSizing("examination")).toEqual({
      unit: "pcs",
      sizes: ["XS", "S", "M", "L", "XL"].map((value) => ({ value })),
    });
    const resolution = resolveTemplate(surgical, lookupFrom([]));
    if (!resolution.ok) throw new Error(JSON.stringify(resolution.problems));
    expect(resolution.template.modules.map((entry) => entry.key)).toEqual(["header", "conclusion"]);
  });
});
