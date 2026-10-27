import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addPhoto, createInspection, createPeople, createTemplate, setStatus, type People } from "./fixtures";
import { asOwner, asService, asUser, column, createTestDb, pgError, type Db } from "./harness";

// Migration 20261027200000 (docs/AI.md, "Describing photos"; docs/DATABASE.md):
// Steri-AI's description of a photo (inspection_photos.ai_description, a JSON
// object of at most 2 kB, always dated by ai_described_at) is written by the
// app with the secret key, never by a signed-in user's own request
// (description_guard); an approved inspection's photos stay read-only for
// every role (inspection_media_guard, unchanged); ai_usage takes the job
// photo_description.

const DESCRIPTION = {
  text: "Pinhole, palm area",
  kind: "defect",
  defect: "hole_palm",
  location: "hole_palm",
  clarity: 0.9,
};

describe("Steri-AI's photo descriptions", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  /** A photo of a new draft of the inspector's: its id and its inspection's. */
  async function draftPhoto(): Promise<{ inspectionId: string; photoId: string }> {
    const inspection = await createInspection(db, people.inspector, templateId);
    const path = await addPhoto(db, inspection.id, people.inspector);
    const [photoId] = await asOwner(db, (tx) => column<string>(tx, "select id from public.inspection_photos where storage_path = $1", [path]));
    return { inspectionId: inspection.id, photoId };
  }

  /** Sets Steri-AI's columns as the secret key or as a signed-in user; `set` may name the description as $2. */
  const describeAs = (role: "service" | string, photoId: string, set = `ai_description = $2::jsonb, ai_described_at = now()`) => {
    const params = set.includes("$2") ? [photoId, JSON.stringify(DESCRIPTION)] : [photoId];
    const run = (tx: Parameters<Parameters<typeof asService>[1]>[0]) => tx.query(`update public.inspection_photos set ${set} where id = $1`, params);
    return role === "service" ? asService(db, run) : asUser(db, role, run);
  };

  it("leaves Steri-AI's description to the app: neither the inspector nor an admin writes it, also on insert", async () => {
    const { inspectionId, photoId } = await draftPhoto();
    const refused = await Promise.all(
      [people.inspector, people.admin].flatMap((user) => [
        pgError(describeAs(user, photoId)),
        pgError(describeAs(user, photoId, "ai_described_at = now()")),
        pgError(describeAs(user, photoId, "ai_description = $2::jsonb")),
      ]),
    );
    expect(refused.map((error) => error.code)).toEqual(Array(6).fill("42501"));
    expect(refused[0].message).toContain("Steri-AI's description is recorded by the app");

    const inserted = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query(
          `insert into public.inspection_photos (inspection_id, storage_path, ai_description, ai_described_at)
           values ($1, $2, $3::jsonb, now())`,
          [inspectionId, `${inspectionId}/${randomUUID()}.jpg`, JSON.stringify(DESCRIPTION)],
        ),
      ),
    );
    expect(inserted.code).toBe("42501");

    // The rest of the photo stays theirs: a caption, a retag, and the inspector's own insert without the columns.
    const captioned = await asUser(db, people.inspector, (tx) =>
      tx.query("update public.inspection_photos set caption = 'Leak at the palm', module_key = 'media_defects' where id = $1", [photoId]),
    );
    expect(captioned.affectedRows).toBe(1);
  });

  it("is written with the secret key, read by whoever reads the photo, and kept when the inspector captions it", async () => {
    const { photoId } = await draftPhoto();
    expect((await describeAs("service", photoId)).affectedRows).toBe(1);
    const read = await asUser(db, people.inspector, (tx) =>
      tx.query<{ ai_description: unknown; dated: boolean }>(
        "select ai_description, ai_described_at is not null as dated from public.inspection_photos where id = $1",
        [photoId],
      ),
    );
    expect(read.rows).toEqual([{ ai_description: DESCRIPTION, dated: true }]);

    await asUser(db, people.inspector, (tx) => tx.query("update public.inspection_photos set caption = 'Mine' where id = $1", [photoId]));
    const kept = await asOwner(db, (tx) => column(tx, "select ai_description from public.inspection_photos where id = $1", [photoId]));
    expect(kept).toEqual([DESCRIPTION]);

    // Steri-AI could not tell what a photo shows: dated, without a description.
    const unclear = await asService(db, (tx) =>
      tx.query("update public.inspection_photos set ai_description = null, ai_described_at = now() where id = $1", [photoId]),
    );
    expect(unclear.affectedRows).toBe(1);
  });

  it.each([
    ["a description that is not an object", `'["Pinhole"]'::jsonb`, "now()"],
    ["a description over 2 kB", `jsonb_build_object('text', repeat('x', 2100))`, "now()"],
    ["a description without its date", `'{"text": "Test rig"}'::jsonb`, "null"],
  ])("refuses %s", async (_label, description, describedAt) => {
    const { photoId } = await draftPhoto();
    const error = await pgError(
      asService(db, (tx) =>
        tx.query(`update public.inspection_photos set ai_description = ${description}, ai_described_at = ${describedAt} where id = $1`, [
          photoId,
        ]),
      ),
    );
    expect(error.code).toBe("23514");
  });

  it("keeps an approved inspection's photos read-only, Steri-AI's description included, for the secret key too", async () => {
    const { inspectionId, photoId } = await draftPhoto();
    await setStatus(db, people.inspector, inspectionId, "submitted");
    // Submitted: the app may still describe it (an admin's Report page), as it may move it on Media.
    expect((await describeAs("service", photoId)).affectedRows).toBe(1);
    await setStatus(db, people.admin, inspectionId, "approved");
    const refused = await pgError(describeAs("service", photoId, "ai_description = null, ai_described_at = now()"));
    expect(refused.code).toBe("42501");
  });

  it("keeps the guard's function out of reach of the API roles", async () => {
    const callable = await asOwner(db, (tx) =>
      tx.query<{ anon: boolean; authenticated: boolean }>(
        `select has_function_privilege('anon', 'public.inspection_photos_description_guard()', 'execute') as anon,
                has_function_privilege('authenticated', 'public.inspection_photos_description_guard()', 'execute') as authenticated`,
      ),
    );
    expect(callable.rows).toEqual([{ anon: false, authenticated: false }]);
  });

  it("records the descriptions' Claude calls as photo_description", async () => {
    const inspection = await createInspection(db, people.inspector, templateId);
    const added = await asService(db, (tx) =>
      tx.query<{ feature: string; item_count: number }>(
        `insert into public.ai_usage (feature, model, inspection_id, actor_id, item_count, duration_ms, outcome)
         values ('photo_description', 'claude-opus-5-5', $1, $2, 4, 7300, 'ok')
         returning feature, item_count`,
        [inspection.id, people.inspector],
      ),
    );
    expect(added.rows).toEqual([{ feature: "photo_description", item_count: 4 }]);
    const unknown = await pgError(
      asService(db, (tx) =>
        tx.query("insert into public.ai_usage (feature, model, duration_ms, outcome) values ('photo_descriptions', 'claude-opus-5-5', 1, 'ok')"),
      ),
    );
    expect(unknown.code).toBe("23514");
  });
});
