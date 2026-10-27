import { describe, expect, it } from "vitest";
import type { UserListItem } from "@/lib/auth/users";
import { ADMIN, INSPECTOR, LEAD as LEAD_ROLE, SENIOR } from "./roles.testing";
import { applyTeamFilter, EVERYONE, filterOptions, filterValue, NO_LEAD, readTeamFilter, teamHref } from "./team-filter";

const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function user(id: string, overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    id,
    uid: null,
    email: `${id}@test.local`,
    fullName: null,
    phone: null,
    role: INSPECTOR,
    status: "active",
    joined: true,
    createdAt: "2026-10-01T00:00:00Z",
    lastSignInAt: null,
    signInBlocked: false,
    isSelf: false,
    lead: null,
    team: [],
    missingLead: false,
    ...overrides,
  };
}

const USERS = [
  user("admin", { role: ADMIN, fullName: "Ada Admin" }),
  user("ivan", { fullName: "Ivan Inspector", lead: { id: LEAD, name: "Lina Lead" } }),
  user(LEAD, { fullName: "Lina Lead", role: LEAD_ROLE, team: [{ id: "ivan", name: "Ivan Inspector", active: true }] }),
  user("gail", { fullName: "Gail Grandfathered", missingLead: true }),
];

describe("team filter", () => {
  it("reads ?team= as a lead's team, the inspectors in no team, or everyone", () => {
    expect(readTeamFilter(LEAD, USERS)).toEqual({ kind: "team", leadId: LEAD, leadName: "Lina Lead" });
    expect(readTeamFilter(LEAD.toUpperCase(), USERS)).toMatchObject({ kind: "team", leadId: LEAD });
    expect(readTeamFilter([NO_LEAD, LEAD], USERS)).toEqual({ kind: "no-lead" });
    expect(readTeamFilter(undefined, USERS)).toEqual({ kind: "everyone" });
  });

  it("shows everyone for a value that is not a lead inspector, rather than an empty page", () => {
    expect(readTeamFilter("ivan", USERS)).toEqual({ kind: "everyone" });
    expect(readTeamFilter("not-a-lead", USERS)).toEqual({ kind: "everyone" });
  });

  it("shows a team with its lead first, or the inspectors in no team", () => {
    expect(applyTeamFilter(USERS, { kind: "team", leadId: LEAD, leadName: "Lina Lead" }).map((u) => u.id)).toEqual([LEAD, "ivan"]);
    expect(applyTeamFilter(USERS, { kind: "no-lead" }).map((u) => u.id)).toEqual(["gail"]);
    expect(applyTeamFilter(USERS, { kind: "everyone" })).toHaveLength(4);
  });

  it("links each choice, and everyone to the plain page", () => {
    expect(teamHref(LEAD)).toBe(`/admin/users?team=${LEAD}`);
    expect(teamHref(NO_LEAD)).toBe("/admin/users?team=none");
    expect(teamHref(EVERYONE)).toBe("/admin/users");
    expect(teamHref(null)).toBe("/admin/users");
    expect(filterValue({ kind: "team", leadId: LEAD, leadName: "Lina Lead" })).toBe(LEAD);
    expect(filterValue({ kind: "everyone" })).toBe(EVERYONE);
  });

  it("carries a search into the view picked, trimmed, and leaves out an empty one", () => {
    expect(teamHref(LEAD, " SC-0042 ")).toBe(`/admin/users?team=${LEAD}&q=SC-0042`);
    expect(teamHref(EVERYONE, "olga other")).toBe("/admin/users?q=olga+other");
    expect(teamHref(NO_LEAD, "   ")).toBe("/admin/users?team=none");
    expect(teamHref(null, "")).toBe("/admin/users");
  });

  it("offers everyone, the inspectors in no team when there are any, then each lead's team", () => {
    expect(filterOptions(USERS)).toEqual([
      { value: EVERYONE, label: "Everyone" },
      { value: NO_LEAD, label: "No Lead Inspector (1)" },
      { value: LEAD, label: "Lina Lead's Team (1)" },
    ]);
    expect(filterOptions(USERS.filter((u) => !u.missingLead)).map((option) => option.value)).toEqual([EVERYONE, LEAD]);
  });

  it("counts anyone whose role sees their team's as a lead, a custom role too", () => {
    const sam = user("sam", { fullName: "Sam Senior", role: SENIOR, team: [{ id: "ivan", name: "Ivan Inspector", active: true }] });
    const withSam = [...USERS, sam];
    expect(filterOptions(withSam).map((option) => option.label)).toContain("Sam Senior's Team (1)");
    expect(readTeamFilter("sam", withSam)).toEqual({ kind: "team", leadId: "sam", leadName: "Sam Senior" });
    // Someone whose role sees every inspection leads no team, whatever the address says.
    expect(readTeamFilter("admin", withSam)).toEqual({ kind: "everyone" });
  });
});
