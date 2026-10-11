import { describe, expect, it } from "vitest";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import type { ModuleKey } from "@/lib/schemas/module-result";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import type { TemplateCandidate } from "@/lib/templates/select";
import { buildSeedBundle, SEED_TEMPLATES } from "@/lib/templates/definitions";
import { parseModuleData, readModuleEntry, type InspectionData } from "@/modules/_framework";
import { TEST_CLIENT_ID, TEST_MANUFACTURER_ID, TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateCapture } from "./capture/evaluate";
import { mirroredColumns } from "./capture/mirror";
import {
  choiceReason,
  chooseTemplate,
  COPIED_MODULE_KEYS,
  copiedFieldsOff,
  copiedInWords,
  copiesOf,
  copyFromPrevious,
  describeCreateError,
  fieldErrorsOf,
  headerHidesProductName,
  headerPrefill,
  latestPerProduct,
  newInspectionData,
  NewInspectionInputSchema,
  NO_CLIENT,
  plannedCopy,
  PREVIOUS_COPY,
  previousFor,
  previousMatches,
  productKey,
  productNameField,
  readNewInspectionForm,
  templateShowsField,
  todayInMalaysia,
  type PreviousInspectionRow,
} from "./create";

const CLIENT = "20000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "20000000-0000-4000-8000-000000000002";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";
const OTHER_MANUFACTURER = "10000000-0000-4000-8000-000000000002";

function form(values: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) data.set(key, value);
  return data;
}

function parse(values: Record<string, string>) {
  return NewInspectionInputSchema.safeParse(readNewInspectionForm(form(values)));
}

/** The seed templates as the real registry resolves them today. */
const seeds = new Map(buildSeedBundle(SEED_TEMPLATES, MODULE_REGISTRY).templates.map((entry) => [entry.code, entry.resolved]));
const STD_EG = seeds.get("STD_EG")!;
const STD_SG = seeds.get("STD_SG")!;

/**
 * The values given, and nothing else: every other key of the module's data
 * is empty. Holds for the placeholder modules and for the built ones, whose
 * empty data lists every field as null.
 */
function expectOnly(actual: unknown, expected: Record<string, unknown>) {
  expect(actual).toMatchObject(expected);
  const others = Object.entries(actual as Record<string, unknown>).filter(([key]) => !(key in expected));
  expect(Object.fromEntries(others.filter(([, value]) => value !== null))).toEqual({});
}

/** A copy of the template with one module's config replaced. */
function withConfig(template: ResolvedTemplate, key: ModuleKey, config: Record<string, unknown>): ResolvedTemplate {
  return {
    ...template,
    modules: template.modules.map((entry) => (entry.key === key ? { ...entry, config: { ...entry.config, ...config } } : entry)),
  } as ResolvedTemplate;
}

describe("the form", () => {
  it("reads client, manufacturer, product type and product name", () => {
    const parsed = parse({ clientId: CLIENT, manufacturerId: MANUFACTURER, productType: "examination", productName: "  Nitrile blue  " });
    expect(parsed.success && parsed.data).toEqual({
      clientId: CLIENT,
      manufacturerId: MANUFACTURER,
      productType: "examination",
      productName: "Nitrile blue",
      templateId: undefined,
      previousId: undefined,
    });
  });

  it("takes No client as no client, and an empty product name as none", () => {
    const parsed = parse({ clientId: NO_CLIENT, manufacturerId: MANUFACTURER, productType: "surgical", productName: " " });
    expect(parsed.success && [parsed.data.clientId, parsed.data.productName]).toEqual([null, null]);
  });

  it("asks for every choice it is missing, in words", () => {
    const parsed = parse({});
    expect(parsed.success).toBe(false);
    expect(fieldErrorsOf(parsed.error!)).toEqual({
      clientId: "Choose the client, or No Client.",
      manufacturerId: "Choose the manufacturer.",
      productType: "Choose the product type.",
    });
  });

  it("refuses what is not an id, a product type or a sensible name", () => {
    const parsed = parse({
      clientId: "Polyco",
      manufacturerId: "1",
      productType: "industrial",
      productName: "x".repeat(301),
      templateId: "STD_EG",
      previousId: "INS-2026-0001",
    });
    expect(Object.keys(fieldErrorsOf(parsed.error!)).sort()).toEqual(
      ["clientId", "manufacturerId", "previousId", "productName", "productType", "templateId"].sort(),
    );
  });

  it("ignores files and fields it does not know", () => {
    const data = form({ clientId: NO_CLIENT, manufacturerId: MANUFACTURER, productType: "examination", extra: "x" });
    data.set("productName", new Blob(["x"]));
    expect(readNewInspectionForm(data)).toEqual({
      clientId: NO_CLIENT,
      manufacturerId: MANUFACTURER,
      productType: "examination",
      productName: "",
      templateId: "",
      previousId: "",
    });
  });
});

