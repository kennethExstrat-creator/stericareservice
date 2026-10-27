import { describe, expect, it } from "vitest";
import {
  accessOf,
  canLead,
  currentPlacement,
  defaultRole,
  inspectionScope,
  INSPECTOR_IN_CHARGE,
  isLeadInspector,
  listNames,
  needsLead,
  placementFor,
  ROLE_CHOICE_LABEL,
  roleChoiceOf,
  roleHint,
  roleValue,
  seesTeamInspections,
  sortRoles,
  standInRole,
  TEAM_MESSAGES,
  type RoleOption,
} from "./org";

const LEAD = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

const ADMIN: RoleOption = { id: "11111111-1111-4111-8111-111111111111", builtIn: "admin", name: "Admin", access: "all" };
const LEAD_ROLE: RoleOption = { id: "22222222-2222-4222-8222-222222222222", builtIn: "lead", name: "Lead Inspector", access: "team" };
const INSPECTOR: RoleOption = { id: "33333333-3333-4333-8333-333333333333", builtIn: "inspector", name: "Inspector", access: "own" };
/** Custom roles, one for each access. */
const REVIEWER: RoleOption = { id: "44444444-4444-4444-8444-444444444444", builtIn: null, name: "QA Reviewer", access: "all" };
const SENIOR: RoleOption = { id: "55555555-5555-4555-8555-555555555555", builtIn: null, name: "Senior Lead", access: "team" };
const FIELD: RoleOption = { id: "66666666-6666-4666-8666-666666666666", builtIn: null, name: "Field Inspector", access: "own" };

describe("placementFor: the profile columns behind a role", () => {
  it("stores a role's id, with the lead of a role that sees its own inspections", () => {
    expect(placementFor(INSPECTOR, LEAD)).toEqual({ role_id: INSPECTOR.id, lead_id: LEAD });
    expect(placementFor(FIELD, LEAD)).toEqual({ role_id: FIELD.id, lead_id: LEAD });
  });

  it("clears the lead in the same write for every other role, whatever was chosen before", () => {
    for (const role of [ADMIN, LEAD_ROLE, REVIEWER, SENIOR]) {
      expect(placementFor(role, LEAD), role.name).toEqual({ role_id: role.id, lead_id: null });
    }
  });

  it("stores the level as before on a project without roles, and the role column alone before lead inspectors", () => {
    expect(placementFor(standInRole("inspector"), LEAD)).toEqual({ role: "inspector", is_lead: false, lead_id: LEAD });
    expect(placementFor(standInRole("lead"), LEAD)).toEqual({ role: "inspector", is_lead: true, lead_id: null });
    expect(placementFor(standInRole("admin"), LEAD)).toEqual({ role: "admin", is_lead: false, lead_id: null });
    expect(placementFor(standInRole("admin"), null, false)).toEqual({ role: "admin" });
    expect(placementFor(standInRole("inspector"), null, false)).toEqual({ role: "inspector" });
  });
});

describe("the built-in role for a level, and what it sees", () => {
  it("reads a profile as inspector, lead inspector or admin, by the built-in roles' names", () => {
    expect(roleChoiceOf({ role: "inspector" })).toBe("inspector");
    expect(roleChoiceOf({ role: "inspector", isLead: true })).toBe("lead");
    expect(roleChoiceOf({ role: "admin", isLead: true })).toBe("admin");
    expect(roleChoiceOf({ role: "inspector", isLead: null })).toBe("inspector");
    expect(ROLE_CHOICE_LABEL).toEqual({ admin: "Admin", lead: "Lead Inspector", inspector: "Inspector" });
  });

  it("gives a level its access, as the profiles guard keeps role and is_lead to it", () => {
    expect(accessOf({ role: "admin" })).toBe("all");
    expect(accessOf({ role: "inspector", isLead: true })).toBe("team");
    expect(accessOf({ role: "inspector", isLead: false })).toBe("own");
  });

  it("stands a built-in role in for its level on a project without roles: no id, sent by its kind", () => {
    expect(standInRole("lead")).toEqual({ id: null, builtIn: "lead", name: "Lead Inspector", access: "team" });
    expect(roleValue(standInRole("admin"))).toBe("admin");
    expect(roleValue(REVIEWER)).toBe(REVIEWER.id);
  });

  it("asks a lead only of a role that sees its own inspections", () => {
    expect([needsLead("own"), needsLead("team"), needsLead("all")]).toEqual([true, false, false]);
  });

  it("lets anyone active whose role sees their team's lead a team, custom roles too", () => {
    expect(canLead({ role: "inspector", isLead: true, active: true })).toBe(true);
    expect(canLead({ role: "inspector", isLead: true, active: false })).toBe(false);
    expect(canLead({ role: "inspector", isLead: false, active: true })).toBe(false);
    expect(canLead({ role: "admin", isLead: true, active: true })).toBe(false);
  });
});

