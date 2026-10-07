import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import {
  addFile,
  addReview,
  createInspection,
  createPeople,
  createTemplate,
  setStatus,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asAnon, asOwner, asService, asUser, column, createAuthUser, createTestDb, pgError, type Db } from "./harness";

/**
 * public.delete_draft_inspection() (migration 20261007151500): the inspections
 * list's Delete. An active user deletes a draft that was never submitted,
 * their own or, as an admin, anyone's; its evidence goes with it and a record
 * of the deletion stays.
 */

type AuditRow = Tables<"audit_log">;
type Deleted = { inspection_id: string; ref_no: string; photo_paths: string[]; file_paths: string[] };

/** Calls the function as a signed-in user, the way supabase.rpc() does. */
async function deleteDraft(db: Db, userId: string, inspectionId: string): Promise<Deleted | null> {
  const result = await asUser(db, userId, (tx) =>
    tx.query<{ deleted: Deleted | null }>("select public.delete_draft_inspection($1) as deleted", [inspectionId]),
  );
  return result.rows[0].deleted;
}

/** A photo row with its full-size object and thumbnail, written as the service role. */
async function addPhotoWithThumb(db: Db, inspectionId: string, createdBy: string): Promise<string[]> {
  const id = randomUUID();
  const path = `${inspectionId}/${id}.jpg`;
  const thumb = `${inspectionId}/thumbs/${id}.jpg`;
  await asService(db, (tx) =>
    tx.query(
      "insert into public.inspection_photos (inspection_id, storage_path, thumb_path, created_by) values ($1, $2, $3, $4)",
      [inspectionId, path, thumb, createdBy],
    ),
  );
  return [path, thumb];
}

/** What is left of an inspection and its evidence, seen by the owner. */
async function whatIsLeft(db: Db, inspectionId: string) {
  return asOwner(db, async (tx) => {
    const count = async (sql: string) => (await column<string>(tx, sql, [inspectionId])).length;
    return {
      inspections: await count("select id::text from public.inspections where id = $1"),
      photos: await count("select id::text from public.inspection_photos where inspection_id = $1"),
      files: await count("select id::text from public.inspection_files where inspection_id = $1"),
      reviews: await count("select id::text from public.ai_reviews where inspection_id = $1"),
      decisions: await count(
        "select a.id::text from public.ai_review_actions a join public.ai_reviews r on r.id = a.ai_review_id where r.inspection_id = $1",
      ),
      audit: await count("select id::text from public.audit_log where inspection_id = $1"),
    };
  });
}

const NOTHING_LEFT = { inspections: 0, photos: 0, files: 0, reviews: 0, decisions: 0, audit: 0 };

/** The record of a deletion, which outlives the inspection (inspection_id null). */
async function deletionRecords(db: Db, inspectionId: string): Promise<Pick<AuditRow, "inspection_id" | "actor_id" | "changes">[]> {
  const result = await asOwner(db, (tx) =>
    tx.query<AuditRow>(
      "select * from public.audit_log where action = 'deleted' and changes ->> 'inspection_id' = $1 order by id",
      [inspectionId],
    ),
  );
  return result.rows.map(({ inspection_id, actor_id, changes }) => ({ inspection_id, actor_id, changes }));
}

async function exists(db: Db, inspectionId: string): Promise<boolean> {
  return (await whatIsLeft(db, inspectionId)).inspections === 1;
}

