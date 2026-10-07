import { describe, expect, it } from "vitest";
import type { UserListItem } from "@/lib/auth/users";
import { applyTeamFilter, EVERYONE, filterOptions, filterValue, NO_LEAD, readTeamFilter, teamHref } from "./team-filter";

const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

function user(id: string, overrides: Partial<UserListItem> = {}): UserListItem {
  return {
    id,
    email: `${id}@test.local`,
    fullName: null,
    role: "inspector",
    roleChoice: "inspector",
    status: "active",
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
  user("admin", { role: "admin", roleChoice: "admin", fullName: "Ada Admin" }),
  user("ivan", { fullName: "Ivan Inspector", lead: { id: LEAD, name: "Lina Lead" } }),
  user(LEAD, { fullName: "Lina Lead", roleChoice: "lead", team: [{ id: "ivan", name: "Ivan Inspector", active: true }] }),
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

  it("offers everyone, the inspectors in no team when there are any, then each lead's team", () => {
    expect(filterOptions(USERS)).toEqual([
      { value: EVERYONE, label: "Everyone" },
      { value: NO_LEAD, label: "No lead inspector (1)" },
      { value: LEAD, label: "Lina Lead's team (1)" },
    ]);
    expect(filterOptions(USERS.filter((u) => !u.missingLead)).map((option) => option.value)).toEqual([EVERYONE, LEAD]);
  });
});
