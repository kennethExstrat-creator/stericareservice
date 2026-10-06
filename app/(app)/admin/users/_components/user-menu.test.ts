import { describe, expect, it } from "vitest";
import { menuGroups, type UserActionsTarget } from "./user-menu";

const person = (overrides: Partial<UserActionsTarget> = {}): UserActionsTarget => ({
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  name: "Olga Other",
  email: "olga@test.local",
  role: "inspector",
  status: "active",
  isSelf: false,
  ...overrides,
});

describe("menuGroups", () => {
  it("offers an active inspector promotion, a password link and deactivation", () => {
    expect(menuGroups(person())).toEqual([["make-admin", "send-link"], ["deactivate"]]);
  });

  it("offers an active admin demotion instead", () => {
    expect(menuGroups(person({ role: "admin" }))).toEqual([["make-inspector", "send-link"], ["deactivate"]]);
  });

  it("never lets admins demote or deactivate themselves", () => {
    const self = menuGroups(person({ role: "admin", isSelf: true })).flat();
    expect(self).toEqual(["send-link"]);
    expect(self).not.toContain("deactivate");
    expect(self).not.toContain("make-inspector");
  });

  it("activates an account that was never active, and sends it no links yet", () => {
    expect(menuGroups(person({ status: "pending" }))).toEqual([["activate", "make-admin"]]);
  });

  it("reactivates a deactivated account, and sends it no links", () => {
    expect(menuGroups(person({ status: "deactivated", role: "admin" }))).toEqual([["reactivate", "make-inspector"]]);
  });
});
