import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  addPhoto,
  addReview,
  assignLead,
  createInspection,
  createLead,
  createPeople,
  createTemplate,
  setStatus,
  TABLES,
  visibleRows,
  type InspectionRow,
  type People,
} from "./fixtures";
import { asOwner, asService, asUser, column, createTestDb, pgError, type Db, type Tx } from "./harness";

/** A lab report row and its Storage object, as the service role. */
async function addStoredFile(db: Db, inspectionId: string, createdBy: string): Promise<string> {
  const path = `${inspectionId}/${randomUUID()}.pdf`;
  await asService(db, async (tx) => {
    await tx.query("insert into storage.objects (bucket_id, name, owner_id) values ('inspection-files', $1, $2)", [
      path,
      createdBy,
    ]);
    await tx.query(
      `insert into public.inspection_files (inspection_id, kind, storage_path, name, created_by)
       values ($1, 'lab_report', $2, 'lab-report.pdf', $3)`,
      [inspectionId, path, createdBy],
    );
  });
  return path;
}

/** The inspection ids each table shows the current session, sorted. */
async function seenInspections(tx: Tx) {
  const ids = (sql: string) => column<string>(tx, `${sql} order by 1`);
  return {
    inspections: await ids("select id::text from public.inspections"),
    photos: await ids("select distinct inspection_id::text from public.inspection_photos"),
    files: await ids("select distinct inspection_id::text from public.inspection_files"),
    reviews: await ids("select distinct inspection_id::text from public.ai_reviews"),
    decisions: await ids(
      "select distinct r.inspection_id::text from public.ai_review_actions a join public.ai_reviews r on r.id = a.ai_review_id",
    ),
    audit: await ids("select distinct inspection_id::text from public.audit_log where inspection_id is not null"),
    objects: await ids(
      "select distinct split_part(name, '/', 1) from storage.objects where bucket_id in ('inspection-photos', 'inspection-files')",
    ),
  };
}

const sorted = (...ids: string[]) => [...ids].sort();

