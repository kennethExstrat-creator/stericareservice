// The row menu's dialogs, drawn on the server: each names the person in its
// title, with their UID beside the title, never inside it, so every dialog
// keeps its name. Edit Details is in details-dialog.test.tsx, Copy Invite
// Link in invite-link-dialog.test.tsx. The dialogs are drawn in place here (a
// portal draws nothing on the server).
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({
  assignLead: vi.fn(),
  cancelInvite: vi.fn(),
  changeRole: vi.fn(),
  createInviteLink: vi.fn(),
  deactivateUser: vi.fn(),
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

import { cancelInvite, changeRole, resendInvite } from "../actions";
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
  role: "inspector",
  status: "active",
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
      ["Change Olga Other's Role", ["inspector", "lead", "admin"]],
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
    const lead = { ...OLGA, uid: "SC-10000", role: "lead" as const, lead: null, team: ["Ivan Inspector"] };
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

describe("the invitation dialogs", () => {
  const ZED: UserActionsTarget = { ...OLGA, uid: "SC-0044", name: "zed@example.com", fullName: null, email: "zed@example.com", status: "invited" };

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
