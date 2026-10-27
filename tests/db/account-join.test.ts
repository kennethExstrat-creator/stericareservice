import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPeople, promoteToAdmin, type People } from "./fixtures";
import {
  applyAsOwner,
  asAnon,
  asOwner,
  asService,
  asUser,
  createAuthUser,
  createTestDb,
  pgError,
  readMigrations,
  type Db,
} from "./harness";

// A phone for every user and joining by invitation (migration 20261027140000,
// Kenneth, 27 October 2026): an invited account has not joined until the
// person creates it (complete_account); one made with a password has.

const MIGRATION = "20261027140000_profile_phone_and_joined.sql";

type Joined = { full_name: string | null; phone: string | null; joined_at: string | null; created_at: string; updated_at: string };

async function profile(db: Db, id: string): Promise<Joined> {
  const result = await asOwner(db, (tx) =>
    tx.query<Joined>(
      "select full_name, phone, joined_at::text, created_at::text, updated_at::text from public.profiles where id = $1",
      [id],
    ),
  );
  return result.rows[0];
}

describe("accounts made before the migration", { timeout: 30_000 }, () => {
  let db: Db;
  let withPassword: string;
  let invited: string;
  let pending: string;

  beforeAll(async () => {
    const names = (await readMigrations()).map(({ name }) => name);
    db = await createTestDb({ until: names[names.indexOf(MIGRATION) - 1] });
    withPassword = await createAuthUser(db, { email: "set@test.local", password: "hash" });
    invited = await createAuthUser(db, { email: "invited@test.local" });
    pending = await createAuthUser(db, { email: "pending@test.local", password: "hash", active: false });
    const file = (await readMigrations()).find(({ name }) => name === MIGRATION);
    if (!file) throw new Error(`${MIGRATION} is not in supabase/migrations`);
    await applyAsOwner(db, file);
  }, 120_000);
  afterAll(() => db.close());

  it("have joined when they have a password, on the day they were made", async () => {
    const row = await profile(db, withPassword);
    expect(row.joined_at).toBe(row.created_at);
  });

  it("wait for the person when an invite is unanswered", async () => {
    expect((await profile(db, invited)).joined_at).toBeNull();
  });

  it("keep updated_at, so an untouched inactive account still reads as pending", async () => {
    const row = await profile(db, pending);
    expect(row.joined_at).not.toBeNull();
    expect(row.updated_at).toBe(row.created_at);
  });
});

describe("joining", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let invited: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    invited = await createAuthUser(db, { email: "new@test.local" });
  }, 120_000);
  afterAll(() => db.close());

  it("starts an account made with a password as joined, an invited one not", async () => {
    const made = await createAuthUser(db, { email: "script@test.local", password: "hash" });
    expect((await profile(db, made)).joined_at).not.toBeNull();
    expect((await profile(db, invited)).joined_at).toBeNull();
  });

  it("lets the invited person create their account once, with their name and phone", async () => {
    await asUser(db, invited, (tx) => tx.query("select public.complete_account($1, $2)", ["  Nora New ", " +60 12-345 6789 "]));
    const row = await profile(db, invited);
    expect(row).toMatchObject({ full_name: "Nora New", phone: "+60 12-345 6789" });
    expect(row.joined_at).not.toBeNull();

    // Again: name and phone change, the day they joined does not.
    await asUser(db, invited, (tx) => tx.query("select public.complete_account($1, $2)", ["Nora New", "012-345 6789"]));
    const again = await profile(db, invited);
    expect(again.phone).toBe("012-345 6789");
    expect(again.joined_at).toBe(row.joined_at);
  });

  it("wants a name and a phone number", async () => {
    const someone = await createAuthUser(db, { email: "blank@test.local" });
    expect((await pgError(asUser(db, someone, (tx) => tx.query("select public.complete_account('', '0123456789')")))).code).toBe("23514");
    expect((await pgError(asUser(db, someone, (tx) => tx.query("select public.complete_account('Bea', ' ')")))).code).toBe("23514");
    expect((await profile(db, someone)).joined_at).toBeNull();
  });

  it("refuses a phone number that is not one", async () => {
    const someone = await createAuthUser(db, { email: "phone@test.local" });
    for (const phone of ["12345", "call me", "+60 12 345 6789 0000 1", "0123456789-", "+-0123456789"]) {
      const error = await pgError(asUser(db, someone, (tx) => tx.query("select public.complete_account('Pat', $1)", [phone])));
      expect(error.code, phone).toBe("23514");
    }
  });

  it("refuses anyone signed out, and an account that is not active", async () => {
    expect((await pgError(asAnon(db, (tx) => tx.query("select public.complete_account('Ann', '0123456789')")))).code).toBe("42501");
    const inactive = await createAuthUser(db, { email: "off@test.local", active: false });
    expect(
      (await pgError(asUser(db, inactive, (tx) => tx.query("select public.complete_account('Ann', '0123456789')")))).code,
    ).toBe("42501");
  });

  it("lets nobody signed in set joined_at by hand, not even an admin", async () => {
    const someone = await createAuthUser(db, { email: "hand@test.local" });
    const own = await pgError(asUser(db, someone, (tx) => tx.query("update public.profiles set joined_at = now() where id = $1", [someone])));
    expect(own.code).toBe("42501");
    const admin = await pgError(
      asUser(db, people.admin, (tx) => tx.query("update public.profiles set joined_at = now() where id = $1", [someone])),
    );
    expect(admin.code).toBe("42501");
    await asService(db, (tx) => tx.query("update public.profiles set joined_at = now() where id = $1", [someone]));
    expect((await profile(db, someone)).joined_at).not.toBeNull();
  });

  it("lets people change their own phone, and an admin anyone's, in the same format", async () => {
    await asUser(db, people.inspector, (tx) =>
      tx.query("update public.profiles set phone = '03-1234 5678' where id = $1", [people.inspector]),
    );
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set phone = '(03) 1234 5678' where id = $1", [people.otherInspector]),
    );
    expect((await profile(db, people.inspector)).phone).toBe("03-1234 5678");
    expect((await profile(db, people.otherInspector)).phone).toBe("(03) 1234 5678");
    const bad = await pgError(
      asUser(db, people.inspector, (tx) => tx.query("update public.profiles set phone = 'none' where id = $1", [people.inspector])),
    );
    expect(bad.code).toBe("23514");
  });

  it("does not let an inspector change someone else's phone", async () => {
    const result = await asUser(db, people.inspector, (tx) =>
      tx.query("update public.profiles set phone = '0123456789' where id = $1", [people.otherInspector]),
    );
    expect(result.affectedRows ?? 0).toBe(0);
  });

  it("keeps an admin made by the first-admin step working", async () => {
    const boss = await createAuthUser(db, { email: "boss@test.local", password: "hash" });
    await promoteToAdmin(db, boss);
    expect((await profile(db, boss)).joined_at).not.toBeNull();
  });
});
