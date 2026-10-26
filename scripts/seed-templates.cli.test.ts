// scripts/seed-templates.mts started as a script, as npm runs it, against a
// local server that stands in for Supabase and records every request:
// without --apply it only reads, with --apply it writes, and when npm took
// one of its options as its own it stops before sending anything. The child
// gets only the variables given here, so it never sees .env.local or a real
// project.
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const SCRIPT = fileURLToPath(new URL("./seed-templates.mts", import.meta.url));
const POLYCO = "20000000-0000-4000-8000-000000000001";

type Request = { method: string; path: string; body: Record<string, unknown> | null };

const requests: Request[] = [];
let server: Server;
let supabaseUrl: string;

beforeAll(async () => {
  server = createServer((request, response) => {
    let text = "";
    request.on("data", (chunk) => (text += chunk));
    request.on("end", () => {
      const path = new URL(request.url ?? "/", "http://localhost").pathname;
      requests.push({ method: request.method ?? "", path, body: text ? JSON.parse(text) : null });
      const reply = (status: number, body: unknown) => {
        response.writeHead(status, { "content-type": "application/json" });
        response.end(JSON.stringify(body));
      };
      // An empty templates table; Polyco Healthline as supabase/seed.sql adds it.
      if (request.method === "GET" && path === "/rest/v1/clients") return reply(200, [{ id: POLYCO, name: "Polyco Healthline" }]);
      if (request.method === "GET" && path === "/rest/v1/templates") return reply(200, []);
      if (request.method === "POST" && path === "/rest/v1/templates") return reply(201, { id: randomUUID() });
      reply(404, { message: `Not part of this stand-in: ${request.method} ${path}` });
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
});

/** The script with these arguments, and the npm_config_ variables npm would have set. */
function seed(args: string[], npm: Record<string, string> = {}) {
  const env = {
    NODE_ENV: "test" as const,
    PATH: process.env.PATH ?? "",
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
    SUPABASE_SECRET_KEY: "sb_secret_stand_in",
    ...npm,
  };
  return new Promise<{ code: number | string | null | undefined; stdout: string; stderr: string }>((resolve) => {
    execFile(process.execPath, [SCRIPT, ...args], { env }, (error, stdout, stderr) => {
      // The exit code when it failed; a string when it could not start (ENOENT).
      resolve({ code: error ? error.code : 0, stdout, stderr });
    });
  });
}

const inserted = () =>
  requests.filter((request) => request.method === "POST").map((request) => `${request.body?.code} ${request.body?.status}`);

describe("npm run seed:templates", () => {
  it("with no options: a dry run that only reads, and says how to write it", async () => {
    const { code, stdout } = await seed([]);
    expect(code).toBe(0);
    expect(requests.length).toBeGreaterThan(0);
    expect(requests.filter((request) => request.method !== "GET")).toEqual([]);
    expect(stdout).toContain("Seed templates in 127.0.0.1, dry run:");
    expect(stdout).toContain("STD_EG       version 1  to add, active");
    expect(stdout).toContain("To write it: npm run seed:templates -- --apply\n");
  }, 30_000);

  it("-- --apply writes them active, and -- --apply --drafts as drafts", async () => {
    const active = await seed(["--apply"]);
    expect(active.code).toBe(0);
    // SAFEDON_EG is retired (26 October 2026): nothing is active to retire in an empty table.
    expect(inserted()).toEqual(["STD_EG active", "STD_SG active"]);
    expect(active.stdout).toContain("SAFEDON_EG   no longer seeded, nothing active to retire");

    requests.length = 0;
    const drafts = await seed(["--apply", "--drafts"]);
    expect(drafts.code).toBe(0);
    expect(inserted()).toEqual(["STD_EG draft", "STD_SG draft"]);
  }, 30_000);

  it("--drafts -- --apply: npm took --drafts, so it stops before sending anything", async () => {
    const { code, stdout, stderr } = await seed(["--apply"], { npm_config_drafts: "true" });
    expect(code).toBe(1);
    expect(requests).toEqual([]);
    expect(stdout).toBe("");
    expect(stderr).toContain("npm took --drafts as its own option, so the script never saw it. Nothing was written.");
    expect(stderr).toContain("Put the options after the --: npm run seed:templates -- --apply --drafts");
  }, 30_000);
});
