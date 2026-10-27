// The row menu's dialogs, drawn on the server: each names the person in its
// title, with their UID beside the title, never inside it, so every dialog
// keeps its name. Edit Details is in details-dialog.test.tsx, Copy Invite
// Link in invite-link-dialog.test.tsx, Delete Permanently in
// delete-user-dialog.test.tsx. The dialogs are drawn in place here (a portal
// draws nothing on the server).
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  assignLead: vi.fn(),
  cancelInvite: vi.fn(),
  changeRole: vi.fn(),
  checkUserDeletion: vi.fn(),
  createInviteLink: vi.fn(),
  deactivateUser: vi.fn(),
  deleteUserPermanently: vi.fn(),
  editUserDetails: vi.fn(),
  reactivateUser: vi.fn(),
  resendInvite: vi.fn(),
  sendPasswordLink: vi.fn(),
}));
vi.mock("@/components/ui/dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Dialog: Part,
    DialogClose: Part,
    DialogContent: Part,
    DialogDescription: Part,
    DialogFooter: Part,
    DialogHeader: Part,
    DialogTitle: Part,
  };
});
vi.mock("@/components/ui/alert-dialog", () => {
  const Part = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    AlertDialog: Part,
    AlertDialogCancel: Part,
    AlertDialogContent: Part,
    AlertDialogDescription: Part,
    AlertDialogFooter: Part,
    AlertDialogHeader: Part,
    AlertDialogTitle: Part,
  };
});

import { radioNames, radiosIn } from "../../_components/radio-card.testing";
import { cancelInvite, changeRole, reactivateUser, resendInvite } from "../actions";
import { FIELD, INSPECTOR, LEAD, REVIEWER, ROLES, SENIOR } from "../_lib/roles.testing";
import { ConfirmDialog, confirmation, LeadsTeamDialog, PlacementDialog } from "./user-actions";
import type { UserActionsTarget } from "./user-menu";

