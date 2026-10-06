// The database half of "one second opinion per version at a time"
// (migration 20261006175715): two requests at the same moment both pass
// startAiReview's check, so the unique index on pending reviews decides.
// Runs the migrations in PGlite, like tests/db.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createInspection, createPeople, createTemplate, setStatus, type People } from "@/tests/db/fixtures";
import { applyAsOwner, asOwner, asUser, createTestDb, pgError, readMigrations, type Db } from "@/tests/db/harness";

const MIGRATION = "20261006175715_ai_reviews_one_pending_per_version.sql";
const INDEX = "ai_reviews_one_pending_per_version";

describe("one pending AI review per inspection version", { timeout: 30_000 }, () => {
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

  /** A submitted inspection of the test inspector, and the version it is at. */
  async function submittedInspection(): Promise<{ id: string; version: string }> {
    const draft = await createInspection(db, people.inspector, templateId);
    const submitted = await setStatus(db, people.inspector, draft.id, "submitted");
    return { id: submitted.id, version: submitted.updated_at };
  }

  /** What startAiReview inserts, as the admin. */
  function requestReview(inspectionId: string, version: string, status: "pending" | "done" | "failed" = "pending") {
    return asUser(db, people.admin, (tx) =>
      tx.query<{ id: string }>(
        "insert into public.ai_reviews (inspection_id, inspection_updated_at, status) values ($1, $2, $3) returning id",
        [inspectionId, version, status],
      ),
    );
  }

  async function statuses(inspectionId: string): Promise<{ status: string; summary: string | null }[]> {
    const result = await asOwner(db, (tx) =>
      tx.query<{ status: string; summary: string | null }>(
        "select status, summary from public.ai_reviews where inspection_id = $1 order by created_at, id",
        [inspectionId],
      ),
    );
    return result.rows;
  }

  it("refuses a second pending review of the same version with a unique violation", async () => {
    const inspection = await submittedInspection();
    await requestReview(inspection.id, inspection.version);
    const second = await pgError(requestReview(inspection.id, inspection.version));
    expect(second.code).toBe("23505");
    expect(second.message).toContain(INDEX);
    expect(await statuses(inspection.id)).toEqual([{ status: "pending", summary: null }]);
  });

  it("takes a new request once the pending review is done or has failed, and one per version", async () => {
    const inspection = await submittedInspection();
    const first = await requestReview(inspection.id, inspection.version);
    // Another version of the same inspection has its own review.
    await requestReview(inspection.id, "2026-10-06T09:00:00.123456+00:00");

    await asUser(db, people.admin, (tx) =>
      tx.query("update public.ai_reviews set status = 'done' where id = $1", [first.rows[0].id]),
    );
    const second = await requestReview(inspection.id, inspection.version);
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.ai_reviews set status = 'failed' where id = $1", [second.rows[0].id]),
    );
    await requestReview(inspection.id, inspection.version);
    // Finished reviews of one version are never limited: each stays in the history.
    await requestReview(inspection.id, inspection.version, "done");

    expect((await statuses(inspection.id)).map((row) => row.status).sort()).toEqual([
      "done",
      "done",
      "failed",
      "pending",
      "pending",
    ]);
  });

  it("closes pending duplicates from before the index, keeping the oldest, and can run again", async () => {
    const inspection = await submittedInspection();
    await asOwner(db, (tx) => tx.query(`drop index public.${INDEX}`));
    // Three requests that all got in before the index existed, one after the
    // other (created_at is the time of each insert's transaction).
    for (let request = 0; request < 3; request += 1) await requestReview(inspection.id, inspection.version);

    const migration = (await readMigrations()).find((file) => file.name === MIGRATION);
    expect(migration).toBeDefined();
    await applyAsOwner(db, migration!);
    await applyAsOwner(db, migration!);

    const closed = "Stopped: another second opinion of this version was already being written.";
    expect(await statuses(inspection.id)).toEqual([
      { status: "pending", summary: null },
      { status: "failed", summary: closed },
      { status: "failed", summary: closed },
    ]);
    expect((await pgError(requestReview(inspection.id, inspection.version))).code).toBe("23505");
  });
});
