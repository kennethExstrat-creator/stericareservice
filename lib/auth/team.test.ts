import { afterEach, describe, expect, it, vi } from "vitest";
import {
  anotherLeadExists,
  checkLead,
  isMissingTeamColumn,
  loadTeam,
  personName,
  readPerson,
  teamOf,
  teamsReady,
} from "./team";

const LEAD = "0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d";
const MEMBER = "5f6e7d8c-9b0a-4c1d-8e2f-3a4b5c6d7e8f";

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

/** A fake Supabase client: each query records its chain and resolves to the responder's answer. */
function fakeClient(respond: (query: Query) => Result) {
  const queries: Query[] = [];
  const client = {
    from(table: string) {
      const query: Query = { table, calls: [] };
      queries.push(query);
      const builder: Record<string, unknown> = {};
      for (const method of ["select", "eq", "limit"]) {
        builder[method] = (...args: unknown[]) => {
          query.calls.push([method, args]);
          return builder;
        };
      }
      builder.maybeSingle = () => Promise.resolve(respond(query));
      builder.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
        Promise.resolve(respond(query)).then(resolve, reject);
      return builder;
    },
  };
  return { client: client as never, queries };
}

const selected = (query: Query) => String(query.calls.find(([name]) => name === "select")?.[1][0] ?? "");
const MISSING = { code: "42703", message: "column profiles.is_lead does not exist" };

const lina = { id: LEAD, email: "lina@test.local", full_name: "Lina Lead", role: "inspector", active: true, is_lead: true, lead_id: null };

afterEach(() => vi.restoreAllMocks());

describe("isMissingTeamColumn", () => {
  it("recognises a project without the lead inspector columns, in a read and in a write", () => {
    expect(isMissingTeamColumn(MISSING)).toBe(true);
    expect(isMissingTeamColumn({ code: "PGRST204", message: "Could not find the 'lead_id' column of 'profiles' in the schema cache" })).toBe(true);
    expect(isMissingTeamColumn({ code: "42703", message: "column profiles.colour does not exist" })).toBe(false);
    expect(isMissingTeamColumn({ code: "42501", message: "permission denied" })).toBe(false);
    expect(isMissingTeamColumn(null)).toBe(false);
  });
});

describe("readPerson", () => {
  it("reads someone with their place in the teams", async () => {
    const { client } = fakeClient(() => ({ data: lina, error: null }));
    expect(await readPerson(client, LEAD)).toEqual({ teams: true, person: lina, error: null });
  });

  it("falls back to the role only on a project without teams, and says so", async () => {
    const { client, queries } = fakeClient((query) =>
      selected(query).includes("is_lead")
        ? { data: null, error: MISSING }
        : { data: { id: LEAD, email: "lina@test.local", full_name: "Lina Lead", role: "inspector", active: true }, error: null },
    );
    expect(await readPerson(client, LEAD)).toEqual({
      teams: false,
      person: { id: LEAD, email: "lina@test.local", full_name: "Lina Lead", role: "inspector", active: true, is_lead: false, lead_id: null },
      error: null,
    });
    expect(queries).toHaveLength(2);
  });

  it("passes any other error on", async () => {
    const failure = { code: "57014", message: "statement timeout" };
    const { client } = fakeClient(() => ({ data: null, error: failure }));
    expect(await readPerson(client, LEAD)).toEqual({ teams: true, person: null, error: failure });
  });
});

describe("teamsReady", () => {
  it("says whether the project has the lead inspector columns", async () => {
    expect(await teamsReady(fakeClient(() => ({ data: [], error: null })).client)).toEqual({ ready: true, error: null });
    expect(await teamsReady(fakeClient(() => ({ data: null, error: MISSING })).client)).toEqual({ ready: false, error: null });
  });
});

