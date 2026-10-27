import type { Database } from "@/lib/supabase/database.types";
import { BUILT_IN_ROLE_NAME, BUILT_IN_ROLES, builtInGrant, ROLE_ACCESS_INFO, type BuiltInRole, type RoleAccess } from "./permissions";

/**
 * Lead inspectors and their teams (Kenneth, 7 October 2026: "inspector level
 * can be inspector or lead inspector, while inspector must be assigned to be
 * managed under a lead inspector, where the lead inspector can see all the on
 * going or done inspection in the table"), and the roles people are given
 * (migration 20261027150000; Kenneth, 27 October 2026: custom roles too).
 *
 * The app's half of the rules in
 * supabase/migrations/20261007170000_lead_inspectors.sql: the Users screen
 * and its Server Actions check them first and explain them in plain words;
 * the database checks them again, for every caller. Change a rule here and
 * in the migration together. Client-safe: the dialogs use the same rules the
 * actions enforce.
 *
 *   - Everyone has a role (public.roles): Admin, Lead Inspector, Inspector or
 *     a custom one. What it sees (its access) is the level these rules have
 *     always been about, and profiles.role and is_lead follow it (the
 *     profiles guard): a role that sees every inspection makes someone an
 *     admin there, one that sees their team's a lead inspector (is_lead),
 *     one that sees their own an inspector. A lead's team is the people
 *     whose lead_id is theirs.
 *   - People whose role sees every inspection are in no team and lead none.
 *     Those who lead one have no lead.
 *   - An active person whose role sees their own inspections only works in
 *     an active lead's team. Inspectors from before the rule may have none:
 *     the Users screen lists them as a problem until an admin chooses one.
 *   - Someone who leads a team keeps a role that sees their team's, active,
 *     until their team has moved to another lead.
 *   - A lead reads every inspection of their team, read-only.
 */

export type UserRole = Database["public"]["Enums"]["user_role"];

/**
 * The built-in role for someone's level (profiles.role and is_lead): what
 * they are on a project without roles, and the stand-in wherever their own
 * role cannot be read. Labels are the built-in roles' names; sentences say
 * "lead inspector".
 */
export type RoleChoice = BuiltInRole;

export const ROLE_CHOICE_LABEL: Readonly<Record<RoleChoice, string>> = BUILT_IN_ROLE_NAME;

/** The built-in role for a profile's level. */
export function roleChoiceOf(person: { role: UserRole; isLead?: boolean | null }): RoleChoice {
  if (person.role === "admin") return "admin";
  return person.isLead ? "lead" : "inspector";
}

/** What someone sees, read from their level: their role's access, which role and is_lead always follow. */
export function accessOf(person: { role: UserRole; isLead?: boolean | null }): RoleAccess {
  return builtInGrant(roleChoiceOf(person)).access;
}

/**
 * A role someone can be given: a row of public.roles, built in or custom, by
 * name, with what its people see. On a project without roles (migration
 * 20261027150000) the built-in roles stand in for the levels, without an id.
 */
export type RoleOption = {
  /** Its id; null for a stand-in on a project without roles. */
  id: string | null;
  /** "admin", "lead" or "inspector" for a role that comes with the app; null for a custom role. */
  builtIn: BuiltInRole | null;
  name: string;
  access: RoleAccess;
};

/**
 * What the Role field sends for a role: its id, or a stand-in's kind, which
 * the actions read as the built-in role of that kind.
 */
export function roleValue(role: Pick<RoleOption, "id" | "builtIn">): string {
  return role.id ?? role.builtIn ?? "";
}

