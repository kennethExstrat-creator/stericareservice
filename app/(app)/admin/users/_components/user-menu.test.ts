import { describe, expect, it } from "vitest";
import { activationNeedsPlacement, menuGroups, type UserActionsTarget } from "./user-menu";

const LEAD = { id: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", name: "Lina Lead" };

const person = (overrides: Partial<UserActionsTarget> = {}): UserActionsTarget => ({
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Olga Other",
  email: "olga@test.local",
  role: "inspector",
  status: "active",
  signInBlocked: false,
  isSelf: false,
  lead: LEAD,
  team: [],
  ...overrides,
});

describe("menuGroups", () => {
  it("offers an active inspector a role, another team, a password link and deactivation", () => {
    expect(menuGroups(person())).toEqual([["change-role", "change-lead", "send-link"], ["deactivate"]]);
  });

  it("moves only inspectors between teams: lead inspectors and admins work in none", () => {
    expect(menuGroups(person({ role: "lead", lead: null }))).toEqual([["change-role", "send-link"], ["deactivate"]]);
    expect(menuGroups(person({ role: "admin", lead: null }))).toEqual([["change-role", "send-link"], ["deactivate"]]);
  });

  it("offers roles only on a project without lead inspectors", () => {
    expect(menuGroups(person({ lead: null }), { teams: false })).toEqual([["change-role", "send-link"], ["deactivate"]]);
  });

  it("never lets admins change their own role or deactivate themselves", () => {
    const self = menuGroups(person({ role: "admin", isSelf: true, lead: null })).flat();
    expect(self).toEqual(["send-link"]);
  });

  it("only activates an account that was never active: no links, no role change yet", () => {
    expect(menuGroups(person({ status: "pending", lead: null }))).toEqual([["activate"]]);
    expect(menuGroups(person({ status: "pending", role: "admin", lead: null }))).toEqual([["activate"]]);
  });

  it("reactivates a deactivated account, sends it no links, and can still move it", () => {
    expect(menuGroups(person({ status: "deactivated", role: "admin", lead: null }))).toEqual([["reactivate", "change-role"]]);
    expect(menuGroups(person({ status: "deactivated" }))).toEqual([["reactivate", "change-role", "change-lead"]]);
  });

  it("lifts a blocked sign-in before any password link", () => {
    expect(menuGroups(person({ signInBlocked: true }))).toEqual([["change-role", "change-lead", "unblock"], ["deactivate"]]);
    expect(menuGroups(person({ signInBlocked: true, isSelf: true, role: "admin", lead: null }))).toEqual([["unblock"]]);
  });
});

describe("activationNeedsPlacement", () => {
  it("asks for a role and a lead when an inspector in no team is let in", () => {
    expect(activationNeedsPlacement(person({ lead: null }), true)).toBe(true);
    expect(activationNeedsPlacement(person(), true)).toBe(false);
    expect(activationNeedsPlacement(person({ role: "lead", lead: null }), true)).toBe(false);
    expect(activationNeedsPlacement(person({ role: "admin", lead: null }), true)).toBe(false);
    expect(activationNeedsPlacement(person({ lead: null }), false)).toBe(false);
  });
});
