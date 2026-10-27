import { describe, expect, it } from "vitest";
import { ADMIN, FIELD, INSPECTOR, LEAD as LEAD_ROLE, REVIEWER, SENIOR } from "../_lib/roles.testing";
import {
  activationNeedsPlacement,
  DESTRUCTIVE,
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
  phone: null,
  email: "olga@test.local",
  role: INSPECTOR,
  status: "active",
  joined: true,
  signInBlocked: false,
  isSelf: false,
  lead: LEAD,
  team: [],
  ...overrides,
});

describe("menuGroups", () => {
  it("offers an active inspector new details, a role, another team, a password link and deactivation", () => {
    expect(menuGroups(person())).toEqual([["edit-details", "change-role", "change-lead", "send-link"], ["deactivate"]]);
  });

  it("moves only inspectors between teams: lead inspectors and admins work in none", () => {
    expect(menuGroups(person({ role: LEAD_ROLE, lead: null }))).toEqual([["edit-details", "change-role", "send-link"], ["deactivate"]]);
    expect(menuGroups(person({ role: ADMIN, lead: null }))).toEqual([["edit-details", "change-role", "send-link"], ["deactivate"]]);
  });

  it("goes by what a custom role sees: one that sees its own works in a team, any other in none", () => {
    expect(menuGroups(person({ role: FIELD }))).toEqual([["edit-details", "change-role", "change-lead", "send-link"], ["deactivate"]]);
    for (const role of [REVIEWER, SENIOR]) {
      expect(menuGroups(person({ role, lead: null })), role.name).toEqual([["edit-details", "change-role", "send-link"], ["deactivate"]]);
    }
  });

  it("offers roles only on a project without lead inspectors", () => {
    expect(menuGroups(person({ lead: null }), { teams: false })).toEqual([
      ["edit-details", "change-role", "send-link"],
      ["deactivate"],
    ]);
  });

  it("lets admins edit their own details, but never their own role, and never deactivate themselves", () => {
    const self = menuGroups(person({ role: ADMIN, isSelf: true, lead: null })).flat();
    expect(self).toEqual(["edit-details", "send-link"]);
  });

  it("only activates an account that was never active, or deletes it: no links, no new details or role yet", () => {
    // Any change to its profile, new details included, would make it look deactivated.
    expect(menuGroups(person({ status: "pending", lead: null }))).toEqual([["activate"], ["delete"]]);
    expect(menuGroups(person({ status: "pending", role: ADMIN, lead: null }))).toEqual([["activate"], ["delete"]]);
  });

  it("reactivates a deactivated account, sends it no links, can still edit its details and move it, or delete it", () => {
    expect(menuGroups(person({ status: "deactivated", role: ADMIN, lead: null }))).toEqual([
      ["reactivate", "edit-details", "change-role"],
      ["delete"],
    ]);
    expect(menuGroups(person({ status: "deactivated" }))).toEqual([
      ["reactivate", "edit-details", "change-role", "change-lead"],
      ["delete"],
    ]);
  });

  describe("Delete Permanently", () => {
    const offers = (user: UserActionsTarget, options?: { invites?: boolean }) => menuGroups(user, options).flat().includes("delete");

    it("is offered for a Deactivated or Pending Activation account alone, last, in a group of its own", () => {
      expect(offers(person({ status: "deactivated" }))).toBe(true);
      expect(offers(person({ status: "pending", lead: null }))).toBe(true);
      // Someone who never created their account and was deactivated: the same.
      expect(offers(person({ status: "deactivated", joined: false, fullName: null, name: "zed@example.com" }))).toBe(true);
      for (const status of ["deactivated", "pending"] as const) {
        expect(menuGroups(person({ status })).at(-1)).toEqual(["delete"]);
      }
    });

    it("is never offered for an Active or Invited account: Deactivate, or Cancel Invite, is for those", () => {
      expect(offers(person())).toBe(false);
      expect(offers(person({ signInBlocked: true }))).toBe(false);
      expect(offers(person({ status: "invited", joined: false }))).toBe(false);
      expect(offers(person({ status: "invited", joined: false, signInBlocked: true }))).toBe(false);
    });

    it("is never offered for yourself, whatever the status", () => {
      for (const status of ["active", "invited", "pending", "deactivated"] as const) {
        expect(offers(person({ status, isSelf: true, role: ADMIN, lead: null })), status).toBe(false);
      }
    });

    it("needs the secret key, as the invite actions do", () => {
      expect(menuGroups(person({ status: "deactivated" }), { invites: false })).toEqual([
        ["reactivate", "edit-details", "change-role", "change-lead"],
      ]);
      expect(menuGroups(person({ status: "pending", lead: null }), { invites: false })).toEqual([["activate"]]);
    });
  });

  it("offers someone invited their invite again, a link to copy, new details, a role, a team, and Cancel Invite", () => {
    const invited = person({ status: "invited", name: "zed@example.com", fullName: null, email: "zed@example.com" });
    expect(menuGroups(invited)).toEqual([
      ["resend-invite", "copy-invite-link"],
      ["edit-details", "change-role", "change-lead"],
      ["cancel-invite", "deactivate"],
    ]);
    // No password link: they have no account to sign in to yet.
    expect(menuGroups(invited).flat()).not.toContain("send-link");
    expect(menuGroups({ ...invited, role: LEAD_ROLE, lead: null })).toEqual([
      ["resend-invite", "copy-invite-link"],
      ["edit-details", "change-role"],
      ["cancel-invite", "deactivate"],
    ]);
  });

  it("offers no invite actions without the secret key, which they need", () => {
    expect(menuGroups(person({ status: "invited" }), { invites: false })).toEqual([
      ["edit-details", "change-role", "change-lead"],
      ["deactivate"],
    ]);
  });

  it("lifts a blocked sign-in on someone invited before any link: the links would not let them in", () => {
    expect(menuGroups(person({ status: "invited", signInBlocked: true }))).toEqual([
      ["edit-details", "change-role", "change-lead", "unblock"],
      ["cancel-invite", "deactivate"],
    ]);
  });

  it("lifts a blocked sign-in before any password link", () => {
    expect(menuGroups(person({ signInBlocked: true }))).toEqual([
      ["edit-details", "change-role", "change-lead", "unblock"],
      ["deactivate"],
    ]);
    expect(menuGroups(person({ signInBlocked: true, isSelf: true, role: ADMIN, lead: null }))).toEqual([
      ["edit-details", "unblock"],
    ]);
  });
});

