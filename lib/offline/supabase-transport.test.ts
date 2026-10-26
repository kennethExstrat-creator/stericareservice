import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import type { Database } from "@/lib/supabase/database.types";
import { saveInspectionData, supabaseAutosaveTransport } from "./supabase-transport";

type Answer = { data: unknown; error: { code?: string; message: string } | null; status: number };

const ID = "4b0f7a7e-62a5-4c4f-9a59-1b8f3c1e2d10";
const V1 = "2026-10-06T09:00:00.000001+00:00";
const V2 = "2026-10-06T09:00:00.000002+00:00";
const data = { modules: { weight: { values: [5.1] } }, custom: {} };

/** A query builder that records each chain and answers maybeSingle() from a script. */
function fakeClient(...answers: Answer[]) {
  const chains: string[][] = [];
  const client = {
    from(table: string) {
      const chain = [`from ${table}`];
      chains.push(chain);
      const builder: Record<string, unknown> = {
        maybeSingle: async () => {
          chain.push("maybeSingle");
          return answers.shift();
        },
      };
      for (const method of ["update", "select", "eq", "abortSignal"]) {
        builder[method] = (...args: unknown[]) => {
          chain.push(`${method} ${args.map((arg) => (arg instanceof AbortSignal ? "signal" : JSON.stringify(arg))).join(" ")}`);
          return builder;
        };
      }
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient<Database>, chains };
}

describe("saveInspectionData", () => {
  it("writes only while the row is at the base version, and returns the new version", async () => {
    const { client, chains } = fakeClient({ data: { updated_at: V2 }, error: null, status: 200 });
    const signal = new AbortController().signal;
    expect(await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1, signal })).toEqual({
      ok: true,
      updatedAt: V2,
    });
    expect(chains).toEqual([
      [
        "from inspections",
        `update ${JSON.stringify({ data })}`,
        `eq "id" "${ID}"`,
        `eq "updated_at" "${V1}"`,
        'select "updated_at"',
        "abortSignal signal",
        "maybeSingle",
      ],
    ]);
  });

  it("writes the mirrored columns with the data", async () => {
    const { client, chains } = fakeClient({ data: { updated_at: V2 }, error: null, status: 200 });
    await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1 }, { columns: () => ({ po_no: "PO-0001" }) });
    expect(chains[0][1]).toBe(`update ${JSON.stringify({ po_no: "PO-0001", data })}`);
  });

  it("answers a conflict with the server's copy when someone saved in between", async () => {
    const server = { modules: { weight: { values: [9.9] } }, custom: {} };
    const { client, chains } = fakeClient(
      { data: null, error: null, status: 200 },
      { data: { data: server, updated_at: V2, status: "draft" }, error: null, status: 200 },
    );
    expect(await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toEqual({
      ok: false,
      reason: "conflict",
      server: { data: server, updatedAt: V2 },
    });
    expect(chains[1]).toEqual(["from inspections", 'select "data, updated_at, status"', `eq "id" "${ID}"`, "maybeSingle"]);
  });

  it("refuses when the inspection was submitted, hidden, or deleted", async () => {
    const submitted = fakeClient(
      { data: null, error: null, status: 200 },
      { data: { data, updated_at: V2, status: "submitted" }, error: null, status: 200 },
    );
    expect(await saveInspectionData(submitted.client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toMatchObject({
      ok: false,
      reason: "forbidden",
      message: expect.stringMatching(/submitted/),
    });

    const sameVersion = fakeClient(
      { data: null, error: null, status: 200 },
      { data: { data, updated_at: V1, status: "draft" }, error: null, status: 200 },
    );
    expect(await saveInspectionData(sameVersion.client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toMatchObject({
      ok: false,
      reason: "forbidden",
    });

    const deleted = fakeClient({ data: null, error: null, status: 200 }, { data: null, error: null, status: 200 });
    expect(await saveInspectionData(deleted.client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toMatchObject({
      ok: false,
      reason: "not_found",
    });
  });

  it("reads errors from the database and the network", async () => {
    const guard = fakeClient({ data: null, error: { code: "42501", message: "inspections.template_id cannot change" }, status: 403 });
    expect(await saveInspectionData(guard.client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toEqual({
      ok: false,
      reason: "forbidden",
      message: "inspections.template_id cannot change",
    });
    const offline = fakeClient({ data: null, error: { message: "TypeError: Load failed" }, status: 0 });
    expect(await saveInspectionData(offline.client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toMatchObject({
      ok: false,
      reason: "network",
    });
  });

  it("asks for a sign-in when the session is gone, rather than reporting the inspection as locked", async () => {
    // Without a session supabase-js sends the publishable key; PostgREST runs as anon and answers 401.
    const anon = fakeClient({ data: null, error: { code: "42501", message: "permission denied for table inspections" }, status: 401 });
    expect(await saveInspectionData(anon.client, { inspectionId: ID, data, baseUpdatedAt: V1 })).toMatchObject({
      ok: false,
      reason: "unauthorized",
      message: expect.stringMatching(/sign in/i),
    });
  });

  describe("with the secret-key writer (migration 20261007190000)", () => {
    /** A secret-key client whose rpc() records its call and answers from a script. */
    function fakeAdmin(answer: Answer) {
      const calls: unknown[][] = [];
      const admin = {
        rpc(name: string, args: unknown) {
          const call = [name, args];
          calls.push(call);
          const builder = {
            abortSignal: (signal: AbortSignal) => {
              call.push(signal instanceof AbortSignal ? "signal" : signal);
              return builder;
            },
            then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(answer).then(resolve, reject),
          };
          return builder;
        },
      };
      return { admin: admin as unknown as SupabaseClient<Database>, calls };
    }

    it("saves through save_inspection() for the user, with the mirrored columns, and answers the new version", async () => {
      const { admin, calls } = fakeAdmin({ data: V2, error: null, status: 200 });
      const { client, chains } = fakeClient();
      const signal = new AbortController().signal;
      const outcome = await saveInspectionData(
        client,
        { inspectionId: ID, data, baseUpdatedAt: V1, signal },
        { columns: () => ({ po_no: "PO-0001" }), writer: { admin, actorId: "user-1" } },
      );
      expect(outcome).toEqual({ ok: true, updatedAt: V2 });
      expect(calls).toEqual([
        [
          "save_inspection",
          { inspection_id: ID, actor_id: "user-1", base_updated_at: V1, data, mirrored_columns: { po_no: "PO-0001" } },
          "signal",
        ],
      ]);
      // The user's own session wrote nothing.
      expect(chains).toEqual([]);
    });

    it("tells why nothing was written with the user's own session, never the secret key", async () => {
      const server = { modules: { weight: { values: [9.9] } }, custom: {} };
      const { admin } = fakeAdmin({ data: null, error: null, status: 200 });
      const { client, chains } = fakeClient({ data: { data: server, updated_at: V2, status: "draft" }, error: null, status: 200 });
      expect(
        await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1 }, { writer: { admin, actorId: "user-1" } }),
      ).toEqual({ ok: false, reason: "conflict", server: { data: server, updatedAt: V2 } });
      expect(chains).toEqual([["from inspections", 'select "data, updated_at, status"', `eq "id" "${ID}"`, "maybeSingle"]]);
    });

    it("reports what the function refused", async () => {
      const { admin } = fakeAdmin({ data: null, error: { code: "42501", message: "the account is not active" }, status: 403 });
      const { client } = fakeClient();
      expect(
        await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1 }, { writer: { admin, actorId: "user-1" } }),
      ).toEqual({ ok: false, reason: "forbidden", message: "the account is not active" });
    });

    it("updates with the user's session on a project that has not run the migration", async () => {
      const missing = { code: "PGRST202", message: "Could not find the function public.save_inspection" };
      const { admin } = fakeAdmin({ data: null, error: missing, status: 404 });
      const { client, chains } = fakeClient({ data: { updated_at: V2 }, error: null, status: 200 });
      expect(
        await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1 }, { writer: { admin, actorId: "user-1" } }),
      ).toEqual({ ok: true, updatedAt: V2 });
      expect(chains[0].slice(0, 2)).toEqual(["from inspections", `update ${JSON.stringify({ data })}`]);
    });

    /** A secret-key client that answers each function its own way and records the calls. */
    function scriptedAdmin(answers: Readonly<Record<string, Answer>>) {
      const calls: [string, unknown][] = [];
      const admin = {
        rpc(name: string, args: unknown) {
          calls.push([name, args]);
          const builder = {
            abortSignal: () => builder,
            then: (resolve: (value: Answer) => unknown, reject: (reason: unknown) => unknown) =>
              Promise.resolve(answers[name]).then(resolve, reject),
          };
          return builder;
        },
      };
      return { admin: admin as unknown as SupabaseClient<Database>, calls };
    }
    const EVENT = {
      action: "pass_fail_changed",
      changes: { module: "dimensions", size: "M", column: "width", from: null, to: "fail", comment: "Torn cuffs." },
    };

    it("writes a save's audit rows in its own transaction, through save_inspection_with_events() (Kenneth, 26 October 2026)", async () => {
      const { admin, calls } = scriptedAdmin({ save_inspection_with_events: { data: V2, error: null, status: 200 } });
      const { client, chains } = fakeClient();
      expect(
        await saveInspectionData(
          client,
          { inspectionId: ID, data, baseUpdatedAt: V1 },
          { writer: { admin, actorId: "user-1" }, events: [EVENT] },
        ),
      ).toEqual({ ok: true, updatedAt: V2 });
      expect(calls).toEqual([
        [
          "save_inspection_with_events",
          { inspection_id: ID, actor_id: "user-1", base_updated_at: V1, data, mirrored_columns: {}, events: [EVENT] },
        ],
      ]);
      expect(chains).toEqual([]);
    });

    it("saves as before and records the rows right after, in the user's name, before migration 20261026130000", async () => {
      const missing = { code: "PGRST202", message: "Could not find the function public.save_inspection_with_events" };
      const { admin, calls } = scriptedAdmin({
        save_inspection_with_events: { data: null, error: missing, status: 404 },
        save_inspection: { data: V2, error: null, status: 200 },
        log_inspection_event: { data: 7, error: null, status: 200 },
      });
      const { client } = fakeClient();
      expect(
        await saveInspectionData(
          client,
          { inspectionId: ID, data, baseUpdatedAt: V1 },
          { writer: { admin, actorId: "user-1" }, events: [EVENT] },
        ),
      ).toEqual({ ok: true, updatedAt: V2 });
      expect(calls.map(([name]) => name)).toEqual(["save_inspection_with_events", "save_inspection", "log_inspection_event"]);
      expect(calls[2][1]).toEqual({ inspection_id: ID, action: "pass_fail_changed", changes: { ...EVENT.changes, by: "user-1" } });
    });

    it("keeps calling save_inspection() for a save with no audit rows", async () => {
      const { admin, calls } = scriptedAdmin({ save_inspection: { data: V2, error: null, status: 200 } });
      const { client } = fakeClient();
      await saveInspectionData(client, { inspectionId: ID, data, baseUpdatedAt: V1 }, { writer: { admin, actorId: "user-1" }, events: [] });
      expect(calls.map(([name]) => name)).toEqual(["save_inspection"]);
    });
  });

  it("serves as the autosave transport", async () => {
    const { client } = fakeClient({ data: { updated_at: V2 }, error: null, status: 200 });
    const transport = supabaseAutosaveTransport(client);
    expect(
      await transport.save({ inspectionId: ID, data, baseUpdatedAt: V1, signal: new AbortController().signal }),
    ).toEqual({ ok: true, updatedAt: V2 });
  });
});