describe("choosing the template (BUILD_SPEC 4.4)", () => {
  const candidate = (id: string, code: string, extra: Partial<TemplateCandidate> = {}): TemplateCandidate => ({
    id,
    code,
    version: 1,
    status: "active",
    productType: "examination",
    standard: "EN455",
    clientId: null,
    manufacturerId: null,
    ...extra,
  });
  const candidates = [
    candidate("00000000-0000-4000-8000-000000000001", "STD_EG"),
    candidate("00000000-0000-4000-8000-000000000002", "SAFEDON_EG", { clientId: CLIENT, standard: "ASTM_D6319" }),
    candidate("00000000-0000-4000-8000-000000000003", "STD_SG", { productType: "surgical", standard: "custom" }),
    candidate("00000000-0000-4000-8000-000000000004", "DRAFT_EG", { status: "draft", clientId: CLIENT }),
    candidate("00000000-0000-4000-8000-000000000005", "OLD_EG", { status: "retired" }),
  ];
  const picks = { productType: "examination" as const, clientId: CLIENT, manufacturerId: MANUFACTURER, templateId: undefined };

  it("takes the most specific active template", () => {
    const choice = chooseTemplate(candidates, picks, "inspector");
    expect(choice.ok && [choice.template.code, choice.specificity]).toEqual(["SAFEDON_EG", "client"]);
    const standard = chooseTemplate(candidates, { ...picks, clientId: OTHER_CLIENT }, "inspector");
    expect(standard.ok && [standard.template.code, standard.specificity]).toEqual(["STD_EG", "standard"]);
  });

  it("lets only an admin choose, from templates that are not retired and are for the same product", () => {
    const draft = { ...picks, templateId: "00000000-0000-4000-8000-000000000004" };
    expect(chooseTemplate(candidates, draft, "inspector")).toEqual({
      ok: false,
      field: "templateId",
      message: "Only an admin can choose the template.",
    });
    const chosen = chooseTemplate(candidates, draft, "admin");
    expect(chosen.ok && [chosen.template.code, chosen.specificity]).toEqual(["DRAFT_EG", "override"]);
    expect(chooseTemplate(candidates, { ...picks, templateId: "00000000-0000-4000-8000-000000000005" }, "admin")).toMatchObject({
      ok: false,
      field: "templateId",
      message: expect.stringMatching(/OLD_EG version 1 is retired/),
    });
    expect(chooseTemplate(candidates, { ...picks, templateId: "00000000-0000-4000-8000-000000000003" }, "admin")).toEqual({
      ok: false,
      field: "templateId",
      message: "STD_SG is for surgical gloves. Choose one for examination gloves.",
    });
  });

  it("says when no template applies", () => {
    expect(chooseTemplate(candidates.slice(0, 2), { ...picks, productType: "surgical" }, "inspector")).toEqual({
      ok: false,
      message: "No active template for surgical gloves fits these choices. An admin needs to activate one.",
    });
  });

  it("explains each choice in plain words", () => {
    const names = { client: "Polyco Healthline", manufacturer: "Hartalega NGC" };
    expect(choiceReason("client_manufacturer", names, "examination")).toBe("For Polyco Healthline at Hartalega NGC");
    expect(choiceReason("client", names, "examination")).toBe("For Polyco Healthline");
    expect(choiceReason("manufacturer", names, "examination")).toBe("For Hartalega NGC");
    expect(choiceReason("standard", names, "surgical")).toBe("Standard Template for Surgical Gloves");
    expect(choiceReason("override", names, "examination")).toBe("Chosen by an Admin");
    // The chip names a missing name in its own Title Case words.
    const none = { client: null, manufacturer: null };
    expect(choiceReason("client_manufacturer", none, "examination")).toBe("For This Client at This Manufacturer");
    for (const specificity of ["client_manufacturer", "client", "manufacturer", "standard", "override"] as const) {
      expect(lowerCaseWords(choiceReason(specificity, none, "surgical"))).toEqual([]);
    }
  });
});

