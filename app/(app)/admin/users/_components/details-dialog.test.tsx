// Edit Details, drawn on the server: Name and Phone (Optional), each filled
// as saved, sent with the person's id, and submitted by hand
// (lib/admin/submit.ts), so a refused value stays in its field. The dialog is
// drawn in place here (a portal draws nothing on the server);
// e2e/users/details.spec.ts edits a throwaway account in the browser.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { PHONE_HINT } from "@/lib/auth/fields";

vi.mock("../actions", () => ({ editUserDetails: vi.fn() }));
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

import { DetailsDialog } from "./details-dialog";
import type { UserActionsTarget } from "./user-menu";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

type Person = Pick<UserActionsTarget, "id" | "uid" | "name" | "fullName" | "phone" | "status">;

const OLGA: Person = {
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  uid: "SC-0042",
  name: "Olga Other",
  fullName: "Olga Other",
  phone: "+60 12-345 6789",
  status: "active",
};

function draw(user: Person = OLGA): string {
  return renderToStaticMarkup(<DetailsDialog user={user} onClose={() => {}} returnFocusTo={{ current: null }} />);
}

/** A text input by its name, and the label that names it. */
function field(html: string, name: string) {
  const input = html.match(new RegExp(`<input(?![^>]*type="hidden")[^>]*name="${name}"[^>]*>`))?.[0] ?? "";
  const id = input.match(/\sid="([^"]+)"/)?.[1];
  const label = id ? html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`))?.[1] : undefined;
  return { input, label };
}

describe("DetailsDialog", () => {
  it("is titled for the person, with Name and Phone (Optional), filled as saved", () => {
    const html = draw();
    expect(html).toContain(">Edit Olga Other&#x27;s Details</div>");
    expect(html).toContain("The app shows the name wherever it names them, their inspections included.");
    const name = field(html, "fullName");
    expect(name.label).toBe("Name");
    expect(name.input).toContain('value="Olga Other"');
    // Names are no words to correct, and start with capitals.
    expect(name.input).toContain('autoCorrect="off"');
    expect(name.input).toContain('autoCapitalize="words"');
    const phone = field(html, "phone");
    expect(phone.label).toBe("Phone (Optional)");
    expect(phone.input).toContain('value="+60 12-345 6789"');
    expect(html.match(/<input(?![^>]*type="hidden")/g)).toHaveLength(2);
  });

  it("offers the phone keypad, and says how to write a number", () => {
    const { input } = field(draw(), "phone");
    expect(input).toContain('type="tel"');
    expect(input).toContain('inputMode="tel"');
    // Someone else's number: the browser's own would be the wrong one to offer.
    expect(input).toContain('autoComplete="off"');
    const hintId = input.match(/aria-describedby="([^"]+)"/)?.[1];
    expect(draw()).toContain(`id="${hintId}">${PHONE_HINT}</p>`);
  });

  it("sends the person's id with the details", () => {
    expect(draw()).toContain(`<input type="hidden" name="userId" value="${OLGA.id}"/>`);
  });

  it("starts empty for someone with no name or phone yet: never their email", () => {
    const html = draw({ ...OLGA, name: "zed@example.com", fullName: null, phone: null, status: "invited" });
    expect(field(html, "fullName").input).toContain('value=""');
    expect(field(html, "phone").input).toContain('value=""');
    expect(html).toContain(">Edit zed@example.com&#x27;s Details</div>");
  });

  it("tells the admin that someone invited replaces these when they create their account", () => {
    const invited = draw({ ...OLGA, status: "invited" });
    expect(invited).toContain(
      "They have not created their account yet: the name and phone number they enter then replace these.",
    );
    expect(draw()).not.toContain("They have not created their account yet");
  });

  it("shows the UID beside the title, outside it, so the dialog keeps its name", () => {
    expect(draw()).toMatch(
      /data-slot="title-with-uid"><div>Edit Olga Other&#x27;s Details<\/div><span data-slot="uid"[^>]*><span class="sr-only">UID <\/span>SC-0042<\/span><\/div>/,
    );
    const without = draw({ ...OLGA, uid: null });
    expect(without).not.toContain('data-slot="uid"');
    expect(without).toContain(">Edit Olga Other&#x27;s Details</div>");
  });

  it("offers Save and Cancel, and submits by hand, so a refused value stays in its field", () => {
    const html = draw();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    // No error until the server refuses a value.
    expect(field(html, "fullName").input).not.toMatch(/\saria-invalid=/);
    expect(field(html, "phone").input).not.toMatch(/\saria-invalid=/);
    expect(html).not.toContain('role="alert"');
  });
});
