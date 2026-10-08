import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { assignLead, createLead, createPeople, type People } from "./fixtures";
import {
  applyAsOwner,
  asAnon,
  asOwner,
  asService,
  asUser,
  column,
  createAuthUser,
  createTestDb,
  pgError,
  readMigrations,
  schemaSnapshot,
  type Db,
} from "./harness";

// A UID for every user (migration 20261008140000, Kenneth, 8 October 2026):
// SC- and a number, given when the profile is created, in order, never
// changed and never given again.

const MIGRATION = "20261008140000_profile_uid.sql";

async function migration() {
  const file = (await readMigrations()).find(({ name }) => name === MIGRATION);
  if (!file) throw new Error(`${MIGRATION} is not in supabase/migrations`);
  return file;
}

/** The migration just before this one: a project that has not had it yet. */
async function previousMigration(): Promise<string> {
  const names = (await readMigrations()).map(({ name }) => name);
  return names[names.indexOf(MIGRATION) - 1];
}

async function uidOf(db: Db, id: string): Promise<string> {
  const uids = await asOwner(db, (tx) => column<string>(tx, "select uid from public.profiles where id = $1", [id]));
  return uids[0];
}

/** Every profile's id and timestamps, as stored. */
async function saves(db: Db) {
  const result = await asOwner(db, (tx) =>
    tx.query<{ id: string; created_at: string; updated_at: string }>(
      "select id, created_at::text, updated_at::text from public.profiles order by id",
    ),
  );
  return result.rows;
}

/** An auth user whose profile is gone, so a profile can be inserted for them by hand. */
async function authUserWithoutProfile(db: Db, email: string): Promise<string> {
  const id = await createAuthUser(db, { email });
  await asOwner(db, (tx) => tx.query("delete from public.profiles where id = $1", [id]));
  return id;
}

describe("profiles made before the migration", { timeout: 30_000 }, () => {
  let db: Db;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    db = await createTestDb({ seed: false, until: await previousMigration() });
    ids.ada = await createAuthUser(db, { email: "ada@test.local", fullName: "Ada Admin" });
    ids.bea = await createAuthUser(db, { email: "bea@test.local", fullName: "Bea" });
    ids.cid = await createAuthUser(db, { email: "cid@test.local", fullName: "Cid" });
    // Waiting for activation: untouched since sign-up made it.
    ids.dee = await createAuthUser(db, { email: "dee@test.local", fullName: "Dee", active: false });
    ids.eve = await createAuthUser(db, { email: "eve@test.local", fullName: "Eve" });
    // When each was created, in another order than they were inserted, two of them at the same instant.
    const created: [string, string][] = [
      [ids.eve, "2026-10-01 08:00:00+00"],
      [ids.bea, "2026-10-02 08:00:00+00"],
      [ids.cid, "2026-10-03 08:00:00+00"],
      [ids.dee, "2026-10-03 08:00:00+00"],
      [ids.ada, "2026-10-04 08:00:00+00"],
    ];
    await asOwner(db, async (tx) => {
      await tx.exec("alter table public.profiles disable trigger set_updated_at");
      for (const [id, at] of created) {
        // Touched an hour later (activated), except the account still waiting.
        await tx.query(
          `update public.profiles set created_at = $2::timestamptz,
                  updated_at = $2::timestamptz + case when active then interval '1 hour' else interval '0' end
            where id = $1`,
          [id, at],
        );
      }
      await tx.exec("alter table public.profiles enable trigger set_updated_at");
    });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("numbers them oldest first, the tie by id, without a save: updated_at and the audit trail stay", async () => {
    const before = await saves(db);
    const audit = () => asOwner(db, (tx) => column<number>(tx, "select count(*)::int from public.audit_log"));
    const auditBefore = await audit();

    await applyAsOwner(db, await migration());

    const [first, second] = [ids.cid, ids.dee].sort();
    expect(await uidOf(db, ids.eve)).toBe("SC-0001");
    expect(await uidOf(db, ids.bea)).toBe("SC-0002");
    expect(await uidOf(db, first)).toBe("SC-0003");
    expect(await uidOf(db, second)).toBe("SC-0004");
    expect(await uidOf(db, ids.ada)).toBe("SC-0005");

    expect(await saves(db)).toEqual(before);
    // Still as sign-up made it, so the Users screen still says Pending Activation.
    const dee = before.find((row) => row.id === ids.dee)!;
    expect(dee.updated_at).toBe(dee.created_at);
    expect(await audit()).toEqual(auditBefore);
  });

  it("gives the next profile the number after the last one", async () => {
    const id = await createAuthUser(db, { email: "fay@test.local" });
    expect(await uidOf(db, id)).toBe("SC-0006");
  });

  it("applies again without changing the schema, a UID or the next number", async () => {
    const schema = await schemaSnapshot(db);
    const all = () => asOwner(db, (tx) => tx.query("select id, uid from public.profiles order by id")).then((r) => r.rows);
    const uids = await all();

    await applyAsOwner(db, await migration());

    expect(await schemaSnapshot(db)).toEqual(schema);
    expect(await all()).toEqual(uids);
    const id = await createAuthUser(db, { email: "gus@test.local" });
    expect(await uidOf(db, id)).toBe("SC-0007");
  });
});