describe("start from previous: which inspection", () => {
  const row = (id: string, extra: Partial<PreviousInspectionRow> = {}): PreviousInspectionRow => ({
    id,
    ref_no: `INS-2026-${id}`,
    inspection_date: "2026-10-01",
    status: "submitted",
    created_at: "2026-10-01T02:00:00Z",
    client_id: CLIENT,
    manufacturer_id: MANUFACTURER,
    product_name: "Nitrile blue",
    template: { code: "STD_EG", version: 1, product_type: "examination" },
    ...extra,
  });

  it("keeps the latest inspection of each product, newest first", () => {
    const products = latestPerProduct([
      row("0001", { inspection_date: "2026-09-01" }),
      row("0002", { inspection_date: "2026-10-02", product_name: "nitrile  BLUE " }),
      row("0003", { inspection_date: "2026-10-02", created_at: "2026-10-02T01:00:00Z", product_name: "Nitrile white" }),
      row("0004", { inspection_date: "2026-10-02", created_at: "2026-10-02T03:00:00Z", product_name: "Nitrile white" }),
      row("0005", { client_id: null }),
      row("0006", { template: { code: "STD_SG", version: 2, product_type: "surgical" } }),
      row("0007", { manufacturer_id: null }),
      row("0008", { template: null }),
      row("0009", { product_name: "  ", inspection_date: "2026-08-01" }),
    ]);
    expect(products.map((product) => [product.refNo, product.productName])).toEqual([
      ["INS-2026-0004", "Nitrile white"],
      ["INS-2026-0002", "nitrile  BLUE"],
      ["INS-2026-0005", "Nitrile blue"],
      ["INS-2026-0006", "Nitrile blue"],
      ["INS-2026-0009", null],
    ]);
    expect(productKey(" Nitrile   Blue ")).toBe("nitrile blue");
  });

  it("notes what each product's latest inspection holds to copy", () => {
    const [product] = latestPerProduct([
      row("0001", {
        header: { poNo: "PO-1", productName: "Nitrile blue", factoryAddress: " ", comment: "Checked." },
        glove_info: { colour: null, comment: "Nothing yet." },
        packing_config: { glovesPerInner: 100 },
      }),
    ]);
    expect(product.copies).toEqual({ header: ["productName"], packing_config: ["glovesPerInner"] });
    // A row read without its modules has nothing to copy.
    expect(latestPerProduct([row("0002")])[0].copies).toEqual({});
  });

  it("fills the product name from a picked product until it is edited, and gives back what was typed", () => {
    const named = { inspectionId: "i1", productName: "Nitrile blue" };
    const unnamed = { inspectionId: "i2", productName: null };
    // Picked: the product's name.
    expect(productNameField("typed", "i1", named)).toBe("Nitrile blue");
    // Start blank, an unnamed product, or a pick the changed choices no longer offer: what was typed.
    expect(productNameField("typed", "i1", null)).toBe("typed");
    expect(productNameField("typed", null, unnamed)).toBe("typed");
    expect(productNameField("", "i1", unnamed)).toBe("");
    // Edited after the pick: the edit stands.
    expect(productNameField("Nitrile blue, 240 mm", null, named)).toBe("Nitrile blue, 240 mm");
  });

  it("offers only the products of the same client, manufacturer and product type", () => {
    const products = latestPerProduct([
      row("0001"),
      row("0002", { client_id: null }),
      row("0003", { manufacturer_id: OTHER_MANUFACTURER }),
      row("0004", { template: { code: "STD_SG", version: 1, product_type: "surgical" } }),
    ]);
    const refs = (clientId: string | null, manufacturerId: string | null, productType: "examination" | "surgical" | null) =>
      previousFor(products, { clientId, manufacturerId, productType }).map((product) => product.refNo);
    expect(refs(CLIENT, MANUFACTURER, "examination")).toEqual(["INS-2026-0001"]);
    expect(refs(null, MANUFACTURER, "examination")).toEqual(["INS-2026-0002"]);
    expect(refs(CLIENT, MANUFACTURER, "surgical")).toEqual(["INS-2026-0004"]);
    expect(refs(CLIENT, null, "examination")).toEqual([]);
    expect(refs(CLIENT, MANUFACTURER, null)).toEqual([]);
    const previous = { clientId: CLIENT, manufacturerId: MANUFACTURER, productType: "examination" as const };
    expect(previousMatches(previous, { clientId: CLIENT, manufacturerId: MANUFACTURER, productType: "examination" })).toBe(true);
    expect(previousMatches(previous, { clientId: null, manufacturerId: MANUFACTURER, productType: "examination" })).toBe(false);
  });
});

