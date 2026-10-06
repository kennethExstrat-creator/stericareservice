import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import { createPeople, promoteToAdmin, type People } from "./fixtures";
import { asOwner, asUser, column, createAuthUser, createTestDb, pgError, type Db } from "./harness";

type Profile = Tables<"profiles">;

async function profileAsOwner(db: Db, id: string): Promise<Profile> {
  const result = await asOwner(db, (tx) =>
    tx.query<Profile>("select * from public.profiles where id = $1", [id]),
  );
  return result.rows[0];
}

describe("auth.users -> profiles", { timeout: 30_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb({
      // Kenneth may sign up in the dashboard before the migrations run.
      beforeMigrations: async (fresh) => {
        await createAuthUser(fresh, { email: "early@test.local", fullName: "Early Bird" });
      },
    });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("creates an inspector profile even when user metadata claims admin", async () => {
    const id = await createAuthUser(db, {
      email: "mallory@test.local",
      fullName: "  Mallory  ",
      metadata: { role: "admin", is_admin: true },
    });
    const profile = await profileAsOwner(db, id);
    expect(profile).toMatchObject({
      role: "inspector",
      active: true,
      email: "mallory@test.local",
      full_name: "Mallory",
    });
  });

  it("leaves full_name empty when the metadata has none", async () => {
    const id = await createAuthUser(db, { email: "noname@test.local" });
    expect((await profileAsOwner(db, id)).full_name).toBeNull();
  });

  it("gives users created before the migration a profile", async () => {
    const emails = await asOwner(db, (tx) =>
      column<string>(tx, "select email from public.profiles where email = 'early@test.local'"),
    );
    expect(emails).toEqual(["early@test.local"]);
  });

  it("keeps profiles.email in sync with auth.users", async () => {
    const id = await createAuthUser(db, { email: "old@test.local" });
    await db.transaction(async (tx) => {
      await tx.query("select set_config('role', 'supabase_auth_admin', true)");
      await tx.query("update auth.users set email = 'new@test.local' where id = $1", [id]);
    });
    expect((await profileAsOwner(db, id)).email).toBe("new@test.local");
  });

  it("deletes the profile with its auth user", async () => {
    const id = await createAuthUser(db, { email: "gone@test.local" });
    await asOwner(db, (tx) => tx.query("delete from auth.users where id = $1", [id]));
    expect(await profileAsOwner(db, id)).toBeUndefined();
  });
});

describe("profiles: who can read and change what", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("lets an inspector read only their own profile", async () => {
    const ids = await asUser(db, people.inspector, (tx) =>
      column<string>(tx, "select id from public.profiles"),
    );
    expect(ids).toEqual([people.inspector]);
  });

  it("lets an admin read every profile", async () => {
    const ids = await asUser(db, people.admin, (tx) =>
      column<string>(tx, "select id from public.profiles order by email"),
    );
    expect(ids).toHaveLength(3);
  });

  it("lets a user change their own name and signature", async () => {
    const path = `${people.inspector}/signature.png`;
    const result = await asUser(db, people.inspector, (tx) =>
      tx.query<Profile>(
        "update public.profiles set full_name = 'Ivan I.', signature_path = $2 where id = $1 returning *",
        [people.inspector, path],
      ),
    );
    expect(result.rows[0]).toMatchObject({ full_name: "Ivan I.", signature_path: path });
  });

  it("keeps a signature inside the user's own folder", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("update public.profiles set signature_path = $2 where id = $1", [
          people.inspector,
          `${people.otherInspector}/signature.png`,
        ]),
      ),
    );
    expect(error.code).toBe("23514");
  });

  it.each([
    ["role", "update public.profiles set role = 'admin' where id = $1"],
    ["active", "update public.profiles set active = false where id = $1"],
    ["email", "update public.profiles set email = 'x@test.local' where id = $1"],
    ["id", "update public.profiles set id = gen_random_uuid() where id = $1"],
  ])("stops an inspector changing their own %s", async (_column, sql) => {
    const error = await pgError(asUser(db, people.inspector, (tx) => tx.query(sql, [people.inspector])));
    expect(error.code).toBe("42501");
  });

  it("hides other users' profiles from an inspector's update", async () => {
    const result = await asUser(db, people.inspector, (tx) =>
      tx.query("update public.profiles set full_name = 'hacked' where id = $1", [people.otherInspector]),
    );
    expect(result.affectedRows).toBe(0);
    expect((await profileAsOwner(db, people.otherInspector)).full_name).toBe("Olga Other");
  });

  it("lets an admin change another user's role, active flag and name", async () => {
    const result = await asUser(db, people.admin, (tx) =>
      tx.query<Profile>(
        `update public.profiles set full_name = 'Olga O.', active = false, role = 'inspector'
          where id = $1 returning *`,
        [people.otherInspector],
      ),
    );
    expect(result.rows[0]).toMatchObject({ full_name: "Olga O.", active: false });
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set active = true where id = $1", [people.otherInspector]),
    );
  });

  it("stops an admin changing another user's email or signature", async () => {
    const email = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.profiles set email = 'x@test.local' where id = $1", [people.inspector]),
      ),
    );
    const signature = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.profiles set signature_path = $2 where id = $1", [
          people.inspector,
          `${people.inspector}/forged.png`,
        ]),
      ),
    );
    expect([email.code, signature.code]).toEqual(["42501", "42501"]);
  });

  it("reports the caller's status, even when deactivated", async () => {
    const status = (userId: string) =>
      asUser(db, userId, (tx) =>
        tx.query<{ active: boolean; role: string }>("select * from public.my_profile_status()"),
      );
    expect((await status(people.inspector)).rows).toEqual([{ active: true, role: "inspector" }]);

    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set active = false where id = $1", [people.otherInspector]),
    );
    expect((await status(people.otherInspector)).rows).toEqual([{ active: false, role: "inspector" }]);
    const visible = await asUser(db, people.otherInspector, (tx) =>
      column<string>(tx, "select id from public.profiles"),
    );
    expect(visible).toEqual([]);

    const stranger = "00000000-0000-4000-8000-0000000000ff";
    expect((await status(stranger)).rows).toEqual([]);
  });
});

describe("the last active admin", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("cannot demote or deactivate themselves", async () => {
    const demote = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.profiles set role = 'inspector' where id = $1", [people.admin]),
      ),
    );
    const deactivate = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.profiles set active = false where id = $1", [people.admin]),
      ),
    );
    expect([demote.code, deactivate.code]).toEqual(["23514", "23514"]);
  });

  it("cannot be removed by the database owner either", async () => {
    const demote = await pgError(
      asOwner(db, (tx) =>
        tx.query("update public.profiles set role = 'inspector' where id = $1", [people.admin]),
      ),
    );
    const remove = await pgError(
      asOwner(db, (tx) => tx.query("delete from auth.users where id = $1", [people.admin])),
    );
    expect([demote.code, remove.code]).toEqual(["23514", "23514"]);
  });

  it("can step down once another admin is active", async () => {
    await promoteToAdmin(db, people.otherInspector);
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set role = 'inspector' where id = $1", [people.admin]),
    );
    const roles = await asOwner(db, (tx) =>
      column<string>(tx, "select role::text from public.profiles where role = 'admin' and active"),
    );
    expect(roles).toEqual(["admin"]);

    const error = await pgError(
      asUser(db, people.otherInspector, (tx) =>
        tx.query("update public.profiles set active = false where id = $1", [people.otherInspector]),
      ),
    );
    expect(error.code).toBe("23514");
  });
});
