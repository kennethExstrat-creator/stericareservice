// Copy Invite Link, drawn on the server: first the question (a new link stops
// every earlier one working), then the link in a read-only field with Copy
// Link and Done. The dialog is drawn in place here (a portal draws nothing on
// the server); e2e/users/invites.spec.ts makes a link for a throwaway account
// in the browser.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ createInviteLink: vi.fn() }));
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

import { InviteLinkDialog, InviteLinkView } from "./invite-link-dialog";

const ZED = { id: "4e5f6071-8293-4d0e-9f1a-3b4c5d6e7f80", uid: "SC-0044", name: "zed@example.com" };
const LINK = "https://qc.example.com/auth/confirm?token_hash=5d41402abc4b2a76b9719d911017c592&type=invite";
const MESSAGE =
  "It signs zed@example.com in to create their account. It works once, within an hour, and any earlier link no longer works, the one in their invite email included.";

const noop = () => {};

function view(copied: boolean): string {
  return renderToStaticMarkup(<InviteLinkView user={ZED} link={LINK} message={MESSAGE} copied={copied} onCopy={noop} />);
}

describe("InviteLinkDialog", () => {
  const html = renderToStaticMarkup(<InviteLinkDialog user={ZED} onClose={noop} returnFocusTo={{ current: null }} />);

  it("asks first, titled for the person with their UID beside the title", () => {
    expect(html).toMatch(
      /data-slot="title-with-uid"><div>Create an Invite Link for zed@example.com\?<\/div><span data-slot="uid"[^>]*><span class="sr-only">UID <\/span>SC-0044<\/span><\/div>/,
    );
  });

  it("says what the link is for, and that it stops every earlier link working", () => {
    expect(html).toContain("A link to send them yourself, by WhatsApp or any chat, when the invite email does not reach them.");
    expect(html).toContain("Any link sent or copied before stops");
    expect(html).toContain("the one in their invite email included.");
  });

  it("sends the person's id, offers Create Link and Cancel, and shows no link yet", () => {
    expect(html).toContain(`<input type="hidden" name="userId" value="${ZED.id}"/>`);
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Create Link<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
    expect(html).not.toContain("auth/confirm");
    expect(html).not.toContain('role="alert"');
  });
});

describe("InviteLinkView", () => {
  it("shows the link in a read-only field labelled Invite Link, under the server's words about it", () => {
    const html = view(true);
    expect(html).toContain(">Invite Link for zed@example.com</div>");
    expect(html).toContain(`<div>${MESSAGE}</div>`);
    const input = html.match(/<input[^>]*>/)![0];
    expect(input).toContain(`value="${LINK.replace(/&/g, "&amp;")}"`);
    expect(input).toContain('readOnly=""');
    const id = input.match(/\sid="([^"]+)"/)![1];
    expect(html).toContain(`for="${id}">Invite Link</label>`);
  });

  it("says whether the link is on the clipboard, as a status a screen reader hears", () => {
    expect(view(true)).toMatch(/role="status"[^>]*>Copied\. Paste it into WhatsApp or another chat to send it\.<\/p>/);
    expect(view(false)).toMatch(/role="status"[^>]*>Not copied yet: choose Copy Link, or copy it from the field\.<\/p>/);
    // The field points at it.
    const html = view(false);
    const describedBy = html.match(/<input[^>]*aria-describedby="([^"]+)"/)![1];
    expect(html).toContain(`id="${describedBy}" role="status"`);
  });

  it("offers Copy Link and Done", () => {
    const html = view(false);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*><svg[^>]*aria-hidden="true"[^>]*>.*<\/svg>Copy Link<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Done<\/button>/);
  });
});