describe("start from previous: what is copied", () => {
  const previous = {
    modules: {
      header: {
        manufacturer: "Manufacturer A",
        factoryAddress: "Factory address A",
        poNo: "PO-0001",
        productName: "Brand A nitrile, code GN-0001",
        productCode: "GN-0001",
        client: "Client A",
        factoryGloveCode: "FGC-01",
        inspectionDate: "2026-09-01",
        mfgDate: "2026-08-01",
        expiryDate: "2029-07-31",
        comment: "Header checked against the PO.",
      },
      glove_info: { surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: "240 mm min", comment: "As printed." },
      packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: "10 boxes per carton" },
      order_lots: { lots: [{ size: "M", qtyCases: 400, lotNumbers: ["LOT-M-0001"] }] },
      sampling_plan: { sizes: { M: { cases: 20 } } },
      conclusion: { finalResult: "pass", remark: "All good." },
    },
    custom: { glove_type: { gloveType: "Powder free" } },
  };

  it("copies the product's facts from the header, and glove information and packing whole", () => {
    const { modules, copied } = copyFromPrevious(previous, STD_EG, MODULE_REGISTRY);
    expect(copied).toEqual(["header", "glove_info", "packing_config"]);
    expectOnly(modules.header, {
      factoryAddress: "Factory address A",
      productName: "Brand A nitrile, code GN-0001",
      productCode: "GN-0001",
      factoryGloveCode: "FGC-01",
    });
    // Saved before variants: copied as the first variant, covering every size.
    expect(modules.glove_info).toEqual({ variants: [{ sizes: [], gloveType: null, surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: 240 }] });
    expectOnly(modules.packing_config, { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: "10 boxes per carton" });
  });

  it("never copies the PO, dates, lots, other modules, results, comments or custom modules", () => {
    const { data } = newInspectionData({
      template: STD_EG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: null,
      previous,
    });
    const text = JSON.stringify(data);
    for (const kept of ["PO-0001", "2026-09-01", "2026-08-01", "2029-07-31", "LOT-M-0001", "All good.", "Powder free", "Client A"]) {
      expect(text, kept).not.toContain(kept);
    }
    expect(text).not.toContain('"comment"');
    expect(data.custom).toEqual({});
  });

  it("copies nothing into a module the new template switches off, or from a module with nothing in it", () => {
    expect(copyFromPrevious(previous, STD_SG, MODULE_REGISTRY).copied).toEqual(["header", "packing_config"]);
    const empty = { modules: { glove_info: { colour: null, comment: "Nothing yet." }, header: { poNo: "PO-1" } }, custom: {} };
    expect(copyFromPrevious(empty, STD_EG, MODULE_REGISTRY)).toEqual({ modules: {}, copied: [] });
  });

  it("leaves behind a field the new template switches off", () => {
    // STD_SG's header has no factory address or factory glove code (onsite/SG.md).
    const { modules } = copyFromPrevious(previous, STD_SG, MODULE_REGISTRY);
    expectOnly(modules.header, { productName: "Brand A nitrile, code GN-0001", productCode: "GN-0001" });
    const noColour = withConfig(STD_EG, "glove_info", { fields: { surfaceTexture: true, indicativeWeight: true, colour: false, length: true } });
    expect(copyFromPrevious(previous, noColour, MODULE_REGISTRY).modules.glove_info).toEqual(
      { variants: [{ sizes: [], gloveType: null, surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: null, length: 240 }] },
    );
  });

  it("keeps to each module's schema: a value it does not take is left out", () => {
    // The test registry's header knows poNo, productName and client; its glove_info indicativeWeight and colour;
    // its packing_config the three counts.
    const template = makeTestTemplate(TEST_REGISTRY, ["header", "glove_info", "packing_config"]);
    const { modules, copied } = copyFromPrevious(previous, template, TEST_REGISTRY);
    expect(copied).toEqual(["header", "glove_info", "packing_config"]);
    expect(modules).toEqual({
      header: { poNo: null, productName: "Brand A nitrile, code GN-0001", client: null },
      glove_info: { indicativeWeight: 3.5, colour: "Blue" },
      packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000 },
    });
  });

  it("knows what an earlier inspection holds to copy: copied fields with a value, never the comment", () => {
    expect(copiesOf(previous)).toEqual({
      header: ["factoryAddress", "productName", "productCode", "factoryGloveCode"],
      glove_info: ["surfaceTexture", "indicativeWeight", "colour", "length"],
      packing_config: ["glovesPerInner", "innersPerCase", "glovesPerCase", "packingMode"],
    });
    const empty = { modules: { glove_info: { colour: null, comment: "Nothing yet." }, header: { poNo: "PO-1" } }, custom: {} };
    expect(copiesOf(empty)).toEqual({});
    expect(copiesOf({ modules: {}, custom: {} })).toEqual({});
  });

  it("plans the copy a template takes, and says it in words", () => {
    const copies = copiesOf(previous);
    const option = (template: ResolvedTemplate) => ({
      titles: Object.fromEntries(template.modules.filter((entry) => entry.include).map((entry) => [entry.key, entry.title])),
      fieldsOff: copiedFieldsOff(template),
    });
    expect(copiedFieldsOff(STD_EG)).toEqual({});
    expect([...(copiedFieldsOff(STD_SG).header ?? [])].sort()).toEqual(["client", "factoryAddress", "factoryGloveCode"]);

    expect(plannedCopy(copies, option(STD_EG)).map(({ key, fields }) => `${key}: ${copiedInWords(key, fields)}`)).toEqual([
      "header: factory address, product name, product code and factory glove code",
      "glove_info: every field",
      "packing_config: every field",
    ]);
    // STD_SG has no glove information, factory address or factory glove code: the copy leaves them behind.
    expect(plannedCopy(copies, option(STD_SG)).map(({ key, fields }) => `${key}: ${copiedInWords(key, fields)}`)).toEqual([
      "header: product name and product code",
      "packing_config: every field",
    ]);
    // Before a template is known: everything held.
    expect(plannedCopy({ header: ["productName"] }, null)).toEqual([{ key: "header", fields: ["productName"] }]);
    expect(plannedCopy({}, option(STD_EG))).toEqual([]);
    expect(copiedInWords("header", ["productCode"])).toBe("product code");
  });

  it("starts a module empty when none of its saved values fit any more", () => {
    const template = makeTestTemplate(TEST_REGISTRY, ["header", "glove_info"]);
    const stale = { modules: { glove_info: { indicativeWeight: "3.5 g", tint: "Blue" } }, custom: {} };
    expect(copyFromPrevious(stale, template, TEST_REGISTRY)).toEqual({ modules: {}, copied: [] });
  });
});