/** A built-in role standing in for its level, on a project without roles. */
export function standInRole(kind: BuiltInRole): RoleOption {
  return { id: null, builtIn: kind, name: BUILT_IN_ROLE_NAME[kind], access: builtInGrant(kind).access };
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/** The built-in roles first, as the app lists them (Admin, Lead Inspector, Inspector), then custom roles by name. */
export function sortRoles<T extends Pick<RoleOption, "builtIn" | "name">>(roles: readonly T[]): T[] {
  const rank = (role: T) => (role.builtIn ? BUILT_IN_ROLES.indexOf(role.builtIn) : BUILT_IN_ROLES.length);
  return [...roles].sort((a, b) => rank(a) - rank(b) || byName.compare(a.name, b.name));
}

/**
 * The role a dialog starts on when it has none of its own: the built-in
 * Inspector, the least anyone is given, else the first.
 */
export function defaultRole<T extends Pick<RoleOption, "builtIn">>(roles: readonly T[]): T | undefined {
  return roles.find((role) => role.builtIn === "inspector") ?? roles[0];
}

/** Under each role in the role pickers: what its people see, as Roles & Permissions says it. */
export function roleHint(role: Pick<RoleOption, "access">): string {
  return `Sees ${ROLE_ACCESS_INFO[role.access].label}`;
}

/** Only people whose role sees their own inspections work in a team, so only they need a lead. */
export function needsLead(access: RoleAccess): boolean {
  return access === "own";
}

/**
 * The profile columns behind a role and a lead. With roles, the role's id:
 * the profiles guard gives role and is_lead its access. Before roles, the
 * level's own columns; before lead inspectors (migration 20261007170000), the
 * role column alone.
 */
export type Placement =
  | { role_id: string; lead_id: string | null }
  | { role: UserRole; is_lead: boolean; lead_id: string | null }
  | { role: UserRole };

/**
 * The columns to write for a role. The lead goes in the same write: kept for
 * a role that sees its own inspections, cleared for any other, since the
 * team rules refuse a lead there and never clear one for you.
 */
export function placementFor(role: RoleOption, leadId: string | null, teams = true): Placement {
  const lead = needsLead(role.access) ? leadId : null;
  if (role.id) return { role_id: role.id, lead_id: lead };
  const level: UserRole = role.access === "all" ? "admin" : "inspector";
  return teams ? { role: level, is_lead: role.access === "team", lead_id: lead } : { role: level };
}

/** The built-in roles in a sentence, as the app has always said them. */
export const BUILT_IN_IN_WORDS: Readonly<Record<BuiltInRole, string>> = {
  admin: "an admin",
  lead: "a lead inspector",
  inspector: "an inspector",
};

/**
 * How someone's role and team read in a dialog: "They are an inspector in
 * Lina Lead's team now." A custom role by its name: "Their role is QA
 * Reviewer now."
 */
export function currentPlacement(role: RoleOption, leadName: string | null): string {
  const team = leadName ? `${leadName}'s team` : null;
  if (role.builtIn === "inspector") return team ? `They are an inspector in ${team} now.` : "They are an inspector in no team yet.";
  if (role.builtIn) return `They are ${BUILT_IN_IN_WORDS[role.builtIn]} now.`;
  if (!needsLead(role.access)) return `Their role is ${role.name} now.`;
  return `Their role is ${role.name} now, in ${team ?? "no team yet"}.`;
}

/** Someone who may lead a team: active, with a role that sees their team's inspections. */
export function canLead(person: { role: UserRole; isLead?: boolean | null; active: boolean }): boolean {
  return person.active && accessOf(person) === "team";
}

/** A lead inspector in the session. */
export function isLeadInspector(user: { role: UserRole; isLead?: boolean }): boolean {
  return user.role === "inspector" && user.isLead === true;
}

/**
 * Whose inspections the user sees: an admin all of them, a lead inspector
 * their own and their team's, an inspector their own. Row level security
 * decides the rows; screens use this for what they show around them.
 */
export type InspectionScope = "all" | "team" | "own";

export function inspectionScope(user: { role: UserRole; isLead?: boolean }): InspectionScope {
  if (user.role === "admin") return "all";
  return isLeadInspector(user) ? "team" : "own";
}

/** True when the user sees other people's inspections, so a list names who is in charge of each. */
export function seesTeamInspections(user: { role: UserRole; isLead?: boolean }): boolean {
  return inspectionScope(user) !== "own";
}

/** The inspections list column for admins and lead inspectors. */
export const INSPECTOR_IN_CHARGE = "Inspector in Charge";

/** "Ivan", "Ivan and Olga", "Ivan, Olga and Tom". */
export function listNames(names: readonly string[]): string {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

function inspectors(count: number): string {
  return count === 1 ? "1 inspector" : `${count} inspectors`;
}

export const TEAM_MESSAGES = {
  chooseLead: "Choose their lead inspector.",
  /** The lead picker with nobody in it. */
  noLeads: "There is no active lead inspector yet. Make someone a lead inspector first.",
  /** The lead picker for the only active lead inspector, who cannot lead themselves. */
  noOtherLead: "There is no other active lead inspector. Make someone else a lead inspector first.",
  /** A role that needs a lead, and nobody can lead them: said at the Role field, where the admin can choose otherwise. */
  nobodyToLead: "Nobody can lead them yet. Choose Lead Inspector or Admin, or make someone a lead inspector first.",
  ownLead: "Nobody can be their own lead inspector. Choose someone else.",
  /** Only people whose role sees their own inspections work in a team. */
  inNoTeam: (name: string, role: Pick<RoleOption, "builtIn" | "name">) =>
    role.builtIn
      ? `${name} is ${BUILT_IN_IN_WORDS[role.builtIn]}, so they work in no lead inspector's team.`
      : `${name} has the ${role.name} role, so they work in no lead inspector's team.`,
  notALead: (name: string) => `${name} is not an active lead inspector any more. Choose another lead inspector.`,
  leadGone: "That lead inspector could not be found. Reload the page and choose again.",
  /** Rule 5, before someone who leads a team gets a role that leads none, or is deactivated. */
  leadsTeam: (name: string, members: readonly string[]) =>
    `${name} leads ${inspectors(members.length)}: ${listNames(members)}. Choose another lead inspector for ${
      members.length === 1 ? "them" : "each of them"
    } first (Change Lead Inspector, next to their name).`,
  teamsMissing:
    "Lead inspectors need a database update first: apply supabase/migrations/20261007170000_lead_inspectors.sql, then reload this page.",
} as const;
