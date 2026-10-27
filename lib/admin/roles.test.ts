// Roles & Permissions' rules without a database: the form's schema cleans as
// the roles guard does, what each role allows, the list's order, versions,
// and the plain words for every refusal of migration 20261027150000.
import { describe, expect, it, vi } from "vitest";
import { MESSAGES } from "@/lib/admin/reference";
import { PERMISSIONS, type RoleGrant } from "@/lib/auth/permissions";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import {
  ACTION_TOTAL,
  BUILT_IN_TAG,
  NEEDS_ALL_ACCESS,
  ROLE_MESSAGES,
  RoleInputSchema,
  RoleVersionSchema,
  SCREEN_TOTAL,
  accessLock,
  allowedCounts,
  cleanPermissions,
  deleteBlocker,
  describeRoleDeleteError,
  describeRoleSaveError,
  followRoleVersion,
  loadRoles,
  readRole,
  readRoleForm,
  roleValues,
  sortRoles,
  switchPermission,
  whoHasRole,
  type RoleItem,
  type RoleSnapshot,
} from "./roles";

const ADMIN: RoleGrant = { builtIn: "admin", access: "all", permissions: [] };
const INSPECTOR: RoleGrant = {
  builtIn: "inspector",
  access: "own",
  permissions: ["create_inspections", "delete_drafts", "export_reports", "ai_reading", "ai_summary"],
};

const role = (overrides: Partial<RoleItem>): RoleItem => ({
  id: "10000000-0000-4000-8000-000000000001",
  builtIn: null,
  name: "QC Manager",
  description: null,
  access: "all",
  permissions: [],
  updatedAt: "2026-10-27T08:00:00.000000+00:00",
  people: 0,
  ...overrides,
});

describe("RoleInputSchema", () => {
  const input = (overrides: Record<string, unknown> = {}) => ({
    name: "QC Manager",
    description: "",
    access: "all",
    permissions: [],
    ...overrides,
  });

  it("cleans as the roles guard does: the name on one line, no empty description", () => {
    const parsed = RoleInputSchema.parse(input({ name: "  QC \n  Manager ", description: "  Approves\n the  day's work.  " }));
    expect(parsed).toMatchObject({ name: "QC Manager", description: "Approves the day's work." });
    expect(RoleInputSchema.parse(input({ description: " \n " })).description).toBeNull();
  });

  it("keeps each permission once, in the list's order", () => {
    const parsed = RoleInputSchema.parse(input({ permissions: ["export_reports", "dashboard", "export_reports"] }));
    expect(parsed.permissions).toEqual(["dashboard", "export_reports"]);
  });

  it("drops what needs every inspection from a role that sees fewer", () => {
    const permissions = ["approve_inspections", "switch_steps", "ai_second_opinion", "clients"];
    expect(RoleInputSchema.parse(input({ access: "team", permissions })).permissions).toEqual(["clients"]);
    expect(RoleInputSchema.parse(input({ access: "all", permissions })).permissions).toEqual([
      "clients",
      "approve_inspections",
      "switch_steps",
      "ai_second_opinion",
    ]);
  });

  it("names what to fix", () => {
    const result = RoleInputSchema.safeParse(input({ name: " ", description: "x".repeat(301), access: "everyone" }));
    expect(result.success).toBe(false);
    const messages = Object.fromEntries(result.error!.issues.map((issue) => [issue.path[0], issue.message]));
    expect(messages).toEqual({
      name: "Enter the role's name.",
      description: "Keep the description to 300 characters or fewer.",
      access: "Choose what the role's people see.",
    });
    expect(RoleInputSchema.safeParse(input({ name: "x".repeat(61) })).error?.issues[0].message).toBe(
      "Keep the name to 60 characters or fewer.",
    );
    expect(RoleInputSchema.safeParse(input({ name: "x".repeat(60) })).success).toBe(true);
  });

  it("refuses a permission the list does not know, and the admin-only screens, which no switch gives", () => {
    for (const permissions of [["fly"], ["users"], ["roles"]]) {
      const result = RoleInputSchema.safeParse(input({ permissions }));
      expect(result.error?.issues.map((issue) => [issue.path[0], issue.message])).toEqual([["permissions", MESSAGES.stale]]);
    }
  });
});

describe("readRoleForm", () => {
  it("reads the text fields and one entry for each switch that is on", () => {
    const form = new FormData();
    form.set("name", "Office");
    form.set("access", "own");
    form.append("permissions", "clients");
    form.append("permissions", "dashboard");
    expect(readRoleForm(form)).toEqual({ name: "Office", description: "", access: "own", permissions: ["clients", "dashboard"] });
  });
});

