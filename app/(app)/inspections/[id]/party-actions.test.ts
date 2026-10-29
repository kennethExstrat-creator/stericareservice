import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));
vi.mock("next/cache", () => ({ refresh: vi.fn(), revalidatePath: vi.fn() }));
vi.mock("next/navigation", () => ({ unstable_rethrow: vi.fn() }));

import { refresh, revalidatePath } from "next/cache";
import { authorizeAction } from "@/lib/auth/session";
import { CLIENT_CHANGED, MANUFACTURER_CHANGED, PARTY_MESSAGES } from "@/lib/inspections/capture/party-events";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { changeInspectionParty } from "./party-actions";

// General Information's Client Name and Manufacturer / Supplier changed on the capture screen (Kenneth, 30 October
// 2026: "manufacturer and client should be editable"). Placeholder clients and factories only.

const INSPECTION = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const INSPECTOR = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const OTHER_INSPECTOR = "1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e";
const ADMIN = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";
const CLIENT_A = { id: "20000000-0000-4000-8000-0000000000c1", name: "Client A" };
const CLIENT_B = { id: "20000000-0000-4000-8000-0000000000c2", name: "Client B" };
const ADDRESS_A = "Lot 1, Jalan Placeholder 1, Town A";
const ADDRESS_B = "Lot 2, Jalan Placeholder 2, Town B";
const FACTORY_A = {
  id: "10000000-0000-4000-8000-0000000000f1",
  address: ADDRESS_A,
  factory_name: "Factory A1",
  company: { name: "Company A", brand: { name: "Manufacturer A" } },
};
const FACTORY_B = {
  id: "10000000-0000-4000-8000-0000000000f2",
  address: ADDRESS_B,
  factory_name: null,
  company: { name: "Manufacturer B NGC", brand: { name: "Manufacturer B" } },
};

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder answers for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

function fakeClient(respond: (query: Query) => Result, rpc: (name: string, args: unknown) => Result = () => ({ data: 1, error: null })) {
  const queries: Query[] = [];
  const rpcCalls: Array<[string, unknown]> = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "insert", "eq", "in", "is"]) {
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

const called = (query: Query, method: string) => query.calls.filter(([name]) => name === method).map(([, args]) => args);
const isWrite = (query: Query) => called(query, "update").length > 0 || called(query, "insert").length > 0;

/** The inspection as the action's select returns it. */
function inspection(overrides: Record<string, unknown> = {}) {
  return { id: INSPECTION, status: "draft", inspector_id: INSPECTOR, client: CLIENT_A, manufacturer: FACTORY_A, ...overrides };
}

/** The user's own session: reads the inspection and the lists. */
function userSession(row: unknown, lists: { clients?: unknown; manufacturers?: unknown } = {}) {
  const session = fakeClient((query) => {
    if (query.table === "inspections") return { data: row, error: null };
    if (query.table === "clients") return { data: lists.clients ?? null, error: null };
    if (query.table === "manufacturers") return { data: lists.manufacturers ?? null, error: null };
    return { data: null, error: null };
  });
  vi.mocked(createClient).mockResolvedValue(session.client as never);
  return session;
}

/** The secret-key client: the update answers `updated` rows; the audit insert answers `logged`. */
function secretKey({ updated = [{ id: INSPECTION }], logged = { data: null, error: null } }: { updated?: unknown[]; logged?: Result } = {}) {
  const admin = fakeClient((query) => (query.table === "audit_log" ? logged : { data: updated, error: null }));
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.mocked(createAdminClient).mockReturnValue(admin.client as never);
  return admin;
}

function signedInAs(role: "inspector" | "admin", id = role === "admin" ? ADMIN : INSPECTOR) {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: { id, email: `${role}@test.local`, fullName: null, role } } as never);
}

const changeClient = (id: string | null) => changeInspectionParty({ inspectionId: INSPECTION, party: "client", id });
const changeManufacturer = (id: string) => changeInspectionParty({ inspectionId: INSPECTION, party: "manufacturer", id });