describe("start from previous with the real modules, for every seed template", () => {
  /**
   * An earlier inspection as the real modules save it: the product's facts,
   * this shipment's own values (PO, dates, order, sampling, cartons,
   * readings), the result, comments and a custom module.
   */
  const earlier: InspectionData = {
    modules: {
      header: {
        factoryAddress: "Factory address A",
        poNo: "PO-0001 (SO-0001)",
        productName: "Brand A nitrile, code GN-0001",
        productCode: "GN-0001",
        factoryGloveCode: "FGC-01",
        inspectionDate: "2026-09-01",
        mfgDate: "2026-08-01",
        expiryDate: "2029-07-31",
        comment: "Header checked against the PO.",
      },
      glove_info: { surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: "240 mm minimum", comment: "As printed." },
      order_lots: { sizes: { M: { qtyCases: 400, lotNumbers: ["LOT-M-0001"], packingSite: "Packing site A" } } },
      packing_config: { glovesPerInner: 100, innersPerCase: 10, glovesPerCase: 1000, packingMode: "10 boxes per carton" },
      sampling_plan: { sizes: { M: { cases: 2, gloves: 200, glovesWatertightVisual: 200 } } },
      carton_sampling: { sizes: { M: { cartonNumbers: [32, 578] } } },
      weight: { sizes: { M: { values: [3.41, 3.62] } } },
      conclusion: { finalResult: "pass", remark: "All good.", date: "2026-09-02" },
    },
    custom: { glove_type: { gloveType: "Powder free" } },
  };
  const META = {
    refNo: "INS-2026-0002",
    inspectionDate: "2026-10-06",
    inspector: { id: "00000000-0000-4000-8000-000000000101", name: "Inspector A" },
    client: null,
    manufacturer: null,
  };

  it("starts from an inspection every real module reads", () => {
    for (const key of Object.keys(earlier.modules) as ModuleKey[]) {
      expect(parseModuleData(MODULE_REGISTRY[key], readModuleEntry(earlier, "modules", key)).success, key).toBe(true);
    }
  });

  for (const code of ["STD_EG", "SAFEDON_EG", "STD_SG"]) {
    it(`${code}: copies the product's facts the template shows, and every other module starts empty`, () => {
      const template = seeds.get(code)!;
      const { data, copied } = newInspectionData({
        template,
        registry: MODULE_REGISTRY,
        inspectionDate: "2026-10-06",
        productName: null,
        previous: earlier,
      });
      const included = template.modules.filter((entry) => entry.include).map((entry) => entry.key);
      expect(Object.keys(data.modules)).toEqual(included);
      expect(copied).toEqual(COPIED_MODULE_KEYS.filter((key) => included.includes(key)));

      for (const key of included) {
        const definition = MODULE_REGISTRY[key];
        const value = data.modules[key];
        // The module's own schema reads it as it is: nothing it does not take.
        expect(definition.dataSchema.parse(value), key).toEqual(value);
        if (!(COPIED_MODULE_KEYS as readonly string[]).includes(key)) expect(value, key).toEqual(definition.emptyData());
      }
      // Exactly the copied fields the template shows (the header also dated today).
      for (const key of copied) {
        const saved = readModuleEntry(earlier, "modules", key).value as Record<string, unknown>;
        const listed = PREVIOUS_COPY[key];
        const fields = (listed === "all" ? Object.keys(saved) : listed).filter((field) => templateShowsField(template, key, field));
        const expected = Object.fromEntries(fields.map((field) => [field, saved[field]]));
        // Glove information saved before variants is copied as its first variant.
        if (key === "glove_info") expect(data.modules[key]).toEqual(MODULE_REGISTRY.glove_info.dataSchema.parse(expected));
        else expectOnly(data.modules[key], key === "header" ? { ...expected, inspectionDate: "2026-10-06" } : expected);
      }

      // Nothing of the earlier shipment flows forward: no order, sizes, cartons, PO or dates, no result.
      const evaluation = evaluateCapture({ template, overrides: {}, data, meta: META });
      expect(evaluation.context.sizes).toEqual([]);
      expect(evaluation.context.order).toEqual({});
      expect(evaluation.context.cartons).toEqual({});
      expect(evaluation.context.header).toMatchObject({ poNo: null, mfgDate: null, expiryDate: null, inspectionDate: "2026-10-06" });
      expect(evaluation.report.issues.filter((issue) => issue.code === "invalid_data")).toEqual([]);
      expect(mirroredColumns(evaluation)).toMatchObject({ po_no: null, lot_numbers: [], result: null, remarks: null });
      const text = JSON.stringify(data);
      for (const never of [
        "PO-0001",
        "2026-09-01",
        "2026-08-01",
        "2029-07-31",
        "2026-09-02",
        "LOT-M-0001",
        "Packing site A",
        "578",
        "3.62",
        "All good.",
        "Powder free",
        '"comment"',
      ]) {
        expect(text, never).not.toContain(never);
      }
      expect(data.custom).toEqual({});
    });
  }
});