describe("RoleVersionSchema", () => {
  it("takes the role's id and the version it was opened on, nothing else", () => {
    const id = "10000000-0000-4000-8000-000000000001";
    expect(RoleVersionSchema.safeParse({ id, version: "2026-10-27T08:00:00.066067+00:00" }).success).toBe(true);
    expect(RoleVersionSchema.safeParse({ id, version: "" }).error?.issues[0].message).toBe(MESSAGES.stale);
    expect(RoleVersionSchema.safeParse({ id: "not-a-role", version: "2026-10-27T08:00:00Z" }).success).toBe(false);
  });
});

describe("switches", () => {
  it("switch one on or off, and never on what the access cannot use", () => {
    expect(switchPermission(["export_reports"], "dashboard", true, "own")).toEqual(["dashboard", "export_reports"]);
    expect(switchPermission(["dashboard", "export_reports"], "dashboard", false, "own")).toEqual(["export_reports"]);
    expect(switchPermission([], "approve_inspections", true, "team")).toEqual([]);
    expect(switchPermission([], "approve_inspections", true, "all")).toEqual(["approve_inspections"]);
  });

  it("keep known permissions only", () => {
    expect(cleanPermissions(["fly", "clients", "users"], "all")).toEqual(["clients"]);
  });

  it("say why a switch that needs every inspection is locked", () => {
    expect(NEEDS_ALL_ACCESS).toBe("Only for a role that sees All Inspections: it changes other people's inspections.");
  });
});

describe("allowedCounts", () => {
  it("counts Users and Roles & Permissions as screens, the Admin role's alone", () => {
    expect([SCREEN_TOTAL, ACTION_TOTAL]).toEqual([8, 8]);
    expect(allowedCounts(ADMIN)).toEqual({ screens: 8, actions: 8 });
    const everything: RoleGrant = { builtIn: null, access: "all", permissions: [...PERMISSIONS] };
    expect(allowedCounts(everything)).toEqual({ screens: 6, actions: 8 });
  });

  it("counts what a role really allows", () => {
    expect(allowedCounts(INSPECTOR)).toEqual({ screens: 0, actions: 5 });
    // Stored by hand, never usable while the role sees its team only.
    expect(allowedCounts({ builtIn: null, access: "team", permissions: ["approve_inspections", "clients"] })).toEqual({
      screens: 1,
      actions: 0,
    });
  });
});

describe("sortRoles", () => {
  it("lists Admin, Lead Inspector and Inspector first, then custom roles by name", () => {
    const sorted = sortRoles([
      role({ name: "office staff" }),
      role({ name: "Inspector", builtIn: "inspector" }),
      role({ name: "Auditor 10" }),
      role({ name: "Admin", builtIn: "admin" }),
      role({ name: "Auditor 9" }),
      role({ name: "Lead Inspector", builtIn: "lead" }),
    ]);
    expect(sorted.map((entry) => entry.name)).toEqual(["Admin", "Lead Inspector", "Inspector", "Auditor 9", "Auditor 10", "office staff"]);
  });
});

describe("versions", () => {
  const base: RoleSnapshot = { version: "v1", values: roleValues(role({ permissions: ["clients"] })) };

  it("follow a newer copy whose fields are unchanged", () => {
    expect(followRoleVersion(base, { version: "v2", values: { ...base.values } })).toEqual({ version: "v2", values: base.values });
    expect(followRoleVersion(base, { version: "v1", values: base.values })).toBe(base);
  });

  it("keep the version the panel opened on when someone else changed the fields", () => {
    expect(followRoleVersion(base, { version: "v2", values: { ...base.values, permissions: [] } })).toBe(base);
    expect(followRoleVersion(base, { version: "v2", values: { ...base.values, name: "Office" } })).toBe(base);
  });

  it("start the form from the role as it can be used", () => {
    expect(roleValues(role({ access: "own", permissions: ["approve_inspections", "clients"], description: null }))).toEqual({
      name: "QC Manager",
      description: "",
      access: "own",
      permissions: ["clients"],
    });
  });
});