describe("the roles to choose from", () => {
  it("lists the built-in roles first, as the app does, then custom roles by name", () => {
    const custom = { ...FIELD, name: "field inspector 10" };
    const second = { ...FIELD, id: "77777777-7777-4777-8777-777777777777", name: "Field Inspector 9" };
    expect(sortRoles([REVIEWER, INSPECTOR, custom, ADMIN, second, LEAD_ROLE]).map((role) => role.name)).toEqual([
      "Admin",
      "Lead Inspector",
      "Inspector",
      "Field Inspector 9",
      "field inspector 10",
      "QA Reviewer",
    ]);
  });

  it("starts a dialog on Inspector, the least anyone is given, else the first role", () => {
    expect(defaultRole([ADMIN, LEAD_ROLE, INSPECTOR, REVIEWER])).toBe(INSPECTOR);
    expect(defaultRole([REVIEWER, FIELD])).toBe(REVIEWER);
    expect(defaultRole([])).toBeUndefined();
  });

  it("says under each role what its people see, as Roles & Permissions does", () => {
    expect([ADMIN, LEAD_ROLE, INSPECTOR, REVIEWER].map(roleHint)).toEqual([
      "Sees All Inspections",
      "Sees Team Inspections",
      "Sees Own Inspections",
      "Sees All Inspections",
    ]);
  });
});

describe("whose inspections a user sees", () => {
  it("is all for admins, their team's for lead inspectors and their own for inspectors", () => {
    expect(inspectionScope({ role: "admin" })).toBe("all");
    expect(inspectionScope({ role: "inspector", isLead: true })).toBe("team");
    expect(inspectionScope({ role: "inspector", isLead: false })).toBe("own");
    // A session from before teams, or a test double, has no isLead: an inspector.
    expect(inspectionScope({ role: "inspector" })).toBe("own");
  });

  it("names the inspector in charge for admins and lead inspectors", () => {
    expect(seesTeamInspections({ role: "admin" })).toBe(true);
    expect(seesTeamInspections({ role: "inspector", isLead: true })).toBe(true);
    expect(seesTeamInspections({ role: "inspector" })).toBe(false);
    expect(isLeadInspector({ role: "admin", isLead: true })).toBe(false);
    expect(INSPECTOR_IN_CHARGE).toBe("Inspector in Charge");
  });
});

describe("messages", () => {
  it("lists names in plain English", () => {
    expect([listNames([]), listNames(["Ivan"]), listNames(["Ivan", "Olga"]), listNames(["Ivan", "Olga", "Tom"])]).toEqual([
      "",
      "Ivan",
      "Ivan and Olga",
      "Ivan, Olga and Tom",
    ]);
  });

  it("says who is still in a lead's team and what to do first", () => {
    expect(TEAM_MESSAGES.leadsTeam("Lina Lead", ["Ivan Inspector"])).toBe(
      "Lina Lead leads 1 inspector: Ivan Inspector. Choose another lead inspector for them first (Change Lead Inspector, next to their name).",
    );
    expect(TEAM_MESSAGES.leadsTeam("Lina Lead", ["Ivan", "Olga", "Tom"])).toBe(
      "Lina Lead leads 3 inspectors: Ivan, Olga and Tom. Choose another lead inspector for each of them first (Change Lead Inspector, next to their name).",
    );
  });

  it("says where someone is now, for the role dialog: the built-in roles as before, a custom role by its name", () => {
    expect(currentPlacement(INSPECTOR, "Lina Lead")).toBe("They are an inspector in Lina Lead's team now.");
    expect(currentPlacement(INSPECTOR, null)).toBe("They are an inspector in no team yet.");
    expect(currentPlacement(LEAD_ROLE, null)).toBe("They are a lead inspector now.");
    expect(currentPlacement(ADMIN, null)).toBe("They are an admin now.");
    expect(currentPlacement(standInRole("admin"), null)).toBe("They are an admin now.");
    expect(currentPlacement(REVIEWER, null)).toBe("Their role is QA Reviewer now.");
    expect(currentPlacement(SENIOR, null)).toBe("Their role is Senior Lead now.");
    expect(currentPlacement(FIELD, "Lina Lead")).toBe("Their role is Field Inspector now, in Lina Lead's team.");
    expect(currentPlacement(FIELD, null)).toBe("Their role is Field Inspector now, in no team yet.");
  });

  it("explains who works in no team", () => {
    expect(TEAM_MESSAGES.inNoTeam("Ada", ADMIN)).toBe("Ada is an admin, so they work in no lead inspector's team.");
    expect(TEAM_MESSAGES.inNoTeam("Lina", LEAD_ROLE)).toBe("Lina is a lead inspector, so they work in no lead inspector's team.");
    expect(TEAM_MESSAGES.inNoTeam("Quinn", REVIEWER)).toBe("Quinn has the QA Reviewer role, so they work in no lead inspector's team.");
  });
});
