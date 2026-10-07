// The database half of keying AI reviews to the inspection's content
// (migration 20261007113245): the fingerprint column, its format and lock,
// and one pending review per inspection and content, while reviews stored
// without a fingerprint keep one per save. Runs the migrations in PGlite,
// like tests/db.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInspection, createPeople, createTemplate, setStatus, type People } from "@/tests/db/fixtures";
import { applyAsOwner, asOwner, asUser, createTestDb, pgError, readMigrations, type Db } from "@/tests/db/harness";

const MIGRATION = "20261007113245_ai_reviews_inspection_fingerprint.sql";
const CONTENT_A = "a".repeat(64);
const CONTENT_B = "0123456789abcdef".repeat(4);

describe("AI reviews keyed to the inspection's content", { timeout: 30_000 }, () => {
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

  /** A submitted inspection of the test inspector, and the save it is at. */
  async function submittedInspection(): Promise<{ id: string; version: string }> {
    const draft = await createInspection(db, people.inspector, templateId);
    const submitted = await setStatus(db, people.inspector, draft.id, "submitted");
    return { id: submitted.id, version: submitted.updated_at };
  }

  /** What startAiReview inserts, as the admin. */
  function requestReview(
    inspectionId: string,
    version: string,
    fingerprint: string | null,
    status: "pending" | "done" | "failed" = "pending",
  ) {
    return asUser(db, people.admin, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.ai_reviews (inspection_id, inspection_updated_at, inspection_fingerprint, status)
         values ($1, $2, $3, $4) returning id`,
        [inspectionId, version, fingerprint, status],
      ),
    );
  }

  it("refuses a second pending review of the same content, even after the inspection was saved again", async () => {
    const inspection = await submittedInspection();
    await requestReview(inspection.id, inspection.version, CONTENT_A);
    // Approving or storing a report link saves the row: a later save, the same content.
    const second = await pgError(requestReview(inspection.id, "2026-10-07T09:00:00.123456+00:00", CONTENT_A));
    expect(second.code).toBe("23505");
    expect(second.message).toContain("ai_reviews_one_pending_per_content");
    // Other content has its own review, even at the same save (a file deleted, say).
    await requestReview(inspection.id, inspection.version, CONTENT_B);
    // Finished reviews of one content are never limited: each stays in the history.
    await requestReview(inspection.id, inspection.version, CONTENT_A, "done");
    await requestReview(inspection.id, inspection.version, CONTENT_A, "done");
  });

  it("keeps one pending review per save for reviews stored without a fingerprint", async () => {
    const inspection = await submittedInspection();
    await requestReview(inspection.id, inspection.version, null);
    const second = await pgError(requestReview(inspection.id, inspection.version, null));
    expect(second.code).toBe("23505");
    expect(second.message).toContain("ai_reviews_one_pending_per_version");
    // A request with a fingerprint is under the content rule.
    await requestReview(inspection.id, inspection.version, CONTENT_A);
  });

  it("takes only a SHA-256 in lowercase hex", async () => {
    const inspection = await submittedInspection();
    for (const fingerprint of ["", "A".repeat(64), "a".repeat(63), `${"a".repeat(63)}g`]) {
      expect((await pgError(requestReview(inspection.id, inspection.version, fingerprint))).code).toBe("23514");
    }
  });

  it("never changes the content a review is about, nor adds it later", async () => {
    const inspection = await submittedInspection();
    const kept = await requestReview(inspection.id, inspection.version, CONTENT_A, "done");
    const legacy = await requestReview(inspection.id, inspection.version, null, "done");
    for (const [id, fingerprint] of [
      [kept.rows[0].id, CONTENT_B],
      [kept.rows[0].id, null],
      [legacy.rows[0].id, CONTENT_A],
    ] as const) {
      const changed = await pgError(
        asUser(db, people.admin, (tx) =>
          tx.query("update public.ai_reviews set inspection_fingerprint = $2 where id = $1", [id, fingerprint]),
        ),
      );
      expect(changed.code).toBe("42501");
      expect(changed.message).toContain("inspection_fingerprint cannot change");
    }
    // The rest of the row still moves on, as completeAiReview writes it.
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.ai_reviews set summary = 'Checked.' where id = $1", [kept.rows[0].id]),
    );
  });

  it("runs again without changing anything", async () => {
    const definitions = () =>
      asOwner(db, (tx) =>
        tx.query<{ item: string }>(
          `select indexdef as item from pg_indexes where tablename = 'ai_reviews'
           union all
           select pg_get_constraintdef(oid) from pg_constraint where conrelid = 'public.ai_reviews'::regclass
           union all
           select pg_get_triggerdef(oid) from pg_trigger where tgrelid = 'public.ai_reviews'::regclass and not tgisinternal
           order by 1`,
        ),
      );
    const before = (await definitions()).rows;
    const migration = (await readMigrations()).find((file) => file.name === MIGRATION);
    expect(migration).toBeDefined();
    await applyAsOwner(db, migration!);
    expect((await definitions()).rows).toEqual(before);
  });
});
