// Delete Permanently, drawn on the server: as it opens, while the server
// checks what keeps the person; then for each answer: what deleting removes,
// with the box for their UID and Delete Permanently, which waits for it; or
// why they stay, with Close alone. The dialog is drawn in place here (a
// portal draws nothing on the server); e2e/users/delete.spec.ts deletes a
// throwaway account in the browser.
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("../actions", () => ({ checkUserDeletion: vi.fn(), deleteUserPermanently: vi.fn() }));
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

import { checkUserDeletion, type DeletionCheck } from "../actions";
import { DeleteUserDialog, DeleteUserForm } from "./delete-user-dialog";

type Person = { id: string; uid: string | null; name: string; email: string };

const OLGA: Person = { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", uid: "SC-0003", name: "Olga Other", email: "olga@test.local" };
const DELETABLE: DeletionCheck = { status: "deletable" };
const KEPT =
  "SC-0003 cannot be deleted: their name is on 4 inspections and 21 history entries, which QC records keep. They stay deactivated and cannot sign in.";

const noop = () => {};

function draw(
  check: DeletionCheck | null,
  typed = "",
  { user = OLGA, error = null, pending = false }: { user?: Person; error?: string | null; pending?: boolean } = {},
): string {
  return renderToStaticMarkup(
    <DeleteUserForm user={user} check={check} typed={typed} onTyped={noop} error={error} pending={pending} onSubmit={noop} />,
  );
}

/** The title, then the UID beside it, both inside the title row. */
function titleWithUid(title: string, uid: string): RegExp {
  const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(
    `data-slot="title-with-uid"><div>${escaped}</div><span data-slot="uid"[^>]*><span class="sr-only">UID </span>${uid}</span></div>`,
  );
}

/** Delete Permanently, when the dialog has it. */
const deleteButton = (html: string) => html.match(/<button[^>]*type="submit"[^>]*>.*?<\/button>/)?.[0] ?? null;
/** The attribute itself: the button's classes mention disabled: too. */
const DISABLED = 'disabled=""';

/** The box for the UID, and the label that names it. */
function confirmBox(html: string) {
  const input = html.match(/<input(?![^>]*type="hidden")[^>]*name="confirm"[^>]*>/)?.[0] ?? null;
  const id = input?.match(/\sid="([^"]+)"/)?.[1];
  const label = id ? html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`))?.[1] : undefined;
  return { input, label };
}

describe("DeleteUserDialog", () => {
  it("asks the server first: as it opens it says it is checking, titled for the person, with Keep alone", () => {
    const html = renderToStaticMarkup(<DeleteUserDialog user={OLGA} onClose={noop} returnFocusTo={{ current: null }} />);
    expect(html).toMatch(titleWithUid("Delete Olga Other Permanently?", "SC-0003"));
    expect(html).toContain("Checking whether QC records still name them…");
    expect(html).toContain("<div>Keep</div>");
    // Nothing to confirm yet: no box, no Delete Permanently.
    expect(confirmBox(html).input).toBeNull();
    expect(deleteButton(html)).toBeNull();
    // The check runs in the browser, as the dialog opens: never while drawing it.
    expect(checkUserDeletion).not.toHaveBeenCalled();
  });
});

describe("DeleteUserForm", () => {
  describe("when nothing keeps them", () => {
    it("says what goes for good, asks for their UID, and offers Keep and Delete Permanently, in red", () => {
      const html = draw(DELETABLE);
      expect(html).toMatch(titleWithUid("Delete Olga Other Permanently?", "SC-0003"));
      expect(html).toContain("This removes SC-0003 for good: their login and profile. This cannot be undone.");
      expect(confirmBox(html).label).toBe("Type SC-0003 to Confirm");
      expect(html).toContain("<div>Keep</div>");
      expect(html).not.toContain("<div>Close</div>");
      expect(deleteButton(html)).toMatch(/data-variant="destructive"[^>]*>Delete Permanently<\/button>$/);
      // The form sends the person's id, and what was typed.
      expect(html).toContain(`<input type="hidden" name="userId" value="${OLGA.id}"/>`);
    });

    it("keeps Delete Permanently off until their UID is typed, in any case, spaces around it aside", () => {
      for (const typed of ["", "SC-000", "SC-0004", "Olga Other"]) {
        expect(deleteButton(draw(DELETABLE, typed)), typed).toContain(DISABLED);
      }
      for (const typed of ["SC-0003", "Sc-0003", " sc-0003 "]) {
        expect(deleteButton(draw(DELETABLE, typed)), typed).not.toContain(DISABLED);
      }
      expect(confirmBox(draw(DELETABLE, "SC-00")).input).toContain('value="SC-00"');
    });

    it("takes the box as a UID or an address, never words: nothing filled in, capitalised or corrected", () => {
      const { input } = confirmBox(draw(DELETABLE));
      expect(input).toContain('autoComplete="off"');
      expect(input).toContain('autoCapitalize="none"');
      expect(input).toContain('autoCorrect="off"');
      expect(input).toContain('spellCheck="false"');
    });

    it("asks for their email on a project without UIDs, and names them by their name", () => {
      const html = draw(DELETABLE, "", { user: { ...OLGA, uid: null } });
      expect(html).toContain("This removes Olga Other for good: their login and profile. This cannot be undone.");
      expect(confirmBox(html).label).toBe("Type olga@test.local to Confirm");
      expect(html).not.toContain('data-slot="uid"');
      expect(deleteButton(draw(DELETABLE, "Olga@Test.local", { user: { ...OLGA, uid: null } }))).not.toContain(DISABLED);
      expect(deleteButton(draw(DELETABLE, "SC-0003", { user: { ...OLGA, uid: null } }))).toContain(DISABLED);
    });

    it("says why a deletion failed beside the UID typed, which stays, ready to try again", () => {
      const html = draw(DELETABLE, "SC-0003", { error: "SC-0003 was not deleted: Service unavailable." });
      expect(html).toMatch(/role="alert"[^>]*>.*SC-0003 was not deleted: Service unavailable\./);
      expect(confirmBox(html).input).toContain('value="SC-0003"');
      expect(deleteButton(html)).not.toContain(DISABLED);
    });

    it("shows Deleting… while it runs, with Keep, Delete Permanently and the box held", () => {
      const html = draw(DELETABLE, "SC-0003", { pending: true });
      expect(deleteButton(html)).toMatch(/disabled="".*Deleting…<\/button>$/);
      expect(confirmBox(html).input).toContain('readOnly=""');
    });
  });

  describe("when something keeps them", () => {
    it("says why they stay, with Close alone: no box, no Delete Permanently", () => {
      const html = draw({ status: "refused", message: KEPT });
      expect(html).toMatch(titleWithUid("Delete Olga Other Permanently?", "SC-0003"));
      expect(html).toContain(`<div>${KEPT}</div>`);
      expect(html).toContain("<div>Close</div>");
      expect(html).not.toContain("<div>Keep</div>");
      expect(confirmBox(html).input).toBeNull();
      expect(deleteButton(html)).toBeNull();
      expect(html).not.toContain("This removes");
      expect(html).not.toContain('role="alert"');
    });

    it("says so in an alert when the check could not be made, with Close alone", () => {
      const html = draw({ status: "error", message: "Could not reach the server. Check the connection, then reload the page and try again." });
      expect(html).toContain("<div>Nothing was deleted.</div>");
      expect(html).toMatch(/role="alert"[^>]*>.*Could not reach the server\./);
      expect(html).toContain("<div>Close</div>");
      expect(confirmBox(html).input).toBeNull();
      expect(deleteButton(html)).toBeNull();
    });
  });
});