beforeEach(() => {
  signedInAs("inspector");
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("changeInspectionParty: who may change the client and manufacturer", () => {
  it("refuses without a session, before reading anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    const session = userSession(inspection());
    const admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: false, message: "Your session has ended. Sign in again." });
    expect(session.queries).toHaveLength(0);
    expect(admin.queries).toHaveLength(0);
  });

  it("refuses a request that is not one: no inspection id, no factory, a party it does not know", async () => {
    const session = userSession(inspection());
    for (const input of [
      { inspectionId: "INS-1", party: "client", id: CLIENT_B.id },
      { inspectionId: INSPECTION, party: "manufacturer", id: null },
      { inspectionId: INSPECTION, party: "inspector", id: INSPECTOR },
      { inspectionId: INSPECTION, party: "client", id: "Client B" },
    ]) {
      await expect(changeInspectionParty(input)).resolves.toEqual({ ok: false, message: PARTY_MESSAGES.invalid });
    }
    expect(session.queries).toHaveLength(0);
  });

  it("answers not found for an inspection the user cannot see", async () => {
    userSession(null);
    const admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: false, message: "The inspection no longer exists." });
    expect(admin.queries).toHaveLength(0);
  });

  it.each([
    ["submitted", { status: "submitted" }, "This inspection has been submitted and can no longer be changed here."],
    ["approved", { status: "approved" }, "This inspection is approved and can no longer be changed."],
    ["another inspector's", { inspector_id: OTHER_INSPECTOR }, "This inspection can no longer be changed from this account."],
  ])("refuses a %s inspection, as its save would, and writes nothing", async (_, overrides, message) => {
    const session = userSession(inspection(overrides), { clients: CLIENT_B, manufacturers: FACTORY_B });
    const admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: false, message });
    await expect(changeManufacturer(FACTORY_B.id)).resolves.toEqual({ ok: false, message });
    expect(session.queries.map((query) => query.table)).toEqual(["inspections", "inspections"]);
    expect(admin.queries).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("lets an admin change another inspector's draft or reopened inspection", async () => {
    signedInAs("admin");
    userSession(inspection({ inspector_id: OTHER_INSPECTOR, status: "reopened" }), { clients: CLIENT_B });
    const admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toMatchObject({ ok: true, changed: true, client: CLIENT_B });
    expect(admin.queries.filter(isWrite)).toHaveLength(2);
  });
});

