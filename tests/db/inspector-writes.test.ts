import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import {
  createInspection,
  createPeople,
  createTemplate,
  EMPTY_DATA,
  readInspection,
  saveInspection,
  setStatus,
  submitInspection,
  type InspectionRow,
  type MirroredColumns,
  type People,
} from "./fixtures";
import { asAnon, asOwner, asService, asUser, column, createAuthUser, createTestDb, pgError, type Db, type Tx } from "./harness";

/**
 * Migration 20261007190000 (final audit: security SEC-02 and SEC-03, data M3).
 * An inspector's inspection is created, saved and submitted by the app with
 * the secret key, through create_inspection(), save_inspection() and
 * submit_inspection(), after the app's own checks; the Data API refuses the
 * inspector's own writes. And an inspector records only the events the app
 * records for them.
 */

type AuditRow = Tables<"audit_log">;

const HARTALEGA = "10000000-0000-4000-8000-000000000001";
const TERANG_NUSA = "10000000-0000-4000-8000-000000000002";
const POLYCO = "20000000-0000-4000-8000-000000000001";

/** What lib/inspections/capture/mirror.ts writes for a finished inspection. */
const MIRRORED: Required<MirroredColumns> = {
  po_no: "PO-4501",
  product_name: "Nitrile examination gloves",
  lot_numbers: ["LOT-A1", "LOT-B2"],
  inspection_date: "2026-10-05",
  remarks: "Cartons in good order",
  result: "pass",
  suggested_result: "pass",
};

const SAVED_DATA = { modules: { header: { poNo: "PO-4501" } }, custom: {} };

/** The keys the functions refuse in mirrored_columns: none of them repeats the data. */
const NOT_MIRRORED: [string, unknown][] = [
  ["status", "submitted"],
  ["client_id", POLYCO],
  ["manufacturer_id", TERANG_NUSA],
  ["template_id", randomUUID()],
  ["inspector_id", randomUUID()],
  ["report_url", "https://example.com/report.pdf"],
  ["module_overrides", { weight: { reason: "no scale" } }],
  ["submitted_at", "2026-10-07T10:14:38Z"],
  ["data", EMPTY_DATA],
];

async function auditTrail(db: Db, inspectionId: string): Promise<Pick<AuditRow, "action" | "actor_id" | "changes">[]> {
  const result = await asOwner(db, (tx) =>
    tx.query<AuditRow>("select * from public.audit_log where inspection_id = $1 order by id", [inspectionId]),
  );
  return result.rows.map(({ action, actor_id, changes }) => ({ action, actor_id, changes }));
}

async function count(db: Db, sql: string, params: unknown[] = []): Promise<number> {
  return (await asOwner(db, (tx) => column<string>(tx, sql, params))).length;
}

/** Who auth.uid() and auth.role() say the caller is, in the same transaction. */
async function whoAmI(tx: Tx): Promise<{ uid: string | null; role: string | null }> {
  const result = await tx.query<{ uid: string | null; role: string | null }>("select auth.uid() as uid, auth.role() as role");
  return result.rows[0];
}

