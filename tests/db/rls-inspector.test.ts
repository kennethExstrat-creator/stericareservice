import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addFile,
  addPhoto,
  addReview,
  addUsage,
  createInspection,
  createPeople,
  createTemplate,
  insertInspection,
  readInspection,
  saveInspection,
  setStatus,
  visibleRows,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asOwner, asService, asUser, column, createTestDb, pgError, type Db } from "./harness";

// BUILD_SPEC 3 and 5, inspector role: own data only, drafts only, no admin powers.
describe("RLS: inspector", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;
  let own: InspectionRow;
  let others: InspectionRow;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
    own = await createInspection(db, people.inspector, templateId, { po_no: "PO-OWN" });
    others = await createInspection(db, people.otherInspector, templateId, { po_no: "PO-OTHER" });
    for (const [inspection, owner] of [
      [own.id, people.inspector],
      [others.id, people.otherInspector],
    ]) {
      await addPhoto(db, inspection, owner);
      await addFile(db, inspection, owner);
      await addReview(db, inspection, people.admin);
    }
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("sees only their own inspections, photos, files, audit rows and AI reviews", async () => {
    const seen = await asUser(db, people.inspector, async (tx) => ({
      inspections: await column<string>(tx, "select id from public.inspections"),
      photos: await column<string>(tx, "select inspection_id from public.inspection_photos"),
      files: await column<string>(tx, "select inspection_id from public.inspection_files"),
      audit: await column<string>(tx, "select distinct inspection_id from public.audit_log"),
      reviews: await column<string>(tx, "select inspection_id from public.ai_reviews"),
    }));
    expect(seen).toEqual({
      inspections: [own.id],
      photos: [own.id],
      files: [own.id],
      audit: [own.id],
      reviews: [own.id],
    });
  });

  it("never sees the admin's decisions on AI findings", async () => {
    expect(await asUser(db, people.inspector, (tx) => visibleRows(tx, "ai_review_actions"))).toBe(0);
  });

  // Migration 20261013120000: what Steri-AI costs is for admins only.
  it("reads no Steri-AI usage, not even their own inspection's, and adds none", async () => {
    await addUsage(db, { inspection_id: own.id, actor_id: people.inspector });
    expect(await asUser(db, people.inspector, (tx) => visibleRows(tx, "ai_usage"))).toBe(0);
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query(
          `insert into public.ai_usage (feature, model, duration_ms, outcome, inspection_id, actor_id)
           values ('source_document_read', 'claude-opus-5-5', 10, 'ok', $1, $2)`,
          [own.id, people.inspector],
        ),
      ),
    );
    expect(error).toMatchObject({ code: "42501", message: "permission denied for table ai_usage" });
  });

  it("reads the reference tables", async () => {
    const counts = await asUser(db, people.inspector, async (tx) => ({
      manufacturers: await visibleRows(tx, "manufacturers"),
      clients: await visibleRows(tx, "clients"),
      defect_codes: await visibleRows(tx, "defect_codes"),
      templates: await visibleRows(tx, "templates"),
    }));
    expect(counts).toEqual({ manufacturers: 2, clients: 1, defect_codes: 35, templates: 1 });
  });

  it.each([
    ["manufacturer_brands", "insert into public.manufacturer_brands (name) values ('Rogue Brand')"],
    [
      "manufacturer_companies",
      "insert into public.manufacturer_companies (brand_id, name) values ('11000000-0000-4000-8000-000000000001', 'Rogue Gloves')",
    ],
    [
      "manufacturers",
      "insert into public.manufacturers (company_id, factory_name) values ('12000000-0000-4000-8000-000000000001', 'Rogue Plant')",
    ],
    ["clients", "insert into public.clients (name) values ('Rogue Client')"],
    ["defect_codes", "insert into public.defect_codes (code, name) values ('rogue', 'Rogue')"],
    [
      "templates",
      `insert into public.templates (code, product_type, standard, definition)
       values ('ROGUE', 'examination', 'EN455', '{}')`,
    ],
  ])("cannot add to %s", async (_table, sql) => {
    const error = await pgError(asUser(db, people.inspector, (tx) => tx.query(sql)));
    expect(error.code).toBe("42501");
  });

  it("cannot change or delete reference rows", async () => {
    const changed = await asUser(db, people.inspector, async (tx) => [
      (await tx.query("update public.manufacturers set notes = 'x'")).affectedRows,
      (await tx.query("update public.manufacturer_companies set name = name || ' x'")).affectedRows,
      (await tx.query("delete from public.manufacturer_brands")).affectedRows,
      (await tx.query("update public.defect_codes set active = false")).affectedRows,
      (await tx.query("delete from public.clients")).affectedRows,
      (await tx.query("delete from public.templates")).affectedRows,
    ]);
    expect(changed).toEqual([0, 0, 0, 0, 0, 0]);
  });

  it("cannot create an inspection for another inspector", async () => {
    const error = await pgError(
      insertInspection(db, people.inspector, templateId, { inspector_id: people.otherInspector }),
    );
    expect(error.code).toBe("42501");
  });

  // Security audit SEC-02: the app chooses the template and fills in the data
  // (create_inspection(), migration 20261007190000).
  it("cannot create even their own draft directly, from an active template", async () => {
    const error = await pgError(insertInspection(db, people.inspector, templateId, { po_no: "PO-DIRECT" }));
    expect(error).toMatchObject({ code: "42501", message: "inspectors create inspections through the app" });
    const made = await asOwner(db, (tx) =>
      column<string>(tx, "select id from public.inspections where po_no = 'PO-DIRECT'"),
    );
    expect(made).toEqual([]);
  });

  it("cannot create an inspection that is already submitted", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.inspections (template_id, status) values ($1, 'submitted')", [
          templateId,
        ]),
      ),
    );
    // The guard trigger fires before the RLS check; both reject it.
    expect(error).toMatchObject({ code: "23514", message: expect.stringContaining("draft") });
  });

  it("cannot create an inspection with modules already switched off", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query(
          `insert into public.inspections (template_id, module_overrides)
           values ($1, '{"weight": {"reason": "no scale"}}')`,
          [templateId],
        ),
      ),
    );
    expect(error).toMatchObject({ code: "42501", message: "only an admin can switch modules off" });
  });

  it("cannot start from a template that is not active", async () => {
    const draftTemplate = await createTemplate(db, { code: "DRAFT_EG", status: "draft" });
    const error = await pgError(createInspection(db, people.inspector, draftTemplate));
    expect(error).toMatchObject({ code: "23514", message: expect.stringContaining("active template") });
  });

  it("edits their own draft through the app, never directly", async () => {
    const direct = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("update public.inspections set po_no = 'PO-EDITED', remarks = 'ok' where id = $1", [own.id]),
      ),
    );
    expect(direct).toMatchObject({ code: "42501", message: "inspectors save and submit inspections through the app" });

    // The capture screen's save, with the secret key, for them.
    const saved = await saveInspection(db, people.inspector, own.id, {
      columns: { po_no: "PO-EDITED", lot_numbers: ["L1", "L2"], remarks: "ok" },
    });
    expect(await readInspection(db, own.id)).toMatchObject({
      po_no: "PO-EDITED",
      lot_numbers: ["L1", "L2"],
      remarks: "ok",
      updated_at: saved,
    });
    expect(saved! > own.updated_at).toBe(true);
  });

  // SEC-02: the data, the columns computed from it, the client and the
  // manufacturer are written by the app's checks or not at all.
  it.each([
    ["id", "id = gen_random_uuid()"],
    ["ref_no", "ref_no = 'INS-1999-0001'"],
    ["inspector_id", "inspector_id = '00000000-0000-4000-8000-000000000000'"],
    ["template_id", "template_id = gen_random_uuid()"],
    ["submitted_at", "submitted_at = now()"],
    ["approved_by", "approved_by = auth.uid()"],
    ["approved_at", "approved_at = now()"],
    ["report_url", "report_url = 'https://example.com/report.pdf'"],
    ["module_overrides", `module_overrides = '{"weight": {"reason": "no scale"}}'`],
    ["data", `data = '{"modules": {"header": {"poNo": 12345}, "sampling_plan": {"anything": "goes"}}, "custom": {}}'`],
    ["suggested_result", "suggested_result = 'pass'"],
    ["result", "result = 'pass'"],
    ["lot_numbers", "lot_numbers = '{FORGED-LOT}'"],
    ["po_no", "po_no = 'FORGED-PO'"],
    ["client_id", "client_id = (select id from public.clients limit 1)"],
    ["manufacturer_id", "manufacturer_id = (select id from public.manufacturers limit 1)"],
  ])("cannot change %s on their own draft", async (_column, assignment) => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query(`update public.inspections set ${assignment} where id = $1`, [own.id]),
      ),
    );
    expect(error.code).toBe("42501");
  });

  // Data audit M3: BUILD_SPEC 6.2 errors block submit, and only the app looks for them.
  it("cannot submit directly: the app submits once its checks pass", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("update public.inspections set status = 'submitted', result = 'pass' where id = $1", [own.id]),
      ),
    );
    expect(error).toMatchObject({ code: "42501", message: "inspectors save and submit inspections through the app" });
    const after = await asOwner(db, async (tx) => ({
      status: (await column<string>(tx, "select status::text from public.inspections where id = $1", [own.id]))[0],
      events: await column<string>(tx, "select action from public.audit_log where inspection_id = $1 order by id", [
        own.id,
      ]),
    }));
    expect(after).toEqual({ status: "draft", events: ["created"] });
  });

  it("cannot jump a draft straight to approved or reopened", async () => {
    for (const status of ["approved", "reopened"] as const) {
      const error = await pgError(setStatus(db, people.inspector, own.id, status));
      expect(error.code).toBe("23514");
    }
  });

  it("cannot see or change another inspector's inspection", async () => {
    const changed = await asUser(db, people.inspector, async (tx) => [
      (await tx.query("update public.inspections set po_no = 'x' where id = $1", [others.id])).affectedRows,
      (await tx.query("delete from public.inspections where id = $1", [others.id])).affectedRows,
      (await tx.query("update public.inspection_photos set caption = 'x' where inspection_id = $1", [others.id]))
        .affectedRows,
    ]);
    expect(changed).toEqual([0, 0, 0]);
  });

  it("cannot add photos to another inspector's inspection", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.inspection_photos (inspection_id, storage_path) values ($1, $2)", [
          others.id,
          `${others.id}/${randomUUID()}.jpg`,
        ]),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("adds and retags photos on their draft, but cannot pick report photos", async () => {
    const photoPath = `${own.id}/${randomUUID()}.jpg`;
    const photo = await asUser(db, people.inspector, (tx) =>
      tx.query<{ id: string; created_by: string }>(
        `insert into public.inspection_photos (inspection_id, module_key, target, storage_path, thumb_path)
         values ($1, 'visual', 'size:M', $2, $3) returning id, created_by`,
        [own.id, photoPath, `${own.id}/thumbs/${randomUUID()}.jpg`],
      ),
    );
    expect(photo.rows[0].created_by).toBe(people.inspector);

    const retagged = await asUser(db, people.inspector, (tx) =>
      tx.query("update public.inspection_photos set module_key = 'watertight', caption = 'hole' where id = $1", [
        photo.rows[0].id,
      ]),
    );
    expect(retagged.affectedRows).toBe(1);

    const pick = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("update public.inspection_photos set include_in_report = true where id = $1", [
          photo.rows[0].id,
        ]),
      ),
    );
    expect(pick.code).toBe("42501");
  });

  it("attaches lab reports to their draft only, in their own name", async () => {
    const insertFile = (inspectionId: string, createdBy?: string) =>
      asUser(db, people.inspector, (tx) =>
        tx.query(
          `insert into public.inspection_files (inspection_id, module_key, kind, storage_path, name, created_by)
           values ($1, 'tensile', 'lab_report', $2, 'tensile.pdf', coalesce($3::uuid, auth.uid()))`,
          [inspectionId, `${inspectionId}/${randomUUID()}.pdf`, createdBy ?? null],
        ),
      );
    expect((await insertFile(own.id)).affectedRows).toBe(1);
    const foreign = await pgError(insertFile(others.id));
    const impersonated = await pgError(insertFile(own.id, people.otherInspector));
    expect([foreign.code, impersonated.code]).toEqual(["42501", "42501"]);
  });

  // Migration 20261026120000: Steri-AI's reading of a Source Document (status, summary, the proposals kept until a
  // capture screen fills them in, when it did) is recorded by the app with the secret key, never by the user's own
  // request.
  it("leaves Steri-AI's reading of their own file to the app", async () => {
    const insert = (columns: string, values: string) =>
      asUser(db, people.inspector, (tx) =>
        tx.query(
          `insert into public.inspection_files (inspection_id, module_key, kind, storage_path, name${columns})
           values ($1, 'source_documents', 'other', $2, 'form.jpg'${values}) returning id`,
          [own.id, `${own.id}/${randomUUID()}.jpg`],
        ),
      );
    const proposed = await pgError(insert(", ai_proposals", `, '{"sampling_plan": {}}'::jsonb`));
    const read = await pgError(insert(", ai_status, ai_summary", ", 'read', 'A form.'"));
    expect([proposed.code, read.code]).toEqual(["42501", "42501"]);

    const plain = await insert("", "");
    const id = (plain.rows[0] as { id: string }).id;
    const update = (set: string) =>
      asUser(db, people.inspector, (tx) => tx.query(`update public.inspection_files set ${set} where id = $1`, [id]));
    const refused = await Promise.all(
      ["ai_filled_at = now()", "ai_proposals = '{}'::jsonb", "ai_status = 'read'", "ai_read_at = now()", "ai_summary = 'Read.'"].map(
        (set) => pgError(update(set)),
      ),
    );
    expect(refused.map((error) => error.code)).toEqual(["42501", "42501", "42501", "42501", "42501"]);
    // Their other columns stay theirs to change.
    expect((await update("name = 'form-2.jpg'")).affectedRows).toBe(1);

    // The app, with the secret key: the reading, then the fill.
    const recorded = await asService(db, (tx) =>
      tx.query(
        `update public.inspection_files
            set ai_status = 'read', ai_read_at = now(), ai_summary = 'A form.',
                ai_proposals = '{"sampling_plan": {"sizes": {}}}'::jsonb, ai_filled_at = null
          where id = $1`,
        [id],
      ),
    );
    const filled = await asService(db, (tx) => tx.query("update public.inspection_files set ai_filled_at = now() where id = $1", [id]));
    expect([recorded.affectedRows, filled.affectedRows]).toEqual([1, 1]);
    // Proposals are a JSON object keyed by module, never anything else.
    const notObject = await pgError(
      asService(db, (tx) => tx.query(`update public.inspection_files set ai_proposals = '[]'::jsonb where id = $1`, [id])),
    );
    expect(notObject.code).toBe("23514");
  });

  it("cannot file a photo outside the inspection's folder or under someone else's name", async () => {
    const misfiled = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.inspection_photos (inspection_id, storage_path) values ($1, $2)", [
          own.id,
          `${others.id}/${randomUUID()}.jpg`,
        ]),
      ),
    );
    const malformed = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.inspection_photos (inspection_id, storage_path) values ($1, 'photo.jpg')", [
          own.id,
        ]),
      ),
    );
    const impersonated = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query(
          "insert into public.inspection_photos (inspection_id, storage_path, created_by) values ($1, $2, $3)",
          [own.id, `${own.id}/${randomUUID()}.jpg`, people.otherInspector],
        ),
      ),
    );
    expect([misfiled.code, malformed.code, impersonated.code]).toEqual(["23514", "23514", "42501"]);
  });

  it("cannot write AI reviews or decisions", async () => {
    const review = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.ai_reviews (inspection_id, inspection_updated_at) values ($1, now())", [
          own.id,
        ]),
      ),
    );
    const updated = await asUser(db, people.inspector, (tx) =>
      tx.query("update public.ai_reviews set summary = 'looks fine' where inspection_id = $1", [own.id]),
    );
    expect(review.code).toBe("42501");
    expect(updated.affectedRows).toBe(0);
  });

  it("cannot write the audit log directly", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.audit_log (inspection_id, action) values ($1, 'forged')", [own.id]),
      ),
    );
    expect(error.code).toBe("42501");
  });

  it("logs events on their own inspection only, and never the automatic ones", async () => {
    const logged = await asUser(db, people.inspector, (tx) =>
      tx.query<{ id: number }>("select public.log_inspection_event($1, 'photo.deleted', '{\"count\": 1}') as id", [
        own.id,
      ]),
    );
    expect(logged.rows[0].id).toBeGreaterThan(0);

    const foreign = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("select public.log_inspection_event($1, 'photo.deleted')", [others.id]),
      ),
    );
    const reserved = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("select public.log_inspection_event($1, 'status_changed')", [own.id]),
      ),
    );
    expect([foreign.code, reserved.code]).toEqual(["42501", "42501"]);
  });

  it("submits their draft, then cannot edit, approve or delete it", async () => {
    const submitted = await setStatus(db, people.inspector, own.id, "submitted");
    expect(submitted.submitted_at).not.toBeNull();

    const attempts = await asUser(db, people.inspector, async (tx) => [
      (await tx.query("update public.inspections set po_no = 'late edit' where id = $1", [own.id])).affectedRows,
      (await tx.query("update public.inspections set status = 'approved' where id = $1", [own.id])).affectedRows,
      (await tx.query("delete from public.inspections where id = $1", [own.id])).affectedRows,
      (await tx.query("update public.inspection_photos set caption = 'late' where inspection_id = $1", [own.id]))
        .affectedRows,
      (await tx.query("delete from public.inspection_photos where inspection_id = $1", [own.id])).affectedRows,
    ]);
    expect(attempts).toEqual([0, 0, 0, 0, 0]);

    const stored = await asOwner(db, (tx) =>
      tx.query<InspectionRow>("select * from public.inspections where id = $1", [own.id]),
    );
    expect(stored.rows[0]).toMatchObject({ status: "submitted", po_no: "PO-EDITED" });
  });

  it("can still read the submitted inspection and its evidence", async () => {
    const counts = await asUser(db, people.inspector, async (tx) => ({
      inspections: await visibleRows(tx, "inspections"),
      photos: (await column<string>(tx, "select id from public.inspection_photos where inspection_id = $1", [own.id]))
        .length,
    }));
    expect(counts.inspections).toBe(1);
    expect(counts.photos).toBeGreaterThan(0);
  });

  it("cannot add photos once submitted", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.inspection_photos (inspection_id, storage_path) values ($1, $2)", [
          own.id,
          `${own.id}/${randomUUID()}.jpg`,
        ]),
      ),
    );
    expect(error.code).toBe("42501");
  });
});
