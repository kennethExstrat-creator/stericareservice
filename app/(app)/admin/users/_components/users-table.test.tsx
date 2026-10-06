// Server-rendered markup of the user list: what each row says, in which
// columns, and how dates read. Interaction is covered by e2e/users.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UserListItem } from "@/lib/auth/users";

vi.mock("../actions", () => ({
  changeRole: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  sendPasswordLink: vi.fn(),
  inviteUser: vi.fn(),
}));

import { UsersTable } from "./users-table";

const USERS: UserListItem[] = [
  {
    id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e",
    email: "admin@test.local",
    fullName: "Test Admin",
    role: "admin",
    status: "active",
    // 17:30 UTC on the 5th is already the 6th in Malaysia.
    createdAt: "2026-10-05T17:30:00Z",
    lastSignInAt: "2026-10-06T01:00:00Z",
    isSelf: true,
  },
  {
    id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    email: "olga@test.local",
    fullName: "Olga Other",
    role: "inspector",
    status: "deactivated",
    createdAt: "2026-09-01T02:00:00Z",
    lastSignInAt: "2026-09-30T02:00:00Z",
    isSelf: false,
  },
  {
    id: "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f",
    email: "new@test.local",
    fullName: null,
    role: "inspector",
    status: "pending",
    createdAt: "2026-10-06T03:00:00Z",
    lastSignInAt: null,
    isSelf: false,
  },
];

function rows(html: string): string[] {
  return html.split("<tr").slice(2); // drop the text before the table and the header row
}

describe("UsersTable", () => {
  const html = renderToStaticMarkup(<UsersTable users={USERS} showSignIns />);
  const [admin, olga, pending] = rows(html);

  it("names its columns, with an accessible caption", () => {
    expect(html).toContain('<caption class="sr-only">Users and their access</caption>');
    for (const header of ["Name", "Email", "Role", "Status", "Last signed in", "Added"]) {
      expect(html).toContain(`>${header}</th>`);
    }
    expect(html).toContain('<span class="sr-only">Actions</span>');
  });

  it("marks the viewer as You", () => {
    expect(admin).toContain(">You</span>");
    expect(olga).not.toContain(">You</span>");
  });

  it("shows each status as an icon and words", () => {
    expect(admin).toMatch(/data-status="active"[^>]*>.*Active<\/span>/);
    expect(olga).toContain("Deactivated");
    expect(pending).toContain("Pending activation");
    for (const row of [admin, olga, pending]) expect(row).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("dates rows in Malaysian time, and says Never for no sign-in", () => {
    expect(admin).toContain('<time dateTime="2026-10-05T17:30:00Z">6 Oct 2026</time>');
    expect(admin).toContain('<time dateTime="2026-10-06T01:00:00Z">6 Oct 2026</time>');
    expect(pending).toContain(">Never</span>");
  });

  it("names a person without a full name by their email, without repeating it under the name", () => {
    // Text nodes only (attributes like the menu's aria-label are not counted).
    expect(pending.match(/>new@test\.local</g)).toHaveLength(2); // the name cell and the email column
    expect(olga.match(/>olga@test\.local</g)).toHaveLength(2); // under the name (below 1280 px) and the email column
  });

  it("gives every row a named actions menu", () => {
    expect(admin).toContain('aria-label="Actions for Test Admin"');
    expect(olga).toContain('aria-label="Actions for Olga Other"');
    expect(pending).toContain('aria-label="Actions for new@test.local"');
  });

  it("drops the sign-in column when sign-in details are unavailable", () => {
    const withoutSignIns = renderToStaticMarkup(<UsersTable users={USERS} showSignIns={false} />);
    expect(withoutSignIns).not.toContain(">Last signed in</th>");
    expect(withoutSignIns).not.toContain(">Never</span>");
  });
});
