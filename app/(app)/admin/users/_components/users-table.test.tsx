// Server-rendered markup of the user list: what each row says, in which
// columns, and how dates read. Interaction is covered by e2e/users and e2e/org.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { UserListItem } from "@/lib/auth/users";

vi.mock("../actions", () => ({
  renameUser: vi.fn(),
  changeRole: vi.fn(),
  assignLead: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  sendPasswordLink: vi.fn(),
  inviteUser: vi.fn(),
}));

import { UsersTable } from "./users-table";

const LEAD_ID = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

const base: Pick<UserListItem, "roleChoice" | "lead" | "team" | "missingLead"> = {
  roleChoice: "inspector",
  lead: null,
  team: [],
  missingLead: false,
};

const USERS: UserListItem[] = [
  {
    ...base,
    id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e",
    email: "admin@test.local",
    fullName: "Test Admin",
    role: "admin",
    roleChoice: "admin",
    status: "active",
    // 17:30 UTC on the 5th is already the 6th in Malaysia.
    createdAt: "2026-10-05T17:30:00Z",
    lastSignInAt: "2026-10-06T01:00:00Z",
    signInBlocked: false,
    isSelf: true,
  },
  {
    ...base,
    id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
    email: "olga@test.local",
    fullName: "Olga Other",
    role: "inspector",
    status: "deactivated",
    createdAt: "2026-09-01T02:00:00Z",
    lastSignInAt: "2026-09-30T02:00:00Z",
    signInBlocked: false,
    isSelf: false,
    lead: { id: LEAD_ID, name: "Lina Lead" },
  },
  {
    ...base,
    id: "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f",
    email: "new@test.local",
    fullName: null,
    role: "inspector",
    status: "pending",
    createdAt: "2026-10-06T03:00:00Z",
    lastSignInAt: null,
    signInBlocked: false,
    isSelf: false,
  },
];

const LEADS: UserListItem[] = [
  {
    ...base,
    id: LEAD_ID,
    email: "lina@test.local",
    fullName: "Lina Lead",
    role: "inspector",
    roleChoice: "lead",
    status: "active",
    createdAt: "2026-10-01T02:00:00Z",
    lastSignInAt: null,
    signInBlocked: false,
    isSelf: false,
    team: [
      { id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Olga Other", active: false },
      { id: "3d4e5f60-7182-4c9d-8e0f-2a3b4c5d6e7f", name: "Ivan Inspector", active: true },
    ],
  },
  {
    ...base,
    id: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
    email: "gail@test.local",
    fullName: "Gail Grandfathered",
    role: "inspector",
    status: "active",
    createdAt: "2026-10-01T02:00:00Z",
    lastSignInAt: null,
    signInBlocked: false,
    isSelf: false,
    missingLead: true,
  },
];

function rows(html: string): string[] {
  return html.split("<tr").slice(2); // drop the text before the table and the header row
}

describe("UsersTable", () => {
  const html = renderToStaticMarkup(<UsersTable users={USERS} showSignIns />);
  const [admin, olga, pending] = rows(html);

  it("names its columns in Title Case, with an accessible caption", () => {
    expect(html).toContain('<caption class="sr-only">Users, their roles, lead inspectors and access</caption>');
    for (const header of ["Name", "Email", "Role", "Lead Inspector", "Status", "Last Signed In", "Added"]) {
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
    expect(pending).toContain("Pending Activation");
    for (const row of [admin, olga, pending]) expect(row).toMatch(/<svg[^>]*aria-hidden="true"/);
  });

  it("dates rows in Malaysian time, and says Never for no sign-in", () => {
    expect(admin).toContain('<time dateTime="2026-10-05T17:30:00Z">6 Oct 2026</time>');
    expect(admin).toContain('<time dateTime="2026-10-06T01:00:00Z">6 Oct 2026</time>');
    expect(pending).toContain(">Never</span>");
  });

  it("puts the date added under the name where the Added column drops out (below 1024 px)", () => {
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden lg:table-cell[^"]*"[^>]*>Added<\/th>/);
    expect(admin).toContain(
      '<span class="text-muted-foreground lg:hidden">Added <time dateTime="2026-10-05T17:30:00Z">6 Oct 2026</time></span>',
    );
    expect(pending).toContain('lg:hidden">Added <time dateTime="2026-10-06T03:00:00Z">6 Oct 2026</time></span>');
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

  it("flags an active account whose sign-in Supabase still blocks", () => {
    const blocked = renderToStaticMarkup(<UsersTable users={[{ ...USERS[1], status: "active", signInBlocked: true }]} showSignIns />);
    expect(blocked).toContain("Sign-In Blocked");
    expect(html).not.toContain("Sign-In Blocked");
  });

  it("drops the sign-in column when sign-in details are unavailable", () => {
    const withoutSignIns = renderToStaticMarkup(<UsersTable users={USERS} showSignIns={false} />);
    expect(withoutSignIns).not.toContain(">Last Signed In</th>");
    expect(withoutSignIns).not.toContain(">Never</span>");
  });
});

describe("UsersTable: lead inspectors and their teams", () => {
  const html = renderToStaticMarkup(<UsersTable users={[...USERS, ...LEADS]} showSignIns />);
  const [admin, olga, , lina, gail] = rows(html);

  it("says Inspector, Lead Inspector or Admin", () => {
    expect(admin).toMatch(/data-role="admin"[^>]*>.*Admin<\/span>/);
    expect(lina).toMatch(/data-role="lead"[^>]*>.*Lead Inspector<\/span>/);
    expect(olga).toMatch(/data-role="inspector"[^>]*>.*Inspector<\/span>/);
  });

  it("links an inspector's lead to that team, and a lead's team size to the team", () => {
    expect(olga).toContain(`href="/admin/users?team=${LEAD_ID}"`);
    expect(olga).toContain('aria-label="Lina Lead: show their team"');
    expect(lina).toContain(`href="/admin/users?team=${LEAD_ID}"`);
    expect(lina).toContain(">Leads 2 inspectors</a>");
  });

  it("flags an active inspector in no team", () => {
    expect(gail).toContain('data-slot="no-lead"');
    expect(gail).toContain("No Lead Inspector");
    expect(olga).not.toContain("No Lead Inspector");
  });

  it("shows admins in no team", () => {
    expect(admin).toContain('<span class="sr-only">In no team</span>');
  });

  it("puts the lead under the role below 1024 px, where the column drops out", () => {
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden lg:table-cell[^"]*"[^>]*>Lead Inspector<\/th>/);
    expect(olga).toMatch(/data-slot="team-under-role">Lead: <a/);
    expect(admin).not.toContain('data-slot="team-under-role"');
  });

  it("has no team column on a project without lead inspectors", () => {
    const withoutTeams = renderToStaticMarkup(<UsersTable users={USERS} showSignIns teams={false} />);
    expect(withoutTeams).not.toContain(">Lead Inspector</th>");
    expect(withoutTeams).not.toContain("team-under-role");
  });

  it("says so when a filter leaves nobody", () => {
    const empty = renderToStaticMarkup(<UsersTable users={[]} showSignIns emptyMessage="Every active inspector has a lead inspector." />);
    expect(empty).toMatch(/<td[^>]*colSpan="8"[^>]*>Every active inspector has a lead inspector\.<\/td>/);
  });
});
