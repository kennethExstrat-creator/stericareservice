// What /inspections/new reads, through the signed-in user's client: the
// pickers' lists, the templates the user may start from and the products of
// earlier inspections, and the wording the form's parts share.
import { describe, expect, it } from "vitest";
import { buildSeedBundle, SEED_TEMPLATES } from "@/lib/templates/definitions";
import { MODULE_REGISTRY } from "@/modules/registry";
import { COPIED_MODULE_KEYS } from "@/lib/inspections/create";
import { loadNewInspectionOptions, PREVIOUS_SCAN_LIMIT, PREVIOUS_SELECT, toTemplateOption } from "./options";
import { overrideOptionLabel, specsNote, templateInSentence, templateLabel } from "./text";

const bundle = new Map(buildSeedBundle(SEED_TEMPLATES, MODULE_REGISTRY).templates.map((entry) => [entry.code, entry]));

function templateRow(code: "STD_EG" | "SAFEDON_EG" | "STD_SG", extra: Record<string, unknown> = {}) {
  const entry = bundle.get(code)!;
  return {
    id: `00000000-0000-4000-8000-00000000000${["STD_EG", "SAFEDON_EG", "STD_SG"].indexOf(code) + 1}`,
    code,
    version: 1,
    status: "active" as const,
    product_type: entry.definition.scope.productType,
    standard: entry.definition.scope.standard,
    client_id: null,
    manufacturer_id: null,
    resolved: entry.resolved as unknown,
    ...extra,
  } as Parameters<typeof toTemplateOption>[0];
}

describe("a template as the form shows it", () => {
  it("names it and lists its sizes and sections in the template's wording", () => {
    const option = toTemplateOption(templateRow("STD_EG"))!;
    expect(option).toMatchObject({
      code: "STD_EG",
      version: 1,
      status: "active",
      productType: "examination",
      standard: "EN455",
      clientId: null,
      manufacturerId: null,
      name: "Standard examination gloves (EN 455)",
      ready: true,
      unit: "pcs",
      sizes: ["XS", "S", "M", "L", "XL"],
    });
    // Modules and custom modules in screen order: Glove Type is part of Glove Information (11 October 2026).
    expect(option.sections.slice(0, 3)).toEqual(["Manufacturer Information", "Glove Information", "Order"]);
    expect(option.sections).toHaveLength(14);
    expect(option.titles.header).toBe("Manufacturer Information");
    expect(Object.keys(option.titles)).not.toContain("tensile");
    expect(option.fieldsOff).toEqual({});
  });

  it("says which copied fields it switches off", () => {
    expect([...(toTemplateOption(templateRow("SAFEDON_EG"))!.fieldsOff.header ?? [])].sort()).toEqual(["client", "factoryGloveCode"]);
  });

  it("leaves out the modules a child switches off", () => {
    const option = toTemplateOption(templateRow("SAFEDON_EG"))!;
    expect(Object.keys(option.titles)).toContain("tensile");
    expect(Object.keys(option.titles)).not.toContain("force_at_break");
    expect(option.unit).toBe("pcs");
  });

  it("keeps a template whose resolution does not read, marked not ready", () => {
    const option = toTemplateOption(templateRow("STD_SG", { resolved: { code: "STD_SG" } }))!;
    expect(option).toMatchObject({ code: "STD_SG", ready: false, name: "STD_SG", sizes: [], sections: [], titles: {}, fieldsOff: {} });
  });

  it("drops a retired version", () => {
    expect(toTemplateOption(templateRow("STD_EG", { status: "retired" }))).toBeNull();
  });
});

/* ------------------------------------------------------------------ *
 * A fake client: each query records its chain and answers by table.
 * ------------------------------------------------------------------ */

type Query = { table: string; calls: Array<[string, unknown[]]> };
type Answer = { data: unknown; error: { code?: string; message: string } | null };

function fakeClient(answers: Partial<Record<string, Answer>>) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "neq", "order", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push([method, args]);
          return builder;
        };
      }
      builder.then = (resolve: (value: Answer) => unknown) =>
        Promise.resolve(answers[table] ?? { data: [], error: null }).then(resolve);
      return builder;
    },
  };
  return { client: client as never, queries };
}

const CLIENTS: Answer = { data: [{ id: "c1", name: "Polyco Healthline" }], error: null };
const MANUFACTURERS: Answer = {
  data: [
    { id: "m1", name: "Hartalega NGC", factory_name: null },
    { id: "m2", name: "Terang Nusa Sdn. Bhd.", factory_name: "TG Factory 40" },
  ],
  error: null,
};
const PREVIOUS_ROW = {
  id: "i1",
  ref_no: "INS-2026-0001",
  inspection_date: "2026-09-01",
  status: "submitted",
  created_at: "2026-09-01T02:00:00Z",
  client_id: "c1",
  manufacturer_id: "m1",
  product_name: "Nitrile blue",
  template: { code: "STD_EG", version: 1, product_type: "examination" },
  header: { poNo: "PO-1", productName: "Nitrile blue", comment: "Checked." },
  glove_info: null,
  packing_config: { glovesPerInner: 100, packingMode: "" },
};

