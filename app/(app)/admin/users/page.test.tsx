// The page's own states, rendered on the server: the ones the shared live
// database cannot show (only one account, Supabase Auth down, no secret key,
// a project without lead inspectors, a team filter).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UserDirectory, UserListItem } from "@/lib/auth/users";

vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/auth/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/users")>()),
  getUserDirectory: vi.fn(),
}));
vi.mock("./actions", () => ({
  inviteUser: vi.fn(),
  editUserDetails: vi.fn(),
  changeRole: vi.fn(),
  assignLead: vi.fn(),
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  sendPasswordLink: vi.fn(),
  resendInvite: vi.fn(),
  createInviteLink: vi.fn(),
  cancelInvite: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));

import { requirePermission } from "@/lib/auth/session";
import { getUserDirectory } from "@/lib/auth/users";
import { ADMIN, INSPECTOR, LEAD as LEAD_ROLE, REVIEWER, ROLES } from "./_lib/roles.testing";
import UsersPage, { generateMetadata } from "./page";

const ME = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const LEAD = "1b2c3d4e-5f60-4a7b-8c9d-0e1f2a3b4c5d";

const me: UserListItem = {
  id: ME,
  uid: "SC-0001",
  email: "admin@test.local",
  fullName: "Test Admin",
  phone: null,
  role: ADMIN,
  status: "active",
  joined: true,
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
  uid: "SC-0003",
  email: "lina@test.local",
  fullName: "Lina Lead",
  role: LEAD_ROLE,
  isSelf: false,
  team: [{ id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", name: "Olga Other", active: true }],
};
const olga: UserListItem = {
  ...me,
  id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
  uid: "SC-0002",
  email: "olga@test.local",
  fullName: "Olga Other",
  phone: "+60 12-345 6789",
  role: INSPECTOR,
  isSelf: false,
  lead: { id: LEAD, name: "Lina Lead" },
};
const gail: UserListItem = {
  ...olga,
  id: "2c3d4e5f-6071-4b8c-9d0e-1f2a3b4c5d6e",
  uid: "SC-0004",
  email: "gail@test.local",
  fullName: "Gail Grandfathered",
  lead: null,
  missingLead: true,
};

const directory = (overrides: Partial<UserDirectory>): UserDirectory => ({
  users: [me, olga],
  adminApi: "ok",
  teams: true,
  uids: true,
  leads: [{ id: LEAD, name: "Lina Lead", teamSize: 1 }],
  roles: [...ROLES],
  ...overrides,
});

async function render(value: UserDirectory, query: Record<string, string> = {}): Promise<string> {
  vi.mocked(getUserDirectory).mockResolvedValue(value);
  return renderToStaticMarkup(await UsersPage({ params: Promise.resolve({}), searchParams: Promise.resolve(query) }));
}

/** The header's Invite User button, or null. */
function inviteButton(html: string): string | null {
  return html.match(/<button[^>]*>(?:(?!<\/button>).)*Invite User<\/button>/)?.[0] ?? null;
}

/** The table's body rows. */
const bodyRows = (html: string) => html.split("<tbody")[1]?.split("<tr").slice(1) ?? [];

describe("/admin/users", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  it("names the page only for someone who may manage users: the built-in Admin role", async () => {
    expect(await generateMetadata()).toEqual({ title: "Users" });
    expect(requirePermission).toHaveBeenCalledExactlyOnceWith("users");
  });

  it("names nothing for anyone else: the 404 from requirePermission() wins over the title", async () => {
    // Next resolves metadata apart from the page, so a static title would
    // still say "Users" on an inspector's 404, or a custom role's that sees every inspection.
    const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    vi.mocked(requirePermission).mockRejectedValue(notFound);
    await expect(generateMetadata()).rejects.toBe(notFound);
    await expect(render(directory({}))).rejects.toBe(notFound);
    expect(getUserDirectory).not.toHaveBeenCalled();
  });

  it("checks the users permission first and lists the directory for that admin", async () => {
    const html = await render(directory({}));

    expect(requirePermission).toHaveBeenCalledExactlyOnceWith("users");
    expect(getUserDirectory).toHaveBeenCalledWith(ME);
    expect(html).toContain("Olga Other");
    expect(inviteButton(html)).not.toMatch(/disabled=""/);
    expect(html).not.toMatch(/Invites are switched off/i);
    expect(html).not.toMatch(/Only you so far/i);
  });

  it("switches invites off and says why without the secret key", async () => {
    const html = await render(directory({ adminApi: "missing-key" }));

    expect(html).toContain("Invites Are Switched Off");
    expect(html).toContain("SUPABASE_SECRET_KEY");
    expect(inviteButton(html)).toMatch(/disabled=""/);
    // Without sign-in details there is no last sign-in column.
    expect(html).not.toContain(">Last Signed In</th>");
  });

  it("explains when Supabase Auth did not answer, and still lists everyone", async () => {
    const html = await render(directory({ adminApi: "failed" }));

    expect(html).toContain("Sign-In Details Are Unavailable");
    expect(html).toContain("Olga Other");
    expect(inviteButton(html)).not.toMatch(/disabled=""/);
  });

  it("invites the first user when the admin is alone", async () => {
    const html = await render(directory({ users: [me], leads: [] }));

    expect(html).toContain("Only You So Far");
    expect(html).toContain("Invite Your First User");
  });

  it("does not offer the first invite when invites are off", async () => {
    const html = await render(directory({ users: [me], adminApi: "missing-key", leads: [] }));

    expect(html).toContain("Only You So Far");
    expect(html).not.toContain("Invite Your First User");
  });
});

describe("/admin/users: lead inspectors and teams", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  it("shows the team column and the Team picker", async () => {
    const html = await render(directory({ users: [me, lina, olga] }));
    expect(html).toContain(">Lead Inspector</th>");
    expect(html).toContain(">Team</label>");
    expect(html).toContain('role="status">3 people.</p>');
    expect(html).not.toContain('data-testid="no-lead-alert"');
  });

  it("lists active inspectors in no team as a problem to fix, with a way to see only them", async () => {
    const html = await render(directory({ users: [me, olga, gail] }));
    const alert = html.slice(html.indexOf('data-testid="no-lead-alert"'));
    expect(alert).toContain("1 Inspector Has No Lead Inspector");
    expect(alert).toContain("Gail Grandfathered works in no team, so no lead inspector sees their inspections.");
    // The menu item it names, as the menu says it.
    expect(alert).toContain("Choose Change Lead Inspector next to their name.");
    // On its own line, and 44 px tall on touch (docs/DESIGN.md, Density): e2e/org measures it.
    const link = alert.match(/<a[^>]*href="\/admin\/users\?team=none"[^>]*>/)?.[0] ?? "";
    expect(link).toMatch(/touch:inline-flex touch:min-h-11 touch:items-center/);
    expect(alert).toMatch(/<p><a[^>]*>Show Them<\/a><\/p>/);

    const two = await render(directory({ users: [me, olga, gail, { ...gail, id: "4e5f6071-8293-4d0e-9f1a-3b4c5d6e7f80", fullName: "Gus" }] }));
    expect(two.slice(two.indexOf('data-testid="no-lead-alert"'))).toMatch(/<p><a[^>]*>Show Only Them<\/a><\/p>/);
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

  it("keeps the search in the team picked, and says how many of the team it leaves", async () => {
    const html = await render(directory({ users: [me, lina, olga, gail] }), { team: LEAD, q: "olga" });
    const rows = bodyRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain("Olga Other");
    expect(html).toContain('role="status">Lina Lead&#x27;s team: 1 of 2 people.</p>');

    const nobody = await render(directory({ users: [me, lina, olga, gail] }), { team: LEAD, q: "gail" });
    expect(nobody).toContain("Nobody in Lina Lead&#x27;s team matches “gail”.");
  });

  it("works with roles only, and says what is needed, on a project without lead inspectors", async () => {
    const html = await render(directory({ teams: false, leads: [] }), { team: LEAD });
    expect(html).toContain('data-testid="teams-missing"');
    expect(html).toContain("Lead Inspectors Are Not Set Up Yet");
    expect(html).toContain("20261007170000_lead_inspectors.sql");
    expect(html).not.toContain(">Lead Inspector</th>");
    expect(html).not.toContain(">Team</label>");
    // The filter is ignored: everyone is listed.
    expect(bodyRows(html)).toHaveLength(2);
  });
});

describe("/admin/users: UIDs and the search", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  /** The search box: its label and its input. */
  function searchBox(html: string) {
    const input = html.match(/<input[^>]*type="search"[^>]*>/)?.[0] ?? "";
    const id = input.match(/\sid="([^"]+)"/)?.[1];
    const label = id ? html.match(new RegExp(`<label[^>]*for="${id}"[^>]*>([^<]*)</label>`))?.[1] : undefined;
    return { input, label };
  }

  it("starts the list with each person's UID, and searches by name, email, phone or UID", async () => {
    const html = await render(directory({ users: [me, lina, olga] }));
    expect(html).toMatch(/<thead[^>]*><tr[^>]*><th[^>]*>UID<\/th>/);
    expect(bodyRows(html).map((row) => row.match(/data-slot="uid"[^>]*>([^<]*)</)?.[1])).toEqual(["SC-0001", "SC-0003", "SC-0002"]);

    const { input, label } = searchBox(html);
    expect(label).toBe("Search");
    expect(input).toContain('placeholder="Name, email, phone or UID"');
    expect(input).toContain('value=""');
    // Nothing to clear yet.
    expect(html).not.toContain('aria-label="Clear Search"');
    expect(html).toContain('role="status">3 people.</p>');
  });

  it("opens with the search in the address, and shows only who it finds, by UID, name, email or phone", async () => {
    for (const q of ["SC-0002", "sc-0002", "olga", "OLGA@test", "012-345 6789", "+60123456789", "345 6789"]) {
      const html = await render(directory({ users: [me, lina, olga] }), { q });
      const rows = bodyRows(html);
      expect(rows, q).toHaveLength(1);
      expect(rows[0], q).toContain("Olga Other");
      expect(html, q).toContain('role="status">1 of 3 people.</p>');
      expect(searchBox(html).input, q).toContain(`value="${q}"`);
      expect(html, q).toContain('aria-label="Clear Search"');
    }
  });

  it("says when the search finds nobody, with Clear Search", async () => {
    const html = await render(directory({ users: [me, lina, olga] }), { q: "SC-9999" });
    const rows = bodyRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('data-slot="no-match"');
    expect(rows[0]).toMatch(/colSpan="10"/);
    expect(rows[0]).toContain("Nobody matches “SC-9999”.");
    expect(rows[0]).toMatch(/<button[^>]*type="button"[^>]*>Clear Search<\/button>/);
    expect(html).toContain('role="status">0 of 3 people.</p>');
  });

  it("has no UID column before the UID migration, and searches names and emails", async () => {
    const before = [me, lina, olga].map((user) => ({ ...user, uid: null }));
    const html = await render(directory({ users: before, uids: false }), { q: "lina" });
    expect(html).not.toContain(">UID</th>");
    expect(html).not.toContain('data-slot="uid"');
    expect(searchBox(html).input).toContain('placeholder="Name, email or phone"');
    expect(bodyRows(html)).toHaveLength(1);
  });
});

describe("/admin/users: invitations not yet answered", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  const zed: UserListItem = {
    ...olga,
    id: "4e5f6071-8293-4d0e-9f1a-3b4c5d6e7f80",
    uid: "SC-0044",
    email: "zed@example.com",
    fullName: null,
    phone: null,
    status: "invited",
    joined: false,
    lastSignInAt: null,
  };

  it("lists someone invited as Invited, by their email, and finds them by it", async () => {
    const html = await render(directory({ users: [me, olga, zed] }), { q: "zed@" });
    const rows = bodyRows(html);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toContain('data-status="invited"');
    expect(rows[0]).toContain(">Invited</span>");
    expect(rows[0]).toContain('aria-label="Actions for zed@example.com"');
  });

  it("tells the admin, when they are the only one, that each invitee creates their own account", async () => {
    const html = await render(directory({ users: [me], leads: [] }));
    expect(html).toContain("Each one creates their account from a link: we email it, or you send it yourself.");
  });
});

describe("/admin/users: roles", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(requirePermission).mockResolvedValue({ id: ME, email: "admin@test.local", fullName: "Test Admin", role: "admin" });
  });

  const quinn: UserListItem = {
    ...olga,
    id: "4e5f6071-8293-4d0e-9f1a-3b4c5d6e7f80",
    uid: "SC-0045",
    email: "quinn@test.local",
    fullName: "Quinn Reviewer",
    phone: null,
    role: REVIEWER,
    lead: null,
  };

  it("names each person's role in the Role column, a custom role by its own name", async () => {
    const html = await render(directory({ users: [me, olga, quinn] }));
    const row = bodyRows(html).find((cells) => cells.includes("Quinn Reviewer")) ?? "";
    expect(row).toMatch(/data-slot="role" data-role="custom" data-access="all"[^>]*>.*QA Reviewer<\/span>/);
    // Every inspection in sight: in no lead inspector's team.
    expect(row).toContain('<span class="sr-only">In no team</span>');
  });
});
