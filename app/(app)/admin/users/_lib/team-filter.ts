// /admin/users?team=: one lead inspector's team, or the inspectors who are in
// no team yet. The URL is the state, so a filtered view can be shared and the
// back button works. Pure; client-safe.
import type { UserListItem } from "@/lib/auth/users";

export const USERS_PATH = "/admin/users";
export const TEAM_PARAM = "team";
/** ?q=: the search by name, email or UID (user-search.ts), kept when the Team picker changes the view. */
export const SEARCH_PARAM = "q";
/** ?team=none: active inspectors who have no lead inspector yet. */
export const NO_LEAD = "none";
/** The picker's value for no filter (Radix Select needs a non-empty value). */
export const EVERYONE = "all";

export type TeamFilter =
  | { kind: "everyone" }
  | { kind: "team"; leadId: string; leadName: string }
  | { kind: "no-lead" };

const EVERYONE_FILTER: TeamFilter = { kind: "everyone" };

/**
 * The page for a filter value: a lead's id, NO_LEAD, or null (and EVERYONE)
 * for everyone; with the search, when there is one.
 */
export function teamHref(value: string | null, search = ""): string {
  const params = new URLSearchParams();
  if (value && value !== EVERYONE) params.set(TEAM_PARAM, value);
  if (search.trim()) params.set(SEARCH_PARAM, search.trim());
  const query = params.toString();
  return query ? `${USERS_PATH}?${query}` : USERS_PATH;
}

/** The picker's value for a filter. */
export function filterValue(filter: TeamFilter): string {
  switch (filter.kind) {
    case "everyone":
      return EVERYONE;
    case "no-lead":
      return NO_LEAD;
    case "team":
      return filter.leadId;
  }
}

/**
 * The filter a ?team= value asks for. Anything that is not a lead inspector
 * on the list (an old link, a typo) shows everyone rather than an empty page.
 */
export function readTeamFilter(raw: string | string[] | undefined, users: readonly UserListItem[]): TeamFilter {
  const value = (Array.isArray(raw) ? raw[0] : raw)?.trim().toLowerCase();
  if (!value) return EVERYONE_FILTER;
  if (value === NO_LEAD) return { kind: "no-lead" };
  const lead = users.find((user) => user.id === value && user.roleChoice === "lead");
  if (!lead) return EVERYONE_FILTER;
  return { kind: "team", leadId: lead.id, leadName: lead.fullName?.trim() || lead.email || "This lead inspector" };
}

/** The people a filter shows: a team with its lead first, in the list's order otherwise. */
export function applyTeamFilter(users: readonly UserListItem[], filter: TeamFilter): UserListItem[] {
  switch (filter.kind) {
    case "everyone":
      return [...users];
    case "no-lead":
      return users.filter((user) => user.missingLead);
    case "team": {
      const lead = users.filter((user) => user.id === filter.leadId);
      return [...lead, ...users.filter((user) => user.lead?.id === filter.leadId)];
    }
  }
}

export type FilterOption = { value: string; label: string };

/**
 * The picker's choices: everyone, the inspectors in no team (when there are
 * any), then each lead's team by name. Labels, so in Title Case: "No Lead
 * Inspector (2)", "Lina Lead's Team (3)".
 */
export function filterOptions(users: readonly UserListItem[]): FilterOption[] {
  const missing = users.filter((user) => user.missingLead).length;
  const leads = users.filter((user) => user.roleChoice === "lead");
  return [
    { value: EVERYONE, label: "Everyone" },
    ...(missing > 0 ? [{ value: NO_LEAD, label: `No Lead Inspector (${missing})` }] : []),
    ...leads.map((lead) => ({
      value: lead.id,
      label: `${lead.fullName?.trim() || lead.email}'s Team (${lead.team.length})`,
    })),
  ];
}
