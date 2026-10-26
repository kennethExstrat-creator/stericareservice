import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  unstable_rethrow: vi.fn((error: unknown) => {
    if (error instanceof Error && error.message === "NEXT_REDIRECT") throw error;
  }),
}));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// Without the key (the default here) the user's own client inserts.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { authorizeAction } from "@/lib/auth/session";
import { evaluateCapture } from "@/lib/inspections/capture/evaluate";
import { mirroredColumns } from "@/lib/inspections/capture/mirror";
import { ResolvedTemplateSchema } from "@/lib/schemas/template";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { buildSeedBundle, SEED_TEMPLATES } from "@/lib/templates/definitions";
import type { InspectionData } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import { createInspection, type CreateInspectionState } from "./actions";

const INSPECTOR = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const ADMIN = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const OTHER_CLIENT = "20000000-0000-4000-8000-000000000002";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";
const NEW_ID = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";
const PREVIOUS_ID = "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d";
const ADDRESS = "Lot 1, Placeholder Industrial Park";
const IDLE: CreateInspectionState = { status: "idle" };
/** Created: the form hands over its Source Documents and opens the inspection itself. */
const CREATED: CreateInspectionState = { status: "created", id: NEW_ID };

const T = {
  STD_EG: "00000000-0000-4000-8000-0000000000e1",
  SAFEDON_EG: "00000000-0000-4000-8000-0000000000e2",
  DRAFT_EG: "00000000-0000-4000-8000-0000000000e3",
  STD_SG: "00000000-0000-4000-8000-0000000000e4",
} as const;

/** The seed templates as the registry resolves them, as rows of the templates table. */
const bundle = new Map(buildSeedBundle(SEED_TEMPLATES, MODULE_REGISTRY).templates.map((entry) => [entry.code, entry]));
function row(id: string, code: "STD_EG" | "SAFEDON_EG" | "STD_SG", extra: Record<string, unknown> = {}) {
  const entry = bundle.get(code)!;
  const clientId = code === "SAFEDON_EG" ? CLIENT : null;
  return {
    id,
    code,
    version: 1,
    status: "active",
    product_type: entry.definition.scope.productType,
    standard: entry.definition.scope.standard,
    client_id: clientId,
    manufacturer_id: null,
    resolved: { ...entry.resolved, scope: { ...entry.resolved.scope, ...(clientId ? { clientId } : {}) } },
    ...extra,
  };
}

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the responder returns for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

function fakeClient(respond: (query: Query) => Result) {
  const queries: Query[] = [];
  const rpcs: Array<{ name: string; args: Record<string, unknown> }> = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq", "neq", "in", "order", "limit", "insert", "update"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    for (const terminal of ["maybeSingle", "single"]) {
      builder[terminal] = () => {
        query.calls.push([terminal, []]);
        return Promise.resolve(respond(query));
      };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  });
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    rpcs.push({ name, args });
    return Promise.resolve({ data: 1, error: null });
  });
  return { client: { from, rpc }, queries, rpcs };
}

const has = (query: Query, method: string, ...args: unknown[]) =>
  query.calls.some(([name, callArgs]) => name === method && JSON.stringify(callArgs) === JSON.stringify(args));
const argOf = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1][0];

type World = {
  templates?: ReturnType<typeof row>[];
  client?: boolean;
  address?: string | null;
  previous?: Record<string, unknown> | null;
  insert?: Result;
};

function world({ templates, client = true, address = ADDRESS, previous = null, insert }: World = {}) {
  const rows = templates ?? [row(T.STD_EG, "STD_EG"), row(T.SAFEDON_EG, "SAFEDON_EG"), row(T.STD_SG, "STD_SG")];
  return fakeClient((query) => {
    if (query.table === "templates") {
      const byId = query.calls.find(([name, args]) => name === "eq" && args[0] === "id");
      if (byId) return { data: rows.find((entry) => entry.id === byId[1][1]) ?? null, error: null };
      const visible = has(query, "eq", "status", "active")
        ? rows.filter((entry) => entry.status === "active")
        : rows.filter((entry) => entry.status !== "retired");
      return { data: visible, error: null };
    }
    if (query.table === "clients") return { data: client ? { id: CLIENT, name: "Client A" } : null, error: null };
    if (query.table === "manufacturers") return { data: { id: MANUFACTURER, name: "Manufacturer A", address }, error: null };
    if (query.table === "inspections" && argOf(query, "insert")) return insert ?? { data: { id: NEW_ID }, error: null };
    if (query.table === "inspections") return { data: previous, error: null };
    return { data: null, error: null };
  });
}