describe("a UID for every new profile", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("gives each new account the next number, in the order they are created", async () => {
    expect(await uidOf(db, people.admin)).toBe("SC-0001");
    expect(await uidOf(db, people.inspector)).toBe("SC-0002");
    expect(await uidOf(db, people.otherInspector)).toBe("SC-0003");
    const next = await createAuthUser(db, { email: "next@test.local" });
    expect(await uidOf(db, next)).toBe("SC-0004");
  });

  it("takes the next number whatever the inserter chose: user metadata, the service role, the owner", async () => {
    // Supabase Auth: the metadata, which users can edit, never sets anything here.
    const fromAuth = await createAuthUser(db, { email: "meta@test.local", metadata: { uid: "SC-0001" } });
    expect(await uidOf(db, fromAuth)).toBe("SC-0005");

    // A profile inserted by hand with the secret key, then in the SQL editor.
    const service = await authUserWithoutProfile(db, "service@test.local"); // draws SC-0006 for the profile it deletes
    const inserted = await asService(db, (tx) =>
      column<string>(tx, "insert into public.profiles (id, email, uid) values ($1, 'service@test.local', 'SC-0001') returning uid", [service]),
    );
    expect(inserted).toEqual(["SC-0007"]);
    const owner = await authUserWithoutProfile(db, "owner@test.local"); // SC-0008, deleted
    const byOwner = await asOwner(db, (tx) =>
      column<string>(tx, "insert into public.profiles (id, email, uid) values ($1, 'owner@test.local', 'SC-0002') returning uid", [owner]),
    );
    expect(byOwner).toEqual(["SC-0009"]);
  });

  it("never gives a number again: not after a deletion, not after a rollback", async () => {
    const gone = await createAuthUser(db, { email: "gone@test.local" });
    expect(await uidOf(db, gone)).toBe("SC-0010");
    await asOwner(db, (tx) => tx.query("delete from auth.users where id = $1", [gone]));

    // An account whose creation is rolled back draws a number too.
    await expect(
      db.transaction(async (tx) => {
        await tx.query("select set_config('role', 'supabase_auth_admin', true)");
        await tx.query("insert into auth.users (id, email, raw_user_meta_data) values ($1, 'rolledback@test.local', '{}')", [randomUUID()]);
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    const next = await createAuthUser(db, { email: "after@test.local" });
    expect(await uidOf(db, next)).toBe("SC-0012");
    expect(await asOwner(db, (tx) => column<string>(tx, "select uid from public.profiles where uid in ('SC-0010', 'SC-0011')"))).toEqual([]);
  });

  it("draws no number for an insert the profile guards refuse", async () => {
    const id = await authUserWithoutProfile(db, "self-lead@test.local"); // SC-0013, deleted
    const refused = await pgError(
      asService(db, (tx) => tx.query("insert into public.profiles (id, email, lead_id) values ($1, 'self-lead@test.local', $1)", [id])),
    );
    expect(refused).toMatchObject({ code: "23514", message: "nobody is their own lead inspector" });
    const next = await createAuthUser(db, { email: "no-gap@test.local" });
    expect(await uidOf(db, next)).toBe("SC-0014");
  });

  it("refuses any change of a UID through the API, the service role included", async () => {
    const change = "update public.profiles set uid = $2 where id = $1";
    const attempts: [string, () => Promise<unknown>][] = [
      ["an admin, someone else's", () => asUser(db, people.admin, (tx) => tx.query(change, [people.inspector, "SC-0999"]))],
      ["an admin, their own", () => asUser(db, people.admin, (tx) => tx.query(change, [people.admin, "SC-0998"]))],
      ["an inspector, their own", () => asUser(db, people.inspector, (tx) => tx.query(change, [people.inspector, "SC-0997"]))],
      ["the service role", () => asService(db, (tx) => tx.query(change, [people.inspector, "SC-0996"]))],
      ["the service role, to nothing", () => asService(db, (tx) => tx.query(change, [people.inspector, null]))],
      ["the service role, another's number", () => asService(db, (tx) => tx.query(change, [people.inspector, "SC-0001"]))],
    ];
    for (const [who, attempt] of attempts) {
      expect(await pgError(attempt()), who).toEqual({ code: "42501", message: "a user's UID never changes" });
    }
    expect(await uidOf(db, people.inspector)).toBe("SC-0002");
    expect(await uidOf(db, people.admin)).toBe("SC-0001");
  });

  it("keeps the UID through every other change", async () => {
    const renamed = await asUser(db, people.admin, (tx) =>
      column<string>(tx, "update public.profiles set full_name = 'Olga O.', uid = uid where id = $1 returning uid", [people.otherInspector]),
    );
    expect(renamed).toEqual(["SC-0003"]);
    const own = await asUser(db, people.inspector, (tx) =>
      column<string>(tx, "update public.profiles set full_name = 'Ivan I.' where id = $1 returning uid", [people.inspector]),
    );
    expect(own).toEqual(["SC-0002"]);
  });

  it("keeps one profile per number, in one spelling, even for the owner", async () => {
    const taken = await pgError(asOwner(db, (tx) => tx.query("update public.profiles set uid = 'SC-0001' where id = $1", [people.inspector])));
    expect(taken.code).toBe("23505");
    for (const uid of ["SC-42", "SC-00042", "SC-0000", "SC-012345", "sc-0042", "SC0042", "INS-0042", " SC-0042"]) {
      const refused = await pgError(asOwner(db, (tx) => tx.query("update public.profiles set uid = $2 where id = $1", [people.inspector, uid])));
      expect(refused.code, uid).toBe("23514");
    }
    // The owner may renumber, deliberately (the go-live clean slate in docs/DATABASE.md), in the one spelling.
    for (const uid of ["SC-0050", "SC-0099", "SC-0999", "SC-9999", "SC-10000", "SC-123456", "SC-0002"]) {
      const saved = await asOwner(db, (tx) =>
        column<string>(tx, "update public.profiles set uid = $2 where id = $1 returning uid", [people.inspector, uid]),
      );
      expect(saved, uid).toEqual([uid]);
    }
  });

  it("lets users and admins read UIDs wherever they read the profile", async () => {
    const lead = await createLead(db, "lead@test.local", "Lina Lead");
    await assignLead(db, people.inspector, lead);
    const read = (userId: string) =>
      asUser(db, userId, (tx) => tx.query<{ id: string; uid: string }>("select id, uid from public.profiles order by uid")).then(
        (result) => result.rows,
      );

    expect(await read(people.inspector)).toEqual([{ id: people.inspector, uid: "SC-0002" }]);
    expect((await read(people.admin)).map((row) => row.uid)).toContain("SC-0003");
    const leadUid = await uidOf(db, lead);
    expect(await read(lead)).toEqual([
      { id: people.inspector, uid: "SC-0002" },
      { id: lead, uid: leadUid },
    ]);
    expect((await pgError(asAnon(db, (tx) => tx.query("select uid from public.profiles")))).code).toBe("42501");
  });

  it("keeps the numbers away from every API role", async () => {
    const privileges = await asOwner(db, (tx) =>
      tx.query<{ role: string; any: boolean }>(
        `select role, has_sequence_privilege(role, 'public.profile_uid_seq', 'usage, select, update') as any
           from unnest(array['anon', 'authenticated', 'service_role']) as role order by role`,
      ),
    );
    expect(privileges.rows).toEqual([
      { role: "anon", any: false },
      { role: "authenticated", any: false },
      { role: "service_role", any: false },
    ]);
    for (const sql of ["select nextval('public.profile_uid_seq')", "select setval('public.profile_uid_seq', 1)"]) {
      expect((await pgError(asService(db, (tx) => tx.query(sql)))).code, sql).toBe("42501");
      expect((await pgError(asUser(db, people.admin, (tx) => tx.query(sql)))).code, sql).toBe("42501");
    }
    expect((await pgError(asUser(db, people.admin, (tx) => tx.query("select public.profile_uid(1)")))).code).toBe("42501");
  });

  it("writes SC- and the number, four digits at least and never cut short: the 10,000th is SC-10000", async () => {
    const formatted = await asService(db, (tx) =>
      column<string>(tx, "select public.profile_uid(n) from unnest(array[1, 42, 999, 9999, 10000, 123456]::bigint[]) as n"),
    );
    expect(formatted).toEqual(["SC-0001", "SC-0042", "SC-0999", "SC-9999", "SC-10000", "SC-123456"]);

    await asOwner(db, (tx) => tx.query("select setval('public.profile_uid_seq', 9999)"));
    const tenThousandth = await createAuthUser(db, { email: "ten-thousand@test.local" });
    expect(await uidOf(db, tenThousandth)).toBe("SC-10000");
    const next = await createAuthUser(db, { email: "ten-thousand-and-one@test.local" });
    expect(await uidOf(db, next)).toBe("SC-10001");
  });
});
