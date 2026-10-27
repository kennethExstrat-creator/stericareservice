import { z } from "zod";
import { MESSAGES, RecordIdSchema, oneLine, type DatabaseClient } from "@/lib/admin/reference";
import {
  ADMIN_ONLY,
  BUILT_IN_ROLES,
  PERMISSION_INFO,
  PERMISSIONS,
  ROLE_ACCESS,
  ROLE_ACCESS_INFO,
  can,
  effectivePermissions,
  type BuiltInRole,
  type Permission,
  type RoleAccess,
  type RoleGrant,
} from "@/lib/auth/permissions";

/**
 * Admin > Roles & Permissions (/admin/roles; migration 20261027150000,
 * Kenneth, 27 October 2026: "build permission and module on off for each
 * role", with custom roles too): the form's schema with the trimming rules
 * the database applies, a role's people, versions, plain words for the
 * database's refusals, and the queries the page and its actions run.
 *
 * lib/auth/permissions.ts names the switches and what they do; nothing here
 * repeats them. Shared by server and browser code (the panel uses the rules
 * and the words), so nothing here imports a server-only module. The queries
 * take the caller's Supabase client: they run with the signed-in admin's
 * rights, so Row Level Security and the roles guard check every write again.
 */

/* ------------------------------------------------------------------ *
 * Roles as the screen shows them
 * ------------------------------------------------------------------ */

/** The tag on the roles that come with the app. */
export const BUILT_IN_TAG = "Built-In";

/** One role as the admin page shows it. Display fields only: this reaches the browser. */
export type RoleItem = {
  id: string;
  /** "admin", "lead" or "inspector" for the roles that come with the app; null for a custom role. */
  builtIn: BuiltInRole | null;
  name: string;
  description: string | null;
  access: RoleAccess;
  /** As stored: known keys only, in the list's order. What the role really allows is effectivePermissions(). */
  permissions: Permission[];
  /** The row's `updated_at`: the version an edit starts from. */
  updatedAt: string;
  /** Everyone with the role, active or not (invited and deactivated people too). */
  people: number;
};

export function isRoleAccess(value: string): value is RoleAccess {
  return (ROLE_ACCESS as readonly string[]).includes(value);
}

