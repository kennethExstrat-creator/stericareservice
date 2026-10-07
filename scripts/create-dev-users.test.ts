// scripts/create-dev-users.mts started as a script, as npm runs it, against a
// local server that stands in for Supabase Auth and the profiles table and
// records every request. It keeps the one database rule the order depends on
// (a lead_id names an active lead inspector, the org_guard trigger), so the
// lead inspector must come before their inspector. The child gets only the
// variables given here, so it never sees .env.local or a real project.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./create-dev-users.mts", import.meta.url));

type Request = { method: string; path: string; query: URLSearchParams; body: Record<string, unknown> | null };
type AuthUser = { id: string; email: string; user_metadata: Record<string, unknown>; banned_until: string | null };
type Profile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "inspector" | "admin";
  active: boolean;
  is_lead: boolean;
  lead_id: string | null;
};

const requests: Request[] = [];
const users = new Map<string, AuthUser>();
const profiles = new Map<string, Profile>();
/** A project that has not run migration 20261007170000. */
let teamsMissing = false;
let server: Server;
let supabaseUrl: string;

/** An account made outside the script, as Auth and the sign-up trigger would make it. */
function addAccount(email: string, profile: Partial<Profile> = {}): string {
  const id = randomUUID();
  users.set(id, { id, email, user_metadata: {}, banned_until: null });
  profiles.set(id, { id, email, full_name: null, role: "inspector", active: false, is_lead: false, lead_id: null, ...profile });
  return id;
}

beforeAll(async () => {
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const url = new URL(request.url ?? "/", "http://localhost");
      const body = text ? (JSON.parse(text) as Record<string, unknown>) : null;
      requests.push({ method: request.method ?? "", path: url.pathname, query: url.searchParams, body });
      const reply = (status: number, value: unknown, headers: Record<string, string> = {}) => {
        response.writeHead(status, { "content-type": "application/json", ...headers });
        response.end(JSON.stringify(value));
      };
      const route = `${request.method} ${url.pathname}`;
      const userPath = /^\/auth\/v1\/admin\/users\/([^/]+)$/.exec(url.pathname);

      if (route === "GET /auth/v1/admin/users") {
        return reply(200, { users: [...users.values()], aud: "authenticated" }, { "x-total-count": String(users.size) });
      }
      if (route === "POST /auth/v1/admin/users") {
        const email = String(body?.email);
        const id = addAccount(email, { full_name: String((body?.user_metadata as { full_name?: string })?.full_name ?? "") || null });
        Object.assign(users.get(id)!, { user_metadata: body?.user_metadata ?? {} });
        return reply(200, users.get(id));
      }
      if (request.method === "PUT" && userPath) {
        const user = users.get(userPath[1]);
        if (!user) return reply(404, { code: "user_not_found", message: "User not found" });
        user.user_metadata = { ...user.user_metadata, ...(body?.user_metadata as object) };
        if (body?.ban_duration === "none") user.banned_until = null;
        return reply(200, user);
      }
      if (route === "GET /rest/v1/profiles") {
        if (teamsMissing && url.searchParams.get("select")?.includes("is_lead")) {
          return reply(400, { code: "42703", message: "column profiles.is_lead does not exist", details: null, hint: null });
        }
        return reply(200, [...profiles.values()].slice(0, 1).map((profile) => ({ is_lead: profile.is_lead })));
      }
      if (route === "PATCH /rest/v1/profiles") {
        const id = url.searchParams.get("id")?.replace(/^eq\./, "") ?? "";
        const profile = profiles.get(id);
        if (!profile) return reply(200, []);
        const leadId = body?.lead_id as string | null | undefined;
        const lead = leadId ? profiles.get(leadId) : null;
        if (leadId && leadId !== profile.lead_id && !(lead?.active && lead.is_lead && lead.role === "inspector")) {
          return reply(400, { code: "23514", message: "the lead inspector must be an active lead inspector", details: null, hint: null });
        }
        Object.assign(profile, body);
        return reply(200, [{ id }]);
      }
      reply(404, { message: `Not part of this stand-in: ${route}` });
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  supabaseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
});

beforeEach(() => {
  requests.length = 0;
  users.clear();
  profiles.clear();
  teamsMissing = false;
});

