// The page's own states, rendered on the server: the ones the shared live
// database cannot show (only one account, Supabase Auth down, no secret key,
// a project without lead inspectors, a team filter).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserDirectory, UserListItem } from "@/lib/auth/users";

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/auth/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/users")>()),
  getUserDirectory: vi.fn(),
}));
vi.mock("./actions", () => ({
  inviteUser: vi.fn(),
  changeRole: vi.fn(),
  assignLead: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  sendPasswordLink: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

import { requireAdmin } from "@/lib/auth/session";
import { getUserDirectory } from "@/lib/auth/users";
import UsersPage, { generateMetadata } from "./page";

const ME = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

const me: UserListItem = {
  id: ME,
  email: "admin@test.local",
  fullName: "Test Admin",
  role: "admin",
  roleChoice: "admin",
  status: "active",
  createdAt: "2026-10-01T00:00:00Z",
  lastSignInAt: "2026-10-06T01:00:00Z",
  signInBlocked: false,
  isSelf: true,
  lead: null,
  team: [],
  missingLead: false,
};
const lina: UserListItem = {
  ...me,
  id: LEAD,
  email: "lina@test.local",
  fullName: "Lina Lead",
  role: "inspector",
  roleChoice: "lead",
  isSelf: false,
  team: [{ id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Olga Other", active: true }],
};
const olga: UserListItem = {
  ...me,
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  email: "olga@test.local",
  fullName: "Olga Other",
  role: "inspector",
  roleChoice: "inspector",
  isSelf: false,
  lead: { id: LEAD, name: "Lina Lead" },
};
const gail: UserListItem = {
  ...olga,
  id: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
  email: "gail@test.local",
  fullName: "Gail Grandfathered",
  lead: null,
  missingLead: true,
};

const directory = (overrides: Partial<UserDirectory>): UserDirectory => ({
  users: [me, olga],
  adminApi: "ok",
  teams: true,
  leads: [{ id: LEAD, name: "Lina Lead", teamSize: 1 }],
  ...overrides,
});

async function render(value: UserDirectory, query: Record<string, string> = {}): Promise<string> {
  vi.mocked(getUserDirectory).mockResolvedValue(value);
  return renderToStaticMarkup(await UsersPage({ params: Promise.resolve({}), searchParams: Promise.resolve(query) }));
}

/** The header's Invite user button, or null. */
function inviteButton(html: string): string | null {
  return html.match(/<button[^>]*>(?:(?!<\/button>).)*Invite user<\/button>/)?.[0] ?? null;
}

/** The table's body rows. */
const bodyRows = (html: string) => html.split("<tbody")[1]?.split("<tr").slice(1) ?? [];

describe("/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  it("names the page only for an admin", async () => {
    expect(await generateMetadata()).toEqual({ title: "Users" });
    expect(requireAdmin).toHaveBeenCalledOnce();
  });

  it("names nothing for anyone else: the 404 from requireAdmin() wins over the title", async () => {
    // Next resolves metadata apart from the page, so a static title would
    // still say "Users" on an inspector's 404.
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    vi.mocked(requireAdmin).mockRejectedValue(notFound);
    await expect(generateMetadata()).rejects.toBe(notFound);
  });

  it("checks for an admin first and lists the directory for that admin", async () => {
    const html = await render(directory({}));

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(getUserDirectory).toHaveBeenCalledWith(ME);
    expect(html).toContain("Olga Other");
    expect(inviteButton(html)).not.toMatch(/disabled=""/);
    expect(html).not.toContain("Invites are switched off");
    expect(html).not.toContain("Only you so far");
  });

  it("switches invites off and says why without the secret key", async () => {
    const html = await render(directory({ adminApi: "missing-key" }));

    expect(html).toContain("Invites are switched off");
    expect(html).toContain("SUPABASE_SECRET_KEY");
    expect(inviteButton(html)).toMatch(/disabled=""/);
    // Without sign-in details there is no last sign-in column.
    expect(html).not.toContain(">Last signed in</th>");
  });

  it("explains when Supabase Auth did not answer, and still lists everyone", async () => {
    const html = await render(directory({ adminApi: "failed" }));

    expect(html).toContain("Sign-in details are unavailable");
    expect(html).toContain("Olga Other");
    expect(inviteButton(html)).not.toMatch(/disabled=""/);
  });

  it("invites the first user when the admin is alone", async () => {
    const html = await render(directory({ users: [me], leads: [] }));

    expect(html).toContain("Only you so far");
    expect(html).toContain("Invite your first user");
  });

  it("does not offer the first invite when invites are off", async () => {
    const html = await render(directory({ users: [me], adminApi: "missing-key", leads: [] }));

    expect(html).toContain("Only you so far");
    expect(html).not.toContain("Invite your first user");
  });
});

describe("/admin/users: lead inspectors and teams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requireAdmin).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  it("shows the team column and the Team picker", async () => {
    const html = await render(directory({ users: [me, lina, olga] }));
    expect(html).toContain(">Lead inspector</th>");
    expect(html).toContain(">Team</label>");
    expect(html).toContain('role="status">3 people.</p>');
    expect(html).not.toContain('data-testid="no-lead-alert"');
  });

  it("lists active inspectors in no team as a problem to fix, with a way to see only them", async () => {
    const html = await render(directory({ users: [me, olga, gail] }));
    const alert = html.slice(html.indexOf('data-testid="no-lead-alert"'));
    expect(alert).toContain("1 inspector has no lead inspector");
    expect(alert).toContain("Gail Grandfathered works in no team, so no lead inspector sees their inspections.");
    // On its own line, and 44 px tall on touch (docs/DESIGN.md, Density): e2e/org measures it.
    const link = alert.match(/<a[^>]*href="\/admin\/users\?team=none"[^>]*>/)?.[0] ?? "";
    expect(link).toMatch(/touch:inline-flex touch:min-h-11 touch:items-center/);
    expect(alert).toMatch(/<p><a[^>]*>Show them<\/a><\/p>/);
  });

  it("shows one lead's team, the lead first", async () => {
    const html = await render(directory({ users: [me, lina, olga, gail] }), { team: LEAD });
    const rows = bodyRows(html);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("Lina Lead");
    expect(rows[1]).toContain("Olga Other");
    expect(html).toContain("Lina Lead&#x27;s team: 1 inspector.");
  });

  it("shows only the inspectors in no team, and says when there are none", async () => {
    const withGail = await render(directory({ users: [me, olga, gail] }), { team: "none" });
    expect(bodyRows(withGail)).toHaveLength(1);
    expect(withGail).not.toContain('data-testid="no-lead-alert"');

    const fixed = await render(directory({ users: [me, olga] }), { team: "none" });
    expect(fixed).toContain("Every active inspector has a lead inspector.");
  });

  it("works with roles only, and says what is needed, on a project without lead inspectors", async () => {
    const html = await render(directory({ teams: false, leads: [] }), { team: LEAD });
    expect(html).toContain('data-testid="teams-missing"');
    expect(html).toContain("Lead inspectors are not set up yet");
    expect(html).toContain("20261007170000_lead_inspectors.sql");
    expect(html).not.toContain(">Lead inspector</th>");
    expect(html).not.toContain(">Team</label>");
    // The filter is ignored: everyone is listed.
    expect(bodyRows(html)).toHaveLength(2);
  });
});