describe("create_inspection()", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;
  let draftTemplateId: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
    draftTemplateId = await createTemplate(db, { code: "STD_SG", product_type: "surgical", status: "draft" });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("starts the actor's own draft with the data and the mirrored columns the app sends", async () => {
    const made = await createInspection(db, people.inspector, templateId, {
      client_id: POLYCO,
      manufacturer_id: HARTALEGA,
      data: SAVED_DATA,
      ...MIRRORED,
    });
    expect(made).toMatchObject({
      inspector_id: people.inspector,
      template_id: templateId,
      client_id: POLYCO,
      manufacturer_id: HARTALEGA,
      status: "draft",
      data: SAVED_DATA,
      module_overrides: {},
      report_url: null,
      submitted_at: null,
      ...MIRRORED,
    });
    expect(made.ref_no).toMatch(/^INS-\d{4}-\d{4,}$/);
  });

  it("names the inspector, not the service role, as the one who created it", async () => {
    const made = await createInspection(db, people.inspector, templateId);
    expect(await auditTrail(db, made.id)).toEqual([
      {
        action: "created",
        actor_id: people.inspector,
        changes: { ref_no: made.ref_no, status: "draft", template_id: templateId, inspector_id: people.inspector },
      },
    ]);
  });

  it("gives what the app leaves out the column defaults", async () => {
    const made = await createInspection(db, people.inspector, templateId);
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
    expect(made).toMatchObject({
      data: EMPTY_DATA,
      lot_numbers: [],
      inspection_date: today,
      po_no: null,
      product_name: null,
      remarks: null,
      result: null,
      suggested_result: null,
      client_id: null,
      manufacturer_id: null,
    });
  });

  it("puts the caller's claims back once the draft is written", async () => {
    const seen = await asService(db, async (tx) => {
      await tx.query("select public.create_inspection($1, $2, $3)", [people.inspector, templateId, HARTALEGA]);
      return whoAmI(tx);
    });
    expect(seen).toEqual({ uid: null, role: "service_role" });
  });

  it("is for the secret key only: signed-in users, admins included, and anon cannot call it", async () => {
    const call = (tx: Tx) =>
      tx.query("select public.create_inspection($1, $2, $3)", [people.inspector, templateId, HARTALEGA]);
    for (const attempt of [
      () => asUser(db, people.inspector, call),
      () => asUser(db, people.admin, call),
      () => asAnon(db, call),
    ]) {
      expect(await pgError(attempt())).toMatchObject({
        code: "42501",
        message: "permission denied for function create_inspection",
      });
    }
  });

  it("refuses an actor whose account is not active, or who does not exist", async () => {
    const pending = await createAuthUser(db, { email: "pending@test.local", fullName: "Pat Pending", active: false });
    const before = await count(db, "select id::text from public.inspections");
    for (const actor of [pending, randomUUID(), null]) {
      const error = await pgError(
        asService(db, (tx) => tx.query("select public.create_inspection($1, $2, $3)", [actor, templateId, HARTALEGA])),
      );
      expect(error, String(actor)).toMatchObject({ code: "42501", message: "the account is not active" });
    }
    expect(await count(db, "select id::text from public.inspections")).toBe(before);
  });

  it("starts an inspector from an active template only, and an admin from any", async () => {
    const error = await pgError(createInspection(db, people.inspector, draftTemplateId));
    expect(error).toMatchObject({ code: "23514", message: "inspections start from an active template" });
    const missing = await pgError(createInspection(db, people.inspector, randomUUID()));
    expect(missing.code).toBe("23514");

    const byAdmin = await createInspection(db, people.admin, draftTemplateId);
    expect(byAdmin).toMatchObject({ inspector_id: people.admin, template_id: draftTemplateId, status: "draft" });
  });

  it.each(NOT_MIRRORED)("takes no %s among the mirrored columns", async (key, value) => {
    const error = await pgError(
      asService(db, (tx) =>
        tx.query("select public.create_inspection($1, $2, $3, mirrored_columns => $4)", [
          people.inspector,
          templateId,
          HARTALEGA,
          JSON.stringify({ po_no: "PO-1", [key]: value }),
        ]),
      ),
    );
    expect(error).toMatchObject({ code: "22023", message: expect.stringContaining("mirrored_columns holds only") });
  });

  it("refuses mirrored columns that are not an object", async () => {
    for (const columns of [["po_no"], "po_no"]) {
      const error = await pgError(
        asService(db, (tx) =>
          tx.query("select public.create_inspection($1, $2, $3, mirrored_columns => $4)", [
            people.inspector,
            templateId,
            HARTALEGA,
            JSON.stringify(columns),
          ]),
        ),
      );
      expect(error.code, JSON.stringify(columns)).toBe("22023");
    }
  });
});