const LINA = { id: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", name: "Lina Lead" };

const OLGA: UserActionsTarget = {
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
  lead: LINA,
  team: [],
};

const noop = () => {};
const nowhere = { current: null };

/** The title, then the UID beside it, both inside the title row. */
function titleWithUid(title: string, uid: string): RegExp {
  const escaped = title.replace(/'/g, "&#x27;").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `data-slot="title-with-uid"><div>${escaped}</div><span data-slot="uid"[^>]*><span class="sr-only">UID </span>${uid}</span></div>`,
  );
}

describe("the user dialogs", () => {
  it.each([
    ["send-link", "Send a Password Link to Olga Other?"],
    ["unblock", "Let Olga Other Sign In Again?"],
    ["resend-invite", "Resend the Invite to Olga Other?"],
    ["cancel-invite", "Cancel the Invite to Olga Other?"],
    ["deactivate", "Deactivate Olga Other?"],
    ["reactivate", "Reactivate Olga Other?"],
    ["activate", "Activate Olga Other?"],
  ] as const)("shows the UID beside the title of %s", (kind, title) => {
    const html = renderToStaticMarkup(
      <ConfirmDialog confirmation={confirmation(kind, OLGA)} onClose={noop} returnFocusTo={nowhere} />,
    );
    expect(html).toMatch(titleWithUid(title, "SC-0042"));
  });

  it("shows the UID beside Change Role and Change Lead Inspector", () => {
    for (const [title, choices] of [
      ["Change Olga Other's Role", ROLES],
      ["Change Olga Other's Lead Inspector", null],
    ] as const) {
      const html = renderToStaticMarkup(
        <PlacementDialog
          user={OLGA}
          title={title}
          description="They work in Lina Lead's team now."
          confirm="Save"
          pending="Saving…"
          action={changeRole}
          choices={choices}
          askLead
          leads={[{ ...LINA, teamSize: 1 }]}
          emptyHint=""
          onClose={noop}
          returnFocusTo={nowhere}
        />,
      );
      expect(html).toMatch(titleWithUid(title, "SC-0042"));
      // The form still sends the person's id, not their UID.
      expect(html).toContain(`<input type="hidden" name="userId" value="${OLGA.id}"/>`);
    }
  });

  it("shows the UID beside the title when a lead inspector still leads a team", () => {
    const lead = { ...OLGA, uid: "SC-10000", role: LEAD, lead: null, team: ["Ivan Inspector"] };
    const html = renderToStaticMarkup(<LeadsTeamDialog user={lead} onClose={noop} returnFocusTo={nowhere} />);
    expect(html).toMatch(titleWithUid("Olga Other Still Leads a Team", "SC-10000"));
  });

  it("shows the title alone before migration 20261008140000", () => {
    const before = { ...OLGA, uid: null };
    const confirm = renderToStaticMarkup(
      <ConfirmDialog confirmation={confirmation("deactivate", before)} onClose={noop} returnFocusTo={nowhere} />,
    );
    const leads = renderToStaticMarkup(<LeadsTeamDialog user={before} onClose={noop} returnFocusTo={nowhere} />);
    for (const html of [confirm, leads]) {
      expect(html).not.toContain('data-slot="uid"');
      expect(html).not.toContain("title-with-uid");
    }
    expect(confirm).toContain("<div>Deactivate Olga Other?</div>");
  });
});

/** Someone invited who has not created their account: no name, and no password. */
const ZED: UserActionsTarget = {
  ...OLGA,
  uid: "SC-0044",
  name: "zed@example.com",
  fullName: null,
  email: "zed@example.com",
  status: "invited",
  joined: false,
};

describe("the invitation dialogs", () => {

  it("resends the invite to the address on the profile, and says Copy Invite Link is there if email fails", () => {
    const resend = confirmation("resend-invite", ZED);
    expect(resend).toMatchObject({ confirm: "Resend Invite", pending: "Sending…", action: resendInvite, fields: { userId: ZED.id } });
    expect(resend.destructive).toBeUndefined();
    const html = renderToStaticMarkup(<ConfirmDialog confirmation={resend} onClose={noop} returnFocusTo={nowhere} />);
    expect(html).toContain('We email <span class="font-medium text-foreground">zed@example.com</span> a new link to create their');
    expect(html).toContain("Any link sent or copied before stops working.");
    expect(html).toContain("choose Copy Invite Link instead");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Resend Invite<\/button>/);
    expect(html).toContain(`<input type="hidden" name="userId" value="${ZED.id}"/>`);
  });

  it("asks before cancelling an invite, in red, with Keep Invite rather than a second Cancel", () => {
    const cancel = confirmation("cancel-invite", ZED);
    expect(cancel).toMatchObject({ confirm: "Cancel Invite", dismiss: "Keep Invite", destructive: true, action: cancelInvite });
    const html = renderToStaticMarkup(<ConfirmDialog confirmation={cancel} onClose={noop} returnFocusTo={nowhere} />);
    expect(html).toMatch(titleWithUid("Cancel the Invite to zed@example.com?", "SC-0044"));
    expect(html).toContain("This removes the account the invite made for");
    expect(html).toContain("You can invite the address again later.");
    expect(html).toContain(">Keep Invite</div>");
    expect(html).not.toMatch(/>Cancel<\/div>/);
    expect(html).toMatch(/<button[^>]*data-variant="destructive"[^>]*type="submit"[^>]*>Cancel Invite<\/button>/);
  });

  it("keeps Cancel on every other confirmation", () => {
    const html = renderToStaticMarkup(
      <ConfirmDialog confirmation={confirmation("deactivate", OLGA)} onClose={noop} returnFocusTo={nowhere} />,
    );
    expect(html).toContain(">Cancel</div>");
  });
});