describe("the new inspection's data", () => {
  it("holds each included module's empty data, in template order, the header dated today", () => {
    const { data, copied } = newInspectionData({
      template: STD_EG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: "Nitrile blue",
    });
    expect(copied).toEqual([]);
    expect(Object.keys(data.modules)).toEqual(STD_EG.modules.filter((entry) => entry.include).map((entry) => entry.key));
    expectOnly(data.modules.header, { inspectionDate: "2026-10-06", productName: "Nitrile blue" });
    for (const key of Object.keys(data.modules).filter((entry) => entry !== "header")) {
      expect(data.modules[key], key).toEqual(MODULE_REGISTRY[key as keyof typeof MODULE_REGISTRY].emptyData());
    }
    expect(data.custom).toEqual({});
    // Plain JSON, as the database stores it.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
  });

  it("leaves out modules the template switches off", () => {
    const safedon = seeds.get("SAFEDON_EG")!;
    const { data } = newInspectionData({ template: safedon, registry: MODULE_REGISTRY, inspectionDate: "2026-10-06", productName: null });
    expect(Object.keys(data.modules)).not.toContain("force_at_break");
    expect(Object.keys(data.modules)).not.toContain("dispensing_packing");
    expect(Object.keys(data.modules)).toContain("tensile");
    expectOnly(data.modules.header, { inspectionDate: "2026-10-06" });
  });

  it("uses the product name typed on the form over the copied one", () => {
    const previous = { modules: { header: { productName: "Old name", productCode: "GN-1" } }, custom: {} };
    const { data, copied } = newInspectionData({
      template: STD_EG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: "New name",
      previous,
    });
    expect(copied).toEqual(["header"]);
    expectOnly(data.modules.header, { productName: "New name", productCode: "GN-1", inspectionDate: "2026-10-06" });
  });

  it("fills the factory address from the manufacturer, unless the earlier inspection gave one", () => {
    const blank = newInspectionData({
      template: STD_EG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: null,
      factoryAddress: "  Lot 1, Industrial Park  ",
    });
    expectOnly(blank.data.modules.header, { inspectionDate: "2026-10-06", factoryAddress: "Lot 1, Industrial Park" });

    const copied = newInspectionData({
      template: STD_EG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: null,
      factoryAddress: "Lot 1, Industrial Park",
      previous: { modules: { header: { factoryAddress: "Plant 2, as written last time", productCode: "GN-1" } }, custom: {} },
    });
    expectOnly(copied.data.modules.header, {
      inspectionDate: "2026-10-06",
      factoryAddress: "Plant 2, as written last time",
      productCode: "GN-1",
    });

    const unknown = newInspectionData({
      template: STD_EG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: null,
      factoryAddress: " ",
    });
    expectOnly(unknown.data.modules.header, { inspectionDate: "2026-10-06" });
  });

  it("prefills only the header rows the template shows", () => {
    // STD_SG has no factory address row (onsite/SG.md).
    const { data } = newInspectionData({
      template: STD_SG,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: "Surgical PF",
      factoryAddress: "Lot 1, Industrial Park",
    });
    expectOnly(data.modules.header, { inspectionDate: "2026-10-06", productName: "Surgical PF" });
    expect(headerPrefill(withConfig(STD_EG, "header", { fields: { inspectionDate: false } }), {
      inspectionDate: "2026-10-06",
      productName: "Nitrile",
    }, undefined)).toEqual({ productName: "Nitrile" });
  });

  it("parses every module's data with that module's schema, whatever the registry", () => {
    const template = makeTestTemplate(TEST_REGISTRY, ["header", "glove_info", "order_lots", "dimensions"], {
      scope: { productType: "examination", standard: "EN455", clientId: TEST_CLIENT_ID, manufacturerId: TEST_MANUFACTURER_ID },
    });
    const { data } = newInspectionData({
      template,
      registry: TEST_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: "Nitrile",
      factoryAddress: "Lot 1",
    });
    for (const [key, value] of Object.entries(data.modules)) {
      expect(TEST_REGISTRY[key as keyof typeof TEST_REGISTRY].dataSchema.safeParse(value).success, key).toBe(true);
    }
    // This header has no inspection date or factory address: they are left to the row and the manufacturer.
    expect(data.modules.header).toEqual({ poNo: null, productName: "Nitrile", client: null });
  });
});