describe("save_inspection()", { timeout: 30_000 }, () => {
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

  const draftOf = (owner: string) =>
    createInspection(db, owner, templateId, { client_id: POLYCO, manufacturer_id: HARTALEGA, po_no: "PO-START" });

  it("saves the data and the mirrored columns at the version the device edited, and answers the new version", async () => {
    const draft = await draftOf(people.inspector);
    const saved = await saveInspection(db, people.inspector, draft.id, {
      data: SAVED_DATA,
      columns: MIRRORED,
      baseUpdatedAt: draft.updated_at,
    });
    expect(saved).not.toBeNull();
    expect(saved! > draft.updated_at).toBe(true);
    expect(await readInspection(db, draft.id)).toMatchObject({
      ...MIRRORED,
      data: SAVED_DATA,
      updated_at: saved,
      // Never changed by a save.
      status: "draft",
      client_id: POLYCO,
      manufacturer_id: HARTALEGA,
      template_id: templateId,
      inspector_id: people.inspector,
      module_overrides: {},
    });
    // A save is not an event: the trail still holds only the creation.
    expect((await auditTrail(db, draft.id)).map((row) => row.action)).toEqual(["created"]);
  });

  it("keeps the columns the app leaves out", async () => {
    const draft = await draftOf(people.inspector);
    await saveInspection(db, people.inspector, draft.id, { columns: { product_name: "Gloves" } });
    expect(await readInspection(db, draft.id)).toMatchObject({ po_no: "PO-START", product_name: "Gloves" });
  });

  it("writes nothing once another save moved the version on: the app answers a conflict", async () => {
    const draft = await draftOf(people.inspector);
    expect(await saveInspection(db, people.inspector, draft.id, { columns: { po_no: "PO-DEVICE-1" } })).not.toBeNull();
    const stale = await saveInspection(db, people.inspector, draft.id, {
      columns: { po_no: "PO-DEVICE-2" },
      baseUpdatedAt: draft.updated_at,
    });
    expect(stale).toBeNull();
    expect((await readInspection(db, draft.id))?.po_no).toBe("PO-DEVICE-1");
  });

  it("writes nothing for an actor who is neither its inspector nor an admin", async () => {
    const draft = await draftOf(people.inspector);
    expect(await saveInspection(db, people.otherInspector, draft.id, { columns: { po_no: "PO-OTHER" } })).toBeNull();
    expect((await readInspection(db, draft.id))?.po_no).toBe("PO-START");
  });

  it("writes nothing on an inspection that is submitted or approved, or that does not exist", async () => {
    const submitted = await draftOf(people.inspector);
    await setStatus(db, people.inspector, submitted.id, "submitted");
    const approved = await draftOf(people.inspector);
    await setStatus(db, people.inspector, approved.id, "submitted");
    await setStatus(db, people.admin, approved.id, "approved");

    for (const [inspection, actor] of [
      [submitted, people.inspector],
      [submitted, people.admin],
      [approved, people.inspector],
      [approved, people.admin],
    ] as const) {
      expect(await saveInspection(db, actor, inspection.id, { columns: { po_no: "PO-LATE" } })).toBeNull();
      expect((await readInspection(db, inspection.id))?.po_no).toBe("PO-START");
    }
    expect(await saveInspection(db, people.inspector, randomUUID(), { baseUpdatedAt: submitted.updated_at })).toBeNull();
  });

  it("saves a reopened inspection for its inspector, and any draft for an admin", async () => {
    const reopened = await draftOf(people.inspector);
    await setStatus(db, people.inspector, reopened.id, "submitted");
    await setStatus(db, people.admin, reopened.id, "reopened");
    expect(await saveInspection(db, people.inspector, reopened.id, { columns: { remarks: "Fixed" } })).not.toBeNull();

    const draft = await draftOf(people.otherInspector);
    expect(await saveInspection(db, people.admin, draft.id, { columns: { remarks: "Admin" } })).not.toBeNull();
    expect((await readInspection(db, reopened.id))?.remarks).toBe("Fixed");
    expect((await readInspection(db, draft.id))?.remarks).toBe("Admin");
  });

  it("is for the secret key only: the inspector's own session cannot call it", async () => {
    const draft = await draftOf(people.inspector);
    const call = (tx: Tx) =>
      tx.query("select public.save_inspection($1, $2, $3, $4)", [
        draft.id,
        people.inspector,
        draft.updated_at,
        JSON.stringify({ modules: { sampling_plan: { anything: "goes" } }, custom: {} }),
      ]);
    for (const attempt of [() => asUser(db, people.inspector, call), () => asUser(db, people.admin, call), () => asAnon(db, call)]) {
      expect(await pgError(attempt())).toMatchObject({ code: "42501", message: "permission denied for function save_inspection" });
    }
    expect((await readInspection(db, draft.id))?.data).toEqual(EMPTY_DATA);
  });

  it("refuses an actor whose account is not active", async () => {
    const leaving = await createAuthUser(db, { email: "leaving@test.local", fullName: "Lee Leaving" });
    const draft = await draftOf(leaving);
    await asOwner(db, (tx) => tx.query("update public.profiles set active = false where id = $1", [leaving]));
    const error = await pgError(saveInspection(db, leaving, draft.id, { columns: { po_no: "PO-GONE" } }));
    expect(error).toMatchObject({ code: "42501", message: "the account is not active" });
  });

  it.each(NOT_MIRRORED)("takes no %s among the mirrored columns", async (key, value) => {
    const draft = await draftOf(people.inspector);
    const error = await pgError(saveInspection(db, people.inspector, draft.id, { columns: { [key]: value } as MirroredColumns }));
    expect(error).toMatchObject({ code: "22023", message: expect.stringContaining("mirrored_columns holds only") });
    expect(await readInspection(db, draft.id)).toMatchObject({ status: "draft", client_id: POLYCO, manufacturer_id: HARTALEGA });
  });
});

