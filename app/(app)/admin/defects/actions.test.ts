import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// A stand-in order module that orders each size with a quantity, as order_lots does (its own tests
// cover that rule): the mapping follows the ordered sizes, whatever the order module's schemas.
vi.mock("@/modules/registry", async (importOriginal) => {
  const { z } = await import("zod");
  const actual = await importOriginal<typeof import("@/modules/registry")>();
  const orderLots = {
    ...actual.MODULE_REGISTRY.order_lots,
    dataSchema: z.unknown(),
    configSchema: z.unknown(),
    contribute: ({ data }: { data: unknown }) => ({
      sizes: Object.entries((data as { sizes?: Record<string, { qtyCases?: number }> } | undefined)?.sizes ?? {})
        .filter(([, line]) => (line.qtyCases ?? 0) > 0)
        .map(([size]) => size),
    }),
  };
  return { ...actual, MODULE_REGISTRY: { ...actual.MODULE_REGISTRY, order_lots: orderLots } };
});

import { refresh } from "next/cache";
import { MESSAGES, type ActionResult } from "@/lib/admin/defects";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { deleteDefectCode, mapDefectLabel, saveDefectCode, setDefectCodeActive } from "./actions";

const ADMIN = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const INSPECTION = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VERSION = "2026-10-06T01:02:03.123456+00:00";
const NEWER = "2026-10-06T01:05:00.654321+00:00";
const IDLE = { status: "idle" } as const;

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder returns for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

const OK_EMPTY: Result = { data: null, error: null };

function fakeClient(respond: Responder, rpcResult: Result = { data: 1, error: null }) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq", "in", "order", "range", "overrideTypes"]) {
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
  const rpc = vi.fn().mockResolvedValue(rpcResult);
  return { client: { from, rpc }, queries };
}

const ops = (query: Query) => query.calls.map(([name]) => name);
const isWrite = (query: Query, op: "insert" | "update" | "delete") => ops(query).includes(op);
const isRead = (query: Query) => !["insert", "update", "delete"].some((op) => ops(query).includes(op));
const arg = (query: Query | undefined, method: string): unknown => query?.calls.find(([name]) => name === method)?.[1][0];
const eqs = (query: Query | undefined) =>
  Object.fromEntries(query?.calls.filter(([name]) => name === "eq").map(([, args]) => [args[0], args[1]]) ?? []);

let fake: ReturnType<typeof fakeClient>;

function useClient(respond: Responder, rpcResult?: Result) {
  fake = fakeClient(respond, rpcResult);
  vi.mocked(createClient).mockResolvedValue(fake.client as never);
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const codeRow = (code: string, extra: Record<string, unknown> = {}) => ({
  code,
  name: code.replace(/_/g, " "),
  description: null,
  active: true,
  updated_at: VERSION,
  ...extra,
});

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: ADMIN, email: "admin@test.local", fullName: "Test Admin", role: "admin" },
  });
  vi.spyOn(console, "error").mockImplementation(() => {});
  useClient(() => OK_EMPTY);
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * Every action
 * ------------------------------------------------------------------ */

describe("every action", () => {
  const target = JSON.stringify({ module: "visual", kind: "unmapped", defectClass: "major", label: "Torn cuff" });
  const calls: Array<[string, () => Promise<ActionResult<string, unknown>>]> = [
    ["saveDefectCode", () => saveDefectCode(IDLE, form({ mode: "create", code: "torn_cuff", name: "Torn cuff", description: "" }))],
    ["setDefectCodeActive", () => setDefectCodeActive(IDLE, form({ code: "stain", active: "false" }))],
    ["deleteDefectCode", () => deleteDefectCode(IDLE, form({ code: "stain" }))],
    ["mapDefectLabel", () => mapDefectLabel(IDLE, form({ inspectionId: INSPECTION, target, mode: "existing", code: "stain" }))],
  ];

  it.each(calls)("%s refuses anyone who is not an active admin, before reading anything", async (_name, run) => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });

    expect(await run()).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(createClient).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(calls)("%s turns an unexpected failure into a message instead of an error page", async (_name, run) => {
    vi.mocked(createClient).mockRejectedValue(new Error("connection reset"));
    expect(await run()).toEqual({ status: "error", message: MESSAGES.unexpected });
    expect(createClient).toHaveBeenCalledOnce();
  });
});

/* ------------------------------------------------------------------ *
 * saveDefectCode
 * ------------------------------------------------------------------ */

