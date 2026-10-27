/**
 * Roles and permissions (migration 20261027150000; Kenneth, 27 October 2026:
 * "build permission and module on off for each role", app sections and
 * actions, with custom roles too). Pure data and functions, shared by the
 * server (the session, the pages, the Server Actions) and the browser (the
 * Roles & Permissions screen), so both read one list.
 *
 * A role is what its people see (access: their own inspections, their team's
 * or every one) and what they may do (permissions: the screens and actions it
 * switches on). The database keeps the same list (roles_known_permissions)
 * and refuses, row by row, what a role does not allow where it can
 * (has_permission); the app checks every permission on the server as well.
 *
 * Users and Roles & Permissions are not switches: only people with the
 * built-in Admin role manage people and roles, so nobody can give themselves
 * more than they have.
 */

/** What a role's people see: the data boundary the database has always kept (profiles.role, is_lead). */
export const ROLE_ACCESS = ["own", "team", "all"] as const;
export type RoleAccess = (typeof ROLE_ACCESS)[number];

export const ROLE_ACCESS_INFO: Readonly<Record<RoleAccess, { label: string; description: string }>> = {
  own: { label: "Own Inspections", description: "Their own inspections only, like an inspector. They work in a lead inspector's team." },
  team: { label: "Team Inspections", description: "Their own and their team's inspections, like a lead inspector." },
  all: { label: "All Inspections", description: "Every inspection, from every inspector, like an admin." },
};

/** The roles that come with the app (roles.built_in). */
export const BUILT_IN_ROLES = ["admin", "lead", "inspector"] as const;
export type BuiltInRole = (typeof BUILT_IN_ROLES)[number];

/** Every switch, as roles.permissions stores it, in the order the screen shows them. */
export const PERMISSIONS = [
  "dashboard",
  "manufacturers",
  "clients",
  "defects",
  "general_settings",
  "ai_settings",
  "create_inspections",
  "delete_drafts",
  "approve_inspections",
  "switch_steps",
  "export_reports",
  "ai_reading",
  "ai_summary",
  "ai_second_opinion",
] as const;
export type Permission = (typeof PERMISSIONS)[number];

/** The screens only the built-in Admin role opens. */
export const ADMIN_ONLY = ["users", "roles"] as const;
export type AdminOnly = (typeof ADMIN_ONLY)[number];

export type PermissionGroup = "screens" | "actions";

export type PermissionInfo = {
  key: Permission;
  group: PermissionGroup;
  label: string;
  description: string;
  /**
   * Works only for a role that sees every inspection: approving, switching
   * steps and deciding on a second opinion change other people's
   * inspections, which only that access lets anyone write.
   */
  needsAllAccess?: boolean;
};

export const PERMISSION_INFO: readonly PermissionInfo[] = [
  { key: "dashboard", group: "screens", label: "Dashboard", description: "The admin dashboard: open inspections, results and activity." },
  { key: "manufacturers", group: "screens", label: "Manufacturers", description: "Add, edit and delete manufacturers." },
  { key: "clients", group: "screens", label: "Clients", description: "Add, edit and delete clients and their logos." },
  { key: "defects", group: "screens", label: "Defects", description: "Defect codes, label mapping, unmapped labels and shortforms." },
  { key: "general_settings", group: "screens", label: "General Settings", description: "Whether Supabase and the sign-in emails are set up." },
  { key: "ai_settings", group: "screens", label: "Steri-AI Settings", description: "The API key, the models, the house style and what Steri-AI costs." },
  { key: "create_inspections", group: "actions", label: "Create Inspections", description: "Start new inspections." },
  { key: "delete_drafts", group: "actions", label: "Delete Drafts", description: "Delete drafts that were never submitted." },
  {
    key: "approve_inspections",
    group: "actions",
    label: "Approve and Reopen",
    description: "Approve submitted inspections, or send them back to the inspector.",
    needsAllAccess: true,
  },
  {
    key: "switch_steps",
    group: "actions",
    label: "Switch Inspection Steps On or Off",
    description: "Leave a step out of one inspection.",
    needsAllAccess: true,
  },
  { key: "export_reports", group: "actions", label: "Export Reports", description: "Download the Client Report PDF." },
  { key: "ai_reading", group: "actions", label: "Steri-AI Reading", description: "Fill From a Document, reading source documents and Auto-Sort." },
  { key: "ai_summary", group: "actions", label: "Steri-AI Summary", description: "Write the Inspection Summary with Steri-AI." },
  {
    key: "ai_second_opinion",
    group: "actions",
    label: "Steri-AI Second Opinion",
    description: "Ask for a second opinion and agree, disagree or mark findings fixed.",
    needsAllAccess: true,
  },
];

