// The page's own states, rendered on the server: the ones the shared live
// database cannot show (only one account, Supabase Auth down, no secret key).
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
  deactivateUser: vi.fn(),
  reactivateUser: vi.fn(),
  sendPasswordLink: vi.fn(),
}));

import { requireAdmin } from "@/lib/auth/session";
import { getUserDirectory } from "@/lib/auth/users";
import UsersPage, { generateMetadata } from "./page";

const ME = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";

const me: UserListItem = {
  id: ME,
  email: "admin@test.local",
  fullName: "Test Admin",
  role: "admin",
  status: "active",
  createdAt: "2026-10-01T00:00:00Z",
  lastSignInAt: "2026-10-06T01:00:00Z",
  signInBlocked: false,
  isSelf: true,
};
const olga: UserListItem = { ...me, id: "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d", email: "olga@test.local", fullName: "Olga Other", role: "inspector", isSelf: false };

async function render(directory: UserDirectory): Promise<string> {
  vi.mocked(getUserDirectory).mockResolvedValue(directory);
  return renderToStaticMarkup(await UsersPage());
}

/** The header's Invite user button, or null. */
function inviteButton(html: string): string | null {
  return html.match(/<button[^>]*>(?:(?!<\/button>).)*Invite user<\/button>/)?.[0] ?? null;
}

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
    const html = await render({ users: [me, olga], adminApi: "ok" });

    expect(requireAdmin).toHaveBeenCalledOnce();
    expect(getUserDirectory).toHaveBeenCalledWith(ME);
    expect(html).toContain("Olga Other");
    expect(inviteButton(html)).not.toMatch(/disabled=""/);
    expect(html).not.toContain("Invites are switched off");
    expect(html).not.toContain("Only you so far");
  });

  it("switches invites off and says why without the secret key", async () => {
    const html = await render({ users: [me, olga], adminApi: "missing-key" });

    expect(html).toContain("Invites are switched off");
    expect(html).toContain("SUPABASE_SECRET_KEY");
    expect(inviteButton(html)).toMatch(/disabled=""/);
    // Without sign-in details there is no last sign-in column.
    expect(html).not.toContain(">Last signed in</th>");
  });

  it("explains when Supabase Auth did not answer, and still lists everyone", async () => {
    const html = await render({ users: [me, olga], adminApi: "failed" });

    expect(html).toContain("Sign-in details are unavailable");
    expect(html).toContain("Olga Other");
    expect(inviteButton(html)).not.toMatch(/disabled=""/);
  });

  it("invites the first user when the admin is alone", async () => {
    const html = await render({ users: [me], adminApi: "ok" });

    expect(html).toContain("Only you so far");
    expect(html).toContain("Invite your first user");
  });

  it("does not offer the first invite when invites are off", async () => {
    const html = await render({ users: [me], adminApi: "missing-key" });

    expect(html).toContain("Only you so far");
    expect(html).not.toContain("Invite your first user");
  });
});