describe("Activate and Reactivate", () => {
  it("speak of passwords to someone who has created their account", () => {
    expect(confirmation("reactivate", OLGA).description).toBe(
      "They can sign in again with their current password and pick up where they left off. They are back in Lina Lead's team.",
    );
    expect(confirmation("activate", { ...OLGA, lead: null }).description).toBe(
      "This account has never been active. Once activated they can sign in with their password, or choose one from a password link.",
    );
  });

  it("speak of the link to create their account to someone invited, who has no password yet", () => {
    const reactivate = confirmation("reactivate", { ...ZED, status: "deactivated" });
    expect(reactivate).toMatchObject({ confirm: "Reactivate", action: reactivateUser });
    expect(reactivate.description).toBe(
      "They have not created their account yet. Once it is active again, send them a new link to create it: Resend Invite or Copy Invite Link, next to their name. They are back in Lina Lead's team.",
    );
    const activate = confirmation("activate", { ...ZED, status: "pending", lead: null });
    expect(activate.description).toBe(
      "This account has never been active, and they have not created it yet. Once it is active, send them a link to create it: Resend Invite or Copy Invite Link, next to their name.",
    );
    for (const { description } of [reactivate, activate]) expect(description).not.toMatch(/password/i);
  });
});

describe("the role pickers", () => {
  /** Change Role for `user`, drawn in place. */
  function changeRoleDialog(user: UserActionsTarget, choices = ROLES) {
    return renderToStaticMarkup(
      <PlacementDialog
        user={user}
        title={`Change ${user.name}'s Role`}
        description=""
        confirm="Save Role"
        pending="Saving…"
        action={changeRole}
        choices={choices}
        askLead
        leads={[{ ...LINA, teamSize: 1 }]}
        emptyHint=""
        onClose={noop}
        returnFocusTo={nowhere}
      />,
    );
  }
  const checked = (html: string) => radiosIn(html).find((radio) => radio["aria-checked"] === "true")?.value;

  it("offers every role by name, the built-in ones first, each saying what it sees, and sends the role's id", () => {
    const html = changeRoleDialog(OLGA);
    expect(radioNames(html)).toEqual([
      { name: "Admin", description: "Sees All Inspections" },
      { name: "Lead Inspector", description: "Sees Team Inspections" },
      { name: "Inspector", description: "Sees Own Inspections" },
      { name: "Field Inspector", description: "Sees Own Inspections" },
      { name: "QA Reviewer", description: "Sees All Inspections" },
      { name: "Senior Lead", description: "Sees Team Inspections" },
    ]);
    expect(radiosIn(html).map((radio) => radio.value)).toEqual(ROLES.map((role) => role.id));
    // Their own role chosen to start with, and sent as it is.
    expect(checked(html)).toBe(INSPECTOR.id);
    expect(html).toContain(`<input type="hidden" name="role" value="${INSPECTOR.id}"/>`);
    // The group is named by its legend, so a screen reader hears "Role".
    expect(html).toMatch(/<legend[^>]*id="([^"]+)"[^>]*>Role<\/legend>/);
    const legend = html.match(/<legend[^>]*id="([^"]+)"[^>]*>Role<\/legend>/)![1];
    expect(html).toMatch(new RegExp(`role="radiogroup"[^>]*aria-labelledby="${legend}"`));
  });

  it("asks for a lead for a role that sees its own inspections, custom or not, and for no other", () => {
    for (const role of [INSPECTOR, FIELD]) {
      expect(changeRoleDialog({ ...OLGA, role }), role.name).toContain('name="leadId"');
    }
    for (const role of [LEAD, REVIEWER, SENIOR]) {
      expect(changeRoleDialog({ ...OLGA, role, lead: null }), role.name).not.toContain('name="leadId"');
    }
  });

  it("starts on Inspector when their role is not one of the choices", () => {
    expect(checked(changeRoleDialog({ ...OLGA, role: { ...REVIEWER, id: "77777777-7777-4777-8777-777777777777" } }))).toBe(INSPECTOR.id);
  });

  it("warns, before saving, that someone who leads a team keeps a role that sees their team's", () => {
    const lead = { ...OLGA, role: SENIOR, lead: null, team: ["Ivan Inspector"] };
    // Their own role, which leads a team: nothing to warn about yet.
    expect(changeRoleDialog(lead)).not.toContain('data-slot="team-note"');
    // A dialog that starts on a role leading no team (theirs was not on the list) warns at once.
    expect(changeRoleDialog({ ...lead, role: { ...SENIOR, id: "77777777-7777-4777-8777-777777777777" } })).toContain(
      'data-slot="team-note"',
    );
  });
});