describe("checkLead", () => {
  it("accepts an active lead inspector who is someone else, by name", async () => {
    const { client } = fakeClient(() => ({ data: lina, error: null }));
    expect(await checkLead(client, LEAD, MEMBER)).toEqual({ ok: true, name: "Lina Lead" });
  });

  it("refuses the person themselves without asking the database", async () => {
    const { client, queries } = fakeClient(() => ({ data: lina, error: null }));
    expect(await checkLead(client, LEAD, LEAD)).toEqual({
      ok: false,
      message: "Nobody can be their own lead inspector. Choose someone else.",
    });
    expect(queries).toHaveLength(0);
  });

  it.each([
    ["deactivated", { ...lina, active: false }],
    ["no longer a lead", { ...lina, is_lead: false }],
    ["an admin", { ...lina, role: "admin", is_lead: false }],
  ])("refuses a lead inspector who is %s, by name", async (_case, row) => {
    const { client } = fakeClient(() => ({ data: row, error: null }));
    expect(await checkLead(client, LEAD, MEMBER)).toEqual({
      ok: false,
      message: "Lina Lead is not an active lead inspector any more. Choose another lead inspector.",
    });
  });

  it("refuses someone who cannot be found", async () => {
    const { client } = fakeClient(() => ({ data: null, error: null }));
    expect(await checkLead(client, LEAD, MEMBER)).toMatchObject({ ok: false, message: expect.stringContaining("could not be found") });
  });
});

describe("anotherLeadExists", () => {
  it("looks for active lead inspectors, two at most", async () => {
    const { client, queries } = fakeClient(() => ({ data: [{ id: LEAD }], error: null }));
    expect(await anotherLeadExists(client, MEMBER)).toEqual({ exists: true, error: null });
    expect(queries[0].calls).toEqual([
      ["select", ["id"]],
      ["eq", ["role", "inspector"]],
      ["eq", ["is_lead", true]],
      ["eq", ["active", true]],
      ["limit", [2]],
    ]);
  });

  it("finds nobody when there is no lead inspector, or only the person themselves", async () => {
    expect(await anotherLeadExists(fakeClient(() => ({ data: [], error: null })).client, null)).toEqual({ exists: false, error: null });
    const onlyThem = fakeClient(() => ({ data: [{ id: LEAD }], error: null })).client;
    expect(await anotherLeadExists(onlyThem, LEAD)).toEqual({ exists: false, error: null });
    const another = fakeClient(() => ({ data: [{ id: LEAD }, { id: MEMBER }], error: null })).client;
    expect(await anotherLeadExists(another, LEAD)).toEqual({ exists: true, error: null });
  });

  it("passes a failed read on", async () => {
    const failure = { code: "57014", message: "statement timeout" };
    expect(await anotherLeadExists(fakeClient(() => ({ data: null, error: failure })).client, null)).toEqual({
      exists: false,
      error: failure,
    });
  });
});

describe("teamOf and loadTeam", () => {
  const members = [
    { id: "b", full_name: "Olga Other", email: "olga@test.local", active: true },
    { id: "a", full_name: null, email: "ivan@test.local", active: false },
  ];

  it("lists a lead's team by name, filtered on lead_id", async () => {
    const { client, queries } = fakeClient(() => ({ data: members, error: null }));
    expect(await teamOf(client, LEAD)).toEqual({
      members: [
        { id: "a", name: "ivan@test.local", email: "ivan@test.local", active: false },
        { id: "b", name: "Olga Other", email: "olga@test.local", active: true },
      ],
      error: null,
    });
    expect(queries[0].calls).toContainEqual(["eq", ["lead_id", LEAD]]);
  });

  it("loads the team for a lead inspector's own screens only", async () => {
    const { client, queries } = fakeClient(() => ({ data: members, error: null }));
    expect(await loadTeam(client, { id: LEAD, role: "inspector", isLead: true })).toHaveLength(2);
    expect(await loadTeam(client, { id: MEMBER, role: "inspector" })).toEqual([]);
    expect(await loadTeam(client, { id: MEMBER, role: "admin" })).toEqual([]);
    expect(queries).toHaveLength(1);
  });

  it("shows an empty team rather than failing a screen", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { client } = fakeClient(() => ({ data: null, error: { message: "timeout" } }));
    expect(await loadTeam(client, { id: LEAD, role: "inspector", isLead: true })).toEqual([]);
  });
});

it("names people by full name, then email", () => {
  expect(personName({ full_name: " Lina Lead ", email: "lina@test.local" })).toBe("Lina Lead");
  expect(personName({ full_name: null, email: "lina@test.local" })).toBe("lina@test.local");
  expect(personName(null)).toBe("This user");
});
