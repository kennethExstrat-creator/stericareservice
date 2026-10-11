import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ getSession: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The framework's test modules, so the results do not move when the real modules land.
vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import type { NextRequest } from "next/server";
import { getSession } from "@/lib/auth/session";
import { createFakeSupabase, type FakeSupabaseOptions } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeInspectionRow, makeObjects, makeTables } from "@/lib/export/__fixtures__/inspection";
import { ExportSchema } from "@/lib/schemas/export";
import { createClient } from "@/lib/supabase/server";
import { GET } from "@/app/api/inspections/[id]/export/route";

type Session = Awaited<ReturnType<typeof getSession>>;

const INSPECTOR: Session = {
  status: "active",
  user: { id: IDS.inspector, email: "inspector@test.local", fullName: "Inspector A", role: "inspector" },
};
const ADMIN: Session = {
  status: "active",
  user: { id: IDS.admin, email: "admin@test.local", fullName: "Admin A", role: "admin" },
};
const OTHER_INSPECTOR: Session = {
  status: "active",
  user: { id: IDS.otherInspector, email: "other@test.local", fullName: "Inspector B", role: "inspector" },
};

function signedInAs(session: Session, options: FakeSupabaseOptions = {}) {
  vi.mocked(getSession).mockResolvedValue(session);
  const fake = createFakeSupabase({ tables: makeTables(), objects: makeObjects(), ...options });
  vi.mocked(createClient).mockResolvedValue(fake.client as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

function get(id: string = IDS.inspection) {
  const request = new Request(`http://localhost/api/inspections/${id}/export`) as unknown as NextRequest;
  return GET(request, { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(getSession).mockReset();
  vi.mocked(createClient).mockReset();
});

describe("GET /api/inspections/[id]/export", () => {
  it("gives the inspector their own inspection as a JSON download that validates", async () => {
    signedInAs(INSPECTOR);
    const response = await get();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/json; charset=utf-8");
    expect(response.headers.get("content-disposition")).toBe('attachment; filename="INS-2026-0042-export.json"');
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(ExportSchema.safeParse(body).success).toBe(true);
    expect(body.refNo).toBe("INS-2026-0042");
  });

  it("gives an admin any inspection", async () => {
    signedInAs(ADMIN);
    expect((await get()).status).toBe(200);
  });

  it("answers 404 to another inspector, as if the inspection did not exist", async () => {
    // Row Level Security would hide the row too; the route checks on its own.
    signedInAs(OTHER_INSPECTOR);
    const response = await get();
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "not_found", message: "Inspection not found." });
  });

  it("answers 404 for an id that is not a UUID or does not exist", async () => {
    signedInAs(ADMIN);
    expect((await get("../../etc")).status).toBe(404);
    expect((await get(IDS.otherInspector)).status).toBe(404);
  });

  it("answers 401 when signed out", async () => {
    vi.mocked(getSession).mockResolvedValue({ status: "signed-out" });
    const response = await get();
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "unauthorized", message: "Sign in to download the export." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("answers 403 to an account that is not active", async () => {
    vi.mocked(getSession).mockResolvedValue({ status: "deactivated", userId: IDS.inspector });
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ error: "forbidden", message: "This account is not active." });
  });

  it("answers 503 when Supabase is not configured or the session cannot be read", async () => {
    vi.mocked(getSession).mockResolvedValue({ status: "unconfigured" });
    expect((await get()).status).toBe(503);

    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(getSession).mockRejectedValue(new Error("rpc down"));
    expect((await get()).status).toBe(503);
  });

  it("answers 503 when the database or Storage does not answer, and 500 when the inspection cannot be exported", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    signedInAs(ADMIN, { failSigning: () => true });
    const outage = await get();
    expect(outage.status).toBe(503);
    expect(await outage.json()).toMatchObject({ error: "unavailable" });

    signedInAs(ADMIN, { tables: { ...makeTables(), inspections: [makeInspectionRow({}, { resolved: { broken: true } })] } });
    const broken = await get();
    expect(broken.status).toBe(500);
    expect(await broken.json()).toMatchObject({ error: "export_failed" });
  });
});