export const ADMIN_ONLY_INFO: Readonly<Record<AdminOnly, { label: string; description: string }>> = {
  users: { label: "Users", description: "Invite people, change their roles, deactivate them." },
  roles: { label: "Roles & Permissions", description: "Add roles and switch what each may see and do." },
};

/** What the session knows about someone's role (public.my_role()). */
export type RoleGrant = {
  builtIn: BuiltInRole | null;
  access: RoleAccess;
  permissions: readonly string[];
};

/** The built-in roles' names, as migration 20261027150000 made them. */
export const BUILT_IN_ROLE_NAME: Readonly<Record<BuiltInRole, string>> = {
  admin: "Admin",
  lead: "Lead Inspector",
  inspector: "Inspector",
};

/**
 * What the built-in roles allowed when migration 20261027150000 made them:
 * what each could do before roles. Only a stand-in for when the role cannot
 * be read (a project without the migration, a test double); an admin may
 * have changed the Lead Inspector's and Inspector's switches since.
 */
const BUILT_IN_DEFAULTS: Readonly<Record<BuiltInRole, readonly Permission[]>> = {
  admin: PERMISSIONS,
  lead: ["create_inspections", "delete_drafts", "export_reports", "ai_reading", "ai_summary"],
  inspector: ["create_inspections", "delete_drafts", "export_reports", "ai_reading", "ai_summary"],
};

const BUILT_IN_ACCESS: Readonly<Record<BuiltInRole, RoleAccess>> = { admin: "all", lead: "team", inspector: "own" };

/** A built-in role as it was made, for when someone's role cannot be read. */
export function builtInGrant(kind: BuiltInRole): RoleGrant {
  return { builtIn: kind, access: BUILT_IN_ACCESS[kind], permissions: BUILT_IN_DEFAULTS[kind] };
}

export function isBuiltInRole(value: unknown): value is BuiltInRole {
  return typeof value === "string" && (BUILT_IN_ROLES as readonly string[]).includes(value);
}

export function isRoleAccess(value: unknown): value is RoleAccess {
  return typeof value === "string" && (ROLE_ACCESS as readonly string[]).includes(value);
}

export function isPermission(value: string): value is Permission {
  return (PERMISSIONS as readonly string[]).includes(value);
}

/**
 * Whether a role allows a permission, or opens an admin-only screen. The
 * Admin role allows everything, whatever it stores; a permission that needs
 * every inspection is off for a role that sees fewer, whatever it stores.
 * No role (a profile the session could not read) allows nothing.
 */
export function can(role: RoleGrant | null | undefined, permission: Permission | AdminOnly): boolean {
  if (!role) return false;
  if (role.builtIn === "admin") return true;
  if ((ADMIN_ONLY as readonly string[]).includes(permission)) return false;
  const info = PERMISSION_INFO.find((entry) => entry.key === permission);
  if (info?.needsAllAccess && role.access !== "all") return false;
  return role.permissions.includes(permission);
}

/** The permissions a role really has, in display order (for the session and the screen). */
export function effectivePermissions(role: RoleGrant | null | undefined): Permission[] {
  return PERMISSIONS.filter((permission) => can(role, permission));
}