describe("a template whose header has no product name", () => {
  const headerFields = (STD_EG.modules.find((entry) => entry.key === "header")!.config as { fields: Record<string, boolean> }).fields;
  const noName = withConfig(STD_EG, "header", { fields: { ...headerFields, productName: false } });

  it("is known from what the form gets", () => {
    expect(headerHidesProductName({ fieldsOff: copiedFieldsOff(STD_EG) })).toBe(false);
    expect(headerHidesProductName({ fieldsOff: copiedFieldsOff(noName) })).toBe(true);
    expect(headerHidesProductName({ fieldsOff: {} })).toBe(false);
  });

  it("starts an inspection that records no product name, typed or copied", () => {
    const previous = { modules: { header: { productName: "Old name", productCode: "GN-1" } }, custom: {} };
    const { data } = newInspectionData({
      template: noName,
      registry: MODULE_REGISTRY,
      inspectionDate: "2026-10-06",
      productName: "Typed name",
      previous,
    });
    expectOnly(data.modules.header, { productCode: "GN-1", inspectionDate: "2026-10-06" });
    const evaluation = evaluateCapture({
      template: noName,
      overrides: {},
      data,
      meta: { refNo: null, inspectionDate: "2026-10-06", inspector: null, client: null, manufacturer: null },
    });
    expect(mirroredColumns(evaluation).product_name).toBeNull();
  });
});