describe("delete_draft_inspection()", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;

  /** A draft of `owner` with a photo (and its thumbnail), a lab report and an AI review. */
  async function draftWithEvidence(owner: string, po = "PO-DEL") {
    const draft = await createInspection(db, owner, templateId, { po_no: po });
    const photoPaths = await addPhotoWithThumb(db, draft.id, owner);
    const filePath = await addFile(db, draft.id, owner);
    await addReview(db, draft.id, people.admin);
    return { draft, photoPaths, filePath };
  }

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("deletes the inspector's own draft with its photos, files and AI reviews, and names their objects", async () => {
    const { draft, photoPaths, filePath } = await draftWithEvidence(people.inspector);

    const deleted = await deleteDraft(db, people.inspector, draft.id);

    expect(deleted).toEqual({
      inspection_id: draft.id,
      ref_no: draft.ref_no,
      photo_paths: [...photoPaths].sort(),
      file_paths: [filePath],
    });
    expect(await whatIsLeft(db, draft.id)).toEqual(NOTHING_LEFT);
  });

  it("keeps a record of the deletion: who deleted it, whose draft it was and what went with it", async () => {
    const { draft } = await draftWithEvidence(people.inspector, "PO-RECORD");

    await deleteDraft(db, people.inspector, draft.id);

    expect(await deletionRecords(db, draft.id)).toEqual([
      {
        inspection_id: null,
        actor_id: people.inspector,
        changes: {
          inspection_id: draft.id,
          ref_no: draft.ref_no,
          status: "draft",
          inspector_id: people.inspector,
          template_id: templateId,
          client_id: null,
          manufacturer_id: null,
          po_no: "PO-RECORD",
          inspection_date: draft.inspection_date,
          photos: 1,
          files: 1,
          via: "delete_draft_inspection",
        },
      },
    ]);

    // Admins read it; the inspector, whose draft is gone, does not.
    const seenBy = async (userId: string) =>
      asUser(db, userId, (tx) =>
        column<string>(tx, "select changes ->> 'ref_no' from public.audit_log where action = 'deleted'"),
      );
    expect(await seenBy(people.admin)).toContain(draft.ref_no);
    expect(await seenBy(people.inspector)).toEqual([]);
  });

  it("never reuses the id of a deleted draft", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    await deleteDraft(db, people.inspector, draft.id);

    const error = await pgError(
      asOwner(db, (tx) =>
        tx.query("insert into public.inspections (id, template_id, inspector_id) values ($1, $2, $3)", [
          draft.id,
          templateId,
          people.inspector,
        ]),
      ),
    );
    expect(error.code).toBe("23505");
  });

  it("lets an admin delete any inspector's draft, and records whose it was", async () => {
    const { draft } = await draftWithEvidence(people.otherInspector);

    const deleted = await deleteDraft(db, people.admin, draft.id);

    expect(deleted).toMatchObject({ inspection_id: draft.id, ref_no: draft.ref_no });
    expect(await whatIsLeft(db, draft.id)).toEqual(NOTHING_LEFT);
    const [record] = await deletionRecords(db, draft.id);
    expect(record).toMatchObject({
      actor_id: people.admin,
      changes: { ref_no: draft.ref_no, status: "draft", inspector_id: people.otherInspector, photos: 1, files: 1 },
    });
  });

  it("treats another inspector's draft as missing and leaves it alone", async () => {
    const { draft } = await draftWithEvidence(people.otherInspector);

    expect(await deleteDraft(db, people.inspector, draft.id)).toBeNull();

    expect(await whatIsLeft(db, draft.id)).toEqual({
      inspections: 1,
      photos: 1,
      files: 1,
      reviews: 1,
      decisions: 1,
      audit: 1,
    });
    expect(await deletionRecords(db, draft.id)).toEqual([]);
  });

  it("answers null for an inspection that does not exist", async () => {
    expect(await deleteDraft(db, people.inspector, randomUUID())).toBeNull();
    expect(await deleteDraft(db, people.admin, randomUUID())).toBeNull();
  });

  it.each([
    ["submitted", ["submitted"]],
    ["reopened", ["submitted", "reopened"]],
    ["approved", ["submitted", "approved"]],
  ] as const)("refuses a %s inspection, to its inspector and to an admin", async (status, steps) => {
    const made = await createInspection(db, people.inspector, templateId);
    let moved: InspectionRow = made;
    for (const step of steps) {
      moved = await setStatus(db, step === "submitted" ? people.inspector : people.admin, made.id, step);
    }
    expect(moved.status).toBe(status);

    for (const caller of [people.inspector, people.admin]) {
      const error = await pgError(deleteDraft(db, caller, made.id));
      expect(error).toMatchObject({ code: "23514", message: expect.stringContaining(made.ref_no) });
    }
    expect(await exists(db, made.id)).toBe(true);
    expect(await deletionRecords(db, made.id)).toEqual([]);
  });

  it("refuses a draft that was once submitted, should a repair have put it back", async () => {
    const made = await createInspection(db, people.inspector, templateId);
    await setStatus(db, people.inspector, made.id, "submitted");
    // A repair with the guard switched off (docs/DATABASE.md): status back to
    // draft, the submission still in the audit trail.
    await asOwner(db, async (tx) => {
      await tx.query("alter table public.inspections disable trigger guard");
      await tx.query("update public.inspections set status = 'draft', submitted_at = null where id = $1", [made.id]);
      await tx.query("alter table public.inspections enable trigger guard");
    });

    const error = await pgError(deleteDraft(db, people.admin, made.id));
    expect(error.code).toBe("23514");
    expect(await exists(db, made.id)).toBe(true);
  });

  it("refuses an inactive user, admins included", async () => {
    const owner = await createAuthUser(db, { email: "leaving@test.local", fullName: "Lee Leaving" });
    const draft = await createInspection(db, owner, templateId);
    const otherAdmin = await createAuthUser(db, { email: "admin-two@test.local", fullName: "Ali Admin" });
    await asOwner(db, (tx) => tx.query("update public.profiles set role = 'admin' where id = $1", [otherAdmin]));
    await asOwner(db, (tx) =>
      tx.query("update public.profiles set active = false where id = any($1::uuid[])", [[owner, otherAdmin]]),
    );

    for (const caller of [owner, otherAdmin]) {
      const error = await pgError(deleteDraft(db, caller, draft.id));
      expect(error).toMatchObject({ code: "42501", message: "the account is not active" });
    }
    expect(await exists(db, draft.id)).toBe(true);
  });

  it("is for signed-in users only: anon and the service role cannot call it", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const call = (tx: Parameters<Parameters<typeof asAnon>[1]>[0]) =>
      tx.query("select public.delete_draft_inspection($1)", [draft.id]);

    const asAnonymous = await pgError(asAnon(db, call));
    const asServiceRole = await pgError(asService(db, call));
    expect([asAnonymous.code, asServiceRole.code]).toEqual(["42501", "42501"]);
    expect(await exists(db, draft.id)).toBe(true);
  });

  it("leaves inspectors without a delete of their own: the table still refuses them", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const result = await asUser(db, people.inspector, (tx) =>
      tx.query("delete from public.inspections where id = $1", [draft.id]),
    );
    expect(result.affectedRows).toBe(0);
    expect(await exists(db, draft.id)).toBe(true);
  });

  it("leaves the record of any other deletion as it was", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    await asUser(db, people.admin, (tx) => tx.query("delete from public.inspections where id = $1", [draft.id]));

    expect(await deletionRecords(db, draft.id)).toEqual([
      {
        inspection_id: null,
        actor_id: people.admin,
        changes: { inspection_id: draft.id, ref_no: draft.ref_no, status: "draft" },
      },
    ]);
  });

  it("only adds its context to the record of the inspection it names", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const elsewhere = await createInspection(db, people.inspector, templateId);
    await asOwner(db, async (tx) => {
      await tx.query("select set_config('stericare.deleted_inspection', $1, true)", [
        JSON.stringify({ inspection_id: elsewhere.id, via: "somewhere else", ref_no: "INS-0000-0000" }),
      ]);
      await tx.query("delete from public.inspections where id = $1", [draft.id]);
    });

    expect(await deletionRecords(db, draft.id)).toEqual([
      { inspection_id: null, actor_id: null, changes: { inspection_id: draft.id, ref_no: draft.ref_no, status: "draft" } },
    ]);
  });

  it("never lets the context overwrite the id, ref or status of the record", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    await asOwner(db, async (tx) => {
      await tx.query("select set_config('stericare.deleted_inspection', $1, true)", [
        JSON.stringify({ inspection_id: draft.id, ref_no: "INS-0000-0000", status: "approved", note: "kept" }),
      ]);
      await tx.query("delete from public.inspections where id = $1", [draft.id]);
    });

    const [record] = await deletionRecords(db, draft.id);
    expect(record.changes).toEqual({ inspection_id: draft.id, ref_no: draft.ref_no, status: "draft", note: "kept" });
  });
});