// Lead inspectors read their team's inspections (migration 20261007170000):
// every status, with what the review shows, read-only. Their own work like
// any inspector's; everyone else keeps exactly what they had.
describe("RLS: lead inspector", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let lead: string;
  let otherLead: string;
  let templateId: string;
  /** The team member's inspections: a draft, a submitted one and an approved one. */
  let draft: InspectionRow;
  let submitted: InspectionRow;
  let approved: InspectionRow;
  /** Another team's. */
  let elsewhere: InspectionRow;
  /** The lead's own. */
  let own: InspectionRow;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    lead = await createLead(db, "lead@test.local", "Lina Lead");
    otherLead = await createLead(db, "lead2@test.local", "Leo Lead");
    await assignLead(db, people.inspector, lead);
    await assignLead(db, people.otherInspector, otherLead);
    templateId = await createTemplate(db);

    draft = await createInspection(db, people.inspector, templateId, { po_no: "PO-DRAFT" });
    submitted = await createInspection(db, people.inspector, templateId, { po_no: "PO-SUBMITTED" });
    approved = await createInspection(db, people.inspector, templateId, { po_no: "PO-APPROVED" });
    elsewhere = await createInspection(db, people.otherInspector, templateId, { po_no: "PO-ELSEWHERE" });
    own = await createInspection(db, lead, templateId, { po_no: "PO-LEAD" });
    for (const [inspection, owner] of [
      [draft.id, people.inspector],
      [submitted.id, people.inspector],
      [approved.id, people.inspector],
      [elsewhere.id, people.otherInspector],
      [own.id, lead],
    ] as const) {
      await addPhoto(db, inspection, owner);
      await addStoredFile(db, inspection, owner);
      await addReview(db, inspection, people.admin);
    }
    await setStatus(db, people.inspector, submitted.id, "submitted");
    await setStatus(db, people.inspector, approved.id, "submitted");
    await setStatus(db, people.admin, approved.id, "approved");
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("reads their team's inspections in every status, with their photos, files, AI reviews, decisions, history and stored files", async () => {
    const team = sorted(draft.id, submitted.id, approved.id);
    const seen = await asUser(db, lead, seenInspections);
    expect(seen).toEqual({
      inspections: sorted(...team, own.id),
      photos: sorted(...team, own.id),
      files: sorted(...team, own.id),
      reviews: sorted(...team, own.id),
      // Decisions on AI findings: their team's. Like any inspector, not their own.
      decisions: team,
      audit: sorted(...team, own.id),
      objects: sorted(...team, own.id),
    });
  });

  it("reads the profiles of their team, and nobody else's", async () => {
    const ids = await asUser(db, lead, (tx) => column<string>(tx, "select id from public.profiles"));
    expect(sorted(...ids)).toEqual(sorted(lead, people.inspector));
  });

  it("is told who is in their team, and nothing about anyone else's", async () => {
    const answers = await asUser(db, lead, async (tx) => ({
      isLead: (await column<boolean>(tx, "select public.is_lead()"))[0],
      team: (await column<string[]>(tx, "select public.my_team()"))[0],
      leadsMember: (await column<boolean>(tx, "select public.leads($1)", [people.inspector]))[0],
      leadsOther: (await column<boolean>(tx, "select public.leads($1)", [people.otherInspector]))[0],
      teamInspection: (await column<boolean>(tx, "select public.leads_inspection($1)", [draft.id]))[0],
      otherInspection: (await column<boolean>(tx, "select public.leads_inspection($1)", [elsewhere.id]))[0],
    }));
    expect(answers).toEqual({
      isLead: true,
      team: [people.inspector],
      leadsMember: true,
      leadsOther: false,
      teamInspection: true,
      otherInspection: false,
    });
  });

  it("leaves a team member seeing only their own, as before", async () => {
    const seen = await asUser(db, people.inspector, seenInspections);
    const mine = sorted(draft.id, submitted.id, approved.id);
    expect(seen).toEqual({
      inspections: mine,
      photos: mine,
      files: mine,
      reviews: mine,
      decisions: [],
      audit: mine,
      objects: mine,
    });
    const profiles = await asUser(db, people.inspector, (tx) => column<string>(tx, "select id from public.profiles"));
    expect(profiles).toEqual([people.inspector]);
    const helpers = await asUser(db, people.inspector, (tx) =>
      tx.query<{ is_lead: boolean; team: string[] }>("select public.is_lead() as is_lead, public.my_team() as team"),
    );
    expect(helpers.rows[0]).toEqual({ is_lead: false, team: [] });
  });

  it("changes nothing on a team inspection, its photos, files, reviews or history", async () => {
    const affected = await asUser(db, lead, async (tx) => [
      (await tx.query("update public.inspections set po_no = 'x' where id = $1", [draft.id])).affectedRows,
      (await tx.query("update public.inspections set status = 'approved' where id = $1", [submitted.id])).affectedRows,
      (await tx.query("update public.inspections set status = 'reopened' where id = $1", [submitted.id])).affectedRows,
      (await tx.query("update public.inspections set status = 'submitted' where id = $1", [draft.id])).affectedRows,
      (await tx.query("delete from public.inspections where id = $1", [draft.id])).affectedRows,
      (await tx.query("update public.inspection_photos set caption = 'x' where inspection_id = $1", [draft.id]))
        .affectedRows,
      (await tx.query("delete from public.inspection_photos where inspection_id = $1", [draft.id])).affectedRows,
      (await tx.query("update public.inspection_files set name = 'x.pdf' where inspection_id = $1", [draft.id]))
        .affectedRows,
      (await tx.query("delete from public.inspection_files where inspection_id = $1", [draft.id])).affectedRows,
      (await tx.query("update public.ai_reviews set summary = 'x' where inspection_id = $1", [draft.id])).affectedRows,
      (await tx.query("delete from public.ai_reviews where inspection_id = $1", [draft.id])).affectedRows,
      (await tx.query("update storage.objects set name = name || '.x' where name like $1", [`${draft.id}/%`]))
        .affectedRows,
      (await tx.query("delete from storage.objects where name like $1", [`${draft.id}/%`])).affectedRows,
    ]);
    expect(affected).toEqual(Array(affected.length).fill(0));

    const stored = await asOwner(db, (tx) =>
      tx.query<InspectionRow>("select status, po_no from public.inspections where id = any($1) order by po_no", [
        [draft.id, submitted.id],
      ]),
    );
    expect(stored.rows).toEqual([
      { status: "draft", po_no: "PO-DRAFT" },
      { status: "submitted", po_no: "PO-SUBMITTED" },
    ]);
  });

  it("adds nothing to a team inspection: no photo, file, upload, review, decision or event", async () => {
    const review = await asOwner(db, (tx) =>
      column<string>(tx, "select id from public.ai_reviews where inspection_id = $1", [submitted.id]),
    );
    const attempts = [];
    for (const attempt of [
        (tx: Tx) =>
          tx.query("insert into public.inspection_photos (inspection_id, storage_path) values ($1, $2)", [
            draft.id,
            `${draft.id}/${randomUUID()}.jpg`,
          ]),
        (tx: Tx) =>
          tx.query("insert into public.inspection_files (inspection_id, storage_path, name) values ($1, $2, 'x.pdf')", [
            draft.id,
            `${draft.id}/${randomUUID()}.pdf`,
          ]),
        (tx: Tx) =>
          tx.query("insert into storage.objects (bucket_id, name, owner_id) values ('inspection-photos', $1, auth.uid()::text)", [
            `${draft.id}/${randomUUID()}.jpg`,
          ]),
        (tx: Tx) =>
          tx.query("insert into storage.objects (bucket_id, name, owner_id) values ('inspection-files', $1, auth.uid()::text)", [
            `${draft.id}/${randomUUID()}.pdf`,
          ]),
        (tx: Tx) =>
          tx.query("insert into public.ai_reviews (inspection_id, inspection_updated_at) values ($1, now())", [submitted.id]),
        (tx: Tx) =>
          tx.query(
            "insert into public.ai_review_actions (ai_review_id, finding_id, action) values ($1, 'f1', 'agree')",
            [review[0]],
          ),
        (tx: Tx) => tx.query("select public.log_inspection_event($1, 'note')", [submitted.id]),
    ]) {
      attempts.push(await pgError(asUser(db, lead, attempt)));
    }
    expect(attempts.map((error) => error.code)).toEqual(Array(attempts.length).fill("42501"));
  });

  it("works on their own inspections like any inspector", async () => {
    const edited = await asUser(db, lead, (tx) =>
      tx.query("update public.inspections set po_no = 'PO-LEAD-2' where id = $1", [own.id]),
    );
    expect(edited.affectedRows).toBe(1);
    const photo = await asUser(db, lead, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name, owner_id) values ('inspection-photos', $1, auth.uid()::text)", [
        `${own.id}/${randomUUID()}.jpg`,
      ]),
    );
    expect(photo.affectedRows).toBe(1);
    const submittedOwn = await setStatus(db, lead, own.id, "submitted");
    expect(submittedOwn.status).toBe("submitted");
    // Approving is an admin's: the update finds nothing it may change.
    const approve = await asUser(db, lead, (tx) =>
      tx.query("update public.inspections set status = 'approved' where id = $1", [own.id]),
    );
    expect(approve.affectedRows).toBe(0);
  });

  it("is not read by the team, nor by the other lead", async () => {
    for (const userId of [people.inspector, people.otherInspector, otherLead]) {
      const ids = await asUser(db, userId, (tx) => column<string>(tx, "select id from public.inspections"));
      expect(ids, userId).not.toContain(own.id);
    }
  });

  it("leaves admins reading and changing everything, as before", async () => {
    const counts = await asUser(db, people.admin, async (tx) => {
      const result: Record<string, number> = {};
      for (const table of TABLES) result[table] = await visibleRows(tx, table);
      return result;
    });
    expect(counts.inspections).toBe(5);
    expect(counts.profiles).toBe(5);
    const changed = await asUser(db, people.admin, (tx) =>
      tx.query("update public.inspections set po_no = 'PO-DRAFT-ADMIN' where id = $1", [draft.id]),
    );
    expect(changed.affectedRows).toBe(1);
  });

  it("drops an inspector's inspections from the old lead's view once they move team", async () => {
    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set lead_id = $2 where id = $1", [people.inspector, otherLead]),
    );
    const oldLead = await asUser(db, lead, seenInspections);
    expect(oldLead.inspections).toEqual([own.id]);
    expect(oldLead.objects).toEqual([own.id]);
    const newLead = await asUser(db, otherLead, (tx) => column<string>(tx, "select id from public.inspections order by 1"));
    expect(newLead).toEqual(sorted(draft.id, submitted.id, approved.id, elsewhere.id));

    await asUser(db, people.admin, (tx) =>
      tx.query("update public.profiles set lead_id = $2 where id = $1", [people.inspector, lead]),
    );
    expect((await asUser(db, lead, seenInspections)).inspections).toEqual(sorted(draft.id, submitted.id, approved.id, own.id));
  });

  it("keeps showing the work of a team member who was deactivated", async () => {
    await asUser(db, people.admin, (tx) => tx.query("update public.profiles set active = false where id = $1", [people.inspector]));
    try {
      const seen = await asUser(db, lead, (tx) => column<string>(tx, "select id from public.inspections order by 1"));
      expect(seen).toEqual(sorted(draft.id, submitted.id, approved.id, own.id));
    } finally {
      await asUser(db, people.admin, (tx) => tx.query("update public.profiles set active = true where id = $1", [people.inspector]));
    }
  });

  it("shows a lead inspector who is deactivated nothing at all", async () => {
    // Refused while they lead a team (rule 5); only a repair with the guard off gets here.
    await asOwner(db, async (tx) => {
      await tx.exec("alter table public.profiles disable trigger org_guard");
      await tx.query("update public.profiles set active = false where id = $1", [lead]);
      await tx.exec("alter table public.profiles enable trigger org_guard");
    });
    try {
      const seen = await asUser(db, lead, async (tx) => {
        const result: Record<string, number> = {};
        for (const table of TABLES) result[table] = await visibleRows(tx, table);
        result["storage.objects"] = (await column<string>(tx, "select id from storage.objects")).length;
        return result;
      });
      expect(Object.values(seen).every((count) => count === 0)).toBe(true);
      const helpers = await asUser(db, lead, (tx) =>
        tx.query<{ is_lead: boolean; team: string[] }>("select public.is_lead() as is_lead, public.my_team() as team"),
      );
      expect(helpers.rows[0]).toEqual({ is_lead: false, team: [] });
    } finally {
      await asOwner(db, (tx) => tx.query("update public.profiles set active = true where id = $1", [lead]));
    }
  });
});