describe("plain words", () => {
  it("say who has a role", () => {
    expect(whoHasRole(0)).toBe("Nobody has this role");
    expect(whoHasRole(1)).toBe("1 person has this role");
    expect(whoHasRole(1200)).toBe("1,200 people have this role");
  });

  it("say why what a role sees is locked", () => {
    expect(accessLock(role({ builtIn: "lead", people: 0 }))).toBe("Built-in roles keep what they see.");
    expect(accessLock(role({ people: 3 }))).toBe("3 people have this role. Move them to another role to change this.");
    expect(accessLock(role({ people: 0 }))).toBeNull();
    expect(accessLock(null)).toBeNull();
  });

  it("say why a role cannot be deleted", () => {
    expect(deleteBlocker(role({ builtIn: "inspector" }))).toBe("Built-in roles are never deleted.");
    expect(deleteBlocker(role({ people: 1 }))).toBe("1 person has this role, so it cannot be deleted. Move them to another role first.");
    expect(deleteBlocker(role({ people: 0 }))).toBeNull();
  });

  it("explain each refusal of a save", () => {
    expect(describeRoleSaveError({ code: "23505", message: 'duplicate key value violates unique constraint "roles_name_key"' })).toEqual({
      field: "name",
      message: ROLE_MESSAGES.nameTaken,
    });
    expect(describeRoleSaveError({ code: "23514", message: "move its people to another role before changing what it sees" })).toEqual({
      field: "access",
      message: ROLE_MESSAGES.accessLocked,
    });
    expect(
      describeRoleSaveError({ code: "23514", message: 'new row for relation "roles" violates check constraint "roles_name_length"' }),
    ).toEqual({ message: ROLE_MESSAGES.saveFailed });
    expect(describeRoleSaveError({ code: "42501", message: "the built-in roles keep their name and what they see" })).toEqual({
      message: ROLE_MESSAGES.builtIn,
    });
    expect(describeRoleSaveError({ code: "42501", message: "the Admin role has every permission" })).toEqual({
      message: ROLE_MESSAGES.builtIn,
    });
    expect(describeRoleSaveError({ code: "42501", message: 'new row violates row-level security policy for table "roles"' })).toEqual({
      message: ROLE_MESSAGES.notFullAdmin,
    });
    expect(describeRoleSaveError({ code: "08006", message: "connection failure" })).toEqual({ message: ROLE_MESSAGES.saveFailed });
  });

  it("explain each refusal of a delete", () => {
    expect(describeRoleDeleteError({ code: "23001", message: "update or delete on table roles violates RESTRICT" })).toBe(
      ROLE_MESSAGES.inUse,
    );
    expect(describeRoleDeleteError({ code: "23503" })).toBe(ROLE_MESSAGES.inUse);
    expect(describeRoleDeleteError({ code: "42501", message: "a built-in role is never deleted" })).toBe(ROLE_MESSAGES.builtInDelete);
    expect(describeRoleDeleteError({ code: "42501", message: "permission denied for table roles" })).toBe(ROLE_MESSAGES.notFullAdmin);
    expect(describeRoleDeleteError({ code: "57014" })).toBe(ROLE_MESSAGES.deleteFailed);
  });

  it("write the tag as a label and the messages as sentences", () => {
    expect(lowerCaseWords(BUILT_IN_TAG)).toEqual([]);
    for (const message of Object.values(ROLE_MESSAGES)) expect(message).toMatch(/^[A-Z].*\.$/);
  });
});

describe("queries", () => {
  const ROW = {
    id: "20000000-0000-4000-8000-000000000002",
    built_in: null,
    name: "Clients Desk",
    description: "Keeps the client list.",
    access: "own",
    // As the guard stores them: sorted by name. A key the app no longer knows is left out.
    permissions: ["clients", "create_inspections", "retired_switch"],
    updated_at: "2026-10-27T08:00:00.066067+00:00",
    profiles: [{ count: 2 }],
  };

  function client(rows: unknown, error: unknown = null) {
    const calls: Array<[string, unknown[]]> = [];
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve({ data: Array.isArray(rows) ? (rows[0] ?? null) : rows, error });
    builder.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: rows, error }).then(resolve);
    const from = vi.fn(() => builder);
    return { supabase: { from } as never, from, calls };
  }

  it("load every role with its people, built-in ones first, in the list's order", async () => {
    const { supabase, from, calls } = client([ROW, { ...ROW, id: "a", built_in: "admin", name: "Admin", access: "all", profiles: [] }]);
    const roles = await loadRoles(supabase);
    expect(from).toHaveBeenCalledWith("roles");
    expect(calls[0]).toEqual(["select", ["id, built_in, name, description, access, permissions, updated_at, profiles(count)"]]);
    expect(roles.map((entry) => entry.name)).toEqual(["Admin", "Clients Desk"]);
    expect(roles[1]).toEqual({
      id: ROW.id,
      builtIn: null,
      name: "Clients Desk",
      description: "Keeps the client list.",
      access: "own",
      permissions: ["clients", "create_inspections"],
      updatedAt: ROW.updated_at,
      people: 2,
    });
    expect(roles[0]).toMatchObject({ builtIn: "admin", people: 0 });
  });

  it("read one role by id, or null", async () => {
    const found = client([ROW]);
    expect(await readRole(found.supabase, ROW.id)).toMatchObject({ name: "Clients Desk", people: 2 });
    expect(found.calls).toContainEqual(["eq", ["id", ROW.id]]);
    expect(await readRole(client([]).supabase, ROW.id)).toBeNull();
  });

  it("throw when the roles cannot be read: the page's error boundary says so", async () => {
    await expect(loadRoles(client(null, { message: "relation does not exist" }).supabase)).rejects.toThrow(
      "Could not load the roles: relation does not exist",
    );
  });
});
