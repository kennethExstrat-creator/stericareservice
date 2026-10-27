import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The framework's test registry stands in for the real modules, so these
// tests keep testing the actions whichever modules are built.
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// Without the key (the default here) the user's own client writes; withSecretKey() switches it on.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));
vi.mock("@/lib/inspections/ai", () => ({ scheduleAiReviewOnSubmit: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT ${path}`);
  }),
  unstable_rethrow: vi.fn(),
}));
vi.mock("next/server", () => ({ after: vi.fn() }));
// The code letter rows run on the data as they are; the test registry's sampling plan holds no letter, so a test
// answers them to follow them into the save (sampling-events.test.ts reads real letters).
vi.mock("@/lib/inspections/capture/sampling-events", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/inspections/capture/sampling-events")>();
  return { ...actual, samplingEvents: vi.fn(actual.samplingEvents) };
});

import { redirect } from "next/navigation";
import { after } from "next/server";
import { authorizeAction } from "@/lib/auth/session";
import { scheduleAiReviewOnSubmit } from "@/lib/inspections/ai";
import { CODE_LETTER_CHANGED, samplingEvents } from "@/lib/inspections/capture/sampling-events";
import { contentHash } from "@/lib/offline/stable-json";
import type { ResolvedTemplate } from "@/lib/schemas/template";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { makeTestTemplate } from "@/modules/_framework/testing";
import type { InspectionData } from "@/modules/_framework";
import { saveCaptureData, submitInspection, switchModuleOff, switchModuleOn, type OverrideResult } from "./actions";

const INSPECTION = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const INSPECTOR = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMIN = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";
const VERSION = "2026-10-06T09:14:03.123456+00:00";
const NEXT_VERSION = "2026-10-06T09:14:05.654321+00:00";
const IDLE: OverrideResult = { status: "idle" };

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder returns for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

function fakeClient(respond: Responder, rpc: (name: string, args: unknown) => Result = () => ({ data: 1, error: null })) {
  const queries: Query[] = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq", "in", "order", "abortSignal"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => {
      query.calls.push(["maybeSingle", []]);
      return Promise.resolve(respond(query));
    };
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  });
  return {
    client: {
      from,
      rpc: vi.fn((name: string, args: unknown) => {
        rpcCalls.push([name, args]);
        return Promise.resolve(rpc(name, args));
      }),
    },
    queries,
    rpcCalls,
  };
}

const isUpdate = (query: Query) => query.calls.some(([name]) => name === "update");
const updatePayload = (query: Query | undefined) =>
  query?.calls.find(([name]) => name === "update")?.[1][0] as Record<string, unknown> | undefined;
const hasEq = (query: Query, column: string, value: unknown) =>
  query.calls.some(([name, args]) => name === "eq" && args[0] === column && args[1] === value);

/* ------------------------------------------------------------------ *
 * The inspection row as the capture select returns it
 * ------------------------------------------------------------------ */

function template(withCustom = false): ResolvedTemplate {
  return makeTestTemplate(TEST_REGISTRY, ["glove_info", "packing_config", "weight"], {
    customModules: withCustom
      ? [
          {
            key: "site_notes",
            title: "Site notes",
            after: "glove_info",
            layout: "fields",
            fields: [{ key: "sealIntact", label: "Seal intact", type: "yes_no", required: true }],
          },
        ]
      : [],
  });
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: INSPECTION,
    ref_no: "INS-2026-0001",
    status: "draft",
    data: { modules: {}, custom: {} },
    module_overrides: {},
    updated_at: VERSION,
    inspection_date: "2026-10-06",
    inspector_id: INSPECTOR,
    submitted_at: null,
    result: null,
    template: { id: "t1", code: "TEST_EG", version: 1, resolved: template() },
    client: { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" },
    manufacturer: { id: "10000000-0000-4000-8000-0000000000f1", name: "Manufacturer A", factory_name: null },
    inspector: { id: INSPECTOR, full_name: "Inspector A", email: "inspector@test.local" },
    ...overrides,
  };
}

const COMPLETE: InspectionData = {
  modules: {
    header: { poNo: "PO-0001", productName: "Nitrile gloves", client: "Client A" },
    glove_info: { indicativeWeight: 3.5, colour: "Blue" },
    conclusion: { finalResult: "pass", remark: null },
  },
  custom: {},
};

let client: ReturnType<typeof fakeClient>;

/** The inspection's files as inspection_files answers; none unless a test says so. */
let fileRows: Result = { data: [], error: null };

function useClient(respond: Responder, rpc?: (name: string, args: unknown) => Result) {
  client = fakeClient((query) => (query.table === "inspection_files" ? fileRows : respond(query)), rpc);
  vi.mocked(createClient).mockResolvedValue(client.client as never);
}

/** A server with the secret key: its client answers the write functions with `rpc`. */
function withSecretKey(rpc: (name: string, args: unknown) => Result) {
  const admin = fakeClient(() => ({ data: null, error: null }), rpc);
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.mocked(createAdminClient).mockReturnValue(admin.client as never);
  return admin;
}

function signedInAs(role: "inspector" | "admin", id = role === "admin" ? ADMIN : INSPECTOR) {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id, email: `${role}@test.local`, fullName: null, role },
  });
}

beforeEach(() => {
  signedInAs("inspector");
  fileRows = { data: [], error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

/* ------------------------------------------------------------------ *
 * saveCaptureData
 * ------------------------------------------------------------------ */

describe("saveCaptureData", () => {
  const request = (data: unknown = COMPLETE, baseUpdatedAt = VERSION) => ({ inspectionId: INSPECTION, data, baseUpdatedAt });

  it("answers unauthorized without a session, before reading anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    useClient(() => ({ data: null, error: null }));
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: false,
      reason: "unauthorized",
      message: "Your session has ended. Sign in again.",
    });
    expect(client.queries).toHaveLength(0);
  });

  it("refuses a request that is not one", async () => {
    useClient(() => ({ data: row(), error: null }));
    await expect(saveCaptureData({ inspectionId: "INS-1", data: {}, baseUpdatedAt: "" })).resolves.toMatchObject({
      ok: false,
      reason: "invalid",
    });
    await expect(saveCaptureData(request({ modules: {}, custom: {}, extra: 1 }))).resolves.toMatchObject({ reason: "invalid" });
  });

  it("answers not_found for an inspection the user cannot see", async () => {
    useClient(() => ({ data: null, error: null }));
    await expect(saveCaptureData(request())).resolves.toMatchObject({ ok: false, reason: "not_found" });
  });

  it("refuses a submitted inspection, saying it was submitted", async () => {
    useClient(() => ({ data: row({ status: "submitted" }), error: null }));
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: false,
      reason: "forbidden",
      message: "This inspection has been submitted and can no longer be changed here.",
      state: { status: "submitted", overrides: {} },
    });
  });

  it("answers conflict with the server's copy when someone saved in between", async () => {
    const stored = { modules: { glove_info: { colour: "Red", indicativeWeight: null } }, custom: {} };
    useClient(() => ({ data: row({ data: stored, updated_at: NEXT_VERSION }), error: null }));
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: false,
      reason: "conflict",
      server: { data: stored, updatedAt: NEXT_VERSION },
      state: { status: "draft", overrides: {} },
    });
    expect(client.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("refuses changed data that fails the module's schema, naming the section", async () => {
    useClient(() => ({ data: row(), error: null }));
    const outcome = await saveCaptureData(
      request({ modules: { glove_info: { indicativeWeight: "2 42", colour: null } }, custom: {} }),
    );
    expect(outcome).toMatchObject({ ok: false, reason: "invalid" });
    expect(outcome.ok === false && "message" in outcome ? outcome.message : "").toMatch(/^Glove Information: indicativeWeight: /);
  });

  it("writes the data with compare-and-set and the mirrored columns", async () => {
    useClient((query) =>
      isUpdate(query) ? { data: { updated_at: NEXT_VERSION }, error: null } : { data: row(), error: null },
    );
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: true,
      updatedAt: NEXT_VERSION,
      state: { status: "draft", overrides: {} },
    });

    const update = client.queries.find(isUpdate);
    expect(update && hasEq(update, "id", INSPECTION) && hasEq(update, "updated_at", VERSION)).toBe(true);
    expect(updatePayload(update)).toMatchObject({
      data: COMPLETE,
      po_no: "PO-0001",
      product_name: "Nitrile gloves",
      lot_numbers: [],
      inspection_date: "2026-10-06",
      result: "pass",
      remarks: null,
      suggested_result: "hold",
    });
    expect(updatePayload(update)).not.toHaveProperty("status");
    expect(updatePayload(update)).not.toHaveProperty("client_id");
  });

  it("writes through save_inspection() with the secret key, for the signed-in user, when the server has the key", async () => {
    useClient(() => ({ data: row(), error: null }));
    const admin = withSecretKey(() => ({ data: NEXT_VERSION, error: null }));
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: true,
      updatedAt: NEXT_VERSION,
      state: { status: "draft", overrides: {} },
    });
    expect(admin.rpcCalls).toEqual([
      [
        "save_inspection",
        {
          inspection_id: INSPECTION,
          actor_id: INSPECTOR,
          base_updated_at: VERSION,
          data: COMPLETE,
          mirrored_columns: expect.objectContaining({ po_no: "PO-0001", result: "pass", suggested_result: "hold" }),
        },
      ],
    ]);
    // The inspector's own session only read.
    expect(client.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("writes a code letter changed since the stored data as an audit row with it, through save_inspection_with_events() (Kenneth, 27 October 2026)", async () => {
    const stored = row({ template: { id: "t1", code: "TEST_EG", version: 1, resolved: makeTestTemplate(TEST_REGISTRY, ["glove_info", "sampling_plan"]) } });
    useClient(() => ({ data: stored, error: null }));
    const admin = withSecretKey(() => ({ data: NEXT_VERSION, error: null }));
    const reduced = {
      action: CODE_LETTER_CHANGED,
      changes: { module: "sampling_plan", size: "S", from: "N", to: "M", direction: "reduced", reason: "Audited factory.", glovesFrom: 500, glovesTo: 315 },
    };
    vi.mocked(samplingEvents).mockReturnValueOnce([reduced]);
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: true,
      updatedAt: NEXT_VERSION,
      state: { status: "draft", overrides: {} },
    });
    // From the server's own read of the stored data, the data saved and the sampling plan's evaluation of it.
    expect(samplingEvents).toHaveBeenCalledWith(stored.data, COMPLETE, expect.objectContaining({ key: "sampling_plan" }));
    expect(admin.rpcCalls).toEqual([
      [
        "save_inspection_with_events",
        {
          inspection_id: INSPECTION,
          actor_id: INSPECTOR,
          base_updated_at: VERSION,
          data: COMPLETE,
          mirrored_columns: expect.objectContaining({ po_no: "PO-0001" }),
          events: [reduced],
        },
      ],
    ]);
  });

  it("reads the inspection's files with it, so the mirrored results count them as the screen does", async () => {
    useClient((query) =>
      isUpdate(query) ? { data: { updated_at: NEXT_VERSION }, error: null } : { data: row(), error: null },
    );
    await expect(saveCaptureData(request())).resolves.toMatchObject({ ok: true });
    const files = client.queries.find((query) => query.table === "inspection_files");
    expect(files && hasEq(files, "inspection_id", INSPECTION)).toBe(true);
  });

  it("answers a server error the autosave retries when the files cannot be read", async () => {
    fileRows = { data: null, error: { code: "57014", message: "canceling statement due to statement timeout" } };
    useClient(() => ({ data: row(), error: null }));
    await expect(saveCaptureData(request())).resolves.toMatchObject({ ok: false, reason: "server" });
    expect(client.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("lets an admin save another inspector's draft", async () => {
    signedInAs("admin");
    useClient((query) =>
      isUpdate(query) ? { data: { updated_at: NEXT_VERSION }, error: null } : { data: row(), error: null },
    );
    await expect(saveCaptureData(request())).resolves.toMatchObject({ ok: true, updatedAt: NEXT_VERSION });
  });

  it("answers the overrides it saved with, so a section switched off elsewhere leaves this screen too", async () => {
    const overrides = { packing_config: { reason: "Not ordered.", by: ADMIN, at: "2026-10-06T08:00:00.000Z" } };
    useClient((query) =>
      isUpdate(query)
        ? { data: { updated_at: NEXT_VERSION }, error: null }
        : { data: row({ module_overrides: overrides }), error: null },
    );
    await expect(saveCaptureData(request())).resolves.toEqual({
      ok: true,
      updatedAt: NEXT_VERSION,
      state: { status: "draft", overrides },
    });
  });

  it("answers no state with a compare-and-set that missed after the read: it belongs to an older version", async () => {
    let reads = 0;
    useClient((query) => {
      if (isUpdate(query)) return { data: null, error: null };
      reads += 1;
      // The capture read, then the transport's own read of the row that moved on.
      return reads === 1
        ? { data: row(), error: null }
        : { data: { data: COMPLETE, updated_at: NEXT_VERSION, status: "draft" }, error: null };
    });
    const outcome = await saveCaptureData(request());
    expect(outcome).toMatchObject({ ok: false, reason: "conflict", server: { updatedAt: NEXT_VERSION } });
    expect(outcome).not.toHaveProperty("state");
  });

  it("turns an unexpected failure into a server error the autosave retries", async () => {
    useClient(() => {
      throw new Error("socket hang up");
    });
    await expect(saveCaptureData(request())).resolves.toMatchObject({ ok: false, reason: "server" });
  });
});

/* ------------------------------------------------------------------ *
 * submitInspection
 * ------------------------------------------------------------------ */

describe("submitInspection", () => {
  const submit = (data: InspectionData = COMPLETE) => submitInspection({ inspectionId: INSPECTION, dataHash: contentHash(data) });

  it("submits through submit_inspection() with the secret key, for the signed-in user, when the server has the key", async () => {
    useClient(() => ({ data: row({ data: COMPLETE }), error: null }));
    const admin = withSecretKey(() => ({ data: NEXT_VERSION, error: null }));
    await expect(submit()).rejects.toThrow(`REDIRECT /inspections/${INSPECTION}/review`);
    expect(admin.rpcCalls).toEqual([
      [
        "submit_inspection",
        {
          inspection_id: INSPECTION,
          actor_id: INSPECTOR,
          base_updated_at: VERSION,
          mirrored_columns: expect.objectContaining({ po_no: "PO-0001", result: "pass" }),
        },
      ],
    ]);
    expect(client.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("says the inspection changed when submit_inspection() wrote nothing, and what the database refused", async () => {
    useClient(() => ({ data: row({ data: COMPLETE }), error: null }));
    withSecretKey(() => ({ data: null, error: null }));
    await expect(submit()).resolves.toEqual({
      status: "error",
      message: "This inspection changed while it was being submitted. Reload the page, then submit again.",
    });
    withSecretKey(() => ({ data: null, error: { code: "23514", message: "status cannot change from approved to submitted" } }));
    await expect(submit()).resolves.toEqual({
      status: "error",
      message: "This inspection cannot be submitted from its current status. Reload the page.",
    });
  });

  it("submits saved data without errors and opens the review", async () => {
    useClient((query) =>
      isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row({ data: COMPLETE }), error: null },
    );
    await expect(submit()).rejects.toThrow(`REDIRECT /inspections/${INSPECTION}/review`);
    const update = client.queries.find(isUpdate);
    expect(updatePayload(update)).toMatchObject({ status: "submitted", result: "pass", po_no: "PO-0001" });
    expect(update && hasEq(update, "updated_at", VERSION)).toBe(true);
    expect(redirect).toHaveBeenCalledWith(`/inspections/${INSPECTION}/review`);
  });

  it("starts the AI second opinion when the template asks for it, and never otherwise", async () => {
    vi.mocked(scheduleAiReviewOnSubmit).mockResolvedValue({ ok: true, reviewId: "r1", inspectionUpdatedAt: NEXT_VERSION });
    const asking = { id: "t1", code: "TEST_EG", version: 1, resolved: { ...template(), ai: { reviewOnSubmit: true } } };
    useClient((query) =>
      isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row({ data: COMPLETE, template: asking }), error: null },
    );
    await expect(submit()).rejects.toThrow(`REDIRECT /inspections/${INSPECTION}/review`);
    // As the user who submitted, so the review's cost is theirs.
    expect(scheduleAiReviewOnSubmit).toHaveBeenCalledWith(INSPECTION, INSPECTOR);
    // The request stays alive for a review still starting when the review opens.
    expect(after).toHaveBeenCalledTimes(1);

    vi.mocked(scheduleAiReviewOnSubmit).mockClear();
    const silent = { ...asking, resolved: { ...template(), ai: { reviewOnSubmit: false } } };
    useClient((query) =>
      isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row({ data: COMPLETE, template: silent }), error: null },
    );
    await expect(submit()).rejects.toThrow("REDIRECT");
    useClient((query) =>
      isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row({ data: COMPLETE }), error: null },
    );
    await expect(submit()).rejects.toThrow("REDIRECT");
    expect(scheduleAiReviewOnSubmit).not.toHaveBeenCalled();
  });

  it("submits all the same when the AI second opinion cannot start", async () => {
    vi.mocked(scheduleAiReviewOnSubmit).mockRejectedValue(new Error("reviewer down"));
    const asking = { id: "t1", code: "TEST_EG", version: 1, resolved: { ...template(), ai: { reviewOnSubmit: true } } };
    useClient((query) =>
      isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row({ data: COMPLETE, template: asking }), error: null },
    );
    await expect(submit()).rejects.toThrow(`REDIRECT /inspections/${INSPECTION}/review`);
    expect(updatePayload(client.queries.find(isUpdate))).toMatchObject({ status: "submitted" });
  });

  it("does not ask for a second opinion of an inspection submitted already", async () => {
    const asking = { id: "t1", code: "TEST_EG", version: 1, resolved: { ...template(), ai: { reviewOnSubmit: true } } };
    useClient(() => ({ data: row({ status: "submitted", data: COMPLETE, template: asking }), error: null }));
    await expect(submit()).rejects.toThrow("REDIRECT");
    expect(scheduleAiReviewOnSubmit).not.toHaveBeenCalled();
  });

  it("stays blocked while the saved data has errors, and lists them", async () => {
    const data = { modules: { ...COMPLETE.modules, conclusion: { finalResult: null, remark: null } }, custom: {} };
    useClient(() => ({ data: row({ data }), error: null }));
    const result = await submit(data);
    expect(result).toMatchObject({ status: "blocked", message: "1 item is needed before you can submit.", overrides: {} });
    expect(result.status === "blocked" && result.errors.map((issue) => issue.moduleKey)).toEqual(["conclusion"]);
    expect(client.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("counts a required custom field as an error", async () => {
    useClient(() => ({
      data: row({ data: COMPLETE, template: { id: "t1", code: "TEST_EG", version: 1, resolved: template(true) } }),
      error: null,
    }));
    const result = await submit();
    expect(result.status === "blocked" && result.errors.map((issue) => issue.code)).toEqual(["required"]);
  });

  it("refuses when the saved data is not what the inspector checked", async () => {
    useClient(() => ({ data: row({ data: COMPLETE }), error: null }));
    const result = await submitInspection({ inspectionId: INSPECTION, dataHash: contentHash({ modules: {}, custom: {} }) });
    expect(result).toMatchObject({ status: "error" });
    expect(result.status === "error" && result.message).toMatch(/changed on another device/);
  });

  it("refuses when the row moved while it was being submitted", async () => {
    useClient((query) => (isUpdate(query) ? { data: [], error: null } : { data: row({ data: COMPLETE }), error: null }));
    await expect(submit()).resolves.toMatchObject({ status: "error", message: expect.stringMatching(/changed while/) });
  });

  it("opens the review of an inspection that is submitted already", async () => {
    useClient(() => ({ data: row({ status: "submitted", data: COMPLETE }), error: null }));
    await expect(submit()).rejects.toThrow("REDIRECT");
    expect(client.queries.filter(isUpdate)).toHaveLength(0);
  });

  it("refuses an approved inspection and a request that is not one", async () => {
    useClient(() => ({ data: row({ status: "approved", data: COMPLETE }), error: null }));
    await expect(submit()).resolves.toMatchObject({ status: "error", message: expect.stringMatching(/approved/) });
    await expect(submitInspection({ inspectionId: INSPECTION, dataHash: "x" })).resolves.toMatchObject({ status: "error" });
  });

  it("explains the database refusing the change of status", async () => {
    useClient((query) =>
      isUpdate(query)
        ? { data: null, error: { code: "23514", message: "status cannot change" } }
        : { data: row({ data: COMPLETE }), error: null },
    );
    await expect(submit()).resolves.toMatchObject({ status: "error", message: expect.stringMatching(/current status/) });
  });
});

/* ------------------------------------------------------------------ *
 * switchModuleOff / switchModuleOn
 * ------------------------------------------------------------------ */

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("switchModuleOff", () => {
  beforeEach(() => signedInAs("admin"));

  it("is for admins only", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    useClient(() => ({ data: row(), error: null }));
    await expect(
      switchModuleOff(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight", reason: "n/a" })),
    ).resolves.toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith("admin");
  });

  it("needs a reason, reported on the field", async () => {
    useClient(() => ({ data: row(), error: null }));
    await expect(
      switchModuleOff(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight", reason: "  " })),
    ).resolves.toEqual({
      status: "error",
      message: "Say why this section is switched off.",
      fieldError: "Say why this section is switched off.",
    });
  });

  it("says why a module cannot be switched off", async () => {
    useClient(() => ({ data: row(), error: null }));
    await expect(
      switchModuleOff(IDLE, form({ inspectionId: INSPECTION, moduleKey: "conclusion", reason: "n/a" })),
    ).resolves.toMatchObject({ status: "error", message: expect.stringMatching(/^Conclusion is always on/) });
  });

  it("switches it off with the reason, the admin and the time, logs it and follows the suggestion", async () => {
    useClient((query) => (isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row(), error: null }));
    const result = await switchModuleOff(
      IDLE,
      form({ inspectionId: INSPECTION, moduleKey: "weight", reason: " Not in this order. " }),
    );
    // Named by its short name, as the screen's menus name it (the template's "Weight (g)").
    expect(result).toMatchObject({ status: "success", message: "Weight is switched off for this inspection." });
    const override = result.status === "success" ? result.overrides.weight : undefined;
    expect(override).toMatchObject({ reason: "Not in this order.", by: ADMIN });
    expect(Number.isNaN(Date.parse(override?.at ?? ""))).toBe(false);

    const update = client.queries.find(isUpdate);
    expect(updatePayload(update)).toMatchObject({ module_overrides: { weight: override }, suggested_result: "hold" });
    expect(update && hasEq(update, "updated_at", VERSION)).toBe(true);
    expect(client.rpcCalls).toEqual([
      [
        "log_inspection_event",
        {
          inspection_id: INSPECTION,
          action: "module_override",
          changes: { module: "weight", include: false, reason: "Not in this order." },
        },
      ],
    ]);
  });

  it("tries again when another change landed in between", async () => {
    let updates = 0;
    useClient((query) => {
      if (!isUpdate(query)) return { data: row(), error: null };
      updates += 1;
      return { data: updates === 1 ? [] : [{ id: INSPECTION }], error: null };
    });
    await expect(
      switchModuleOff(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight", reason: "n/a" })),
    ).resolves.toMatchObject({ status: "success" });
    expect(updates).toBe(2);
  });

  it("keeps the change but warns when the audit log refuses it", async () => {
    useClient(
      (query) => (isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row(), error: null }),
      () => ({ data: null, error: { code: "42501", message: "no" } }),
    );
    await expect(
      switchModuleOff(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight", reason: "n/a" })),
    ).resolves.toMatchObject({ status: "warning", message: expect.stringMatching(/audit log/) });
  });

  it("leaves an approved inspection alone", async () => {
    useClient(() => ({ data: row({ status: "approved" }), error: null }));
    await expect(
      switchModuleOff(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight", reason: "n/a" })),
    ).resolves.toEqual({ status: "error", message: "An approved inspection is read-only." });
  });
});

describe("switchModuleOn", () => {
  beforeEach(() => signedInAs("admin"));

  const off = { weight: { reason: "Not in this order.", by: ADMIN, at: "2026-10-06T08:00:00.000Z" } };

  it("removes the override and logs the earlier reason", async () => {
    useClient((query) =>
      isUpdate(query) ? { data: [{ id: INSPECTION }], error: null } : { data: row({ module_overrides: off }), error: null },
    );
    const result = await switchModuleOn(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight" }));
    expect(result).toEqual({ status: "success", message: "Weight is switched back on.", overrides: {} });
    expect(updatePayload(client.queries.find(isUpdate))).toMatchObject({ module_overrides: {} });
    expect(client.rpcCalls[0][1]).toMatchObject({
      changes: { module: "weight", include: true, previousReason: "Not in this order." },
    });
  });

  it("says when the module is not switched off", async () => {
    useClient(() => ({ data: row(), error: null }));
    await expect(switchModuleOn(IDLE, form({ inspectionId: INSPECTION, moduleKey: "weight" }))).resolves.toEqual({
      status: "error",
      message: "Weight is not switched off for this inspection.",
    });
  });
});
