import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import {
  addFile,
  addPhoto,
  addReview,
  addUsage,
  createInspection,
  createPeople,
  createTemplate,
  insertInspection,
  saveInspection,
  setStatus,
  TABLES,
  visibleRows,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asOwner, asService, asUser, column, createAuthUser, createTestDb, pgError, type Db } from "./harness";

type AuditRow = Tables<"audit_log">;

async function auditTrail(db: Db, inspectionId: string): Promise<Pick<AuditRow, "action" | "actor_id" | "changes">[]> {
  const result = await asOwner(db, (tx) =>
    tx.query<AuditRow>("select * from public.audit_log where inspection_id = $1 order by id", [inspectionId]),
  );
  return result.rows.map(({ action, actor_id, changes }) => ({ action, actor_id, changes }));
}

/** What remains of an inspection, its evidence and its audit trail, seen by the owner. */
async function whatIsLeft(db: Db, inspectionId: string) {
  return asOwner(db, async (tx) => {
    const count = async (table: string) =>
      (await column<string>(tx, `select id::text from public.${table} where inspection_id = $1`, [inspectionId]))
        .length;
    const deletion = await tx.query<Pick<AuditRow, "actor_id" | "changes">>(
      `select actor_id, changes from public.audit_log
        where action = 'deleted' and changes ->> 'inspection_id' = $1`,
      [inspectionId],
    );
    return {
      inspections: (await column<string>(tx, "select id from public.inspections where id = $1", [inspectionId]))
        .length,
      photos: await count("inspection_photos"),
      files: await count("inspection_files"),
      reviews: await count("ai_reviews"),
      audit: await column<string>(tx, "select action from public.audit_log where inspection_id = $1 order by id", [
        inspectionId,
      ]),
      deletion: deletion.rows,
    };
  });
}

/** whatIsLeft() of an inspection deleted with everything it had, as the service role or owner. */
function deletedWithEverything(inspection: InspectionRow) {
  return {
    inspections: 0,
    photos: 0,
    files: 0,
    reviews: 0,
    audit: [],
    deletion: [
      {
        actor_id: null,
        changes: { inspection_id: inspection.id, ref_no: inspection.ref_no, status: inspection.status },
      },
    ],
  };
}

