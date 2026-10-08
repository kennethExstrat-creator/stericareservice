import { describe, expect, it } from "vitest";
import {
  activationNeedsPlacement,
  DIALOG_TITLE,
  leadChoicesFor,
  MENU_LABEL,
  menuGroups,
  type UserActionsTarget,
} from "./user-menu";

const LEAD = { id: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", name: "Lina Lead" };

const person = (overrides: Partial<UserActionsTarget> = {}): UserActionsTarget => ({
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  uid: "SC-0042",
  name: "Olga Other",
  fullName: "Olga Other",
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
  it("offers an active inspector a new name, a role, another team, a password link and deactivation", () => {
    expect(menuGroups(person())).toEqual([["change-name", "change-role", "change-lead", "send-link"], ["deactivate"]]);
  });

  it("moves only inspectors between teams: lead inspectors and admins work in none", () => {
    expect(menuGroups(person({ role: "lead", lead: null }))).toEqual([["change-name", "change-role", "send-link"], ["deactivate"]]);
    expect(menuGroups(person({ role: "admin", lead: null }))).toEqual([["change-name", "change-role", "send-link"], ["deactivate"]]);
  });

  it("offers roles only on a project without lead inspectors", () => {
    expect(menuGroups(person({ lead: null }), { teams: false })).toEqual([
      ["change-name", "change-role", "send-link"],
      ["deactivate"],
    ]);
  });

  it("lets admins change their own name, but never their own role, and never deactivate themselves", () => {
    const self = menuGroups(person({ role: "admin", isSelf: true, lead: null })).flat();
    expect(self).toEqual(["change-name", "send-link"]);
  });

  it("only activates an account that was never active: no links, no new name or role yet", () => {
    // Any change to its profile, a name included, would make it look deactivated.
    expect(menuGroups(person({ status: "pending", lead: null }))).toEqual([["activate"]]);
    expect(menuGroups(person({ status: "pending", role: "admin", lead: null }))).toEqual([["activate"]]);
  });

  it("reactivates a deactivated account, sends it no links, and can still rename and move it", () => {
    expect(menuGroups(person({ status: "deactivated", role: "admin", lead: null }))).toEqual([
      ["reactivate", "change-name", "change-role"],
    ]);
    expect(menuGroups(person({ status: "deactivated" }))).toEqual([["reactivate", "change-name", "change-role", "change-lead"]]);
  });

  it("lifts a blocked sign-in before any password link", () => {
    expect(menuGroups(person({ signInBlocked: true }))).toEqual([
      ["change-name", "change-role", "change-lead", "unblock"],
      ["deactivate"],
    ]);
    expect(menuGroups(person({ signInBlocked: true, isSelf: true, role: "admin", lead: null }))).toEqual([
      ["change-name", "unblock"],
    ]);
  });
});

describe("MENU_LABEL", () => {
  it("names every item in Title Case, a hyphenated word with a capital on each part", () => {
    expect(MENU_LABEL).toEqual({
      "change-name": "Change Name",
      "change-role": "Change Role",
      "change-lead": "Change Lead Inspector",
      "send-link": "Send Password Link",
      unblock: "Lift Sign-In Block",
      deactivate: "Deactivate",
      reactivate: "Reactivate",
      activate: "Activate",
    });
  });
});

describe("DIALOG_TITLE", () => {
  it("titles each dialog for the person in Title Case, the small words in lower case, a question keeping its mark", () => {
    const titles = Object.fromEntries(Object.entries(DIALOG_TITLE).map(([kind, title]) => [kind, title("Olga Other")]));
    expect(titles).toEqual({
      "change-name": "Change Olga Other's Name",
      "change-role": "Change Olga Other's Role",
      "change-lead": "Change Olga Other's Lead Inspector",
      "send-link": "Send a Password Link to Olga Other?",
      // "In" belongs to the verb here, as in the Sign In button.
      unblock: "Let Olga Other Sign In Again?",
      deactivate: "Deactivate Olga Other?",
      "leads-team": "Olga Other Still Leads a Team",
      reactivate: "Reactivate Olga Other?",
      activate: "Activate Olga Other?",
    });
  });

  it("leaves the name as it is: a name is no label, nor is the email shown for someone with none", () => {
    expect(DIALOG_TITLE["send-link"]("olga@test.local")).toBe("Send a Password Link to olga@test.local?");
    expect(DIALOG_TITLE["leads-team"]("ngan boon keat")).toBe("ngan boon keat Still Leads a Team");
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

describe("leadChoicesFor", () => {
  const LEO = { id: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e", name: "Leo Lead", teamSize: 0 };
  const LINA = { ...LEAD, teamSize: 2 };

  it("offers every active lead inspector but the person themselves", () => {
    expect(leadChoicesFor(person().id, [LINA, LEO])).toEqual({
      choices: [LINA, LEO],
      emptyHint: "There is no active lead inspector yet. Make someone a lead inspector first.",
    });
    expect(leadChoicesFor(LINA.id, [LINA, LEO]).choices).toEqual([LEO]);
  });

  it("tells the only lead inspector there is no other one, rather than none at all", () => {
    expect(leadChoicesFor(LINA.id, [LINA])).toEqual({
      choices: [],
      emptyHint: "There is no other active lead inspector. Make someone else a lead inspector first.",
    });
    expect(leadChoicesFor(person().id, [])).toEqual({
      choices: [],
      emptyHint: "There is no active lead inspector yet. Make someone a lead inspector first.",
    });
  });
});
