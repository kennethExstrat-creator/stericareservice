import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  activate,
  addFile,
  addPhoto,
  addReview,
  createInspection,
  createPeople,
  createTemplate,
  promoteToAdmin,
  TABLES,
  visibleRows,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asAnon, asUser, column, createAuthUser, createTestDb, pgError, type Db, type Tx } from "./harness";

async function everythingVisible(tx: Tx): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  for (const table of TABLES) {
    counts[table] = await visibleRows(tx, table);
  }
  counts["storage.objects"] = (await column<string>(tx, "select id from storage.objects")).length;
  return counts;
}

const nothing = Object.fromEntries([...TABLES, "storage.objects"].map((table) => [table, 0]));

// BUILD_SPEC 3: deactivated users cannot read data; no public sign-up, no public access.
describe("deactivated users, new accounts and anon", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let secondAdmin: string;
  let templateId: string;
  let inspection: InspectionRow;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    secondAdmin = await createAuthUser(db, { email: "admin2@test.local", fullName: "Second Admin" });
    await promoteToAdmin(db, secondAdmin);
    templateId = await createTemplate(db);
    inspection = await createInspection(db, people.inspector, templateId);
    await addPhoto(db, inspection.id, people.inspector);
    await addFile(db, inspection.id, people.inspector);
    await addReview(db, inspection.id, people.admin);
    await asUser(db, people.inspector, (tx) =>
      tx.query(
        "insert into storage.objects (bucket_id, name, owner_id) values ('signatures', $1 || '/signature.png', $1)",
        [people.inspector],
      ),
    );

    for (const userId of [people.inspector, secondAdmin]) {
      await asUser(db, people.admin, (tx) =>
        tx.query("update public.profiles set active = false where id = $1", [userId]),
      );
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("shows a deactivated inspector nothing, own data included", async () => {
    expect(await asUser(db, people.inspector, everythingVisible)).toEqual(nothing);
  });

  it("shows a deactivated admin nothing", async () => {
    expect(await asUser(db, secondAdmin, everythingVisible)).toEqual(nothing);
  });

  it("tells deactivated users why through my_profile_status() only", async () => {
    const status = await asUser(db, secondAdmin, (tx) =>
      tx.query("select * from public.my_profile_status()"),
    );
    const flags = await asUser(db, secondAdmin, (tx) =>
      tx.query("select public.is_admin() as admin, public.is_active() as active"),
    );
    expect(status.rows).toEqual([{ active: false, role: "admin" }]);
    expect(flags.rows).toEqual([{ admin: false, active: false }]);
  });

  it("lets a deactivated inspector change nothing", async () => {
    const changed = await asUser(db, people.inspector, async (tx) => [
      (await tx.query("update public.inspections set po_no = 'x'")).affectedRows,
      (await tx.query("update public.profiles set full_name = 'x'")).affectedRows,
      (await tx.query("delete from public.inspection_photos")).affectedRows,
      (await tx.query("delete from storage.objects")).affectedRows,
    ]);
    expect(changed).toEqual([0, 0, 0, 0]);

    const insert = await pgError(createInspection(db, people.inspector, templateId));
    const upload = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('inspection-photos', $1)", [
          `${inspection.id}/${randomUUID()}.jpg`,
        ]),
      ),
    );
    const log = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("select public.log_inspection_event($1, 'note')", [inspection.id]),
      ),
    );
    expect(insert).toMatchObject({ code: "42501", message: "the account is not active" });
    expect([upload.code, log.code]).toEqual(["42501", "42501"]);
  });

  it("lets a deactivated admin change nothing", async () => {
    const changed = await asUser(db, secondAdmin, async (tx) => [
      (await tx.query("update public.manufacturers set notes = 'x'")).affectedRows,
      (await tx.query("update public.profiles set active = true")).affectedRows,
      (await tx.query("delete from public.inspections")).affectedRows,
    ]);
    expect(changed).toEqual([0, 0, 0]);
    const insert = await pgError(
      asUser(db, secondAdmin, (tx) => tx.query("insert into public.clients (name) values ('Sneaky')")),
    );
    expect(insert.code).toBe("42501");
  });

  it("gives anon no privileges on any public table", async () => {
    for (const table of TABLES) {
      const error = await pgError(asAnon(db, (tx) => tx.query(`select * from public.${table} limit 1`)));
      expect(error, table).toMatchObject({ code: "42501", message: `permission denied for table ${table}` });
    }
  });

  it("gives anon no helper functions and no stored files", async () => {
    const helper = await pgError(asAnon(db, (tx) => tx.query("select public.my_profile_status()")));
    expect(helper.code).toBe("42501");

    const objects = await asAnon(db, (tx) => column<string>(tx, "select name from storage.objects"));
    expect(objects).toEqual([]);
    const upload = await pgError(
      asAnon(db, (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('client-logos', 'logo.png')"),
      ),
    );
    expect(upload.code).toBe("42501");
  });

  it("keeps a new account inert until it is activated", async () => {
    // What a public sign-up, an anonymous sign-in or the dashboard's Add user creates.
    const stranger = await createAuthUser(db, { email: "stranger@example.com" });
    const status = await asUser(db, stranger, (tx) => tx.query("select * from public.my_profile_status()"));
    expect(status.rows).toEqual([{ active: false, role: "inspector" }]);
    expect(await asUser(db, stranger, everythingVisible)).toEqual(nothing);

    const insert = await pgError(createInspection(db, stranger, templateId));
    const upload = await pgError(
      asUser(db, stranger, (tx) =>
        tx.query("insert into storage.objects (bucket_id, name) values ('signatures', $1)", [
          `${stranger}/signature.png`,
        ]),
      ),
    );
    expect(insert).toMatchObject({ code: "42501", message: "the account is not active" });
    expect(upload.code).toBe("42501");

    // The invite action activates the account it creates.
    await activate(db, stranger);
    const seen = await asUser(db, stranger, async (tx) => ({
      manufacturers: await visibleRows(tx, "manufacturers"),
      templates: await visibleRows(tx, "templates"),
      inspections: await visibleRows(tx, "inspections"),
    }));
    expect(seen).toEqual({ manufacturers: 2, templates: 1, inspections: 0 });
    expect((await createInspection(db, stranger, templateId)).inspector_id).toBe(stranger);
  });

  it("lets a reactivated inspector back in", async () => {
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set active = true where id = $1", [people.inspector]),
    );
    const own = await asUser(db, people.inspector, (tx) => column<string>(tx, "select id from public.inspections"));
    expect(own).toEqual([inspection.id]);
  });
});