export function isBuiltInRole(value: string | null): value is BuiltInRole {
  return value !== null && (BUILT_IN_ROLES as readonly string[]).includes(value);
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** The built-in roles first, as the app lists them (Admin, Lead Inspector, Inspector), then custom roles by name. */
export function sortRoles<T extends { builtIn: BuiltInRole | null; name: string }>(roles: readonly T[]): T[] {
  const rank = (role: T) => (role.builtIn ? BUILT_IN_ROLES.indexOf(role.builtIn) : BUILT_IN_ROLES.length);
  return [...roles].sort((a, b) => rank(a) - rank(b) || byName.compare(a.name, b.name));
}

/* ------------------------------------------------------------------ *
 * Switches
 * ------------------------------------------------------------------ */

export const SCREEN_INFO = PERMISSION_INFO.filter((info) => info.group === "screens");
export const ACTION_INFO = PERMISSION_INFO.filter((info) => info.group === "actions");

/** Every screen the list counts, Users and Roles & Permissions included (the Admin role's alone). */
export const SCREEN_TOTAL = SCREEN_INFO.length + ADMIN_ONLY.length;
export const ACTION_TOTAL = ACTION_INFO.length;

/** True when a role that sees `access` can use `permission` (PermissionInfo.needsAllAccess). */
export function usableWith(permission: Permission, access: RoleAccess): boolean {
  return access === "all" || PERMISSION_INFO.find((info) => info.key === permission)?.needsAllAccess !== true;
}

/**
 * The permissions a role keeps: each once, in the list's order, without
 * those its access cannot use. The form keeps them so (switching Sees away
 * from All Inspections switches those off), and the server again.
 */
export function cleanPermissions(permissions: Iterable<string>, access: RoleAccess): Permission[] {
  const chosen = new Set(permissions);
  return PERMISSIONS.filter((permission) => chosen.has(permission) && usableWith(permission, access));
}

/** The permissions with `permission` switched on or off. */
export function switchPermission(
  permissions: readonly Permission[],
  permission: Permission,
  on: boolean,
  access: RoleAccess,
): Permission[] {
  const chosen = new Set<string>(permissions);
  if (on) chosen.add(permission);
  else chosen.delete(permission);
  return cleanPermissions(chosen, access);
}

/** How many screens and actions a role allows, as effectivePermissions() and can() decide. */
export function allowedCounts(role: RoleGrant): { screens: number; actions: number } {
  const allowed = new Set<string>(effectivePermissions(role));
  return {
    screens: SCREEN_INFO.filter((info) => allowed.has(info.key)).length + ADMIN_ONLY.filter((key) => can(role, key)).length,
    actions: ACTION_INFO.filter((info) => allowed.has(info.key)).length,
  };
}

/* ------------------------------------------------------------------ *
 * Plain words
 * ------------------------------------------------------------------ */

export const ROLE_MESSAGES = {
  notFullAdmin: "Only people with the Admin role can manage roles. Reload the page to check your access.",
  nameTaken: "There is already a role with this name.",
  builtIn: "Built-in roles keep their names and what they see, and the Admin role keeps every permission.",
  adminRole: "The Admin role has every permission and never changes.",
  accessLocked: "People have this role now, so what it sees cannot change. Move them to another role first.",
  builtInDelete: "Built-in roles are never deleted.",
  inUse: "People have this role now, so it cannot be deleted. Move them to another role first.",
  conflict:
    "Someone else changed this role while you were editing. Close the panel to see their changes, or save again to replace them with yours.",
  deleted: "This role has been deleted, so your changes were not saved.",
  saveFailed: "The role could not be saved. Try again.",
  deleteFailed: "The role could not be deleted. Try again.",
} as const;

/** Under Users and Roles & Permissions, which no switch gives. */
export const ADMIN_ONLY_NOTE = "Only the Admin role manages people and roles.";

/** Under a switch that needs every inspection, while the role sees fewer. */
export const NEEDS_ALL_ACCESS = `Only for a role that sees ${ROLE_ACCESS_INFO.all.label}: it changes other people's inspections.`;

/** "Nobody has this role", "1 person has this role", "3 people have this role". */
export function whoHasRole(people: number): string {
  if (people <= 0) return "Nobody has this role";
  return people === 1 ? "1 person has this role" : `${people.toLocaleString("en-GB")} people have this role`;
}

/** Why what a role sees cannot change, or null when it can. */
export function accessLock(role: Pick<RoleItem, "builtIn" | "people"> | null): string | null {
  if (!role) return null;
  if (role.builtIn) return "Built-in roles keep what they see.";
  return role.people > 0 ? `${whoHasRole(role.people)}. Move them to another role to change this.` : null;
}

/** Why a role cannot be deleted, or null when it can. */
export function deleteBlocker(role: Pick<RoleItem, "builtIn" | "people">): string | null {
  if (role.builtIn) return ROLE_MESSAGES.builtInDelete;
  return role.people > 0 ? `${whoHasRole(role.people)}, so it cannot be deleted. Move them to another role first.` : null;
}

type DatabaseError = { code?: string | null; message?: string | null };

/**
 * A failed insert or update (codes: docs/DATABASE.md). 23514 is the roles
 * guard refusing new access while people have the role (a check constraint
 * says 23514 too, for what the form already checks); 42501 is the guard
 * keeping a built-in role as it is, or row level security refusing someone
 * without the Admin role.
 */
export function describeRoleSaveError(error: DatabaseError): { message: string; field?: "name" | "access" } {
  const said = error.message ?? "";
  switch (error.code) {
    case "23505":
      return { field: "name", message: ROLE_MESSAGES.nameTaken };
    case "23514":
      return /move its people/i.test(said) ? { field: "access", message: ROLE_MESSAGES.accessLocked } : { message: ROLE_MESSAGES.saveFailed };
    case "42501":
      return /built.in|admin role/i.test(said) ? { message: ROLE_MESSAGES.builtIn } : { message: ROLE_MESSAGES.notFullAdmin };
    default:
      return { message: ROLE_MESSAGES.saveFailed };
  }
}

/** A failed delete: 23001 (and 23503) is someone who still has the role (profiles.role_id restricts it). */
export function describeRoleDeleteError(error: DatabaseError): string {
  switch (error.code) {
    case "23001":
    case "23503":
      return ROLE_MESSAGES.inUse;
    case "42501":
      return /built.in/i.test(error.message ?? "") ? ROLE_MESSAGES.builtInDelete : ROLE_MESSAGES.notFullAdmin;
    default:
      return ROLE_MESSAGES.deleteFailed;
  }
}

/* ------------------------------------------------------------------ *
 * Form input
 * ------------------------------------------------------------------ */

/** The longest name and description the database takes (roles_name_length, roles_description_length). */
export const ROLE_LIMITS = { name: 60, description: 300 } as const;

const tooLong = (what: string, max: number) => `Keep the ${what} to ${max.toLocaleString("en-GB")} characters or fewer.`;

/**
 * A role as the form sends it, cleaned as the database cleans it (roles_guard):
 * the name on one line with single spaces, an empty description none. The
 * description goes on one line too: the list shows it under the name. Only
 * known permissions (anything else comes from a page older than the list),
 * each once, without those the access cannot use.
 */
export const RoleInputSchema = z
  .object({
    name: z
      .string()
      .overwrite(oneLine)
      .min(1, "Enter the role's name.")
      .max(ROLE_LIMITS.name, tooLong("name", ROLE_LIMITS.name)),
    description: z
      .string()
      .overwrite(oneLine)
      .max(ROLE_LIMITS.description, tooLong("description", ROLE_LIMITS.description))
      .transform((value) => (value === "" ? null : value)),
    access: z.enum(ROLE_ACCESS, { error: "Choose what the role's people see." }),
    permissions: z.array(z.enum(PERMISSIONS, { error: MESSAGES.stale })),
  })
  .transform((role) => ({ ...role, permissions: cleanPermissions(role.permissions, role.access) }));
export type RoleInput = z.output<typeof RoleInputSchema>;
export type RoleField = "name" | "description" | "access" | "permissions";

/** The form's fields: its text by name, and one `permissions` entry for each switch that is on. */
export function readRoleForm(formData: FormData): { name: string; description: string; access: string; permissions: string[] } {
  const text = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    name: text("name"),
    description: text("description"),
    access: text("access"),
    permissions: formData.getAll("permissions").filter((value): value is string => typeof value === "string"),
  };
}

