// Who reaches /admin/users and its actions, through the real session
// (lib/auth/session.ts) against a fake Supabase: only the built-in Admin
// role. A custom role that sees every inspection is an admin to the database
// (profiles.role) and passes the admin layout, but gets the page's 404 and
// every action's refusal, as an inspector does (migration 20261027150000:
// managing users is no switch a role can have).
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: () => true,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn(() => true) }));
vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/users", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/users")>()),
  getUserDirectory: vi.fn(),
}));

import { getUserDirectory } from "@/lib/auth/users";
import { PERMISSIONS } from "@/lib/auth/permissions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { changeRole, createInviteLink, inviteUser, type ActionResult } from "./actions";
import UsersPage, { generateMetadata } from "./page";

const ME = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const OTHER = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const IDLE: ActionResult = { status: "idle" };

type Level = { role: "admin" | "inspector"; is_lead: boolean };
type Role = { id: string; name: string; built_in: string | null; access: string; permissions: string[] };

/**
 * A signed-in, active user at `level` with `role`, as getSession() reads
 * them; null for a role my_role() fails to answer (a passing fault). And
 * what is_full_admin() says.
 */
function signedIn(level: Level, role: Role | null, fullAdmin = role?.built_in === "admin") {
  const profile = {
    select: () => profile,
    eq: () => profile,
    maybeSingle: () => Promise.resolve({ data: { full_name: "Quinn", email: "quinn@test.local", joined_at: "2026-10-27T00:00:00Z" }, error: null }),
  };
  const answers: Record<string, { data: unknown; error: unknown }> = {
    my_profile_status: { data: [{ active: true, lead_id: null, ...level }], error: null },
    my_role: role ? { data: [role], error: null } : { data: null, error: { code: "57014", message: "statement timeout" } },
    is_full_admin: { data: fullAdmin, error: null },
  };
  const rpc = vi.fn((name: string) => Promise.resolve(answers[name] ?? { data: null, error: null }));
  vi.mocked(createClient).mockResolvedValue({
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: ME, email: "quinn@test.local" } }, error: null }) },
    rpc,
    from: vi.fn(() => profile),
  } as never);
  return rpc;
}

const ALL = [...PERMISSIONS];
const REVIEWER: Role = { id: "44444444-4444-4444-8444-444444444444", name: "QA Reviewer", built_in: null, access: "all", permissions: ALL };
const ADMIN: Role = { id: "11111111-1111-4111-8111-111111111111", name: "Admin", built_in: "admin", access: "all", permissions: ALL };
const LEAD: Role = { id: "22222222-2222-4222-8222-222222222222", name: "Lead Inspector", built_in: "lead", access: "team", permissions: [] };

afterEach(() => vi.restoreAllMocks());

const page = () => UsersPage({ params: Promise.resolve({}), searchParams: Promise.resolve({}) } as never);

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

describe("/admin/users for a custom role that sees every inspection, with every switch on", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    signedIn({ role: "admin", is_lead: false }, REVIEWER);
  });

  it("is a 404, its title too, and nobody's details are read", async () => {
    await expect(generateMetadata()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    await expect(page()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(getUserDirectory).not.toHaveBeenCalled();
  });

  it("refuses every action before anything is asked of Supabase Auth", async () => {
    const refused = { status: "error", message: "You do not have permission to do that." };
    expect(await inviteUser(IDLE, form({ email: "jane@example.com", role: REVIEWER.id, delivery: "link" }))).toEqual(refused);
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "admin" }))).toEqual(refused);
    expect(await createInviteLink(IDLE, form({ userId: OTHER }))).toEqual(refused);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refuses them too when the session cannot read the role and stands in Admin for the level: the database is asked", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const rpc = signedIn({ role: "admin", is_lead: false }, null, false);
    expect(await inviteUser(IDLE, form({ email: "jane@example.com", role: "admin", delivery: "link" }))).toEqual({
      status: "error",
      message: "You do not have permission to do that.",
    });
    expect(rpc).toHaveBeenCalledWith("is_full_admin");
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("/admin/users for the other roles", () => {
  beforeEach(() => vi.clearAllMocks());

  it("opens for the built-in Admin role", async () => {
    signedIn({ role: "admin", is_lead: false }, ADMIN);
    expect(await generateMetadata()).toEqual({ title: "Users" });
  });

  it("is a 404 for a lead inspector", async () => {
    signedIn({ role: "inspector", is_lead: true }, LEAD);
    await expect(generateMetadata()).rejects.toMatchObject({ digest: "NEXT_HTTP_ERROR_FALLBACK;404" });
    expect(await changeRole(IDLE, form({ userId: OTHER, role: "lead" }))).toEqual({
      status: "error",
      message: "You do not have permission to do that.",
    });
  });
});