// BUILD_SPEC 3 and 5, admin role: everything, with the status flow enforced.
describe("RLS: admin", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;
  let first: InspectionRow;
  let second: InspectionRow;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
    first = await createInspection(db, people.inspector, templateId, { po_no: "PO-1" });
    second = await createInspection(db, people.otherInspector, templateId, { po_no: "PO-2" });
    await addPhoto(db, first.id, people.inspector);
    await addFile(db, first.id, people.inspector);
    await addPhoto(db, second.id, people.otherInspector);
    await addFile(db, second.id, people.otherInspector);
    await addReview(db, second.id, people.admin);
    await addUsage(db, { feature: "second_opinion", inspection_id: second.id, actor_id: people.admin, cost_usd: 0.1606 });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("reads every inspection, photo and audit row", async () => {
    const seen = await asUser(db, people.admin, async (tx) => ({
      inspections: await visibleRows(tx, "inspections"),
      photos: await visibleRows(tx, "inspection_photos"),
      audit: await column<string>(tx, "select distinct inspection_id from public.audit_log order by 1"),
    }));
    expect(seen.inspections).toBe(2);
    expect(seen.photos).toBe(2);
    expect(seen.audit).toEqual([first.id, second.id].sort());
  });

  it("reads every table", async () => {
    const empty = await asUser(db, people.admin, async (tx) => {
      const counts = await Promise.all(TABLES.map(async (table) => [table, await visibleRows(tx, table)] as const));
      return counts.filter(([, count]) => count === 0).map(([table]) => table);
    });
    expect(empty).toEqual([]);
  });

  it("is refused the AI settings, which only the service role reads", async () => {
    await expect(asUser(db, people.admin, (tx) => visibleRows(tx, "ai_settings"))).rejects.toThrow(/permission denied/);
  });

  // Migration 20261013120000: the Steri-AI Cost view reads the usage; only the app adds to it.
  it("reads the Steri-AI usage, and adds, changes or removes none of it", async () => {
    const seen = await asUser(db, people.admin, (tx) =>
      tx.query<{ feature: string; inspection_id: string }>("select feature, inspection_id from public.ai_usage"),
    );
    expect(seen.rows).toEqual([{ feature: "second_opinion", inspection_id: second.id }]);
    for (const sql of [
      "insert into public.ai_usage (feature, model, duration_ms, outcome) values ('media_sort', 'claude-opus-5-5', 10, 'ok')",
      "update public.ai_usage set cost_usd = 0",
      "delete from public.ai_usage",
    ]) {
      const error = await pgError(asUser(db, people.admin, (tx) => tx.query(sql)));
      expect(error, sql).toMatchObject({ code: "42501", message: "permission denied for table ai_usage" });
    }
  });

  it("manages reference data", async () => {
    const result = await asUser(db, people.admin, async (tx) => {
      const made = await tx.query<{ id: string }>(
        "insert into public.manufacturers (name, factory_name, country) values ('Acme Gloves', 'Plant 2', 'Malaysia') returning id",
      );
      const id = made.rows[0].id;
      await tx.query("update public.manufacturers set notes = 'audited' where id = $1", [id]);
      await tx.query("insert into public.clients (name) values ('Acme Health')");
      await tx.query("insert into public.defect_codes (code, name) values ('pinhole_test', 'Pinhole test')");
      await tx.query("update public.defect_codes set active = false where code = 'pinhole_test'");
      return (await tx.query("delete from public.manufacturers where id = $1", [id])).affectedRows;
    });
    expect(result).toBe(1);
  });

  it("rejects a second manufacturer row for the same factory, whatever the case", async () => {
    const error = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("insert into public.manufacturers (name) values ('HARTALEGA ngc')"),
      ),
    );
    expect(error.code).toBe("23505");
  });

  it("cannot rename a defect code that templates refer to", async () => {
    const error = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.defect_codes set code = 'stain_any' where code = 'stain'"),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("creates an inspection for an inspector", async () => {
    const made = await insertInspection(db, people.admin, templateId, { inspector_id: people.inspector });
    expect(made.inspector_id).toBe(people.inspector);
    const trail = await auditTrail(db, made.id);
    expect(trail).toEqual([
      {
        action: "created",
        actor_id: people.admin,
        changes: { ref_no: made.ref_no, status: "draft", template_id: templateId, inspector_id: people.inspector },
      },
    ]);
  });

  it("cannot approve or reopen a draft", async () => {
    for (const status of ["approved", "reopened"] as const) {
      const error = await pgError(setStatus(db, people.admin, first.id, status));
      expect(error).toMatchObject({ code: "23514", message: `status cannot change from draft to ${status}` });
    }
  });

  it("edits any inspection while it is not approved", async () => {
    const result = await asUser(db, people.admin, (tx) =>
      tx.query("update public.inspections set remarks = 'checked by admin' where id = $1", [second.id]),
    );
    expect(result.affectedRows).toBe(1);
  });

  it("switches a module off for one inspection and logs the reason", async () => {
    const override = { weight: { reason: "Scale broken on site", by: people.admin, at: "2026-10-06T08:00:00Z" } };
    await asUser(db, people.admin, async (tx) => {
      await tx.query("update public.inspections set module_overrides = $2 where id = $1", [
        second.id,
        JSON.stringify(override),
      ]);
      await tx.query("select public.log_inspection_event($1, 'module_override', $2)", [
        second.id,
        JSON.stringify({ module: "weight", reason: "Scale broken on site" }),
      ]);
    });
    const trail = await auditTrail(db, second.id);
    expect(trail.at(-1)).toEqual({
      action: "module_override",
      actor_id: people.admin,
      changes: { module: "weight", reason: "Scale broken on site" },
    });
  });

  it("walks the full status flow and records each step", async () => {
    const submitted = await setStatus(db, people.inspector, first.id, "submitted");
    expect(submitted.submitted_at).not.toBeNull();

    const reopened = await setStatus(db, people.admin, first.id, "reopened");
    expect(reopened.status).toBe("reopened");

    // Reopened is editable again by the owner, through the app, then goes back to submitted.
    expect(await saveInspection(db, people.inspector, first.id, { columns: { remarks: "fixed carton list" } })).not.toBeNull();
    const resubmitted = await setStatus(db, people.inspector, first.id, "submitted");
    expect(resubmitted.submitted_at! >= submitted.submitted_at!).toBe(true);

    const approved = await setStatus(db, people.admin, first.id, "approved");
    expect(approved).toMatchObject({ status: "approved", approved_by: people.admin });
    expect(approved.approved_at).not.toBeNull();

    const steps = (await auditTrail(db, first.id)).map(({ action, actor_id, changes }) => [action, actor_id, changes]);
    expect(steps).toEqual([
      ["created", people.inspector, expect.objectContaining({ status: "draft" })],
      ["status_changed", people.inspector, { from: "draft", to: "submitted" }],
      ["status_changed", people.admin, { from: "submitted", to: "reopened" }],
      ["status_changed", people.inspector, { from: "reopened", to: "submitted" }],
      ["status_changed", people.admin, { from: "submitted", to: "approved" }],
    ]);
  });

  it("keeps an approved inspection read-only except report_url", async () => {
    const edit = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.inspections set remarks = 'too late' where id = $1", [first.id]),
      ),
    );
    const reopen = await pgError(setStatus(db, people.admin, first.id, "reopened"));
    expect(edit).toMatchObject({ code: "42501", message: "an approved inspection is read-only" });
    expect(reopen.code).toBe("23514");

    const report = await asUser(db, people.admin, (tx) =>
      tx.query<InspectionRow>(
        "update public.inspections set report_url = 'https://reports.example.com/INS.pdf' where id = $1 returning *",
        [first.id],
      ),
    );
    expect(report.rows[0].report_url).toBe("https://reports.example.com/INS.pdf");

    const script = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.inspections set report_url = 'javascript:alert(1)' where id = $1", [first.id]),
      ),
    );
    expect(script.code).toBe("23514");
  });

  // Data audit D1 (migration 20261007193000): no policy lets a signed-in user
  // delete an inspection, so an admin's own DELETE matches no row and is not an
  // error. Drafts go through delete_draft_inspection() (below).
  it("deletes no inspection with its own session: a submitted or approved one stays, with its history", async () => {
    const submitted = await createInspection(db, people.inspector, templateId);
    await addPhoto(db, submitted.id, people.inspector);
    await setStatus(db, people.inspector, submitted.id, "submitted");

    for (const inspection of [submitted, first]) {
      const before = await whatIsLeft(db, inspection.id);
      // What PostgREST runs for supabase.from("inspections").delete().eq("id", id).select("id").
      const deleted = await asUser(db, people.admin, (tx) =>
        column<string>(tx, "delete from public.inspections where id = $1 returning id", [inspection.id]),
      );
      expect(deleted, inspection.ref_no).toEqual([]);
      expect(await whatIsLeft(db, inspection.id), inspection.ref_no).toEqual(before);
    }
  });

  it("chooses report photos on any inspection, approved included", async () => {
    const result = await asUser(db, people.admin, (tx) =>
      tx.query("update public.inspection_photos set include_in_report = true where inspection_id = $1", [first.id]),
    );
    expect(result.affectedRows).toBe(1);
  });

  it("changes nothing else about the photos and files of an approved inspection", async () => {
    const caption = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.inspection_photos set caption = 'too late' where inspection_id = $1", [first.id]),
      ),
    );
    expect(caption).toMatchObject({
      code: "42501",
      message: "the photos and files of an approved inspection are read-only",
    });

    const added = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("insert into public.inspection_photos (inspection_id, storage_path) values ($1, $2)", [
          first.id,
          `${first.id}/${randomUUID()}.jpg`,
        ]),
      ),
    );
    expect(added.code).toBe("42501");

    const changed = await asUser(db, people.admin, async (tx) => [
      (await tx.query("delete from public.inspection_photos where inspection_id = $1", [first.id])).affectedRows,
      (await tx.query("update public.inspection_files set name = 'renamed.pdf' where inspection_id = $1", [first.id]))
        .affectedRows,
      (await tx.query("delete from public.inspection_files where inspection_id = $1", [first.id])).affectedRows,
    ]);
    expect(changed).toEqual([0, 0, 0]);
  });

  it("records AI reviews and decides on findings in their own name", async () => {
    const review = await asUser(db, people.admin, (tx) =>
      tx.query<{ id: string }>(
        `insert into public.ai_reviews (inspection_id, inspection_updated_at, status, model, suggested_result, confidence, findings)
         values ($1, now(), 'done', 'claude-opus-5-5', 'pass', 0.875, '[{"id": "f1"}, {"id": "f2"}]') returning id`,
        [second.id],
      ),
    );
    const reviewId = review.rows[0].id;
    await asUser(db, people.admin, (tx) =>
      tx.query(
        "insert into public.ai_review_actions (ai_review_id, finding_id, action) values ($1, 'f1', 'agree')",
        [reviewId],
      ),
    );

    const forged = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query(
          "insert into public.ai_review_actions (ai_review_id, finding_id, actor_id, action) values ($1, 'f2', $2, 'fixed')",
          [reviewId, people.inspector],
        ),
      ),
    );
    const silent = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query(
          "insert into public.ai_review_actions (ai_review_id, finding_id, action, note) values ($1, 'f2', 'disagree', ' ')",
          [reviewId],
        ),
      ),
    );
    expect([forged.code, silent.code]).toEqual(["42501", "23514"]);

    const actors = await asUser(db, people.admin, (tx) =>
      column<string>(tx, "select actor_id from public.ai_review_actions where ai_review_id = $1", [reviewId]),
    );
    expect(actors).toEqual([people.admin]);
  });

  it("deletes a draft through delete_draft_inspection(), with its evidence, and keeps a record of the deletion", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const photo = await addPhoto(db, draft.id, people.inspector);
    // The list's Delete: supabase.rpc("delete_draft_inspection", { inspection_id }).
    const deleted = await asUser(db, people.admin, (tx) =>
      column<unknown>(tx, "select public.delete_draft_inspection($1)", [draft.id]),
    );
    expect(deleted).toEqual([{ inspection_id: draft.id, ref_no: draft.ref_no, photo_paths: [photo], file_paths: [] }]);

    const left = await asOwner(db, async (tx) => ({
      photos: await column<string>(tx, "select id from public.inspection_photos where inspection_id = $1", [draft.id]),
      deletion: await tx.query<AuditRow>(
        "select * from public.audit_log where action = 'deleted' and changes ->> 'inspection_id' = $1",
        [draft.id],
      ),
    }));
    expect(left.photos).toEqual([]);
    expect(left.deletion.rows).toHaveLength(1);
    expect(left.deletion.rows[0]).toMatchObject({
      inspection_id: null,
      actor_id: people.admin,
      changes: { ref_no: draft.ref_no, status: "draft", inspector_id: people.inspector, via: "delete_draft_inspection" },
    });

    // The deletion record is for admins only.
    const visibleToInspector = await asUser(db, people.inspector, (tx) =>
      column<number>(tx, "select id from public.audit_log where action = 'deleted'"),
    );
    expect(visibleToInspector).toEqual([]);
  });
});

