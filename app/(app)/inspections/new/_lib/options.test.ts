// What /inspections/new reads, through the signed-in user's client: the
// pickers' lists and the templates the user may start from, no earlier
// inspections; and the wording the form's parts share.
import { describe, expect, it } from "vitest";
import { buildSeedBundle, SEED_TEMPLATES } from "@/lib/templates/definitions";
import { FORCE_AT_BREAK_TITLE } from "@/modules/force_at_break/config";
import { MODULE_REGISTRY } from "@/modules/registry";
import { TENSILE_TITLE } from "@/modules/tensile/config";
import { loadNewInspectionOptions, toTemplateOption } from "./options";
import { overrideOptionLabel, templateInSentence, templateLabel } from "./text";

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
      standard: "ASTM_D6319",
      clientId: null,
      manufacturerId: null,
      name: "Standard examination gloves (ASTM D6319)",
      ready: true,
      unit: "pcs",
      sizes: ["XS", "S", "M", "L", "XL"],
    });
    // SAFEDON_EG's flow since 26 October 2026: modules and custom modules in screen order, the onsite
    // dispensing notes included; Glove Type is part of Glove Information (11 October 2026).
    expect(option.sections.slice(0, 3)).toEqual(["Manufacturer Information", "Glove Information", "Order"]);
    expect(option.sections).toHaveLength(15);
    expect(option.sections).toContain(TENSILE_TITLE);
    expect(option.sections).not.toContain(FORCE_AT_BREAK_TITLE);
    // The client row is on (no logo names the client); no factory glove code, as in SAFEDON_EG's flow.
    expect(option.fieldsOff).toEqual({ header: ["factoryGloveCode"] });
  });

  it("says which copied fields it switches off", () => {
    expect([...(toTemplateOption(templateRow("SAFEDON_EG"))!.fieldsOff.header ?? [])].sort()).toEqual(["client", "factoryGloveCode"]);
  });

  it("leaves out the modules a child switches off", () => {
    const option = toTemplateOption(templateRow("SAFEDON_EG"))!;
    expect(option.sections).toContain(TENSILE_TITLE);
    expect(option.sections).not.toContain(FORCE_AT_BREAK_TITLE);
    expect(option.unit).toBe("pcs");
  });

  it("keeps a template whose resolution does not read, marked not ready", () => {
    const option = toTemplateOption(templateRow("STD_SG", { resolved: { code: "STD_SG" } }))!;
    expect(option).toMatchObject({ code: "STD_SG", ready: false, name: "STD_SG", sizes: [], sections: [], fieldsOff: {} });
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
describe("loading the page's lists", () => {
  it("reads clients, manufacturers and the active templates, and no earlier inspections", async () => {
    const { client, queries } = fakeClient({
      clients: CLIENTS,
      manufacturers: MANUFACTURERS,
      templates: { data: [templateRow("STD_EG")], error: null },
    });
    const options = await loadNewInspectionOptions(client, "inspector");
    expect(options).toEqual({
      clients: [{ id: "c1", label: "Polyco Healthline" }],
      manufacturers: [
        { id: "m1", label: "Hartalega NGC" },
        { id: "m2", label: "Terang Nusa Sdn. Bhd. · TG Factory 40" },
      ],
      templates: [expect.objectContaining({ code: "STD_EG" })],
    });

    const templates = queries.find((query) => query.table === "templates")!;
    expect(templates.calls).toContainEqual(["eq", ["status", "active"]]);
    // Start From Previous is gone (Kenneth, 26 October 2026): nothing reads the inspections.
    expect(queries.map((query) => query.table).sort()).toEqual(["clients", "manufacturers", "templates"]);
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

  it.each(["clients", "manufacturers", "templates"])(
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
});