describe("submit_inspection()", { timeout: 30_000 }, () => {
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

  const draftOf = (owner: string) => createInspection(db, owner, templateId, { po_no: "PO-SAVED", result: null });

  it("submits at the version the app checked, with the mirrored columns written again, and names the inspector", async () => {
    const draft = await draftOf(people.inspector);
    const submitted = await submitInspection(db, people.inspector, draft.id, {
      columns: { ...MIRRORED, suggested_result: "fail", result: "fail" },
      baseUpdatedAt: draft.updated_at,
    });
    expect(submitted).not.toBeNull();
    const row = await readInspection(db, draft.id);
    expect(row).toMatchObject({ ...MIRRORED, suggested_result: "fail", result: "fail", status: "submitted", updated_at: submitted });
    expect(row?.submitted_at).not.toBeNull();
    expect(await auditTrail(db, draft.id)).toEqual([
      expect.objectContaining({ action: "created", actor_id: people.inspector }),
      { action: "status_changed", actor_id: people.inspector, changes: { from: "draft", to: "submitted" } },
    ]);
  });

  it("puts the caller's claims back once it is submitted", async () => {
    const draft = await draftOf(people.inspector);
    const seen = await asService(db, async (tx) => {
      await tx.query("select public.submit_inspection($1, $2, $3)", [draft.id, people.inspector, draft.updated_at]);
      return whoAmI(tx);
    });
    expect(seen).toEqual({ uid: null, role: "service_role" });
  });

  it("writes nothing when the inspection changed after the app checked it", async () => {
    const draft = await draftOf(people.inspector);
    await saveInspection(db, people.inspector, draft.id, { columns: { po_no: "PO-NEWER" } });
    expect(await submitInspection(db, people.inspector, draft.id, { baseUpdatedAt: draft.updated_at })).toBeNull();
    expect(await readInspection(db, draft.id)).toMatchObject({ status: "draft", po_no: "PO-NEWER", submitted_at: null });
    expect((await auditTrail(db, draft.id)).map((row) => row.action)).toEqual(["created"]);
    expect(await submitInspection(db, people.inspector, randomUUID(), { baseUpdatedAt: draft.updated_at })).toBeNull();
  });

  it("refuses an actor who is neither its inspector nor an admin", async () => {
    const draft = await draftOf(people.inspector);
    const error = await pgError(submitInspection(db, people.otherInspector, draft.id));
    expect(error).toMatchObject({ code: "42501", message: "only the inspector or an admin can submit" });
    expect((await readInspection(db, draft.id))?.status).toBe("draft");
  });

  it("refuses an inspection that is already submitted or approved", async () => {
    const draft = await draftOf(people.inspector);
    await setStatus(db, people.inspector, draft.id, "submitted");
    const again = await pgError(submitInspection(db, people.inspector, draft.id));
    expect(again).toMatchObject({ code: "23514", message: "status cannot change from submitted to submitted" });
    await setStatus(db, people.admin, draft.id, "approved");
    const approved = await pgError(submitInspection(db, people.admin, draft.id));
    expect(approved).toMatchObject({ code: "23514", message: "status cannot change from approved to submitted" });
  });

  it("submits a reopened inspection again, and lets an admin submit for the inspector", async () => {
    const reopened = await draftOf(people.inspector);
    await setStatus(db, people.inspector, reopened.id, "submitted");
    await setStatus(db, people.admin, reopened.id, "reopened");
    expect(await submitInspection(db, people.inspector, reopened.id)).not.toBeNull();

    const draft = await draftOf(people.otherInspector);
    expect(await submitInspection(db, people.admin, draft.id)).not.toBeNull();

    expect((await auditTrail(db, reopened.id)).slice(1).map(({ actor_id, changes }) => [actor_id, changes])).toEqual([
      [people.inspector, { from: "draft", to: "submitted" }],
      [people.admin, { from: "submitted", to: "reopened" }],
      [people.inspector, { from: "reopened", to: "submitted" }],
    ]);
    expect((await auditTrail(db, draft.id)).at(-1)).toEqual({
      action: "status_changed",
      actor_id: people.admin,
      changes: { from: "draft", to: "submitted" },
    });
  });

  it("is for the secret key only: the inspector's own session cannot call it", async () => {
    const draft = await draftOf(people.inspector);
    const call = (tx: Tx) =>
      tx.query("select public.submit_inspection($1, $2, $3, $4)", [
        draft.id,
        people.inspector,
        draft.updated_at,
        JSON.stringify({ result: "pass", suggested_result: "pass" }),
      ]);
    for (const attempt of [() => asUser(db, people.inspector, call), () => asUser(db, people.admin, call), () => asAnon(db, call)]) {
      expect(await pgError(attempt())).toMatchObject({ code: "42501", message: "permission denied for function submit_inspection" });
    }
    expect(await readInspection(db, draft.id)).toMatchObject({ status: "draft", result: null });
  });

  it("refuses an actor whose account is not active", async () => {
    const leaving = await createAuthUser(db, { email: "leaving@test.local", fullName: "Lee Leaving" });
    const draft = await draftOf(leaving);
    await asOwner(db, (tx) => tx.query("update public.profiles set active = false where id = $1", [leaving]));
    const error = await pgError(submitInspection(db, leaving, draft.id));
    expect(error).toMatchObject({ code: "42501", message: "the account is not active" });
    expect((await readInspection(db, draft.id))?.status).toBe("draft");
  });
});

