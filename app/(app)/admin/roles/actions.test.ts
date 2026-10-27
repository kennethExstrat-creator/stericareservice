// The role actions against a fake Supabase client: who may call them (an
// active admin with the built-in Admin role), what they write, and the plain
// words for each refusal. The database's own rules are tests/db/roles.test.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn(), requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { MESSAGES } from "@/lib/admin/reference";
import { ROLE_MESSAGES, type RoleResult } from "@/lib/admin/roles";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { createRole, deleteRole, updateRole } from "./actions";

const ID = "3c9a2f1e-8b7d-4c6e-9f5a-1b2c3d4e5f60";
const VERSION = "2026-10-27T08:00:00.066067+00:00";
const NEWER = "2026-10-27T09:30:00.123456+00:00";
const IDLE = { status: "idle" } as const;

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * whatever the test's responder returns for it; rpc answers is_full_admin.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };
type Responder = (query: Query) => Result;

let queries: Query[] = [];
let fullAdmin: Result = { data: true, error: null };
const rpc = vi.fn(() => Promise.resolve(fullAdmin));

function useDatabase(respond: Responder) {
  queries = [];
  const from = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "insert", "update", "delete", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    for (const method of ["single", "maybeSingle"]) {
      builder[method] = () => {
        query.calls.push([method, []]);
        return Promise.resolve(respond(query));
      };
    }
    builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(respond(query)).then(resolve, reject);
    return builder;
  };
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
}

const kind = (query: Query) => query.calls[0]?.[0];
const arg = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];
const eqs = (query: Query | undefined) => query?.calls.filter(([name]) => name === "eq").map(([, args]) => args);
const writes = () => queries.filter((query) => ["insert", "update", "delete"].includes(kind(query) ?? ""));

function form(fields: Record<string, string | string[]>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) {
    for (const entry of Array.isArray(value) ? value : [value]) data.append(name, entry);
  }
  return data;
}

const roleForm = (overrides: Record<string, string | string[]> = {}) =>
  form({
    name: "  QC   Manager ",
    description: "  Approves the day's work. ",
    access: "all",
    permissions: ["export_reports", "approve_inspections", "dashboard"],
    ...overrides,
  });

/** A roles row as PostgREST returns it, with its people. */
const row = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  built_in: null,
  name: "QC Manager",
  description: null,
  access: "all",
  permissions: ["dashboard"],
  updated_at: VERSION,
  profiles: [{ count: 0 }],
  ...overrides,
});

/** Answers the read of the role with `current`, and every write with `write`. */
function database(current: unknown, write: Result = { data: { id: ID }, error: null }): Responder {
  return (query) => (kind(query) === "select" ? { data: current, error: null } : write);
}

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" },
  });
  fullAdmin = { data: true, error: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
  useDatabase(() => ({ data: null, error: null }));
});

afterEach(() => {
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

describe("who may manage roles", () => {
  it("needs an active admin before anything else", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });

    for (const action of [createRole, updateRole, deleteRole]) {
      expect(await action(IDLE, roleForm({ id: ID, version: VERSION }))).toEqual({
        status: "error",
        message: "You do not have permission to do that.",
      });
    }
    expect(authorizeAction).toHaveBeenCalledWith("admin");
    expect(rpc).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });

  it("refuses an admin without the built-in Admin role, such as a custom role that sees everything", async () => {
    fullAdmin = { data: false, error: null };

    for (const action of [createRole, updateRole, deleteRole]) {
      expect(await action(IDLE, roleForm({ id: ID, version: VERSION }))).toEqual({
        status: "error",
        message: ROLE_MESSAGES.notFullAdmin,
      });
    }
    expect(rpc).toHaveBeenCalledWith("is_full_admin");
    expect(queries).toEqual([]);
  });

  it("says something went wrong when the check itself fails, and changes nothing", async () => {
    fullAdmin = { data: null, error: { message: "connection refused" } };
    expect(await createRole(IDLE, roleForm())).toEqual({ status: "error", message: MESSAGES.unexpected });
    expect(queries).toEqual([]);
  });
});