describe("saveDefectCode, adding", () => {
  const add = (fields: Record<string, string>) =>
    saveDefectCode(IDLE, form({ mode: "create", code: "", name: "", description: "", ...fields }));

  it("adds the code as it will be stored, and refreshes the page", async () => {
    useClient((query) => (isWrite(query, "insert") ? { data: { code: "torn_cuff" }, error: null } : OK_EMPTY));

    const result = await add({ code: " Torn Cuff ", name: "  Torn   cuff ", description: "  Split at the cuff.\n\n" });

    expect(result).toEqual({ status: "success", message: "Code torn_cuff added." });
    const insert = fake.queries.find((query) => isWrite(query, "insert"));
    expect(insert?.table).toBe("defect_codes");
    expect(arg(insert, "insert")).toEqual({ code: "torn_cuff", name: "Torn cuff", description: "Split at the cuff." });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("names each field that is wrong, before touching the database", async () => {
    const result = await add({ code: "9 lives", name: " " });
    expect(result).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { code: "Start the code with a letter, e.g. torn_cuff.", name: "Enter a name." },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a code that exists, and says so when it is only inactive", async () => {
    useClient((query) =>
      isWrite(query, "insert")
        ? { data: null, error: { code: "23505", message: "duplicate key" } }
        : { data: codeRow("stain", { active: false }), error: null },
    );
    expect(await add({ code: "stain", name: "Stain" })).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { code: "There is already a code stain, and it is inactive. Reactivate it instead." },
    });

    useClient((query) =>
      isWrite(query, "insert") ? { data: null, error: { code: "23505", message: "duplicate key" } } : { data: codeRow("stain"), error: null },
    );
    expect(await add({ code: "stain", name: "Stain" })).toMatchObject({ fieldErrors: { code: "There is already a code stain." } });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("explains a refusal by the database without exposing it", async () => {
    useClient(() => ({ data: null, error: { code: "42501", message: "permission denied for table defect_codes" } }));
    expect(await add({ code: "torn_cuff", name: "Torn cuff" })).toEqual({ status: "error", message: MESSAGES.notAllowed });
  });
});

describe("saveDefectCode, editing", () => {
  const edit = (fields: Record<string, string> = {}) =>
    saveDefectCode(
      IDLE,
      form({ mode: "edit", code: "torn_cuff", version: VERSION, name: "Torn cuff edge", description: "", ...fields }),
    );

  it("saves the name and description over the version the form was opened on", async () => {
    useClient((query) => (isWrite(query, "update") ? { data: { code: "torn_cuff" }, error: null } : OK_EMPTY));

    expect(await edit()).toEqual({ status: "success", message: "Code torn_cuff saved." });
    const update = fake.queries.find((query) => isWrite(query, "update"));
    // Never the code itself: templates and inspection data refer to it by value.
    expect(arg(update, "update")).toEqual({ name: "Torn cuff edge", description: null });
    expect(eqs(update)).toEqual({ code: "torn_cuff", updated_at: VERSION });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("does not replace someone else's newer change, and answers with it for a second save to replace", async () => {
    useClient((query) =>
      isWrite(query, "update")
        ? OK_EMPTY
        : { data: codeRow("torn_cuff", { name: "Torn cuff", description: "Their words", updated_at: NEWER }), error: null },
    );
    expect(await edit()).toEqual({
      status: "error",
      message:
        "Someone else changed this code while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
      latest: { version: NEWER, values: { name: "Torn cuff", description: "Their words" } },
    });
    expect(refresh).toHaveBeenCalledOnce();

    useClient(() => OK_EMPTY);
    expect(await edit()).toEqual({ status: "error", message: "This code has been deleted, so your changes were not saved." });
  });

  it("calls a form without its version, or an unknown mode, out of date", async () => {
    expect(await edit({ version: "" })).toEqual({ status: "error", message: MESSAGES.stale });
    expect(await saveDefectCode(IDLE, form({ mode: "rename", code: "stain", name: "x" }))).toEqual({
      status: "error",
      message: MESSAGES.stale,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("names an empty name under its field", async () => {
    expect(await edit({ name: "  " })).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { name: "Enter a name." },
    });
  });
});

/* ------------------------------------------------------------------ *
 * setDefectCodeActive and deleteDefectCode
 * ------------------------------------------------------------------ */

describe("setDefectCodeActive", () => {
  it("deactivates and reactivates", async () => {
    useClient(() => ({ data: { code: "stain" }, error: null }));

    const off = await setDefectCodeActive(IDLE, form({ code: "stain", active: "false" }));
    expect(off).toEqual({
      status: "success",
      message: "stain is inactive. Templates and inspections that use it keep it; it is no longer offered when mapping labels.",
    });
    expect(arg(fake.queries[0], "update")).toEqual({ active: false });
    expect(eqs(fake.queries[0])).toEqual({ code: "stain" });

    expect(await setDefectCodeActive(IDLE, form({ code: "stain", active: "true" }))).toEqual({
      status: "success",
      message: "stain is active again.",
    });
  });

  it("says when the code is gone, and refuses anything but true or false", async () => {
    expect(await setDefectCodeActive(IDLE, form({ code: "stain", active: "false" }))).toEqual({
      status: "error",
      message: "This code has been deleted.",
    });
    expect(await setDefectCodeActive(IDLE, form({ code: "stain", active: "maybe" }))).toEqual({
      status: "error",
      message: MESSAGES.stale,
    });
  });
});

describe("deleteDefectCode", () => {
  const templateRow = (definition: unknown) => ({
    id: "t-1",
    code: "STD_EG",
    version: 2,
    status: "retired",
    definition,
    resolved: null,
  });

  function respond({
    code = codeRow("torn_cuff") as unknown,
    templates = [] as unknown[],
    inspections = [] as unknown[],
    deleted = [{ code: "torn_cuff" }] as unknown[],
  } = {}): Responder {
    return (query) => {
      if (query.table === "defect_codes" && isWrite(query, "delete")) return { data: deleted, error: null };
      if (query.table === "defect_codes") return { data: code, error: null };
      if (query.table === "templates") return { data: templates, error: null };
      return { data: inspections, error: null };
    };
  }

  const remove = () => deleteDefectCode(IDLE, form({ code: "torn_cuff" }));

  it("deletes a code nothing uses", async () => {
    useClient(respond());
    expect(await remove()).toEqual({ status: "success", message: "Code torn_cuff deleted." });
    const deletion = fake.queries.find((query) => isWrite(query, "delete"));
    expect(eqs(deletion)).toEqual({ code: "torn_cuff" });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("never deletes a code a template version mentions, retired ones included", async () => {
    useClient(respond({ templates: [templateRow({ modules: [{ config: { defects: [{ code: "torn_cuff" }] } }] })] }));
    expect(await remove()).toEqual({
      status: "error",
      message: "STD_EG v2 uses it, so it cannot be deleted. Deactivate it instead.",
    });
    expect(fake.queries.some((query) => isWrite(query, "delete"))).toBe(false);
  });

  it("never deletes a code an inspection counts", async () => {
    useClient(
      respond({
        inspections: [
          { ref_no: "INS-2026-0001", visual: { sizes: { M: { major: { counts: { stain: 1 } } } } }, watertight: null, dispensing: null },
          { ref_no: "INS-2026-0002", visual: { sizes: { M: { minor: { counts: { torn_cuff: 2 } } } } }, watertight: null, dispensing: null },
        ],
      }),
    );
    expect(await remove()).toEqual({
      status: "error",
      message: "INS-2026-0002 counts it, so it cannot be deleted. Deactivate it instead.",
    });
    expect(fake.queries.some((query) => isWrite(query, "delete"))).toBe(false);
    // Only the parts of the data that count codes are read.
    const read = fake.queries.find((query) => query.table === "inspections");
    expect(String(arg(read, "select"))).toContain("visual:data->modules->visual");
  });

  it("answers calmly when the code is already gone, or nothing was deleted", async () => {
    useClient(respond({ code: null }));
    expect(await remove()).toEqual({ status: "success", message: "Code torn_cuff was already deleted." });

    useClient(respond({ deleted: [] }));
    expect(await remove()).toEqual({
      status: "error",
      message: "Code torn_cuff could not be deleted. Reload the page and try again.",
    });
  });
});

/* ------------------------------------------------------------------ *
 * mapDefectLabel
 * ------------------------------------------------------------------ */

describe("mapDefectLabel", () => {
  const target = { module: "visual", kind: "unmapped", defectClass: "major", label: "Torn cuff" };
  /** The template version the inspection was started with, as `templates.resolved` holds it. */
  const RESOLVED = {
    format: 2,
    code: "STD_EG",
    name: "Standard examination gloves",
    chain: ["STD_EG"],
    bases: [],
    scope: { productType: "examination", standard: "EN455" },
    unit: "pcs",
    sizes: ["S", "M", "L"].map((value) => ({ value, label: value })),
    modules: [
      { key: "header", include: true, title: "Header", labels: {}, config: {} },
      { key: "order_lots", include: true, title: "Order", labels: {}, config: {} },
      {
        key: "visual",
        include: true,
        title: "Visual Inspection",
        labels: {},
        config: {
          handSplit: false,
          classes: {
            critical: { include: true, aql: 0, defects: [] },
            major: { include: true, aql: 2.5, defects: [{ code: "stain", label: "Oil stain" }] },
            minor: { include: true, aql: 4, defects: [] },
          },
        },
      },
      { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
    ],
    customModules: [],
    report: { title: "Report", showClientLogo: false },
    sourceFile: null,
  };
  /** M and L ordered; S not. */
  const ORDER = {
    sizes: {
      M: { qtyCases: 10, lotNumbers: ["LOT-M"], packingSite: null },
      L: { qtyCases: 5, lotNumbers: ["LOT-L"], packingSite: null },
    },
  };
  const data = () => ({
    modules: {
      order_lots: ORDER,
      visual: { sizes: { M: { major: { counts: { stain: 1 }, unmapped: [{ label: "Torn cuff", count: 2 }] } } } },
    },
    custom: {},
  });
  const inspection = (extra: Record<string, unknown> = {}) => ({
    id: INSPECTION,
    ref_no: "INS-2026-0042",
    status: "submitted",
    updated_at: VERSION,
    data: data(),
    module_overrides: {},
    template: { resolved: RESOLVED },
    ...extra,
  });

  const map = (fields: Record<string, string> = {}) =>
    mapDefectLabel(
      IDLE,
      form({
        inspectionId: INSPECTION,
        target: JSON.stringify(target),
        mode: "existing",
        code: "stain",
        newCode: "",
        name: "",
        description: "",
        ...fields,
      }),
    );

  /** Inspections read as `rows` in turn (the last one repeats); updates answer `written` in turn. */
  function respond({
    rows = [inspection()] as unknown[],
    written = [{ id: INSPECTION }] as unknown[],
    code = codeRow("stain", { name: "Stain" }) as unknown,
    insertError = null as unknown,
  } = {}): Responder {
    let reads = 0;
    let writes = 0;
    return (query) => {
      if (query.table === "inspections" && isWrite(query, "update")) {
        return { data: written[Math.min(writes++, written.length - 1)], error: null };
      }
      if (query.table === "inspections") return { data: rows[Math.min(reads++, rows.length - 1)], error: null };
      if (isWrite(query, "insert")) return { data: insertError ? null : { code: "x" }, error: insertError };
      return { data: code, error: null };
    };
  }

  const updates = () => fake.queries.filter((query) => query.table === "inspections" && isWrite(query, "update"));

  it("records the label as the code on the inspection's data, over the version it read, and logs it", async () => {
    useClient(respond());

    expect(await map()).toEqual({ status: "success", message: "“Torn cuff” on INS-2026-0042 now counts as Stain (stain)." });

    const [update] = updates();
    expect(arg(update, "update")).toEqual({
      data: {
        modules: { order_lots: ORDER, visual: { sizes: { M: { major: { counts: { stain: 3 }, unmapped: [] } } } } },
        custom: {},
      },
    });
    // With the template version it was started with, to tell what it counts.
    const read = fake.queries.find((query) => query.table === "inspections" && isRead(query));
    expect(String(arg(read, "select"))).toContain("template:templates!inspections_template_id_fkey(resolved)");
    expect(String(arg(read, "select"))).toContain("module_overrides");
    // Only over the version it read, and only while it is still submitted.
    expect(eqs(update)).toEqual({ id: INSPECTION, updated_at: VERSION, status: "submitted" });
    expect(fake.client.rpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: INSPECTION,
      action: "defect_label.mapped",
      changes: {
        module: "visual",
        kind: "unmapped",
        class: "major",
        label: "Torn cuff",
        code: "stain",
        count: 2,
        places: [{ size: "M", hand: null, count: 2 }],
        new_code: false,
      },
    });
    expect(refresh).toHaveBeenCalled();
  });

  it("maps the label in every size the inspection counts, at once, and never in a size not in the order", async () => {
    const sizes = {
      modules: {
        order_lots: ORDER,
        visual: {
          sizes: {
            M: { major: { counts: { stain: 1 }, unmapped: [{ label: "Torn cuff", count: 2 }] } },
            L: { major: { counts: {}, unmapped: [{ label: "torn cuff", count: 1 }] } },
            // Not ordered: saved, but counted nowhere (BUILD_SPEC 6.2 rule 4).
            S: { major: { counts: {}, unmapped: [{ label: "Torn cuff", count: 4 }] } },
          },
        },
      },
      custom: {},
    };
    useClient(respond({ rows: [inspection({ data: sizes })] }));

    expect(await map()).toMatchObject({ status: "success" });
    expect(updates()).toHaveLength(1);
    expect(arg(updates()[0], "update")).toEqual({
      data: {
        modules: {
          order_lots: ORDER,
          visual: {
            sizes: {
              M: { major: { counts: { stain: 3 }, unmapped: [] } },
              L: { major: { counts: { stain: 1 }, unmapped: [] } },
              S: { major: { counts: {}, unmapped: [{ label: "Torn cuff", count: 4 }] } },
            },
          },
        },
        custom: {},
      },
    });
    expect(fake.client.rpc).toHaveBeenCalledWith(
      "log_inspection_event",
      expect.objectContaining({
        changes: expect.objectContaining({
          count: 3,
          places: [
            { size: "M", hand: null, count: 2 },
            { size: "L", hand: null, count: 1 },
          ],
        }),
      }),
    );
  });

  it("adds a new code first when asked, then maps the label to it", async () => {
    useClient(respond({ code: null }));

    const result = await map({ mode: "new", code: "", newCode: "Torn cuff", name: " Torn cuff ", description: "" });

    expect(result).toEqual({
      status: "success",
      message: "Code torn_cuff added. “Torn cuff” on INS-2026-0042 now counts as Torn cuff.",
    });
    const insert = fake.queries.find((query) => isWrite(query, "insert"));
    expect(arg(insert, "insert")).toEqual({ code: "torn_cuff", name: "Torn cuff", description: null });
    expect(arg(updates()[0], "update")).toMatchObject({
      data: { modules: { visual: { sizes: { M: { major: { counts: { stain: 1, torn_cuff: 2 } } } } } } },
    });
    expect(fake.client.rpc).toHaveBeenCalledWith(
      "log_inspection_event",
      expect.objectContaining({ changes: expect.objectContaining({ code: "torn_cuff", new_code: true }) }),
    );
  });

  it("asks for a code, and names a new code's problems under its fields", async () => {
    expect(await map({ code: "" })).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { code: "Choose a code." },
    });
    expect(await map({ mode: "new", newCode: "9", name: "" })).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { newCode: "Start the code with a letter, e.g. torn_cuff.", name: "Enter a name." },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("calls a broken target or an unknown mode out of date", async () => {
    expect(await map({ target: "{not json" })).toEqual({ status: "error", message: MESSAGES.stale });
    expect(await map({ target: JSON.stringify({ ...target, defectClass: null }) })).toEqual({
      status: "error",
      message: MESSAGES.stale,
    });
    expect(await map({ inspectionId: "INS-2026-0042" })).toEqual({ status: "error", message: MESSAGES.stale });
    expect(await map({ mode: "guess" })).toEqual({ status: "error", message: MESSAGES.stale });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["draft", "INS-2026-0042 is a draft: the inspector may still change it. Map the label once it is submitted."],
    ["reopened", "INS-2026-0042 is reopened: the inspector may still change it. Map the label once it is submitted again."],
    ["approved", "INS-2026-0042 is approved, so its data is final and the label stays as recorded."],
  ])("leaves a %s inspection alone", async (status, message) => {
    useClient(respond({ rows: [inspection({ status })] }));
    expect(await map()).toEqual({ status: "error", message });
    expect(updates()).toEqual([]);
  });

  it("adds no code for a label that is no longer there", async () => {
    useClient(respond({ rows: [inspection({ data: { modules: {}, custom: {} } })] }));
    expect(await map({ mode: "new", code: "", newCode: "torn_cuff", name: "Torn cuff" })).toEqual({
      status: "error",
      message: "This label is no longer on INS-2026-0042: someone has mapped or changed it. Reload the page.",
    });
    expect(fake.queries.some((query) => isWrite(query, "insert"))).toBe(false);
  });

  it("maps nothing where the inspection counts nothing: no size ordered, or the module switched off", async () => {
    const unordered = { ...data(), modules: { ...data().modules, order_lots: { sizes: {} } } };
    useClient(respond({ rows: [inspection({ data: unordered })] }));
    expect(await map()).toEqual({
      status: "error",
      message: "This label is no longer on INS-2026-0042: someone has mapped or changed it. Reload the page.",
    });

    const switchedOff = { visual: { reason: "Not inspected", by: ADMIN, at: "2026-10-06T08:00:00Z" } };
    useClient(respond({ rows: [inspection({ module_overrides: switchedOff })] }));
    expect(await map()).toMatchObject({ status: "error" });
    expect(updates()).toEqual([]);
  });

  it("says when the template version cannot be read, and adds no code", async () => {
    const message =
      "The template version INS-2026-0042 uses could not be read, so its labels cannot be mapped. Ask a developer to check the template.";
    useClient(respond({ rows: [inspection({ template: { resolved: { modules: [] } } })] }));
    expect(await map({ mode: "new", code: "", newCode: "torn_cuff", name: "Torn cuff" })).toEqual({ status: "error", message });
    expect(fake.queries.some((query) => isWrite(query, "insert"))).toBe(false);

    useClient(respond({ rows: [inspection({ template: null })] }));
    expect(await map()).toEqual({ status: "error", message });
    expect(updates()).toEqual([]);
  });

  it("maps only to an active code that exists", async () => {
    useClient(respond({ code: codeRow("stain", { active: false }) }));
    expect(await map()).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { code: "stain is inactive. Choose an active code, or reactivate it on the Codes tab first." },
    });

    useClient(respond({ code: null }));
    expect(await map()).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { code: "This code no longer exists. Choose another." },
    });
    expect(updates()).toEqual([]);
  });

  it("refuses a new code that exists, next to its field", async () => {
    useClient(respond({ insertError: { code: "23505", message: "duplicate key" } }));
    expect(await map({ mode: "new", code: "", newCode: "stain", name: "Stain" })).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { newCode: "There is already a code stain. Choose it under An existing code, or pick another code." },
    });
    expect(updates()).toEqual([]);
  });

  it("says so when the code that exists is inactive, which An existing code does not offer", async () => {
    useClient(respond({ insertError: { code: "23505", message: "duplicate key" }, code: codeRow("stain", { active: false }) }));
    expect(await map({ mode: "new", code: "", newCode: "stain", name: "Stain" })).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: {
        newCode: "There is already a code stain, and it is inactive. Reactivate it on the Codes tab, or pick another code.",
      },
    });
    expect(updates()).toEqual([]);
  });

  it("reads again and retries when someone saved the inspection in between", async () => {
    const newer = inspection({ updated_at: NEWER });
    useClient(respond({ rows: [inspection(), inspection(), newer], written: [null, { id: INSPECTION }] }));

    expect(await map()).toMatchObject({ status: "success" });
    expect(updates().map((update) => eqs(update).updated_at)).toEqual([VERSION, NEWER]);
  });

  it("gives up after three tries", async () => {
    useClient(respond({ written: [null] }));
    expect(await map()).toEqual({
      status: "error",
      message: "The inspection kept changing while the label was being mapped. Reload the page and try again.",
    });
    expect(updates()).toHaveLength(3);
  });

  it("says a new code was added even when the label could not be mapped after all", async () => {
    // Approved between the check and the save.
    useClient(respond({ code: null, rows: [inspection(), inspection({ status: "approved" })] }));
    expect(await map({ mode: "new", code: "", newCode: "torn_cuff", name: "Torn cuff" })).toEqual({
      status: "warning",
      message:
        "Code torn_cuff added, but the label was not mapped. INS-2026-0042 is approved, so its data is final and the label stays as recorded.",
    });
  });

  it("warns when the mapping is saved but the audit trail refused it", async () => {
    useClient(respond(), { data: null, error: { code: "42501", message: "denied" } });
    expect(await map()).toEqual({
      status: "warning",
      message: "“Torn cuff” on INS-2026-0042 now counts as Stain (stain). Its audit trail could not record the change.",
    });
  });

  it("says when the inspection is gone", async () => {
    useClient(respond({ rows: [null] }));
    expect(await map()).toEqual({ status: "error", message: "This inspection no longer exists. Reload the page." });
  });

  it("reads the inspection as the signed-in admin, so RLS applies", async () => {
    useClient(respond());
    await map();
    const read = fake.queries.find((query) => query.table === "inspections" && isRead(query));
    expect(eqs(read)).toEqual({ id: INSPECTION });
  });
});