// Security audit SEC-02, as it was reproduced: the owner's session and the
// publishable key, straight at the table.
describe("the Data API, for an inspector's own inspection", { timeout: 30_000 }, () => {
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

  const forged = `update public.inspections
                     set data = '{"modules": {"header": {"poNo": 12345, "inspectionDate": "31/02/2026"}, "sampling_plan": {"anything": "goes"}}, "custom": {}}',
                         suggested_result = 'pass', result = 'pass', lot_numbers = '{FORGED-LOT}', po_no = 'FORGED-PO',
                         status = 'submitted'
                   where id = $1
               returning *`;

  it("refuses invalid data, forged results and a submit, on a draft and on a reopened inspection", async () => {
    const draft = await createInspection(db, people.inspector, templateId, { po_no: "PO-REAL" });
    const reopened = await createInspection(db, people.inspector, templateId, { po_no: "PO-REAL" });
    await setStatus(db, people.inspector, reopened.id, "submitted");
    await setStatus(db, people.admin, reopened.id, "reopened");

    for (const inspection of [draft, reopened]) {
      const before = await readInspection(db, inspection.id);
      const error = await pgError(asUser(db, people.inspector, (tx) => tx.query(forged, [inspection.id])));
      expect(error).toMatchObject({ code: "42501", message: "inspectors save and submit inspections through the app" });
      expect(await readInspection(db, inspection.id)).toEqual(before);
    }
  });

  it("refuses moving it to another client or manufacturer", async () => {
    const draft = await createInspection(db, people.inspector, templateId, { client_id: POLYCO, manufacturer_id: HARTALEGA });
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("update public.inspections set manufacturer_id = $2, client_id = null where id = $1", [draft.id, TERANG_NUSA]),
      ),
    );
    expect(error.code).toBe("42501");
    expect(await readInspection(db, draft.id)).toMatchObject({ client_id: POLYCO, manufacturer_id: HARTALEGA });
  });

  it("refuses the update even with the guard switched off: row level security checks for an admin", async () => {
    const draft = await createInspection(db, people.inspector, templateId);
    const error = await pgError(
      asOwner(db, async (tx) => {
        await tx.query("alter table public.inspections disable trigger guard");
        await tx.query(
          "select set_config('role', 'authenticated', true), set_config('request.jwt.claims', $1, true)",
          [JSON.stringify({ sub: people.inspector, role: "authenticated" })],
        );
        await tx.query("update public.inspections set result = 'pass' where id = $1", [draft.id]);
        // Reached only if the update went through: the guard must not stay off.
        await tx.rollback();
      }),
    );
    expect(error).toMatchObject({ code: "42501", message: expect.stringContaining("row-level security") });
  });

  it("leaves admins their direct writes: data of a submitted inspection, overrides, approval and the report link", async () => {
    const made = await createInspection(db, people.inspector, templateId);
    await setStatus(db, people.inspector, made.id, "submitted");
    const mapped = { modules: { visual: { mapped: true } }, custom: {} };
    await asUser(db, people.admin, async (tx) => {
      // The defect label mapping (lib/admin/defects.ts) and a module switched off.
      await tx.query("update public.inspections set data = $2 where id = $1 and status = 'submitted'", [
        made.id,
        JSON.stringify(mapped),
      ]);
      await tx.query("update public.inspections set module_overrides = $2, suggested_result = 'hold' where id = $1", [
        made.id,
        JSON.stringify({ weight: { reason: "Scale broken", by: people.admin, at: "2026-10-07T08:00:00Z" } }),
      ]);
      await tx.query("update public.inspections set status = 'approved' where id = $1", [made.id]);
      await tx.query("update public.inspections set report_url = 'https://reports.example.com/x.pdf' where id = $1", [
        made.id,
      ]);
    });
    expect(await readInspection(db, made.id)).toMatchObject({
      data: mapped,
      suggested_result: "hold",
      status: "approved",
      approved_by: people.admin,
      report_url: "https://reports.example.com/x.pdf",
    });
  });
});