describe("which fields a template shows", () => {
  it("reads the module's field switches; a field without one shows", () => {
    expect(templateShowsField(STD_EG, "header", "factoryAddress")).toBe(true);
    expect(templateShowsField(STD_SG, "header", "factoryAddress")).toBe(false);
    expect(templateShowsField(STD_EG, "packing_config", "glovesPerInner")).toBe(true);
    // A module the template switches off shows nothing.
    expect(templateShowsField(STD_SG, "glove_info", "colour")).toBe(false);
  });
});

describe("dates and errors", () => {
  it("dates an inspection by the calendar in Malaysia", () => {
    expect(todayInMalaysia(new Date("2026-10-05T15:59:59Z"))).toBe("2026-10-05");
    expect(todayInMalaysia(new Date("2026-10-05T16:00:00Z"))).toBe("2026-10-06");
    expect(todayInMalaysia(new Date("2026-12-31T20:00:00Z"))).toBe("2027-01-01");
  });

  it("puts database refusals in words", () => {
    expect(describeCreateError({ code: "23514", message: "inspections start from an active template" })).toBe(
      "That template is no longer active. Reload the page to see the current one.",
    );
    expect(describeCreateError({ code: "23503", message: "fk" })).toMatch(/has gone/);
    expect(describeCreateError({ code: "42501", message: "rls" })).toMatch(/not allowed/);
    expect(describeCreateError({ code: "XX000", message: "boom" })).toBe("The inspection could not be created. Try again.");
  });
});
