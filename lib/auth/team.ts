import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { canLead, isLeadInspector, TEAM_MESSAGES } from "./org";

/**
 * Database reads about lead inspectors and their teams (lib/auth/org.ts has
 * the rules). Always through the caller's own client: row level security
 * lets an admin read every profile and a lead inspector their team's.
 *
 * Until a project has run migration 20261007170000 the columns are missing;
 * these reads say so (`teams: false`) instead of failing, so the Users
 * screen keeps working as it did and explains what is needed.
 */

type Client = SupabaseClient<Database>;
type UserRole = Database["public"]["Enums"]["user_role"];
export type ErrorLike = { code?: string | null; message?: string | null };

/**
 * The database has no lead inspector columns yet. PostgREST answers 42703
 * for an unknown column in a select or filter, PGRST204 for one in a write.
 */
export function isMissingTeamColumn(error: ErrorLike | null | undefined): boolean {
  if (!error) return false;
  return (error.code === "42703" || error.code === "PGRST204") && /is_lead|lead_id/.test(error.message ?? "");
}

/** Someone's account and place in the teams. */
export type Person = {
  id: string;
  email: string | null;
  full_name: string | null;
  role: UserRole;
  active: boolean;
  is_lead: boolean;
  lead_id: string | null;
};

export type PersonRead = {
  /** False until the project has the lead inspector columns. */
  teams: boolean;
  person: Person | null;
  error: ErrorLike | null;
};

/** One person, with their place in the teams when the database has them. */
export async function readPerson(supabase: Client, id: string): Promise<PersonRead> {
  const found = await supabase
    .from("profiles")
    .select("id, email, full_name, role, active, is_lead, lead_id")
    .eq("id", id)
    .maybeSingle();
  if (!isMissingTeamColumn(found.error)) return { teams: true, person: found.data, error: found.error };

  const legacy = await supabase.from("profiles").select("id, email, full_name, role, active").eq("id", id).maybeSingle();
  return {
    teams: false,
    person: legacy.data ? { ...legacy.data, is_lead: false, lead_id: null } : null,
    error: legacy.error,
  };
}

/** True when the project has the lead inspector columns (migration 20261007170000). */
export async function teamsReady(supabase: Client): Promise<{ ready: boolean; error: ErrorLike | null }> {
  const { error } = await supabase.from("profiles").select("is_lead").limit(1);
  if (isMissingTeamColumn(error)) return { ready: false, error: null };
  return { ready: true, error };
}

/** A person as the screens name them: full name, else email. */
export function personName(person: { full_name: string | null; email: string | null } | null | undefined): string {
  return person?.full_name?.trim() || person?.email?.trim() || "This user";
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

export type TeamMember = { id: string; name: string; email: string | null; active: boolean };

/** The people in a lead inspector's team (everyone whose lead_id is theirs), by name. */
export async function teamOf(
  supabase: Client,
  leadId: string,
): Promise<{ members: TeamMember[]; error: ErrorLike | null }> {
  const { data, error } = await supabase.from("profiles").select("id, full_name, email, active").eq("lead_id", leadId);
  const members = (data ?? []).map((row) => ({ id: row.id, name: personName(row), email: row.email, active: row.active }));
  members.sort((a, b) => byName.compare(a.name, b.name));
  return { members, error };
}

export type LeadCheck = { ok: true; name: string } | { ok: false; message: string; error?: ErrorLike };

/**
 * The lead inspector an admin chose for `forUserId`: someone else, and an
 * active lead inspector (rules 3 and 4). The database checks both again and
 * locks the lead until the change is saved.
 */
export async function checkLead(supabase: Client, leadId: string, forUserId: string | null): Promise<LeadCheck> {
  if (leadId === forUserId) return { ok: false, message: TEAM_MESSAGES.ownLead };
  const { person, error } = await readPerson(supabase, leadId);
  if (error) return { ok: false, message: TEAM_MESSAGES.leadGone, error };
  if (!person) return { ok: false, message: TEAM_MESSAGES.leadGone };
  const name = personName(person);
  if (!canLead({ role: person.role, isLead: person.is_lead, active: person.active })) {
    return { ok: false, message: TEAM_MESSAGES.notALead(name) };
  }
  return { ok: true, name };
}

/**
 * For the screens of a lead inspector: the people in their team, by name,
 * active or not. Empty for everyone else (admins read the Users screen).
 */
export async function loadTeam(
  supabase: Client,
  user: { id: string; role: UserRole; isLead?: boolean },
): Promise<TeamMember[]> {
  if (!isLeadInspector(user)) return [];
  const { members, error } = await teamOf(supabase, user.id);
  if (error) {
    console.error("Team: the team members could not be read", { code: error.code, message: error.message });
    return [];
  }
  return members;
}