// Security audit SEC-03.
describe("log_inspection_event() for an inspector", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;
  let lead: string;
  let draft: InspectionRow;
  let reopened: InspectionRow;
  let submitted: InspectionRow;
  let approved: InspectionRow;

  const log = (userId: string, inspectionId: string, action: string, changes: unknown = {}) =>
    asUser(db, userId, (tx) =>
      column<number>(tx, "select public.log_inspection_event($1, $2, $3)", [inspectionId, action, JSON.stringify(changes)]),
    ).then((ids) => ids[0]);

  const events = (inspectionId: string) =>
    asOwner(db, (tx) =>
      column<string>(tx, "select action from public.audit_log where inspection_id = $1 order by id", [inspectionId]),
    );

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db);
    lead = await createAuthUser(db, { email: "lead@test.local", fullName: "Lina Lead" });
    await asOwner(db, async (tx) => {
      await tx.query("update public.profiles set is_lead = true where id = $1", [lead]);
      await tx.query("update public.profiles set lead_id = $2 where id = $1", [people.inspector, lead]);
    });
    draft = await createInspection(db, people.inspector, templateId);
    reopened = await createInspection(db, people.inspector, templateId);
    submitted = await createInspection(db, people.inspector, templateId);
    approved = await createInspection(db, people.inspector, templateId);
    for (const inspection of [reopened, submitted, approved]) await setStatus(db, people.inspector, inspection.id, "submitted");
    await setStatus(db, people.admin, reopened.id, "reopened");
    await setStatus(db, people.admin, approved.id, "approved");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("records the events the app records for them, on their draft or reopened inspection, in their name", async () => {
    const recorded = [
      await log(people.inspector, draft.id, "photo.deleted", { photo_id: randomUUID(), module_key: "visual" }),
      await log(people.inspector, draft.id, "file.deleted", { file_id: randomUUID(), name: "tensile.pdf" }),
      await log(people.inspector, draft.id, "started_from_previous", { from: { id: randomUUID(), ref_no: "INS-2026-0001" } }),
      await log(people.inspector, reopened.id, "photo.deleted", { photo_id: randomUUID() }),
    ];
    expect(recorded.every((id) => id > 0)).toBe(true);
    const actors = await asOwner(db, (tx) =>
      column<string>(tx, "select distinct actor_id::text from public.audit_log where id = any($1::bigint[])", [recorded]),
    );
    expect(actors).toEqual([people.inspector]);
  });

  it.each([
    "review.reopened",
    "ai_report.sent",
    "ai_review.requested",
    "module_override",
    "template_chosen",
    "verifier.blob",
  ])("refuses %s, which is not theirs to record", async (action) => {
    const error = await pgError(log(people.inspector, draft.id, action, { reason: "Approved by phone" }));
    expect(error).toMatchObject({ code: "42501", message: `an inspector cannot record ${action}` });
  });

  it("records nothing on their inspection once it is submitted or approved", async () => {
    const before = { submitted: await events(submitted.id), approved: await events(approved.id) };
    for (const inspection of [submitted, approved]) {
      for (const action of ["photo.deleted", "ai_report.sent", "review.reopened"]) {
        const error = await pgError(log(people.inspector, inspection.id, action, { note: "x" }));
        expect(error.code, `${action} on ${inspection.status}`).toBe("42501");
      }
    }
    expect({ submitted: await events(submitted.id), approved: await events(approved.id) }).toEqual(before);
  });

  it("records at most 8 kB of changes for them", async () => {
    const fits = await log(people.inspector, draft.id, "file.deleted", { name: "x".repeat(7_000) });
    expect(fits).toBeGreaterThan(0);
    for (const size of [9_000, 1_000_000]) {
      const error = await pgError(log(people.inspector, draft.id, "file.deleted", { name: "x".repeat(size) }));
      expect(error, String(size)).toMatchObject({ code: "22023", message: "an event records at most 8 kB of changes" });
    }
  });

  it("gives a lead inspector nothing to record on their team's inspections", async () => {
    for (const inspection of [draft, approved]) {
      const error = await pgError(log(lead, inspection.id, "photo.deleted"));
      expect(error).toMatchObject({ code: "42501", message: `inspection ${inspection.id} not found` });
    }
  });

  it("leaves admins and the service role every event, approved inspections and large changes included", async () => {
    const large = { reportUrl: "https://reports.example.com/x.pdf", note: "y".repeat(20_000) };
    expect(await log(people.admin, approved.id, "ai_report.sent", large)).toBeGreaterThan(0);
    expect(await log(people.admin, submitted.id, "review.reopened", { reason: "Weights missing" })).toBeGreaterThan(0);
    const byService = await asService(db, (tx) =>
      column<number>(tx, "select public.log_inspection_event($1, 'ai_review.done', $2)", [approved.id, JSON.stringify(large)]),
    );
    expect(byService[0]).toBeGreaterThan(0);
  });
});

