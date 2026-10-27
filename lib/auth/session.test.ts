import { beforeEach, describe, expect, it, vi } from "vitest";

// redirect() ends a render by throwing; the stand-in does the same so the
// tests can see where it pointed.
const { Redirect } = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return { Redirect };
});

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
  notFound: () => {
    throw new Error("not found");
  },
}));

import { createClient } from "@/lib/supabase/server";
import { DEACTIVATED_PATH, getSession, hasJoined, requireUser } from "./session";

const USER = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const LEAD = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** Ivan's own profile row, as the select in getSession reads it: he created his account on 27 October. */
const IVAN = { full_name: "Ivan Inspector", email: "ivan@test.local", joined_at: "2026-10-27T06:00:00+00:00" };
const INSPECTOR = [{ active: true, role: "inspector", is_lead: false, lead_id: LEAD }];

type Reply = { data: unknown; error: { code: string; message: string } | null };

/**
 * A client whose my_profile_status() answers `status` and whose profile
 * select answers `profileReplies` in turn (by default Ivan's row). `selects`
 * records the columns each profile select asked for.
 */
function client(status: unknown[] | null, profileReplies: Reply[] = [{ data: IVAN, error: null }]) {
  const replies = [...profileReplies];
  const selects: string[] = [];
  const profile = {
    select: (columns: string) => {
      selects.push(columns);
      return profile;
    },
    eq: () => profile,
    maybeSingle: () => Promise.resolve(replies.shift() ?? { data: null, error: null }),
  };
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: USER, email: "ivan@test.local" } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: status, error: null }),
    from: vi.fn(() => profile),
    selects,
  };
}

async function sessionWith(status: unknown[] | null, profileReplies?: Reply[]) {
  vi.mocked(createClient).mockResolvedValue(client(status, profileReplies) as never);
  return getSession();
}

// getSession is cached per request with React's cache(); outside a request
// every call runs again, so each test sees its own client.
describe("getSession: the level and the lead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("knows a lead inspector", async () => {
    expect(await sessionWith([{ active: true, role: "inspector", is_lead: true, lead_id: null }])).toEqual({
      status: "active",
      user: {
        id: USER,
        email: "ivan@test.local",
        fullName: "Ivan Inspector",
        role: "inspector",
        isLead: true,
        leadId: null,
        joined: true,
      },
    });
  });

  it("knows an inspector's lead", async () => {
    expect(await sessionWith([{ active: true, role: "inspector", is_lead: false, lead_id: LEAD }])).toMatchObject({
      user: { role: "inspector", isLead: false, leadId: LEAD },
    });
  });

  it("never makes an admin a lead, whatever the row says", async () => {
    expect(await sessionWith([{ active: true, role: "admin", is_lead: true, lead_id: LEAD }])).toMatchObject({
      user: { role: "admin", isLead: false, leadId: null },
    });
  });

  it("reads a project without lead inspectors as nobody leading, as before", async () => {
    expect(await sessionWith([{ active: true, role: "inspector" }])).toMatchObject({
      user: { role: "inspector", isLead: false, leadId: null },
    });
  });

  it("still blocks a deactivated lead inspector", async () => {
    expect(await sessionWith([{ active: false, role: "inspector", is_lead: true, lead_id: null }])).toEqual({
      status: "deactivated",
      userId: USER,
    });
  });
});

describe("getSession: joining by invitation (migration 20261027140000)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("knows an invitation not yet answered", async () => {
    const session = await sessionWith(INSPECTOR, [{ data: { ...IVAN, full_name: null, joined_at: null }, error: null }]);
    expect(session).toMatchObject({ status: "active", user: { joined: false, fullName: null } });
  });

  it("knows an account created, from the same select as the name", async () => {
    const supabase = client(INSPECTOR);
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    expect(await getSession()).toMatchObject({ user: { joined: true, fullName: "Ivan Inspector" } });
    expect(supabase.selects).toEqual(["full_name, email, joined_at"]);
  });

  it("counts a profile it cannot read as joined, so nobody is locked out over it", async () => {
    const session = await sessionWith(INSPECTOR, [{ data: null, error: { code: "08006", message: "connection failure" } }]);
    expect(session).toMatchObject({ status: "active", user: { joined: true, fullName: null, email: "ivan@test.local" } });
  });

  it("reads a project without joined_at again without it: everyone has joined, the name stays", async () => {
    const supabase = client(INSPECTOR, [
      { data: null, error: { code: "42703", message: "column profiles.joined_at does not exist" } },
      { data: { full_name: "Ivan Inspector", email: "ivan@test.local" }, error: null },
    ]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    expect(await getSession()).toMatchObject({ user: { joined: true, fullName: "Ivan Inspector" } });
    expect(supabase.selects).toEqual(["full_name, email, joined_at", "full_name, email"]);
  });

  it("does not read again for another missing column", async () => {
    const supabase = client(INSPECTOR, [{ data: null, error: { code: "42703", message: "column profiles.email does not exist" } }]);
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    expect(await getSession()).toMatchObject({ user: { joined: true, fullName: null } });
    expect(supabase.selects).toHaveLength(1);
  });
});

describe("hasJoined", () => {
  it("is false only for an invitation not yet answered; a session without the flag has joined", () => {
    expect(hasJoined({ joined: false })).toBe(false);
    expect(hasJoined({ joined: true })).toBe(true);
    expect(hasJoined({})).toBe(true);
  });
});

describe("requireUser", () => {
  beforeEach(() => vi.clearAllMocks());

  it("sends an invitation not yet answered to Account Creation, wherever it was going", async () => {
    vi.mocked(createClient).mockResolvedValue(client(INSPECTOR, [{ data: { ...IVAN, joined_at: null }, error: null }]) as never);
    await expect(requireUser()).rejects.toMatchObject({ url: "/create-account" });
  });

  it("lets an account that has joined through", async () => {
    vi.mocked(createClient).mockResolvedValue(client(INSPECTOR) as never);
    await expect(requireUser()).resolves.toMatchObject({ id: USER, joined: true });
  });

  it("signs a deactivated account out, joined or not", async () => {
    vi.mocked(createClient).mockResolvedValue(
      client([{ ...INSPECTOR[0], active: false }], [{ data: { ...IVAN, joined_at: null }, error: null }]) as never,
    );
    await expect(requireUser()).rejects.toMatchObject({ url: DEACTIVATED_PATH });
  });

  it("sends a visitor without a session to sign in", async () => {
    const supabase = client(INSPECTOR);
    supabase.auth.getClaims.mockResolvedValue({ data: null, error: new Error("no session") });
    vi.mocked(createClient).mockResolvedValue(supabase as never);
    await expect(requireUser()).rejects.toMatchObject({ url: "/login" });
  });
});
