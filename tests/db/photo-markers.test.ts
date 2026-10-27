import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPhoto, assignLead, createInspection, createLead, createPeople, createTemplate, setStatus, type People } from "./fixtures";
import { applyAsOwner, asAnon, asOwner, asService, asUser, column, createTestDb, pgError, readMigrations, type Db, type Tx } from "./harness";

// Migration 20261027210000: defect marks on a photo (Kenneth, 27 October
// 2026). inspection_photos.markers holds at most 20 circles {x, y, r}, every
// value a number from 0 to 1, and whoever may change the photo may change
// them: the inspector while the inspection is a draft or reopened, admins
// until it is approved.

const MIGRATION = "20261027210000_photo_markers.sql";

const CIRCLE = { x: 0.25, y: 0.5, r: 0.1 };

async function photoId(db: Db, path: string): Promise<string> {
  const ids = await asOwner(db, (tx) => column<string>(tx, "select id from public.inspection_photos where storage_path = $1", [path]));
  return ids[0];
}

async function markersOf(db: Db, id: string): Promise<unknown> {
  const rows = await asOwner(db, (tx) => column<unknown>(tx, "select markers from public.inspection_photos where id = $1", [id]));
  return rows[0];
}

/** Writes the marks as `tx`'s session; answers how many rows took them. */
async function mark(tx: Tx, id: string, markers: unknown): Promise<number> {
  const result = await tx.query("update public.inspection_photos set markers = $2::jsonb where id = $1 returning id", [
    id,
    JSON.stringify(markers),
  ]);
  return result.rows.length;
}

describe("photos there before the migration", { timeout: 30_000 }, () => {
  let db: Db;
  let path: string;

  beforeAll(async () => {
    const names = (await readMigrations()).map(({ name }) => name);
    db = await createTestDb({ until: names[names.indexOf(MIGRATION) - 1] });
    const people = await createPeople(db);
    const inspection = await createInspection(db, people.inspector, await createTemplate(db));
    path = await addPhoto(db, inspection.id, people.inspector);
    const file = (await readMigrations()).find(({ name }) => name === MIGRATION);
    if (!file) throw new Error(`${MIGRATION} is not in supabase/migrations`);
    await applyAsOwner(db, file);
  }, 120_000);
  afterAll(() => db.close());

  it("have no marks", async () => {
    expect(await markersOf(db, await photoId(db, path))).toEqual([]);
  });
});

