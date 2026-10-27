// The permission list and what a role allows: the Admin role everything, the
// admin-only screens nobody else, switches that change other people's
// inspections only with every inspection in sight, and one list in the code
// and the database.
import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { can, effectivePermissions, PERMISSION_INFO, PERMISSIONS, type RoleGrant } from "./permissions";

const INSPECTOR: RoleGrant = { builtIn: "inspector", access: "own", permissions: ["create_inspections", "ai_reading"] };

describe("can", () => {
  it("lets the Admin role do everything, whatever it stores", () => {
    const admin: RoleGrant = { builtIn: "admin", access: "all", permissions: [] };
    expect(PERMISSIONS.every((permission) => can(admin, permission))).toBe(true);
    expect(can(admin, "users")).toBe(true);
    expect(can(admin, "roles")).toBe(true);
  });

  it("follows a role's switches", () => {
    expect(can(INSPECTOR, "create_inspections")).toBe(true);
    expect(can(INSPECTOR, "clients")).toBe(false);
  });

  it("keeps Users and Roles & Permissions to the Admin role", () => {
    const allSeeing: RoleGrant = { builtIn: null, access: "all", permissions: [...PERMISSIONS] };
    expect(can(allSeeing, "users")).toBe(false);
    expect(can(allSeeing, "roles")).toBe(false);
  });

  it("switches off what needs every inspection for a role that sees fewer", () => {
    const team: RoleGrant = { builtIn: null, access: "team", permissions: ["approve_inspections", "dashboard"] };
    expect(can(team, "approve_inspections")).toBe(false);
    expect(can({ ...team, access: "all" }, "approve_inspections")).toBe(true);
    expect(effectivePermissions(team)).toEqual(["dashboard"]);
  });

  it("allows nothing without a role", () => {
    expect(can(null, "create_inspections")).toBe(false);
    expect(effectivePermissions(undefined)).toEqual([]);
  });
});

describe("the list", () => {
  it("describes every permission once, in the list's order", () => {
    expect(PERMISSION_INFO.map((info) => info.key)).toEqual([...PERMISSIONS]);
  });

  it("is the database's list (roles_known_permissions, migration 20261027150000)", async () => {
    const sql = await readFile(new URL("../../supabase/migrations/20261027150000_roles_and_permissions.sql", import.meta.url), "utf8");
    const listed = /permissions <@ array\[([\s\S]*?)\]::text\[\]/.exec(sql)?.[1] ?? "";
    expect(listed.split(",").map((key) => key.trim().replace(/'/g, ""))).toEqual([...PERMISSIONS]);
  });
});
