import { z } from "zod";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Lead inspectors and their teams (Kenneth, 7 October 2026: "inspector level
 * can be inspector or lead inspector, while inspector must be assigned to be
 * managed under a lead inspector, where the lead inspector can see all the on
 * going or done inspection in the table").
 *
 * The app's half of the rules in
 * supabase/migrations/20261007170000_lead_inspectors.sql: the Users screen
 * and its Server Actions check them first and explain them in plain words;
 * the database checks them again, for every caller. Change a rule here and
 * in the migration together. Client-safe: the dialogs use the same rules the
 * actions enforce.
 *
 *   - Roles stay inspector and admin. A lead inspector is an inspector with
 *     profiles.is_lead; their team is the inspectors whose lead_id is theirs.
 *   - Admins are in no team and lead none. Lead inspectors have no lead.
 *   - An active inspector who is not a lead works in an active lead
 *     inspector's team. Inspectors from before the rule may have none: the
 *     Users screen lists them as a problem until an admin chooses one.
 *   - Someone who leads a team stays an active lead inspector until their
 *     team has moved to another lead.
 *   - A lead inspector reads every inspection of their team, read-only.
 */

export type UserRole = Database["public"]["Enums"]["user_role"];

/** What an admin picks in the Role field: the database role, with lead inspectors told apart. */
export const ROLE_CHOICES = ["inspector", "lead", "admin"] as const;
export type RoleChoice = (typeof ROLE_CHOICES)[number];

export const RoleChoiceSchema = z.enum(ROLE_CHOICES, { error: "Choose Inspector, Lead Inspector or Admin." });

/** The roles as labels (Title Case, Kenneth 8 October 2026); sentences say "lead inspector". */
export const ROLE_CHOICE_LABEL: Readonly<Record<RoleChoice, string>> = {
  inspector: "Inspector",
  lead: "Lead Inspector",
  admin: "Admin",
};

/** One line each in the role pickers, so a dialog fits an iPad in landscape. */
export const ROLE_CHOICE_DESCRIPTION: Readonly<Record<RoleChoice, string>> = {
  inspector: "Records inspections and sees their own.",
  lead: "Also sees their team's inspections, read-only.",
  admin: "Manages users and templates, and approves inspections.",
};

/** How someone's current role and team read in a dialog: "They are an inspector in Lina Lead's team now." */
export function currentPlacement(choice: RoleChoice, leadName: string | null): string {
  switch (choice) {
    case "admin":
      return "They are an admin now.";
    case "lead":
      return "They are a lead inspector now.";
    case "inspector":
      return leadName ? `They are an inspector in ${leadName}'s team now.` : "They are an inspector in no team yet.";
  }
}

/** The profile columns behind a choice. */
export type Placement = { role: UserRole; is_lead: boolean; lead_id: string | null };

/** The columns to store for a choice: admins and lead inspectors have no lead. */
export function placementFor(choice: RoleChoice, leadId: string | null): Placement {
  switch (choice) {
    case "admin":
      return { role: "admin", is_lead: false, lead_id: null };
    case "lead":
      return { role: "inspector", is_lead: true, lead_id: null };
    case "inspector":
      return { role: "inspector", is_lead: false, lead_id: leadId };
  }
}

/** How a profile reads in the Role field. */
export function roleChoiceOf(person: { role: UserRole; isLead?: boolean | null }): RoleChoice {
  if (person.role === "admin") return "admin";
  return person.isLead ? "lead" : "inspector";
}

/** Only inspectors who are not leads work in a team, so only they need a lead. */
export function needsLead(choice: RoleChoice): boolean {
  return choice === "inspector";
}

/** Someone who may lead a team: an active lead inspector. */
export function canLead(person: { role: UserRole; isLead?: boolean | null; active: boolean }): boolean {
  return person.active && roleChoiceOf(person) === "lead";
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
export const INSPECTOR_IN_CHARGE = "Inspector in charge";

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
  /** An inspector needs a lead and nobody can lead them: said at the Role field, where the admin can choose otherwise. */
  nobodyToLead: "Nobody can lead them yet. Choose Lead Inspector or Admin, or make someone a lead inspector first.",
  ownLead: "Nobody can be their own lead inspector. Choose someone else.",
  /** Only inspectors who are not leads work in a team. */
  inNoTeam: (name: string, choice: RoleChoice) =>
    `${name} is ${choice === "admin" ? "an admin" : "a lead inspector"}, so they work in no lead inspector's team.`,
  notALead: (name: string) => `${name} is not an active lead inspector any more. Choose another lead inspector.`,
  leadGone: "That lead inspector could not be found. Reload the page and choose again.",
  /** Rule 5, before a lead inspector is demoted, made an admin or deactivated. */
  leadsTeam: (name: string, members: readonly string[]) =>
    `${name} leads ${inspectors(members.length)}: ${listNames(members)}. Choose another lead inspector for ${
      members.length === 1 ? "them" : "each of them"
    } first (Change Lead Inspector, next to their name).`,
  teamsMissing:
    "Lead inspectors need a database update first: apply supabase/migrations/20261007170000_lead_inspectors.sql, then reload this page.",
} as const;