describe("defect marks", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let lead: string;
  let templateId: string;

  /** A photo of a new inspection of the inspector's, at `status`. */
  async function photoAt(status: "draft" | "submitted" | "approved" | "reopened"): Promise<string> {
    const inspection = await createInspection(db, people.inspector, templateId);
    const id = await photoId(db, await addPhoto(db, inspection.id, people.inspector));
    if (status !== "draft") await setStatus(db, people.inspector, inspection.id, "submitted");
    if (status === "approved" || status === "reopened") await setStatus(db, people.admin, inspection.id, status);
    return id;
  }

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    lead = await createLead(db, "lead@test.local", "Lee Lead");
    await assignLead(db, people.inspector, lead);
    templateId = await createTemplate(db);
  }, 120_000);
  afterAll(() => db.close());

  it("start empty on a new photo", async () => {
    expect(await markersOf(db, await photoAt("draft"))).toEqual([]);
  });

  it("take up to 20 circles, each value from 0 to 1, whole numbers included", async () => {
    const id = await photoAt("draft");
    const twenty = Array.from({ length: 20 }, (_, index) => ({ x: index / 19, y: 1 - index / 19, r: 0.05 }));
    for (const markers of [[CIRCLE], [{ x: 0, y: 1, r: 1 }], [{ x: 1, y: 0, r: 0 }], twenty, []]) {
      expect(await asService(db, (tx) => mark(tx, id, markers))).toBe(1);
      expect(await markersOf(db, id)).toEqual(markers);
    }
  });

  it.each([
    ["an object", { x: 0.5, y: 0.5, r: 0.1 }],
    ["a number", 3],
    ["21 circles", Array.from({ length: 21 }, () => CIRCLE)],
    ["a circle that is a number", [0.5]],
    ["a circle that is a list", [[0.5, 0.5, 0.1]]],
    ["a circle without its radius", [{ x: 0.5, y: 0.5 }]],
    ["a circle with a key of its own", [{ ...CIRCLE, colour: "red" }]],
    ["a value in words", [{ ...CIRCLE, x: "0.5" }]],
    ["a value that is null", [{ ...CIRCLE, r: null }]],
    ["a centre off the photo", [{ ...CIRCLE, x: 1.01 }]],
    ["a negative radius", [{ ...CIRCLE, r: -0.1 }]],
  ])("refuse %s", async (_name, markers) => {
    const id = await photoAt("draft");
    expect((await pgError(asService(db, (tx) => mark(tx, id, markers)))).code).toBe("23514");
    expect(await markersOf(db, id)).toEqual([]);
  });

  it("are never null", async () => {
    const id = await photoAt("draft");
    const error = await pgError(asService(db, (tx) => tx.query("update public.inspection_photos set markers = null where id = $1", [id])));
    expect(error.code).toBe("23502");
  });

  it("are the inspector's to change while the inspection is a draft or reopened, the photo's size with them", async () => {
    for (const status of ["draft", "reopened"] as const) {
      const id = await photoAt(status);
      const changed = await asUser(db, people.inspector, (tx) =>
        tx.query("update public.inspection_photos set markers = $2::jsonb, width = 2048, height = 1536 where id = $1 returning id", [
          id,
          JSON.stringify([CIRCLE]),
        ]),
      );
      expect(changed.rows).toHaveLength(1);
      const rows = await asOwner(db, (tx) =>
        tx.query<{ markers: unknown; width: number; height: number }>("select markers, width, height from public.inspection_photos where id = $1", [id]),
      );
      expect(rows.rows[0]).toEqual({ markers: [CIRCLE], width: 2048, height: 1536 });
    }
  });

  it("are no longer the inspector's once submitted, and never another inspector's or the lead's", async () => {
    const submitted = await photoAt("submitted");
    expect(await asUser(db, people.inspector, (tx) => mark(tx, submitted, [CIRCLE]))).toBe(0);
    const draft = await photoAt("draft");
    expect(await asUser(db, people.otherInspector, (tx) => mark(tx, draft, [CIRCLE]))).toBe(0);
    expect(await asUser(db, lead, (tx) => mark(tx, draft, [CIRCLE]))).toBe(0);
    expect(await markersOf(db, submitted)).toEqual([]);
    expect(await markersOf(db, draft)).toEqual([]);
  });

  it("are an admin's to change until the inspection is approved", async () => {
    const submitted = await photoAt("submitted");
    expect(await asUser(db, people.admin, (tx) => mark(tx, submitted, [CIRCLE]))).toBe(1);
    expect(await markersOf(db, submitted)).toEqual([CIRCLE]);
  });

  it("are read-only on an approved inspection, for an admin and the service role alike, while the report choice stays open", async () => {
    const approved = await photoAt("approved");
    expect((await pgError(asUser(db, people.admin, (tx) => mark(tx, approved, [CIRCLE])))).code).toBe("42501");
    expect((await pgError(asService(db, (tx) => mark(tx, approved, [CIRCLE])))).code).toBe("42501");
    const chosen = await asUser(db, people.admin, (tx) =>
      tx.query("update public.inspection_photos set include_in_report = true where id = $1 returning id", [approved]),
    );
    expect(chosen.rows).toHaveLength(1);
    expect(await markersOf(db, approved)).toEqual([]);
  });

  it("are checked by a function signed-in users and the service role may run, and anon may not", async () => {
    const valid = (tx: Tx) => column<boolean>(tx, "select public.photo_markers_valid($1::jsonb)", [JSON.stringify([CIRCLE])]);
    expect(await asUser(db, people.inspector, valid)).toEqual([true]);
    expect(await asService(db, valid)).toEqual([true]);
    expect((await pgError(asAnon(db, valid))).code).toBe("42501");
  });
});
