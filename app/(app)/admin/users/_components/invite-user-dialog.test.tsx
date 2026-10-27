// The invite form keeps its choices through a failed invite: it is submitted
// by hand (lib/admin/submit.ts), never through a function `action`, which
// React resets after every action, sending the role's RadioGroup back to
// its first value. The dialog is drawn in place here (a portal draws nothing
// on the server); e2e/users fails an invite in the browser and checks the
// role stays, and makes a link with Create Link.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ inviteUser: vi.fn(), createInviteLink: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
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

import { radioNames, radiosIn } from "../../_components/radio-card.testing";
import { INSPECTOR, ROLES, STAND_INS } from "../_lib/roles.testing";
import { InviteUserDialog } from "./invite-user-dialog";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const LEADS = [{ id: "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d", name: "Lina Lead", teamSize: 2 }];

/** The radios of one group, by the legend that names it. */
function group(html: string, legend: string): string {
  const id = html.match(new RegExp(`<legend[^>]*id="([^"]+)"[^>]*>${legend}</legend>`))?.[1];
  const start = html.indexOf(`aria-labelledby="${id}"`);
  return start === -1 ? "" : html.slice(start, html.indexOf("</fieldset>", start));
}

describe("InviteUserDialog", () => {
  const html = renderToStaticMarkup(<InviteUserDialog leads={LEADS} roles={ROLES} />);

  it("submits by hand, so a refused invite never resets the role, the lead or how it goes", () => {
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    // The role is a radio group sent with the form, Inspector to start with, by its id.
    expect(radiosIn(group(html, "Role")).find((radio) => radio["aria-checked"] === "true")?.value).toBe(INSPECTOR.id);
    expect(html).toContain(`<input type="hidden" name="role" value="${INSPECTOR.id}"/>`);
  });

  it("offers every role, the built-in ones first, each saying what it sees, and asks the lead of one that needs it", () => {
    expect(radioNames(group(html, "Role")).map((radio) => radio.name)).toEqual([
      "Admin",
      "Lead Inspector",
      "Inspector",
      "Field Inspector",
      "QA Reviewer",
      "Senior Lead",
    ]);
    expect(radioNames(group(html, "Role"))[0]).toEqual({ name: "Admin", description: "Sees All Inspections" });
    expect(html).toContain(">Lead Inspector</label>");
    // The picker's placeholder is a sentence, so it keeps its case.
    expect(html).toContain("Choose their lead inspector");
    expect(html).toContain('<input type="hidden" name="leadId" value=""/>');
  });

  it("asks how the invite goes: Send Email to start with, or Create Link, and names the button by it", () => {
    const delivery = group(html, "How to Invite");
    expect(radioNames(delivery)).toEqual([
      { name: "Send Email", description: "We email them the link." },
      { name: "Create Link", description: "You send it yourself." },
    ]);
    expect(radiosIn(delivery).find((radio) => radio["aria-checked"] === "true")?.value).toBe("email");
    expect(html).toContain('<input type="hidden" name="delivery" value="email"/>');
    expect(html).toContain(">Send Invite</button>");
    // Side by side from 640 px, so the dialog stays short on an iPad in landscape.
    expect(html).toMatch(/<div[^>]*role="radiogroup"[^>]*class="[^"]*\bsm:grid-cols-2\b[^"]*"[^>]*aria-labelledby="[^"]*-delivery-legend"/);
  });

  it("names the button, the dialog, the fields and the submit in Title Case", () => {
    expect(html).toMatch(/<button[^>]*>(?:(?!<\/button>).)*Invite User<\/button>/);
    expect(html).toContain(">Invite a User</div>");
    expect(html).toContain(">Email</label>");
    expect(html).toContain(">Send Invite</button>");
    expect(renderToStaticMarkup(<InviteUserDialog label="Invite Your First User" roles={ROLES} />)).toContain("Invite Your First User");
  });

  it("asks for the address, the role and how it goes only: the invitee gives their own name, phone and password", () => {
    expect(html).not.toContain("Full Name");
    expect(html).not.toContain('name="fullName"');
    expect(html).not.toContain('name="phone"');
    // One field to type in: the email (the radios are buttons, each with a hidden native input).
    expect(html.match(/<input(?![^>]*type="hidden")(?![^>]*aria-hidden="true")[^>]*>/g)).toEqual([
      expect.stringContaining('name="email"'),
    ]);
    expect(html).toContain(">They create their account from a link: their name, phone and password.<");
  });

  it("says there is no lead inspector to choose yet", () => {
    expect(renderToStaticMarkup(<InviteUserDialog leads={[]} roles={ROLES} />)).toContain(
      "There is no active lead inspector yet. Make someone a lead inspector first.",
    );
  });

  it("offers the built-in roles by their kind on a project without roles, and no lead without lead inspectors", () => {
    const withoutRoles = renderToStaticMarkup(<InviteUserDialog leads={LEADS} roles={STAND_INS} />);
    expect(radiosIn(group(withoutRoles, "Role")).map((radio) => radio.value)).toEqual(["admin", "lead", "inspector"]);
    expect(withoutRoles).toContain('<input type="hidden" name="role" value="inspector"/>');

    const withoutTeams = renderToStaticMarkup(<InviteUserDialog teams={false} roles={STAND_INS.filter((role) => role.builtIn !== "lead")} />);
    expect(radiosIn(group(withoutTeams, "Role")).map((radio) => radio.value)).toEqual(["admin", "inspector"]);
    expect(withoutTeams).not.toContain('name="leadId"');
  });
});