describe("changeInspectionParty: what it changes", () => {
  it("refuses a client or factory that is not in the list, and writes nothing", async () => {
    userSession(inspection());
    const admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: false, message: PARTY_MESSAGES.clientGone });
    await expect(changeManufacturer(FACTORY_B.id)).resolves.toEqual({ ok: false, message: PARTY_MESSAGES.manufacturerGone });
    expect(admin.queries).toHaveLength(0);
  });

  it("changes nothing when the client or factory is already the inspection's", async () => {
    userSession(inspection());
    const admin = secretKey();
    await expect(changeClient(CLIENT_A.id)).resolves.toEqual({ ok: true, party: "client", changed: false, client: CLIENT_A });
    await expect(changeManufacturer(FACTORY_A.id)).resolves.toEqual({
      ok: true,
      party: "manufacturer",
      changed: false,
      manufacturer: { id: FACTORY_A.id, name: "Manufacturer A · Factory A1", brand: "Manufacturer A" },
      address: { previous: ADDRESS_A, next: ADDRESS_A },
    });
    userSession(inspection({ client: null }));
    await expect(changeClient(null)).resolves.toEqual({ ok: true, party: "client", changed: false, client: null });
    expect(admin.queries).toHaveLength(0);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("writes the client with the secret key while the inspection is still editable and still has the old one, then audits it", async () => {
    const session = userSession(inspection(), { clients: CLIENT_B });
    const admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: true, party: "client", changed: true, client: CLIENT_B });

    // The list read with the user's own session, so row level security decides what is listed.
    expect(called(session.queries.find((query) => query.table === "clients")!, "eq")).toEqual([["id", CLIENT_B.id]]);
    expect(session.queries.some(isWrite)).toBe(false);

    const [update, audit] = admin.queries;
    expect(update.table).toBe("inspections");
    expect(called(update, "update")).toEqual([[{ client_id: CLIENT_B.id }]]);
    expect(called(update, "eq")).toEqual([
      ["id", INSPECTION],
      ["client_id", CLIENT_A.id],
    ]);
    expect(called(update, "in")).toEqual([["status", ["draft", "reopened"]]]);

    // One audit row in the user's name, the old and new names as they read now.
    expect(audit.table).toBe("audit_log");
    expect(called(audit, "insert")).toEqual([
      [{ inspection_id: INSPECTION, actor_id: INSPECTOR, action: CLIENT_CHANGED, changes: { from: CLIENT_A, to: CLIENT_B } }],
    ]);
    expect(admin.rpcCalls).toEqual([]);

    // The screen's page and the list follow the row.
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(revalidatePath).toHaveBeenCalledWith("/inspections");
  });

  it("takes the client away (No Client) and gives one to an inspection without", async () => {
    userSession(inspection(), {});
    let admin = secretKey();
    await expect(changeClient(null)).resolves.toEqual({ ok: true, party: "client", changed: true, client: null });
    expect(called(admin.queries[0], "update")).toEqual([[{ client_id: null }]]);
    expect(called(admin.queries[1], "insert")[0][0]).toMatchObject({ changes: { from: CLIENT_A, to: null } });

    userSession(inspection({ client: null }), { clients: CLIENT_B });
    admin = secretKey();
    await expect(changeClient(CLIENT_B.id)).resolves.toMatchObject({ ok: true, changed: true, client: CLIENT_B });
    // Only while it still has no client.
    expect(called(admin.queries[0], "is")).toEqual([["client_id", null]]);
    expect(called(admin.queries[1], "insert")[0][0]).toMatchObject({ changes: { from: null, to: CLIENT_B } });
  });

  it("changes the factory, naming both by their labels, and answers both stored addresses for the header", async () => {
    const session = userSession(inspection(), { manufacturers: FACTORY_B });
    const admin = secretKey();
    await expect(changeManufacturer(FACTORY_B.id)).resolves.toEqual({
      ok: true,
      party: "manufacturer",
      changed: true,
      manufacturer: { id: FACTORY_B.id, name: "Manufacturer B NGC", brand: "Manufacturer B" },
      address: { previous: ADDRESS_A, next: ADDRESS_B },
    });
    // The factory's names come from its company and brand (MANUFACTURER_NAMES_SELECT), never manufacturers.name.
    const [select] = called(session.queries.find((query) => query.table === "manufacturers")!, "select");
    expect(select[0]).toContain("company:manufacturer_companies(name, brand:manufacturer_brands(name))");
    expect(select[0]).not.toMatch(/(^|[ ,])name[ ,]/);

    const [update, audit] = admin.queries;
    expect(called(update, "update")).toEqual([[{ manufacturer_id: FACTORY_B.id }]]);
    expect(called(update, "eq")).toEqual([
      ["id", INSPECTION],
      ["manufacturer_id", FACTORY_A.id],
    ]);
    expect(called(audit, "insert")).toEqual([
      [
        {
          inspection_id: INSPECTION,
          actor_id: INSPECTOR,
          action: MANUFACTURER_CHANGED,
          changes: {
            from: { id: FACTORY_A.id, name: "Manufacturer A · Factory A1" },
            to: { id: FACTORY_B.id, name: "Manufacturer B NGC" },
          },
        },
      ],
    ]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("writes nothing more when the inspection changed in between (submitted, or another pick landed first)", async () => {
    userSession(inspection(), { clients: CLIENT_B });
    const admin = secretKey({ updated: [] });
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: false, message: PARTY_MESSAGES.changedMeanwhile });
    expect(admin.queries.map((query) => query.table)).toEqual(["inspections"]);
    expect(refresh).not.toHaveBeenCalled();
  });

  it("keeps the change when its audit row cannot be written, and says so", async () => {
    userSession(inspection(), { clients: CLIENT_B });
    secretKey({ logged: { data: null, error: { code: "42501", message: "permission denied" } } });
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({
      ok: true,
      party: "client",
      changed: true,
      client: CLIENT_B,
      warning: PARTY_MESSAGES.notLogged,
    });
  });

  it("without the secret key writes with the user's own session and audits through log_inspection_event", async () => {
    signedInAs("admin");
    const session = fakeClient((query) => {
      if (query.table === "inspections" && called(query, "update").length === 0) return { data: inspection(), error: null };
      if (query.table === "clients") return { data: CLIENT_B, error: null };
      return { data: [{ id: INSPECTION }], error: null };
    });
    vi.mocked(createClient).mockResolvedValue(session.client as never);
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    await expect(changeClient(CLIENT_B.id)).resolves.toMatchObject({ ok: true, changed: true });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(session.rpcCalls).toEqual([
      ["log_inspection_event", { inspection_id: INSPECTION, action: CLIENT_CHANGED, changes: { from: CLIENT_A, to: CLIENT_B } }],
    ]);
  });

  it("answers a refusal by the database in plain words", async () => {
    userSession(inspection(), { clients: CLIENT_B });
    const admin = fakeClient(() => ({ data: null, error: { code: "42501", message: "inspectors save and submit inspections through the app" } }));
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue(admin.client as never);
    await expect(changeClient(CLIENT_B.id)).resolves.toEqual({ ok: false, message: "This inspection can no longer be changed from this account." });
  });
});
