// Change Name, drawn on the server: one field, Name, filled with the name as
// saved, sent with the person's id, and submitted by hand (lib/admin/submit.ts),
// so a refused name stays in the field. The dialog is drawn in place here (a
// portal draws nothing on the server); e2e/users/rename.spec.ts renames a
// throwaway account in the browser.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ renameUser: vi.fn() }));
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

import { RenameDialog } from "./rename-dialog";

/** What React draws for `<form action={fn}>` on the server: such a form is reset after every action. */
const FUNCTION_ACTION = "React form unexpectedly submitted";

const OLGA = { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Olga Other", fullName: "Olga Other" };

function draw(user: typeof OLGA | { id: string; name: string; fullName: string | null } = OLGA): string {
  return renderToStaticMarkup(<RenameDialog user={user} onClose={() => {}} returnFocusTo={{ current: null }} />);
}

/** The text input, and the label that names it. */
function nameField(html: string) {
  const input = html.match(/<input(?![^>]*type="hidden")[^>]*>/)?.[0] ?? "";
  const id = input.match(/\sid="([^"]+)"/)?.[1];
  const label = id ? html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`))?.[1] : undefined;
  return { input, label };
}

describe("RenameDialog", () => {
  it("is titled for the person, with one field, Name, filled with their name", () => {
    const html = draw();
    expect(html).toContain(">Change Olga Other&#x27;s Name</div>");
    expect(html).toContain("The app shows the new name wherever it names them, their inspections included.");
    const { input, label } = nameField(html);
    expect(label).toBe("Name");
    expect(input).toContain('name="fullName"');
    expect(input).toContain('value="Olga Other"');
    // Names are no words to correct, and start with capitals.
    expect(input).toContain('autoCorrect="off"');
    expect(input).toContain('autoCapitalize="words"');
    expect(html.match(/<input(?![^>]*type="hidden")/g)).toHaveLength(1);
  });

  it("sends the person's id with the name", () => {
    expect(draw()).toContain(`<input type="hidden" name="userId" value="${OLGA.id}"/>`);
  });

  it("starts empty for someone with no name yet: never their email", () => {
    const html = draw({ id: OLGA.id, name: "olga@test.local", fullName: null });
    expect(nameField(html).input).toContain('value=""');
    expect(html).toContain(">Change olga@test.local&#x27;s Name</div>");
  });

  it("offers Save and Cancel, and submits by hand, so a refused name stays in the field", () => {
    const html = draw();
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>Save<\/button>/);
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>Cancel<\/button>/);
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    // No error until the server refuses a name.
    expect(nameField(html).input).not.toMatch(/\saria-invalid=/);
    expect(html).not.toContain('role="alert"');
  });
});