function createDevUsers(args: string[] = [], url = supabaseUrl) {
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH ?? "",
    NEXT_PUBLIC_SUPABASE_URL: url,
    SUPABASE_SECRET_KEY: "sb_secret_stand_in",
  };
  return new Promise<{ code: number | string | null | undefined; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env }, (error, stdout, stderr) => {
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

const profileOf = (email: string) => [...profiles.values()].find((profile) => profile.email === email);
const writes = () => requests.filter((request) => request.method !== "GET");

describe("npm run seed:dev-users", () => {
  it("creates the lead inspector first, then the inspector in their team, then the admin", async () => {
    const { code, stdout, stderr } = await createDevUsers();
    expect(stderr).toBe("");
    expect(code).toBe(0);

    const lead = profileOf("lead@test.local")!;
    expect(lead).toMatchObject({ full_name: "Ngan Boon Keat", role: "inspector", is_lead: true, lead_id: null, active: true });
    expect(profileOf("inspector@test.local")).toMatchObject({
      full_name: "Test Inspector",
      role: "inspector",
      is_lead: false,
      lead_id: lead.id,
      active: true,
    });
    expect(profileOf("admin@test.local")).toMatchObject({ full_name: "Test Admin", role: "admin", is_lead: false, lead_id: null, active: true });

    // Each account through the Auth admin API, with its name, then its profile.
    expect(writes().map((request) => `${request.method} ${request.body?.email ?? request.query.get("id")}`)).toEqual([
      "POST lead@test.local",
      `PATCH eq.${lead.id}`,
      "POST inspector@test.local",
      `PATCH eq.${profileOf("inspector@test.local")!.id}`,
      "POST admin@test.local",
      `PATCH eq.${profileOf("admin@test.local")!.id}`,
    ]);
    const created = requests.find((request) => request.method === "POST" && request.body?.email === "lead@test.local");
    expect(created?.body).toEqual({
      email: "lead@test.local",
      password: "SteriCare-dev-2026",
      email_confirm: true,
      user_metadata: { full_name: "Ngan Boon Keat" },
    });

    expect(stdout).toBe(
      [
        "lead@test.local        lead inspector  ready",
        "inspector@test.local   inspector       ready, in Ngan Boon Keat's team",
        "admin@test.local       admin           ready",
        "",
        "Password for every account: SteriCare-dev-2026",
        "",
      ].join("\n"),
    );
  }, 30_000);

  it("run again, recreates the same state on the accounts it finds, and leaves the rest of the team alone", async () => {
    await createDevUsers();
    const first = structuredClone([...profiles.values()]);
    const lead = profileOf("lead@test.local")!;
    // Changed since: a leftover e2e account in the lead's team, the inspector out of it, the lead deactivated and banned.
    const leftover = addAccount("e2e-finaldata-abc123@test.local", { active: true, lead_id: lead.id, full_name: "Leftover" });
    Object.assign(profileOf("inspector@test.local")!, { lead_id: null, full_name: "Renamed" });
    Object.assign(profileOf("lead@test.local")!, { active: false });
    users.get(lead.id)!.banned_until = "2126-01-01T00:00:00Z";
    requests.length = 0;

    const { code } = await createDevUsers();

    expect(code).toBe(0);
    expect(writes().filter((request) => request.method === "POST")).toEqual([]);
    expect(writes().filter((request) => request.method === "PUT").map((request) => request.body)).toEqual(
      ["Ngan Boon Keat", "Test Inspector", "Test Admin"].map((fullName) => ({
        password: "SteriCare-dev-2026",
        email_confirm: true,
        ban_duration: "none",
        user_metadata: { full_name: fullName },
      })),
    );
    expect(users.get(lead.id)!.banned_until).toBeNull();
    expect([...profiles.values()].filter((profile) => profile.id !== leftover)).toEqual(first);
    expect(profiles.get(leftover)).toMatchObject({ lead_id: lead.id, full_name: "Leftover" });
  }, 30_000);

  it("refuses a project that is not local without --force, before sending anything", async () => {
    const { code, stderr } = await createDevUsers([], "https://abcdefghijklmnop.supabase.co");
    expect(code).toBe(1);
    expect(stderr).toContain("Refusing to create test accounts with a known password on abcdefghijklmnop.supabase.co.");
    expect(stderr).toContain("Re-run with --force only if this is a development project, never production.");
    expect(requests).toEqual([]);
  }, 30_000);

  it("stops before changing anything on a project without lead inspectors", async () => {
    teamsMissing = true;
    const { code, stdout, stderr } = await createDevUsers();
    expect(code).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("Apply supabase/migrations/20261007170000_lead_inspectors.sql");
    expect(stderr).toContain("Nothing was changed.");
    expect(writes()).toEqual([]);
  }, 30_000);
});