let db: ReturnType<typeof world>;

function use(next: ReturnType<typeof world>) {
  db = next;
  vi.mocked(createClient).mockResolvedValue(db.client as never);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const order = (overrides: Record<string, string> = {}) =>
  form({ clientId: CLIENT, manufacturerId: MANUFACTURER, productType: "examination", productName: "Nitrile blue", ...overrides });

function signedIn(role: "inspector" | "admin") {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: role === "admin" ? ADMIN : INSPECTOR, email: `${role}@test.local`, fullName: null, role },
  });
}

function submit(data: FormData): Promise<CreateInspectionState> {
  return createInspection(IDLE, data);
}

/**
 * The values given, and nothing else: every other key of the module's data
 * is empty, for the placeholder modules and the built ones alike.
 */
function expectOnly(actual: unknown, expected: Record<string, unknown>) {
  expect(actual).toMatchObject(expected);
  const others = Object.entries(actual as Record<string, unknown>).filter(([key]) => !(key in expected));
  expect(Object.fromEntries(others.filter(([, value]) => value !== null))).toEqual({});
}

const inserted = () => argOf(db.queries.find((query) => query.table === "inspections" && argOf(query, "insert")), "insert") as
  | Record<string, unknown>
  | undefined;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-06T03:00:00Z"));
  signedIn("inspector");
  vi.spyOn(console, "error").mockImplementation(() => {});
  use(world());
});

