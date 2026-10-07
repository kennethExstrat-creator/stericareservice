import { describe, expect, it } from "vitest";
import {
  canLead,
  currentPlacement,
  inspectionScope,
  INSPECTOR_IN_CHARGE,
  isLeadInspector,
  listNames,
  needsLead,
  placementFor,
  RoleChoiceSchema,
  roleChoiceOf,
  seesTeamInspections,
  TEAM_MESSAGES,
} from "./org";

const LEAD = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

describe("placementFor: the profile columns behind a role choice", () => {
  it("puts an inspector in their lead's team", () => {
    expect(placementFor("inspector", LEAD)).toEqual({ role: "inspector", is_lead: false, lead_id: LEAD });
  });

  it("gives lead inspectors and admins no lead, whatever was chosen before", () => {
    expect(placementFor("lead", LEAD)).toEqual({ role: "inspector", is_lead: true, lead_id: null });
    expect(placementFor("admin", LEAD)).toEqual({ role: "admin", is_lead: false, lead_id: null });
  });
});

describe("roleChoiceOf and the level checks", () => {
  it("reads a profile as inspector, lead inspector or admin", () => {
    expect(roleChoiceOf({ role: "inspector" })).toBe("inspector");
    expect(roleChoiceOf({ role: "inspector", isLead: true })).toBe("lead");
    expect(roleChoiceOf({ role: "admin", isLead: true })).toBe("admin");
    expect(roleChoiceOf({ role: "inspector", isLead: null })).toBe("inspector");
  });

  it("only asks inspectors who are not leads for a lead", () => {
    expect([needsLead("inspector"), needsLead("lead"), needsLead("admin")]).toEqual([true, false, false]);
  });

  it("lets only active lead inspectors lead a team", () => {
    expect(canLead({ role: "inspector", isLead: true, active: true })).toBe(true);
    expect(canLead({ role: "inspector", isLead: true, active: false })).toBe(false);
    expect(canLead({ role: "inspector", isLead: false, active: true })).toBe(false);
    expect(canLead({ role: "admin", isLead: true, active: true })).toBe(false);
  });

  it("parses the role field's three values only", () => {
    expect(RoleChoiceSchema.safeParse("lead").success).toBe(true);
    expect(RoleChoiceSchema.safeParse("owner").error?.issues[0].message).toBe("Choose Inspector, Lead Inspector or Admin.");
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
    expect(INSPECTOR_IN_CHARGE).toBe("Inspector in charge");
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

  it("says where someone is now, for the role dialog", () => {
    expect(currentPlacement("inspector", "Lina Lead")).toBe("They are an inspector in Lina Lead's team now.");
    expect(currentPlacement("inspector", null)).toBe("They are an inspector in no team yet.");
    expect(currentPlacement("lead", null)).toBe("They are a lead inspector now.");
    expect(currentPlacement("admin", null)).toBe("They are an admin now.");
  });

  it("explains who works in no team", () => {
    expect(TEAM_MESSAGES.inNoTeam("Ada", "admin")).toBe("Ada is an admin, so they work in no lead inspector's team.");
    expect(TEAM_MESSAGES.inNoTeam("Lina", "lead")).toBe("Lina is a lead inspector, so they work in no lead inspector's team.");
  });
});