/** Which role a save changes: its id and the version (`updated_at`) the panel opened on. */
export const RoleVersionSchema = z.object({
  id: RecordIdSchema,
  version: z.iso.datetime({ offset: true, error: MESSAGES.stale }),
});

/* ------------------------------------------------------------------ *
 * Versions: a save never replaces a change its panel has not shown
 * ------------------------------------------------------------------ */

/** A role's editable fields as the form holds them. */
export type RoleValues = { name: string; description: string; access: RoleAccess; permissions: Permission[] };

/** A new role: it sees its people's own inspections, and allows nothing until switched on. */
export const NEW_ROLE: RoleValues = { name: "", description: "", access: "own", permissions: [] };

export function roleValues(role: Pick<RoleItem, "name" | "description" | "access" | "permissions"> | null): RoleValues {
  if (!role) return NEW_ROLE;
  return {
    name: role.name,
    description: role.description ?? "",
    access: role.access,
    permissions: cleanPermissions(role.permissions, role.access),
  };
}

/** The values as a save stores them: name and description on one line. */
export function cleanedValues(values: RoleValues): RoleValues {
  return { ...values, name: oneLine(values.name), description: oneLine(values.description) };
}

export function sameRoleValues(a: RoleValues, b: RoleValues): boolean {
  return (
    a.name === b.name &&
    a.description === b.description &&
    a.access === b.access &&
    a.permissions.join(" ") === b.permissions.join(" ")
  );
}

/** A role's editable fields at one version of the row. */
export type RoleSnapshot = { version: string; values: RoleValues };

export function roleSnapshot(role: RoleItem): RoleSnapshot {
  return { version: role.updatedAt, values: roleValues(role) };
}

/**
 * The version an open panel saves against, once the page has a newer copy of
 * the role. Unchanged fields: the panel follows it. Changed fields are
 * someone else's edit: the panel keeps `base`, and its save is refused
 * instead of quietly replacing theirs (lib/admin/reference followVersion).
 */
export function followRoleVersion(base: RoleSnapshot, latest: RoleSnapshot): RoleSnapshot {
  if (latest.version === base.version) return base;
  return sameRoleValues(base.values, latest.values) ? { version: latest.version, values: base.values } : base;
}

/* ------------------------------------------------------------------ *
 * Results
 * ------------------------------------------------------------------ */

/**
 * What a role action answers. Only display data: it is serialised to the
 * browser. `latest` comes with a save refused because someone else changed
 * the role: the role as it is now, which a second save replaces.
 */
export type RoleResult =
  | { status: "idle" }
  | { status: "success"; message: string; id?: string }
  | { status: "error"; message: string; fieldErrors?: Partial<Record<RoleField, string>>; latest?: RoleSnapshot };

/* ------------------------------------------------------------------ *
 * Queries
 * ------------------------------------------------------------------ */

// profiles(count): everyone whose role_id is the role's (the admin reads every profile).
const ROLE_COLUMNS = "id, built_in, name, description, access, permissions, updated_at, profiles(count)";

type RoleRow = {
  id: string;
  built_in: string | null;
  name: string;
  description: string | null;
  access: string;
  permissions: string[];
  updated_at: string;
  profiles: Array<{ count: number }>;
};

function roleItem(row: RoleRow): RoleItem {
  return {
    id: row.id,
    builtIn: isBuiltInRole(row.built_in) ? row.built_in : null,
    name: row.name,
    description: row.description,
    // The database allows only these three; the narrowest is the safe reading of anything else.
    access: isRoleAccess(row.access) ? row.access : "own",
    permissions: PERMISSIONS.filter((permission) => row.permissions.includes(permission)),
    updatedAt: row.updated_at,
    people: row.profiles[0]?.count ?? 0,
  };
}

/** Every role with its people, the built-in ones first. */
export async function loadRoles(supabase: DatabaseClient): Promise<RoleItem[]> {
  const { data, error } = await supabase.from("roles").select(ROLE_COLUMNS);
  if (error) throw new Error(`Could not load the roles: ${error.message}`);
  return sortRoles(data.map(roleItem));
}

/** A role by id with its people, or null when it does not exist. */
export async function readRole(supabase: DatabaseClient, id: string): Promise<RoleItem | null> {
  const { data, error } = await supabase.from("roles").select(ROLE_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(`Could not read role ${id}: ${error.message}`);
  return data ? roleItem(data) : null;
}