afterEach(() => {
  vi.useRealTimers();
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("who may start an inspection", () => {
  it("answers a caller without an active session with the session's words, reading nothing", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await submit(order())).toEqual({ status: "error", message: "Your session has ended. Sign in again." });
    expect(authorizeAction).toHaveBeenCalledWith();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("lets only an admin choose the template", async () => {
    expect(await submit(order({ templateId: T.DRAFT_EG }))).toEqual({
      status: "error",
      message: "Only an admin can choose the template.",
      fieldErrors: { templateId: "Only an admin can choose the template." },
    });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("checking the form", () => {
  it("names each missing choice", async () => {
    expect(await submit(form({}))).toEqual({
      status: "error",
      message: "Check the highlighted fields.",
      fieldErrors: {
        clientId: "Choose the client, or No Client.",
        manufacturerId: "Choose the manufacturer.",
        productType: "Choose the product type.",
      },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("says when the client has gone since the page loaded", async () => {
    use(world({ client: false }));
    expect(await submit(order())).toMatchObject({ status: "error", fieldErrors: { clientId: "That client is no longer in the list." } });
    expect(inserted()).toBeUndefined();
  });
});

describe("writing the draft (migration 20261007190000)", () => {
  it("starts it through create_inspection() with the secret key, for the signed-in user, when the server has the key", async () => {
    const calls: Array<[string, Record<string, unknown>]> = [];
    const admin = {
      rpc: vi.fn((name: string, args: Record<string, unknown>) => {
        calls.push([name, args]);
        return Promise.resolve({ data: NEW_ID, error: null });
      }),
    };
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue(admin as never);

    expect(await submit(order())).toEqual(CREATED);
    expect(inserted()).toBeUndefined();
    expect(calls).toHaveLength(1);
    const [name, args] = calls[0];
    expect(name).toBe("create_inspection");
    expect(args).toMatchObject({
      actor_id: INSPECTOR,
      template_id: T.STD_EG,
      client_id: CLIENT,
      manufacturer_id: MANUFACTURER,
      mirrored_columns: { product_name: "Nitrile blue", inspection_date: "2026-10-06" },
    });
    for (const key of ["id", "ref_no", "status", "inspector_id"]) expect(args).not.toHaveProperty(key);
    expect(Object.keys((args.data as { modules: object }).modules).length).toBeGreaterThan(0);
  });

  it("answers what the database refused, in plain words", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue({
      rpc: vi.fn(() =>
        Promise.resolve({ data: null, error: { code: "23514", message: "inspections start from an active template" } }),
      ),
    } as never);
    expect(await submit(order())).toEqual({
      status: "error",
      message: "That template is no longer active. Reload the page to see the current one.",
    });
  });
});

describe("the template (BUILD_SPEC 4.4)", () => {
  // Kenneth, 26 October 2026: every client uses the standard template, so SAFEDON_EG, still active for this client here, is passed over.
  it("starts from the standard template of the product type, whoever the client is, and answers the new inspection's id", async () => {
    expect(await submit(order())).toEqual(CREATED);
    const payload = inserted()!;
    expect(payload).toMatchObject({
      template_id: T.STD_EG,
      client_id: CLIENT,
      manufacturer_id: MANUFACTURER,
      product_name: "Nitrile blue",
      inspection_date: "2026-10-06",
    });
    // Never sent: the database draws these.
    for (const key of ["id", "ref_no", "status", "inspector_id"]) expect(payload).not.toHaveProperty(key);
    const data = payload.data as { modules: Record<string, unknown>; custom: Record<string, unknown> };
    const included = bundle.get("STD_EG")!.resolved.modules.filter((entry) => entry.include).map((entry) => entry.key);
    expect(Object.keys(data.modules)).toEqual(included);
    // The header starts dated today, with the product name and the manufacturer's address.
    expectOnly(data.modules.header, { inspectionDate: "2026-10-06", productName: "Nitrile blue", factoryAddress: ADDRESS });
    expect(data.custom).toEqual({});
    // Every module's data is that module's own, as its schema reads it.
    for (const [key, value] of Object.entries(data.modules)) {
      expect(MODULE_REGISTRY[key as keyof typeof MODULE_REGISTRY].dataSchema.safeParse(value).success, key).toBe(true);
    }
    const manufacturer = db.queries.find((query) => query.table === "manufacturers");
    expect(argOf(manufacturer, "select")).toBe("id, name, address");
    // An inspector reads active templates only.
    expect(db.queries.some((query) => query.table === "templates" && has(query, "eq", "status", "active"))).toBe(true);
    expect(db.rpcs).toEqual([]);
  });

  it("leaves the factory address blank when the manufacturer has none", async () => {
    use(world({ address: null }));
    await submit(order());
    const data = inserted()!.data as { modules: Record<string, unknown> };
    expectOnly(data.modules.header, { inspectionDate: "2026-10-06", productName: "Nitrile blue" });
  });

  it("takes the standard template when there is no client", async () => {
    await submit(order({ clientId: "none", productName: "" }));
    expect(inserted()).toMatchObject({ template_id: T.STD_EG, client_id: null, product_name: null });
  });

  it("says when no active template applies, and creates nothing", async () => {
    use(world({ templates: [row(T.STD_EG, "STD_EG")] }));
    expect(await submit(order({ productType: "surgical" }))).toEqual({
      status: "error",
      message: "No active template for surgical gloves. An admin needs to activate one.",
    });
    expect(inserted()).toBeUndefined();
  });

  it("refuses a template whose resolution no longer reads", async () => {
    use(world({ templates: [row(T.STD_EG, "STD_EG", { resolved: { code: "STD_EG" } })] }));
    expect(await submit(order({ clientId: "none" }))).toEqual({
      status: "error",
      message: "STD_EG version 1 cannot be used yet: an admin needs to save it again.",
    });
    expect(inserted()).toBeUndefined();
  });

  it("uses an admin's choice, a draft included, and records it next to what the rule picked", async () => {
    signedIn("admin");
    use(
      world({
        templates: [
          row(T.STD_EG, "STD_EG"),
          row(T.SAFEDON_EG, "SAFEDON_EG"),
          row(T.DRAFT_EG, "STD_EG", { code: "DRAFT_EG", status: "draft" }),
        ],
      }),
    );
    expect(await submit(order({ templateId: T.DRAFT_EG }))).toEqual(CREATED);
    expect(inserted()).toMatchObject({ template_id: T.DRAFT_EG });
    expect(db.queries.some((query) => query.table === "templates" && has(query, "neq", "status", "retired"))).toBe(true);
    expect(db.rpcs).toEqual([
      {
        name: "log_inspection_event",
        args: {
          inspection_id: NEW_ID,
          action: "template_chosen",
          changes: {
            template: { id: T.DRAFT_EG, code: "DRAFT_EG", version: 1 },
            instead_of: { id: T.STD_EG, code: "STD_EG", version: 1 },
          },
        },
      },
    ]);
  });

  it("refuses an admin's choice for another product type", async () => {
    signedIn("admin");
    expect(await submit(order({ templateId: T.STD_SG }))).toMatchObject({
      status: "error",
      fieldErrors: { templateId: "STD_SG is for surgical gloves. Choose one for examination gloves." },
    });
  });
});

describe("the columns the list shows and searches (BUILD_SPEC 6.2 rule 10)", () => {
  /** What the capture screen's save would write for this data (lib/inspections/capture/mirror.ts). */
  function onFirstSave(code: "STD_EG" | "SAFEDON_EG", data: unknown) {
    const template = ResolvedTemplateSchema.parse(bundle.get(code)!.resolved);
    return mirroredColumns(
      evaluateCapture({
        template,
        overrides: {},
        data: data as InspectionData,
        meta: { refNo: "INS-2026-0001", inspectionDate: "2026-10-06", inspector: null, client: null, manufacturer: null },
      }),
    );
  }

  it("are written as the capture screen's save writes them, so the first save changes none", async () => {
    await submit(order());
    const payload = inserted()!;
    expect(payload).toMatchObject({
      po_no: null,
      product_name: "Nitrile blue",
      lot_numbers: [],
      inspection_date: "2026-10-06",
      suggested_result: "hold",
      result: null,
      remarks: null,
    });
    expect(payload).toMatchObject(onFirstSave("SAFEDON_EG", payload.data));
  });

  it("never carry an earlier inspection's PO, lots or results", async () => {
    use(
      world({
        previous: {
          id: PREVIOUS_ID,
          ref_no: "INS-2026-0007",
          client_id: null,
          manufacturer_id: MANUFACTURER,
          template: { product_type: "examination" },
          data: {
            modules: {
              header: { productName: "Nitrile blue", poNo: "PO-0001" },
              order_lots: { sizes: { M: { qtyCases: 400, lotNumbers: ["LOT-M-0001"], packingSite: null } } },
              conclusion: { finalResult: "pass", remark: "All good." },
            },
            custom: {},
          },
        },
      }),
    );
    await submit(order({ clientId: "none", previousId: PREVIOUS_ID, productName: "" }));
    const payload = inserted()!;
    expect(payload).toMatchObject({ template_id: T.STD_EG, product_name: "Nitrile blue", po_no: null, lot_numbers: [] });
    expect(payload).toMatchObject({ result: null, remarks: null });
    expect(payload).toMatchObject(onFirstSave("STD_EG", payload.data));
  });
});

describe("start from previous (BUILD_SPEC 8)", () => {
  const previous = {
    id: PREVIOUS_ID,
    ref_no: "INS-2026-0007",
    client_id: CLIENT,
    manufacturer_id: MANUFACTURER,
    template: { product_type: "examination" },
    data: {
      modules: {
        header: { productName: "Nitrile blue", productCode: "GN-1", poNo: "PO-0001", mfgDate: "2026-08-01", comment: "Checked." },
        glove_info: { surfaceTexture: "Textured", indicativeWeight: 3.5, colour: "Blue", length: "240 mm" },
        packing_config: { glovesPerInner: 100 },
        sampling_plan: { sizes: { M: { cases: 20 } } },
      },
      custom: { glove_type: { gloveType: "Powder free" } },
    },
  };

  it("copies the product's details, nothing else, and records where they came from", async () => {
    use(world({ previous }));
    expect(await submit(order({ previousId: PREVIOUS_ID, productName: "Nitrile blue" }))).toEqual(CREATED);
    const data = inserted()!.data as { modules: Record<string, unknown>; custom: Record<string, unknown> };
    // No address last time: the manufacturer's fills it.
    expectOnly(data.modules.header, {
      productName: "Nitrile blue",
      productCode: "GN-1",
      inspectionDate: "2026-10-06",
      factoryAddress: ADDRESS,
    });
    // Saved before variants: copied as the first variant, covering every size.
    expect(data.modules.glove_info).toEqual({ gloveType: null, variants: [{ sizes: [], ...previous.data.modules.glove_info, length: 240 }] });
    expectOnly(data.modules.packing_config, { glovesPerInner: 100 });
    expect(data.modules.sampling_plan).toEqual(MODULE_REGISTRY.sampling_plan.emptyData());
    expect(data.custom).toEqual({});
    expect(db.rpcs).toEqual([
      {
        name: "log_inspection_event",
        args: {
          inspection_id: NEW_ID,
          action: "started_from_previous",
          changes: { from: { id: PREVIOUS_ID, ref_no: "INS-2026-0007" }, copied: ["header", "glove_info", "packing_config"] },
        },
      },
    ]);
  });

  it("keeps the row's product name in step with the copied header when the form's is blank", async () => {
    use(world({ previous }));
    await submit(order({ previousId: PREVIOUS_ID, productName: "" }));
    expect(inserted()).toMatchObject({ product_name: "Nitrile blue" });
  });

  it("refuses an earlier inspection of another client, manufacturer or product type", async () => {
    use(world({ previous: { ...previous, client_id: OTHER_CLIENT } }));
    expect(await submit(order({ previousId: PREVIOUS_ID }))).toMatchObject({
      status: "error",
      fieldErrors: { previousId: "That earlier inspection is for another client, manufacturer or product type." },
    });
    use(world({ previous: { ...previous, template: { product_type: "surgical" } } }));
    expect(await submit(order({ previousId: PREVIOUS_ID }))).toMatchObject({ status: "error" });
    expect(inserted()).toBeUndefined();
  });

  it("refuses one the caller cannot see (Row Level Security returns nothing)", async () => {
    use(world({ previous: null }));
    expect(await submit(order({ previousId: PREVIOUS_ID }))).toMatchObject({
      status: "error",
      fieldErrors: { previousId: "That earlier inspection is not available. Pick another or start blank." },
    });
  });
});

describe("Source Documents read on the form (docs/AI.md)", () => {
  it("fills the header from what they read and records the files by name; the files themselves come later, through the queue", async () => {
    const rpc = vi.fn(() => Promise.resolve({ data: 1, error: null }));
    vi.mocked(createAdminClient).mockReturnValue({ rpc } as never);
    const fill = {
      fileName: "PO 0001.pdf, Inspection Form.jpg",
      header: { poNo: "PO-0001", productCode: null, factoryGloveCode: null, inspectionDate: null, mfgDate: null, expiryDate: null },
      sizes: {},
    };
    const data = order({ documentFill: JSON.stringify(fill) });
    // What an older form posted along: nothing reads it now.
    data.set("documentFile", new File(["%PDF-1.7"], "PO 0001.pdf", { type: "application/pdf" }));
    expect(await submit(data)).toEqual(CREATED);
    const modules = (inserted()!.data as { modules: Record<string, Record<string, unknown>> }).modules;
    expect(modules.header.poNo).toBe("PO-0001");
    // The audit names the files and what they filled; nothing is uploaded here.
    expect(rpc.mock.calls).toEqual([
      [
        "log_inspection_event",
        { inspection_id: NEW_ID, action: "filled_from_document", changes: { file: fill.fileName, filled: ["header.poNo"], by: INSPECTOR } },
      ],
    ]);
  });
});

describe("when something fails", () => {
  it("puts a database refusal in words", async () => {
    use(world({ insert: { data: null, error: { code: "23514", message: "inspections start from an active template" } } }));
    expect(await submit(order())).toEqual({
      status: "error",
      message: "That template is no longer active. Reload the page to see the current one.",
    });
  });

  it("turns an unexpected failure into a message on the form", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("fetch failed"));
    expect(await submit(order())).toEqual({ status: "error", message: "The inspection could not be created. Try again." });
  });

  it("still opens the inspection when recording how it started fails", async () => {
    use(world({ previous: {
      id: PREVIOUS_ID,
      ref_no: "INS-2026-0007",
      client_id: CLIENT,
      manufacturer_id: MANUFACTURER,
      template: { product_type: "examination" },
      data: { modules: {}, custom: {} },
    } }));
    db.client.rpc.mockResolvedValue({ data: null, error: { code: "42501", message: "nope" } } as never);
    expect(await submit(order({ previousId: PREVIOUS_ID }))).toEqual(CREATED);
  });
});
