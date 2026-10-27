// The invite form keeps its choices through a failed invite: it is submitted
// by hand (lib/admin/submit.ts), never through a function `action`, which
// React resets after every action, sending the role's RadioGroup back to
// Inspector. The dialog is drawn in place here (a portal draws nothing on the
// server); e2e/users fails an invite in the browser and checks the role stays.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ inviteUser: vi.fn() }));
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
    DialogTrigger: Part,
  };
});

import { InviteUserDialog } from "./invite-user-dialog";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const LEADS = [{ id: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", name: "Lina Lead", teamSize: 2 }];

describe("InviteUserDialog", () => {
  it("submits by hand, so a refused invite never resets the role or the lead", () => {
    const html = renderToStaticMarkup(<InviteUserDialog leads={LEADS} />);
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    // The role is a radio group sent with the form, Inspector to start with.
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*value="inspector"/);
    expect(html).toContain('<input type="hidden" name="role" value="inspector"/>');
  });

  it("offers Inspector, Lead Inspector and Admin, and asks an inspector's lead", () => {
    const html = renderToStaticMarkup(<InviteUserDialog leads={LEADS} />);
    for (const role of ["inspector", "lead", "admin"]) expect(html).toMatch(new RegExp(`role="radio"[^>]*value="${role}"`));
    expect(html).toContain(">Lead Inspector</label>");
    // The picker's placeholder is a sentence, so it keeps its case.
    expect(html).toContain("Choose their lead inspector");
    expect(html).toContain('<input type="hidden" name="leadId" value=""/>');
  });

  it("names the button, the dialog, the fields and the submit in Title Case", () => {
    const html = renderToStaticMarkup(<InviteUserDialog leads={LEADS} />);
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Invite User<\/button>/);
    expect(html).toContain(">Invite a User</div>");
    expect(html).toContain(">Email</label>");
    expect(html).toContain(">Send Invite</button>");
    expect(renderToStaticMarkup(<InviteUserDialog label="Invite Your First User" />)).toContain("Invite Your First User");
  });

  it("asks for the address and the role only: the invitee gives their own name, phone and password", () => {
    const html = renderToStaticMarkup(<InviteUserDialog leads={LEADS} />);
    expect(html).not.toContain("Full Name");
    expect(html).not.toContain('name="fullName"');
    expect(html).not.toContain('name="phone"');
    // One field to type in: the email (the role's radios are buttons, each with a hidden native input).
    expect(html.match(/<input(?![^>]*type="hidden")(?![^>]*aria-hidden="true")[^>]*>/g)).toEqual([
      expect.stringContaining('name="email"'),
    ]);
    expect(html).toContain("They get an email with a link to create their account: their name, phone and password.");
  });

  it("says there is no lead inspector to choose yet", () => {
    const html = renderToStaticMarkup(<InviteUserDialog leads={[]} />);
    expect(html).toContain("There is no active lead inspector yet. Make someone a lead inspector first.");
  });

  it("offers roles only on a project without lead inspectors", () => {
    const html = renderToStaticMarkup(<InviteUserDialog teams={false} />);
    expect(html).not.toMatch(/role="radio"[^>]*value="lead"/);
    expect(html).not.toContain('name="leadId"');
  });
});