/**
 * Migration 20261026130000 (Kenneth, 26 October 2026): a save with audit rows,
 * a Dimension P/F set by hand or a spec changed for the inspection, writes the
 * data and the rows in one transaction, or neither.
 */
describe("save_inspection_with_events()", { timeout: 30_000 }, () => {
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

  const draftOf = (owner: string) => createInspection(db, owner, templateId, { client_id: POLYCO, manufacturer_id: HARTALEGA });
  const CHANGE = { module: "dimensions", size: "M", column: "width", from: null, to: "fail", calculated: "pass", comment: "Torn cuffs." };
  const SPEC = { module: "dimensions", size: "M", column: "fingerThickness", from: { kind: "tolerance", nominal: 0.18, tolerance: 0.04 }, to: { kind: "na" } };
  const save = (actorId: string, inspectionId: string, baseUpdatedAt: string, events: unknown, data: unknown = SAVED_DATA) =>
    asService(db, (tx) =>
      column<string | null>(
        tx,
        `select public.save_inspection_with_events(
           inspection_id => $1, actor_id => $2, base_updated_at => $3, data => $4, mirrored_columns => '{}', events => $5)`,
        [inspectionId, actorId, baseUpdatedAt, JSON.stringify(data), JSON.stringify(events)],
      ),
    );

  it("saves the data and writes each event as an audit row in the actor's name, in order", async () => {
    const draft = await draftOf(people.inspector);
    const second = { ...CHANGE, column: "length", to: "pass" };
    const saved = await save(people.inspector, draft.id, draft.updated_at, [
      { action: "spec_changed", changes: SPEC },
      { action: "pass_fail_changed", changes: CHANGE },
      { action: "pass_fail_changed", changes: second },
    ]);
    expect(saved[0]).not.toBeNull();
    expect((await readInspection(db, draft.id))?.data).toEqual(SAVED_DATA);
    expect(await auditTrail(db, draft.id)).toEqual([
      expect.objectContaining({ action: "created" }),
      { action: "spec_changed", actor_id: people.inspector, changes: SPEC },
      { action: "pass_fail_changed", actor_id: people.inspector, changes: CHANGE },
      { action: "pass_fail_changed", actor_id: people.inspector, changes: second },
    ]);
  });

  it("writes neither the data nor the rows once another save moved the version on", async () => {
    const draft = await draftOf(people.inspector);
    expect(await saveInspection(db, people.inspector, draft.id, { columns: { po_no: "PO-DEVICE-1" } })).not.toBeNull();
    const stale = await save(people.inspector, draft.id, draft.updated_at, [{ action: "pass_fail_changed", changes: CHANGE }]);
    expect(stale[0]).toBeNull();
    expect((await readInspection(db, draft.id))?.data).toEqual(EMPTY_DATA);
    expect((await auditTrail(db, draft.id)).map((row) => row.action)).toEqual(["created"]);
  });

  it("refuses any other event, or events that are no list, and then writes nothing", async () => {
    const draft = await draftOf(people.inspector);
    for (const events of [
      [{ action: "status_changed", changes: {} }],
      [{ action: "spec_changed", changes: SPEC }, { action: "approved", changes: {} }],
      [{ action: "pass_fail_changed" }],
      [{ action: "spec_changed", changes: "NA" }],
      { action: "pass_fail_changed" },
    ]) {
      expect(await pgError(save(people.inspector, draft.id, draft.updated_at, events))).toMatchObject({ code: "22023" });
    }
    expect((await readInspection(db, draft.id))?.data).toEqual(EMPTY_DATA);
    expect((await auditTrail(db, draft.id)).map((row) => row.action)).toEqual(["created"]);
  });

  it("is for the secret key only: signed-in sessions and anon cannot call it", async () => {
    const draft = await draftOf(people.inspector);
    const call = (tx: Tx) =>
      tx.query("select public.save_inspection_with_events($1, $2, $3, $4, '{}', $5)", [
        draft.id,
        people.inspector,
        draft.updated_at,
        JSON.stringify(SAVED_DATA),
        JSON.stringify([{ action: "pass_fail_changed", changes: CHANGE }]),
      ]);
    for (const attempt of [() => asUser(db, people.inspector, call), () => asUser(db, people.admin, call), () => asAnon(db, call)]) {
      expect(await pgError(attempt())).toMatchObject({ code: "42501", message: "permission denied for function save_inspection_with_events" });
    }
    expect((await auditTrail(db, draft.id)).map((row) => row.action)).toEqual(["created"]);
  });
});
