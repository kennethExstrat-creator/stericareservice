// Roles for the Users screen's tests, as the directory hands them out
// (lib/auth/users.ts, getUserDirectory): the three built-in roles with ids,
// and a custom role for each access. Import it from tests only:
//   import { ROLES } from "../_lib/roles.testing";
import { standInRole, type RoleOption } from "@/lib/auth/org";

export const ADMIN: RoleOption = { id: "11111111-1111-4111-8111-111111111111", builtIn: "admin", name: "Admin", access: "all" };
export const LEAD: RoleOption = { id: "22222222-2222-4222-8222-222222222222", builtIn: "lead", name: "Lead Inspector", access: "team" };
export const INSPECTOR: RoleOption = { id: "33333333-3333-4333-8333-333333333333", builtIn: "inspector", name: "Inspector", access: "own" };
/** Custom roles: one that sees every inspection, one that leads a team, one that works in one. */
export const REVIEWER: RoleOption = { id: "44444444-4444-4444-8444-444444444444", builtIn: null, name: "QA Reviewer", access: "all" };
export const SENIOR: RoleOption = { id: "55555555-5555-4555-8555-555555555555", builtIn: null, name: "Senior Lead", access: "team" };
export const FIELD: RoleOption = { id: "66666666-6666-4666-8666-666666666666", builtIn: null, name: "Field Inspector", access: "own" };

/** Every role in the directory's order: the built-in ones first, then custom roles by name. */
export const ROLES: readonly RoleOption[] = [ADMIN, LEAD, INSPECTOR, FIELD, REVIEWER, SENIOR];

/** The roles on a project without roles (migration 20261027150000): the built-in ones standing in, sent by their kind. */
export const STAND_INS: readonly RoleOption[] = [standInRole("admin"), standInRole("lead"), standInRole("inspector")];
