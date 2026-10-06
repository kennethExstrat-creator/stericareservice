import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import {
  addFile,
  addPhoto,
  addReview,
  createInspection,
  createPeople,
  createTemplate,
  setStatus,
  TABLES,
  visibleRows,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asOwner, asService, asUser, column, createTestDb, pgError, type Db } from "./harness";

type AuditRow = Tables<"audit_log">;

async function auditTrail(db: Db, inspectionId: string): Promise<Pick<AuditRow, "action" | "actor_id" | "changes">[]> {
  const result = await asOwner(db, (tx) =>
    tx.query<AuditRow>("select * from public.audit_log where inspection_id = $1 order by id", [inspectionId]),
  );
  return result.rows.map(({ action, actor_id, changes }) => ({ action, actor_id, changes }));
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
    const made = await createInspection(db, people.admin, templateId, { inspector_id: people.inspector });
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

    // Reopened is editable again by the owner, then goes back to submitted.
    await asUser(db, people.inspector, (tx) =>
      tx.query("update public.inspections set remarks = 'fixed carton list' where id = $1", [first.id]),
    );
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

  it("cannot delete an approved inspection", async () => {
    const error = await pgError(
      asUser(db, people.admin, (tx) => tx.query("delete from public.inspections where id = $1", [first.id])),
    );
    expect(error.code).toBe("42501");
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

  it("deletes a draft with its evidence and keeps a record of the deletion", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    await addPhoto(db, draft.id, people.inspector);
    const deleted = await asUser(db, people.admin, (tx) =>
      tx.query("delete from public.inspections where id = $1", [draft.id]),
    );
    expect(deleted.affectedRows).toBe(1);

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
      changes: { ref_no: draft.ref_no, status: "draft" },
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

  /** An approved inspection with a photo, a lab report and an AI review. */
  async function approvedInspection(): Promise<InspectionRow> {
    const made = await createInspection(db, people.inspector, templateId);
    await addPhoto(db, made.id, people.inspector);
    await addFile(db, made.id, people.inspector);
    await addReview(db, made.id, people.admin);
    await setStatus(db, people.inspector, made.id, "submitted");
    return setStatus(db, people.admin, made.id, "approved");
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
