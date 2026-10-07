import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/env", () => ({ isSupabaseConfigured: vi.fn(() => true) }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { createClient } from "@/lib/supabase/server";
import { getSession } from "./session";

const USER = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const LEAD = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";

/** A client whose my_profile_status() answers `status` and whose profile row is Ivan's. */
function client(status: unknown[] | null) {
  const profile = {
    select: () => profile,
    eq: () => profile,
    maybeSingle: () => Promise.resolve({ data: { full_name: "Ivan Inspector", email: "ivan@test.local" }, error: null }),
  };
  return {
    auth: { getClaims: vi.fn().mockResolvedValue({ data: { claims: { sub: USER, email: "ivan@test.local" } }, error: null }) },
    rpc: vi.fn().mockResolvedValue({ data: status, error: null }),
    from: vi.fn(() => profile),
  };
}

async function sessionWith(status: unknown[] | null) {
  vi.mocked(createClient).mockResolvedValue(client(status) as never);
  return getSession();
}

// getSession is cached per request with React's cache(); outside a request
// every call runs again, so each test sees its own client.
describe("getSession: the level and the lead", () => {
  beforeEach(() => vi.clearAllMocks());

  it("knows a lead inspector", async () => {
    expect(await sessionWith([{ active: true, role: "inspector", is_lead: true, lead_id: null }])).toEqual({
      status: "active",
      user: { id: USER, email: "ivan@test.local", fullName: "Ivan Inspector", role: "inspector", isLead: true, leadId: null },
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