describe("loading the page's lists", () => {
  it("reads clients, manufacturers, the active templates and the user's earlier inspections", async () => {
    const { client, queries } = fakeClient({
      clients: CLIENTS,
      manufacturers: MANUFACTURERS,
      templates: { data: [templateRow("STD_EG")], error: null },
      inspections: { data: [PREVIOUS_ROW, { ...PREVIOUS_ROW, id: "i0", inspection_date: "2026-08-01" }], error: null },
    });
    const options = await loadNewInspectionOptions(client, "inspector");
    expect(options?.clients).toEqual([{ id: "c1", label: "Polyco Healthline" }]);
    expect(options?.manufacturers).toEqual([
      { id: "m1", label: "Hartalega NGC" },
      { id: "m2", label: "Terang Nusa Sdn. Bhd. · TG Factory 40" },
    ]);
    expect(options?.templates.map((template) => template.code)).toEqual(["STD_EG"]);
    // The latest inspection of each product, and what it holds to copy.
    expect(options?.previous.map((product) => product.refNo)).toEqual(["INS-2026-0001"]);
    expect(options?.previous[0].copies).toEqual({ header: ["productName"], packing_config: ["glovesPerInner"] });

    const templates = queries.find((query) => query.table === "templates")!;
    expect(templates.calls).toContainEqual(["eq", ["status", "active"]]);
    const inspections = queries.find((query) => query.table === "inspections")!;
    expect(inspections.calls).toContainEqual(["limit", [PREVIOUS_SCAN_LIMIT]]);
    // Only the modules a copy takes, never the whole data.
    expect(inspections.calls[0]).toEqual(["select", [PREVIOUS_SELECT]]);
    for (const key of COPIED_MODULE_KEYS) expect(PREVIOUS_SELECT).toContain(`${key}:data->modules->${key}`);
    expect(PREVIOUS_SELECT).not.toMatch(/(^|, )data(,|$)/);
  });

  it("offers an admin the drafts as well, never a retired version", async () => {
    const { client, queries } = fakeClient({
      templates: {
        data: [templateRow("STD_EG", { status: "draft" }), templateRow("STD_SG", { status: "retired" })],
        error: null,
      },
    });
    const options = await loadNewInspectionOptions(client, "admin");
    expect(options?.templates.map((template) => [template.code, template.status])).toEqual([["STD_EG", "draft"]]);
    expect(queries.find((query) => query.table === "templates")!.calls).toContainEqual(["neq", ["status", "retired"]]);
  });

  it.each(["clients", "manufacturers", "templates", "inspections"])(
    "gives nothing when the %s cannot be read",
    async (table) => {
      const { client } = fakeClient({ [table]: { data: null, error: { code: "PGRST000", message: "down" } } });
      const errors: unknown[] = [];
      const original = console.error;
      console.error = (...args: unknown[]) => errors.push(args);
      try {
        expect(await loadNewInspectionOptions(client, "inspector")).toBeNull();
      } finally {
        console.error = original;
      }
      expect(errors).toHaveLength(1);
    },
  );
});

describe("the wording the form's parts share", () => {
  const product = { templateCode: "STD_EG", templateVersion: 2 };

  it("names a template version in Title Case as a label, and in lower case within a sentence", () => {
    expect(templateLabel({ code: "STD_EG", version: 3 })).toBe("STD_EG Version 3");
    expect(templateInSentence({ code: "STD_EG", version: 3 })).toBe("STD_EG version 3");
  });

  it("lists another template for the admin with its draft and unusable marks in Title Case", () => {
    expect(overrideOptionLabel({ code: "STD_EG", version: 2, status: "active", ready: true })).toBe("STD_EG Version 2");
    expect(overrideOptionLabel({ code: "STD_EG", version: 3, status: "draft", ready: true })).toBe("STD_EG Version 3 · Draft");
    expect(overrideOptionLabel({ code: "STD_EG", version: 1, status: "active", ready: false })).toBe(
      "STD_EG Version 1 · Cannot Be Used Yet",
    );
    expect(overrideOptionLabel({ code: "STD_EG", version: 4, status: "draft", ready: false })).toBe(
      "STD_EG Version 4 · Draft · Cannot Be Used Yet",
    );
  });

  it("says whether specs and AQL are last time's", () => {
    expect(specsNote(product, { code: "STD_EG", version: 2 })).toBe(
      "Same template as last time (STD_EG version 2): its specs and AQL carry over.",
    );
    expect(specsNote(product, { code: "STD_EG", version: 3 })).toBe(
      "Last time used version 2. This inspection uses version 3, with its specs and AQL.",
    );
    expect(specsNote(product, { code: "SAFEDON_EG", version: 1 })).toBe(
      "Last time used STD_EG version 2. This inspection uses SAFEDON_EG version 1: specs and AQL come from it.",
    );
  });
});