// The secret key bypasses RLS but not the status flow; it acts as an admin with no user.
describe("service role", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;

  /** A submitted inspection with a photo, a lab report and an AI review. */
  async function submittedInspection(): Promise<InspectionRow> {
    const made = await createInspection(db, people.inspector, templateId);
    await addPhoto(db, made.id, people.inspector);
    await addFile(db, made.id, people.inspector);
    await addReview(db, made.id, people.admin);
    return setStatus(db, people.inspector, made.id, "submitted");
  }

  /** An approved inspection with a photo, a lab report and an AI review. */
  async function approvedInspection(): Promise<InspectionRow> {
    const submitted = await submittedInspection();
    return setStatus(db, people.admin, submitted.id, "approved");
  }

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("follows the status flow and is recorded without an actor", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const skip = await pgError(
      asService(db, (tx) => tx.query("update public.inspections set status = 'approved' where id = $1", [draft.id])),
    );
    expect(skip.code).toBe("23514");

    await setStatus(db, people.inspector, draft.id, "submitted");
    const approved = await asService(db, (tx) =>
      tx.query<InspectionRow>("update public.inspections set status = 'approved' where id = $1 returning *", [
        draft.id,
      ]),
    );
    expect(approved.rows[0]).toMatchObject({ status: "approved", approved_by: null });

    const last = (await auditTrail(db, draft.id)).at(-1);
    expect(last).toEqual({ action: "status_changed", actor_id: null, changes: { from: "submitted", to: "approved" } });
  });

  it("cannot supply its own ref_no or rewrite history", async () => {
    const ref = await pgError(
      asService(db, (tx) =>
        tx.query(
          "insert into public.inspections (template_id, inspector_id, ref_no) values ($1, $2, 'INS-2020-0001')",
          [templateId, people.inspector],
        ),
      ),
    );
    expect(ref).toMatchObject({ code: "42501", message: "ref_no is assigned by the database" });

    // The audit trail is append-only, for server code too.
    for (const sql of ["update public.audit_log set action = 'edited'", "delete from public.audit_log"]) {
      const error = await pgError(asService(db, (tx) => tx.query(sql)));
      expect(error, sql).toMatchObject({ code: "42501", message: "permission denied for table audit_log" });
    }
  });

  it("logs events on any inspection", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const id = await asService(db, (tx) =>
      column<number>(tx, "select public.log_inspection_event($1, 'ai_review.requested', '{}')", [draft.id]),
    );
    expect(id[0]).toBeGreaterThan(0);
    const trail = await auditTrail(db, draft.id);
    expect(trail.at(-1)).toEqual({ action: "ai_review.requested", actor_id: null, changes: {} });
  });

  it("logs no event without an inspection, and neither can a user", async () => {
    const service = await pgError(asService(db, (tx) => tx.query("select public.log_inspection_event(null, 'note')")));
    const user = await pgError(
      asUser(db, people.inspector, (tx) => tx.query("select public.log_inspection_event(null, 'note')")),
    );
    for (const error of [service, user]) {
      expect(error).toMatchObject({ code: "22004", message: "inspection_id is required" });
    }
  });

  it("changes nothing about the photos and files of an approved inspection but the report choice", async () => {
    const approved = await approvedInspection();
    const blocked: [sql: string, params: unknown[]][] = [
      [
        "insert into public.inspection_photos (inspection_id, storage_path, created_by) values ($1, $2, $3)",
        [approved.id, `${approved.id}/${randomUUID()}.jpg`, people.inspector],
      ],
      ["update public.inspection_photos set caption = 'too late' where inspection_id = $1", [approved.id]],
      ["delete from public.inspection_photos where inspection_id = $1", [approved.id]],
      [
        "insert into public.inspection_files (inspection_id, storage_path, name, created_by) values ($1, $2, 'late.pdf', $3)",
        [approved.id, `${approved.id}/${randomUUID()}.pdf`, people.inspector],
      ],
      ["update public.inspection_files set name = 'renamed.pdf' where inspection_id = $1", [approved.id]],
      ["delete from public.inspection_files where inspection_id = $1", [approved.id]],
    ];
    for (const [sql, params] of blocked) {
      const error = await pgError(asService(db, (tx) => tx.query(sql, params)));
      expect(error, sql).toMatchObject({
        code: "42501",
        message: "the photos and files of an approved inspection are read-only",
      });
    }

    const pick = await asService(db, (tx) =>
      tx.query("update public.inspection_photos set include_in_report = true where inspection_id = $1", [approved.id]),
    );
    expect(pick.affectedRows).toBe(1);
  });

  // Maintenance with the secret key, which no signed-in user has (migration 20261007193000).
  it("deletes a submitted inspection with its evidence, and the deletion is recorded", async () => {
    const submitted = await submittedInspection();
    const deleted = await asService(db, (tx) =>
      tx.query("delete from public.inspections where id = $1", [submitted.id]),
    );
    expect(deleted.affectedRows).toBe(1);
    expect(await whatIsLeft(db, submitted.id)).toEqual(deletedWithEverything(submitted));
  });

  it("cannot delete an approved inspection, so its audit history stays", async () => {
    const approved = await approvedInspection();
    const error = await pgError(
      asService(db, (tx) => tx.query("delete from public.inspections where id = $1", [approved.id])),
    );
    expect(error).toMatchObject({ code: "42501", message: "an approved inspection cannot be deleted" });
    expect(await whatIsLeft(db, approved.id)).toMatchObject({
      inspections: 1,
      photos: 1,
      files: 1,
      reviews: 1,
      audit: ["created", "status_changed", "status_changed"],
      deletion: [],
    });
  });

  it("leaves deleting an approved inspection to the database owner, which is recorded", async () => {
    const approved = await approvedInspection();
    const deleted = await asOwner(db, (tx) => tx.query("delete from public.inspections where id = $1", [approved.id]));
    expect(deleted.affectedRows).toBe(1);
    expect(await whatIsLeft(db, approved.id)).toEqual(deletedWithEverything(approved));
  });

  // End-to-end teardown in the shared project (e2e/README.md).
  it("deletes the inspections of test accounts through delete_test_inspection(), approved ones included", async () => {
    const approved = await approvedInspection();
    const draft = await createInspection(db, people.inspector, templateId);
    const results = await asService(db, async (tx) => [
      await column<boolean>(tx, "select public.delete_test_inspection($1)", [approved.id]),
      await column<boolean>(tx, "select public.delete_test_inspection($1)", [draft.id]),
      await column<boolean>(tx, "select public.delete_test_inspection($1)", [randomUUID()]),
    ]);
    expect(results).toEqual([[true], [true], [false]]);
    expect(await whatIsLeft(db, approved.id)).toEqual(deletedWithEverything(approved));
  });

  it("keeps delete_test_inspection() away from real accounts and from signed-in users", async () => {
    const real = await createAuthUser(db, { email: "rina@stericare.example", fullName: "Rina Real" });
    const theirs = await createInspection(db, real, templateId);
    const notTest = await pgError(
      asService(db, (tx) => tx.query("select public.delete_test_inspection($1)", [theirs.id])),
    );
    expect(notTest).toMatchObject({
      code: "42501",
      message: `inspection ${theirs.id} does not belong to a test account`,
    });

    const own = await createInspection(db, people.inspector, templateId);
    for (const userId of [people.admin, people.inspector]) {
      const error = await pgError(
        asUser(db, userId, (tx) => tx.query("select public.delete_test_inspection($1)", [own.id])),
      );
      expect(error, userId).toMatchObject({
        code: "42501",
        message: "permission denied for function delete_test_inspection",
      });
    }
    const still = await asOwner(db, (tx) =>
      column<string>(tx, "select id from public.inspections where id in ($1, $2) order by id", [theirs.id, own.id]),
    );
    expect(still).toEqual([theirs.id, own.id].sort());
  });

  it("stores photo rows for any inspection", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const path = `${draft.id}/${randomUUID()}.jpg`;
    const result = await asService(db, (tx) =>
      tx.query(
        "insert into public.inspection_photos (inspection_id, storage_path, created_by, include_in_report) values ($1, $2, $3, true)",
        [draft.id, path, people.inspector],
      ),
    );
    expect(result.affectedRows).toBe(1);
  });
});