describe("createRole", () => {
  it("adds the role cleaned as the database cleans it, and refreshes the page", async () => {
    useDatabase(() => ({ data: { id: ID }, error: null }));

    const result = await createRole(IDLE, roleForm());

    expect(writes()).toHaveLength(1);
    expect(queries[0].table).toBe("roles");
    expect(arg(queries[0], "insert")?.[0]).toEqual({
      name: "QC Manager",
      description: "Approves the day's work.",
      access: "all",
      permissions: ["dashboard", "approve_inspections", "export_reports"],
    });
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "success", message: "QC Manager added.", id: ID });
  });

  it("leaves out what needs every inspection for a role that sees fewer", async () => {
    useDatabase(() => ({ data: { id: ID }, error: null }));
    await createRole(IDLE, roleForm({ access: "own" }));
    expect(arg(queries[0], "insert")?.[0]).toMatchObject({ access: "own", permissions: ["dashboard", "export_reports"] });
  });

  it("shows field errors without touching the database", async () => {
    const result = await createRole(IDLE, roleForm({ name: " ", description: "x".repeat(301) }));
    expect(result).toEqual({
      status: "error",
      message: MESSAGES.checkFields,
      fieldErrors: { name: "Enter the role's name.", description: "Keep the description to 300 characters or fewer." },
    });
    expect(queries).toEqual([]);
  });

  it("asks for a reload when the page sends a permission the list does not know", async () => {
    expect(await createRole(IDLE, roleForm({ permissions: ["dashboard", "users"] }))).toEqual({
      status: "error",
      message: MESSAGES.stale,
    });
    expect(queries).toEqual([]);
  });

  it("puts a name taken (whatever its capitals) next to the name", async () => {
    useDatabase(() => ({ data: null, error: { code: "23505", message: 'duplicate key value violates unique constraint "roles_name_key"' } }));
    expect(await createRole(IDLE, roleForm())).toEqual({
      status: "error",
      message: ROLE_MESSAGES.nameTaken,
      fieldErrors: { name: ROLE_MESSAGES.nameTaken },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("explains row level security refusing the insert", async () => {
    useDatabase(() => ({ data: null, error: { code: "42501", message: 'new row violates row-level security policy for table "roles"' } }));
    expect(await createRole(IDLE, roleForm())).toEqual({ status: "error", message: ROLE_MESSAGES.notFullAdmin });
  });
});

describe("updateRole", () => {
  const edit = (overrides: Record<string, string | string[]> = {}) => roleForm({ id: ID, version: VERSION, ...overrides });

  it("refuses a tampered target before reading anything", async () => {
    expect(await updateRole(IDLE, edit({ version: "" }))).toEqual({ status: "error", message: MESSAGES.stale });
    expect(await updateRole(IDLE, edit({ id: "not-a-role" }))).toEqual({ status: "error", message: MESSAGES.stale });
    expect(queries).toEqual([]);
  });

  it("saves a custom role against the version the panel opened on", async () => {
    useDatabase(database(row()));

    const result = await updateRole(IDLE, edit());

    const update = writes()[0];
    expect(arg(update, "update")?.[0]).toEqual({
      name: "QC Manager",
      description: "Approves the day's work.",
      access: "all",
      permissions: ["dashboard", "approve_inspections", "export_reports"],
    });
    expect(eqs(update)).toEqual([
      ["id", ID],
      ["updated_at", VERSION],
    ]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "success", message: "QC Manager saved.", id: ID });
  });

  it("changes only the description and switches of a built-in role, for what it sees", async () => {
    useDatabase(database(row({ built_in: "lead", name: "Lead Inspector", access: "team", profiles: [{ count: 4 }] })));

    const result = await updateRole(IDLE, edit({ name: "Boss", access: "all" }));

    // Approving needs every inspection: a lead inspector sees their team's only.
    expect(arg(writes()[0], "update")?.[0]).toEqual({
      description: "Approves the day's work.",
      permissions: ["dashboard", "export_reports"],
    });
    expect(result).toEqual({ status: "success", message: "Lead Inspector saved.", id: ID });
  });

  it("never changes the Admin role", async () => {
    useDatabase(database(row({ built_in: "admin", name: "Admin" })));
    expect(await updateRole(IDLE, edit())).toEqual({ status: "error", message: ROLE_MESSAGES.adminRole });
    expect(writes()).toEqual([]);
  });

  it("says so when the role was deleted meanwhile", async () => {
    useDatabase(database(null));
    expect(await updateRole(IDLE, edit())).toEqual({ status: "error", message: ROLE_MESSAGES.deleted });
    expect(writes()).toEqual([]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("refuses to replace someone else's newer change, and hands it back for a second save", async () => {
    let reads = 0;
    useDatabase((query) => {
      if (kind(query) !== "select") return { data: null, error: null };
      reads += 1;
      return { data: reads === 1 ? row() : row({ updated_at: NEWER, name: "Quality Lead", permissions: ["clients"] }), error: null };
    });

    const result = await updateRole(IDLE, edit());

    expect(result).toEqual({
      status: "error",
      message: ROLE_MESSAGES.conflict,
      latest: {
        version: NEWER,
        values: { name: "Quality Lead", description: "", access: "all", permissions: ["clients"] },
      },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("explains an update row level security found nothing to change in (the version unchanged)", async () => {
    useDatabase(database(row(), { data: null, error: null }));
    expect(await updateRole(IDLE, edit())).toEqual({ status: "error", message: ROLE_MESSAGES.notFullAdmin });
  });

  it("puts the guard's refusal of new access, while people have the role, under Sees", async () => {
    useDatabase(
      database(row({ access: "own", profiles: [{ count: 2 }] }), {
        data: null,
        error: { code: "23514", message: "move its people to another role before changing what it sees" },
      }),
    );
    expect(await updateRole(IDLE, edit())).toEqual({
      status: "error",
      message: ROLE_MESSAGES.accessLocked,
      fieldErrors: { access: ROLE_MESSAGES.accessLocked },
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("explains the guard keeping a built-in role as it is", async () => {
    useDatabase(
      database(row({ built_in: "inspector", name: "Inspector", access: "own" }), {
        data: null,
        error: { code: "42501", message: "the built-in roles keep their name and what they see" },
      }),
    );
    expect(await updateRole(IDLE, edit())).toEqual({ status: "error", message: ROLE_MESSAGES.builtIn });
  });
});

describe("deleteRole", () => {
  const remove = () => form({ id: ID });

  it("deletes a custom role nobody has", async () => {
    useDatabase(database(row({ name: "Clients Desk" }), { data: [{ id: ID }], error: null }));

    const result = await deleteRole(IDLE, remove());

    expect(kind(writes()[0])).toBe("delete");
    expect(eqs(writes()[0])).toEqual([["id", ID]]);
    expect(refresh).toHaveBeenCalledOnce();
    expect(result).toEqual({ status: "success", message: "Clients Desk deleted." });
  });

  it("refuses a role people have, with how many, and deletes nothing", async () => {
    useDatabase(database(row({ name: "Clients Desk", profiles: [{ count: 3 }] })));
    expect(await deleteRole(IDLE, remove())).toEqual({
      status: "error",
      message: "3 people have this role, so it cannot be deleted. Move them to another role first.",
    });
    expect(writes()).toEqual([]);
    // The page showed it as free to delete: it shows the people now.
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("never deletes a built-in role", async () => {
    useDatabase(database(row({ built_in: "inspector", name: "Inspector" })));
    expect(await deleteRole(IDLE, remove())).toEqual({ status: "error", message: ROLE_MESSAGES.builtInDelete });
    expect(writes()).toEqual([]);
  });

  it("explains someone given the role meanwhile (the foreign key restricts the delete)", async () => {
    useDatabase(
      database(row(), {
        data: null,
        error: { code: "23001", message: 'update or delete on table "roles" violates RESTRICT setting of foreign key constraint' },
      }),
    );
    expect(await deleteRole(IDLE, remove())).toEqual({ status: "error", message: ROLE_MESSAGES.inUse });
  });

  it("takes a role already gone as deleted", async () => {
    useDatabase(database(null));
    expect(await deleteRole(IDLE, remove())).toEqual({ status: "success", message: "This role was already deleted." });
    expect(writes()).toEqual([]);
  });

  it("asks for a reload when the delete matched nothing", async () => {
    useDatabase(database(row({ name: "Clients Desk" }), { data: [], error: null }));
    expect(await deleteRole(IDLE, remove())).toEqual({
      status: "error",
      message: "Clients Desk could not be deleted. Reload the page and try again.",
    });
  });

  it("refuses a tampered id before reading anything", async () => {
    expect(await deleteRole(IDLE, form({ id: "../profiles" }))).toEqual({ status: "error", message: MESSAGES.stale });
    expect(queries).toEqual([]);
  });
});

it("answers every action with display data only", async () => {
  useDatabase(database(row()));
  const result: RoleResult = await updateRole(IDLE, roleForm({ id: ID, version: VERSION }));
  expect(JSON.parse(JSON.stringify(result))).toEqual(result);
});
