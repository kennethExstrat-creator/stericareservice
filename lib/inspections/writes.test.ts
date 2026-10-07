import type { SupabaseClient } from "@supabase/supabase-js";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import type { Database } from "@/lib/supabase/database.types";
import { createInspectionRow, isMissingFunction, serverWriter, submitInspectionRow } from "./writes";

type Answer = { data: unknown; error: { code?: string; message: string } | null };

const INSPECTION = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const TEMPLATE = "3c1f0e9a-7d2b-4e6f-8a1c-5b4d3e2f1a0b";
const MANUFACTURER = "10000000-0000-4000-8000-000000000001";
const CLIENT = "20000000-0000-4000-8000-000000000001";
const USER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const VERSION = "2026-10-07T09:14:03.123456+00:00";
const MISSING = { code: "PGRST202", message: "Could not find the function in the schema cache" };
const COLUMNS = { po_no: "PO-0001", lot_numbers: ["L1"], result: "pass" as const, suggested_result: "pass" as const };

/** A client that records rpc() calls and table queries, and answers each from a script. */
function fakeClient(...answers: Answer[]) {
  const rpcCalls: [string, unknown][] = [];
  const chains: string[][] = [];
  const next = () => Promise.resolve(answers.shift() ?? { data: null, error: null });
  const client = {
    rpc: vi.fn((name: string, args: unknown) => {
      rpcCalls.push([name, args]);
      return next();
    }),
    from(table: string) {
      const chain = [`from ${table}`];
      chains.push(chain);
      const builder: Record<string, unknown> = {
        single: () => {
          chain.push("single");
          return next();
        },
        then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) => next().then(resolve, reject),
      };
      for (const method of ["insert", "update", "select", "eq"]) {
        builder[method] = (...args: unknown[]) => {
          chain.push(`${method} ${args.map((arg) => JSON.stringify(arg)).join(" ")}`);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, rpcCalls, chains };
}

beforeEach(() => {
  vi.mocked(isAdminClientConfigured).mockReset();
  vi.mocked(createAdminClient).mockReset();
});

describe("serverWriter", () => {
  it("writes with the secret key for the signed-in user, when the server has the key", () => {
    const { client: admin } = fakeClient();
    vi.mocked(isAdminClientConfigured).mockReturnValue(true);
    vi.mocked(createAdminClient).mockReturnValue(admin as ReturnType<typeof createAdminClient>);
    expect(serverWriter(USER)).toEqual({ admin, actorId: USER });
  });

  it("is null without the key: the user's own session writes", () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    expect(serverWriter(USER)).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("isMissingFunction", () => {
  it("is PostgREST's answer for a function it does not know", () => {
    expect(isMissingFunction(MISSING)).toBe(true);
    expect(isMissingFunction({ code: "42501" })).toBe(false);
    expect(isMissingFunction(null)).toBe(false);
  });
});

describe("createInspectionRow", () => {
  const row = { templateId: TEMPLATE, clientId: CLIENT, manufacturerId: MANUFACTURER, data: { modules: {}, custom: {} }, columns: COLUMNS };

  it("starts the draft through create_inspection() for the user, and answers its id", async () => {
    const admin = fakeClient({ data: INSPECTION, error: null });
    const own = fakeClient();
    expect(await createInspectionRow(own.client, { admin: admin.client, actorId: USER }, row)).toEqual({ id: INSPECTION });
    expect(admin.rpcCalls).toEqual([
      [
        "create_inspection",
        {
          actor_id: USER,
          template_id: TEMPLATE,
          manufacturer_id: MANUFACTURER,
          client_id: CLIENT,
          data: { modules: {}, custom: {} },
          mirrored_columns: COLUMNS,
        },
      ],
    ]);
    expect(own.chains).toEqual([]);
  });

  it("leaves the client out when there is none", async () => {
    const admin = fakeClient({ data: INSPECTION, error: null });
    await createInspectionRow(fakeClient().client, { admin: admin.client, actorId: USER }, { ...row, clientId: null });
    expect(admin.rpcCalls[0][1]).not.toHaveProperty("client_id");
  });

  it("answers the database's refusal", async () => {
    const refusal = { code: "23514", message: "inspections start from an active template" };
    const admin = fakeClient({ data: null, error: refusal });
    expect(await createInspectionRow(fakeClient().client, { admin: admin.client, actorId: USER }, row)).toEqual({ error: refusal });
  });

  it("inserts with the user's own session without a writer, or before the migration has run", async () => {
    for (const writer of [null, { admin: fakeClient({ data: null, error: MISSING }).client, actorId: USER }]) {
      const own = fakeClient({ data: { id: INSPECTION }, error: null });
      expect(await createInspectionRow(own.client, writer, row)).toEqual({ id: INSPECTION });
      expect(own.chains).toEqual([
        [
          "from inspections",
          `insert ${JSON.stringify({ ...COLUMNS, template_id: TEMPLATE, client_id: CLIENT, manufacturer_id: MANUFACTURER, data: row.data })}`,
          'select "id"',
          "single",
        ],
      ]);
    }
  });
});

describe("submitInspectionRow", () => {
  const row = { inspectionId: INSPECTION, baseUpdatedAt: VERSION, columns: COLUMNS };

  it("submits through submit_inspection() for the user, at the validated version", async () => {
    const admin = fakeClient({ data: "2026-10-07T09:20:00.000001+00:00", error: null });
    const own = fakeClient();
    expect(await submitInspectionRow(own.client, { admin: admin.client, actorId: USER }, row)).toEqual({ submitted: true });
    expect(admin.rpcCalls).toEqual([
      ["submit_inspection", { inspection_id: INSPECTION, actor_id: USER, base_updated_at: VERSION, mirrored_columns: COLUMNS }],
    ]);
    expect(own.chains).toEqual([]);
  });

  it("answers not submitted when the inspection changed after it was validated", async () => {
    const admin = fakeClient({ data: null, error: null });
    expect(await submitInspectionRow(fakeClient().client, { admin: admin.client, actorId: USER }, row)).toEqual({ submitted: false });
  });

  it("answers the database's refusal", async () => {
    const refusal = { code: "23514", message: "status cannot change from approved to submitted" };
    const admin = fakeClient({ data: null, error: refusal });
    expect(await submitInspectionRow(fakeClient().client, { admin: admin.client, actorId: USER }, row)).toEqual({ error: refusal });
  });

  it("updates with the user's own session without a writer, or before the migration has run", async () => {
    for (const writer of [null, { admin: fakeClient({ data: null, error: MISSING }).client, actorId: USER }]) {
      const own = fakeClient({ data: [{ id: INSPECTION }], error: null });
      expect(await submitInspectionRow(own.client, writer, row)).toEqual({ submitted: true });
      expect(own.chains).toEqual([
        [
          "from inspections",
          `update ${JSON.stringify({ ...COLUMNS, status: "submitted" })}`,
          `eq "id" "${INSPECTION}"`,
          `eq "updated_at" "${VERSION}"`,
          'select "id"',
        ],
      ]);
    }
  });
});