describe("MENU_LABEL", () => {
  it("names every item in Title Case, a hyphenated word with a capital on each part", () => {
    expect(MENU_LABEL).toEqual({
      "edit-details": "Edit Details",
      "change-role": "Change Role",
      "change-lead": "Change Lead Inspector",
      "send-link": "Send Password Link",
      unblock: "Lift Sign-In Block",
      "resend-invite": "Resend Invite",
      "copy-invite-link": "Copy Invite Link",
      "cancel-invite": "Cancel Invite",
      deactivate: "Deactivate",
      reactivate: "Reactivate",
      activate: "Activate",
      delete: "Delete Permanently",
    });
  });

  it("marks what takes something away in red: Cancel Invite, Deactivate and Delete Permanently", () => {
    expect([...DESTRUCTIVE].sort()).toEqual(["cancel-invite", "deactivate", "delete"]);
  });
});

describe("DIALOG_TITLE", () => {
  it("titles each dialog for the person in Title Case, the small words in lower case, a question keeping its mark", () => {
    const titles = Object.fromEntries(Object.entries(DIALOG_TITLE).map(([kind, title]) => [kind, title("Olga Other")]));
    expect(titles).toEqual({
      "edit-details": "Edit Olga Other's Details",
      "change-role": "Change Olga Other's Role",
      "change-lead": "Change Olga Other's Lead Inspector",
      "send-link": "Send a Password Link to Olga Other?",
      // "In" belongs to the verb here, as in the Sign In button.
      unblock: "Let Olga Other Sign In Again?",
      "resend-invite": "Resend the Invite to Olga Other?",
      "copy-invite-link": "Create an Invite Link for Olga Other?",
      "invite-link": "Invite Link for Olga Other",
      "cancel-invite": "Cancel the Invite to Olga Other?",
      deactivate: "Deactivate Olga Other?",
      "leads-team": "Olga Other Still Leads a Team",
      reactivate: "Reactivate Olga Other?",
      activate: "Activate Olga Other?",
      delete: "Delete Olga Other Permanently?",
    });
  });

  it("leaves the name as it is: a name is no label, nor is the email shown for someone with none", () => {
    expect(DIALOG_TITLE["send-link"]("olga@test.local")).toBe("Send a Password Link to olga@test.local?");
    expect(DIALOG_TITLE["resend-invite"]("zed@example.com")).toBe("Resend the Invite to zed@example.com?");
    expect(DIALOG_TITLE["leads-team"]("ngan boon keat")).toBe("ngan boon keat Still Leads a Team");
  });
});

describe("activationNeedsPlacement", () => {
  it("asks for a role and a lead when someone whose role needs a lead is let in without one", () => {
    expect(activationNeedsPlacement(person({ lead: null }), true)).toBe(true);
    expect(activationNeedsPlacement(person({ role: FIELD, lead: null }), true)).toBe(true);
    expect(activationNeedsPlacement(person(), true)).toBe(false);
    expect(activationNeedsPlacement(person({ role: LEAD_ROLE, lead: null }), true)).toBe(false);
    expect(activationNeedsPlacement(person({ role: ADMIN, lead: null }), true)).toBe(false);
    expect(activationNeedsPlacement(person({ role: REVIEWER, lead: null }), true)).toBe(false);
    expect(activationNeedsPlacement(person({ role: SENIOR, lead: null }), true)).toBe(false);
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
