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

describe("InviteUserDialog", () => {
  it("submits by hand, so a refused invite never resets the role", () => {
    const html = renderToStaticMarkup(<InviteUserDialog />);
    expect(html).toContain("<form");
    expect(html).not.toContain(FUNCTION_ACTION);
    // The role is a radio group sent with the form, Inspector to start with.
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/<button[^>]*role="radio"[^>]*aria-checked="true"[^>]*value="inspector"/);
  });
});
