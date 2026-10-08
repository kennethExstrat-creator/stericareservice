// /admin/users?q=: find someone by name, email or UID, as the admin types,
// within the view the Team picker shows (team-filter.ts). The list is short
// and already on the page, so it filters in the browser, as the reference
// lists do: every word of the search appears in the person's name, email or
// UID, in any order, ignoring case and accents. Pure; client-safe.
import { matchesSearch, normaliseForSearch, searchText } from "@/lib/admin/reference";
import type { UserListItem } from "@/lib/auth/users";
import type { TeamFilter } from "./team-filter";

/** Longer than any name, email or UID the list holds. */
export const MAX_SEARCH_LENGTH = 200;

/** The search a ?q= value asks for: the first one, as typed. */
export function readSearch(raw: string | string[] | undefined): string {
  return ((Array.isArray(raw) ? raw[0] : raw) ?? "").slice(0, MAX_SEARCH_LENGTH);
}

/**
 * The ways an admin may type a UID: as shown (SC-0042), without the hyphen
 * (SC0042) or without the zeros in front (SC-42, SC42). Its digits are in
 * each, so "0042" and "42" find it too. Like every word searched, a part
 * finds each UID it is part of: "SC-42" also finds SC-0420 when there is one.
 */
export function uidSpellings(uid: string): string[] {
  const match = /^SC-(\d+)$/i.exec(uid.trim());
  if (!match) return [uid];
  const digits = match[1];
  const number = digits.replace(/^0+(?=\d)/, "");
  return [...new Set([`SC-${digits}`, `SC${digits}`, `SC-${number}`, `SC${number}`])];
}

/** What a person is found by: their name, email and UID, normalised once. */
export function userSearchText(user: Pick<UserListItem, "fullName" | "email" | "uid">): string {
  return searchText(user.fullName, user.email, ...(user.uid ? uidSpellings(user.uid) : []));
}

/** One person, as the search sees them. */
export type SearchEntry = { id: string; text: string };

/** True when the search has words in it: spaces alone show everyone. */
export function isSearching(query: string): boolean {
  return normaliseForSearch(query) !== "";
}

/** The ids of the people a search leaves showing, or null without one: everyone. */
export function matchingIds(entries: readonly SearchEntry[], query: string): Set<string> | null {
  if (!isSearching(query)) return null;
  return new Set(entries.filter((entry) => matchesSearch(entry.text, query)).map((entry) => entry.id));
}

function people(count: number): string {
  return count === 1 ? "1 person" : `${count} people`;
}

function inspectors(count: number): string {
  return count === 1 ? "1 inspector" : `${count} inspectors`;
}

/**
 * What the list shows, in words, beside the pickers: "12 people.", "Lina
 * Lead's team: 2 inspectors.", "2 inspectors in no team." While a search
 * leaves out some of them, how many of the view it leaves: "1 of 12 people.",
 * "Lina Lead's team: 1 of 3 people." (the lead and their inspectors).
 * `shown` is the view's size, `total` everyone's, `matched` the search's
 * result (null without a search).
 */
export function listSummary(filter: TeamFilter, shown: number, total: number, matched: number | null): string {
  const narrowed = matched !== null && matched < shown;
  switch (filter.kind) {
    case "everyone":
      return narrowed ? `${matched} of ${people(total)}.` : `${people(total)}.`;
    case "no-lead":
      if (shown === 0) return "Every active inspector has a lead inspector.";
      return narrowed ? `${matched} of ${inspectors(shown)} in no team.` : `${inspectors(shown)} in no team.`;
    case "team":
      return narrowed
        ? `${filter.leadName}'s team: ${matched} of ${people(shown)}.`
        : `${filter.leadName}'s team: ${inspectors(Math.max(shown - 1, 0))}.`;
  }
}

/** The line in the list when the search finds nobody in the view. */
export function noMatchMessage(filter: TeamFilter, query: string): string {
  const quoted = `“${query.trim().replace(/\s+/g, " ")}”`;
  switch (filter.kind) {
    case "everyone":
      return `Nobody matches ${quoted}.`;
    case "no-lead":
      return `None of the inspectors in no team match ${quoted}.`;
    case "team":
      return `Nobody in ${filter.leadName}'s team matches ${quoted}.`;
  }
}
