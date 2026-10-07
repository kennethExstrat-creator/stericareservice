import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Tables } from "@/lib/supabase/database.types";
import { createInspection, createPeople, createTemplate, type People } from "./fixtures";
import { asOwner, asUser, column, createTestDb, pgError, type Db } from "./harness";

const malaysianYear = () =>
  new Intl.DateTimeFormat("en", { timeZone: "Asia/Kuala_Lumpur", year: "numeric" }).format(new Date());

describe("inspection reference numbers", { timeout: 30_000 }, () => {
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

  it("numbers inspections INS-<year in Malaysia>-<sequence of four digits>", async () => {
    const first = await createInspection(db, people.inspector, templateId);
    const second = await createInspection(db, people.otherInspector, templateId);
    const year = malaysianYear();
    expect(first.ref_no).toMatch(/^INS-\d{4}-\d{4,}$/);
    expect(first.ref_no).toBe(`INS-${year}-0001`);
    expect(second.ref_no).toBe(`INS-${year}-0002`);
  });

  it("keeps growing past 9999", async () => {
    await asOwner(db, (tx) => tx.query("select setval('public.inspection_ref_seq', 9999)"));
    const next = await createInspection(db, people.inspector, templateId);
    expect(next.ref_no).toBe(`INS-${malaysianYear()}-10000`);
  });

  it("takes the year from Malaysian time, not UTC", async () => {
    const refs = await asOwner(db, (tx) =>
      tx.query<{ before: string; after: string }>(
        `select public.inspection_ref('2026-12-31 15:59:59+00', 12) as before,
                public.inspection_ref('2026-12-31 16:00:00+00', 12) as after`,
      ),
    );
    expect(refs.rows[0]).toEqual({ before: "INS-2026-0012", after: "INS-2027-0012" });
  });

  it("rejects a ref_no supplied by the caller", async () => {
    const error = await pgError(
      asUser(db, people.inspector, (tx) =>
        tx.query("insert into public.inspections (template_id, ref_no) values ($1, 'INS-2026-0500')", [templateId]),
      ),
    );
    expect(error).toMatchObject({ code: "42501", message: "ref_no is assigned by the database" });
  });

  it("never hands out again a number freed by a deletion, even on the connection that drew it", async () => {
    // currval() still holds the freed number here; the database must not trust it.
    const error = await pgError(
      asUser(db, people.admin, async (tx) => {
        const made = await tx.query<{ id: string; ref_no: string }>(
          "insert into public.inspections (template_id, inspector_id) values ($1, $2) returning id, ref_no",
          [templateId, people.inspector],
        );
        // The list's Delete; an admin's own DELETE matches no row (migration 20261007193000).
        const deleted = await column<{ ref_no: string } | null>(tx, "select public.delete_draft_inspection($1)", [
          made.rows[0].id,
        ]);
        expect(deleted).toEqual([expect.objectContaining({ ref_no: made.rows[0].ref_no })]);
        return tx.query("insert into public.inspections (template_id, inspector_id, ref_no) values ($1, $2, $3)", [
          templateId,
          people.inspector,
          made.rows[0].ref_no,
        ]);
      }),
    );
    expect(error).toMatchObject({ code: "42501", message: "ref_no is assigned by the database" });
  });

  it("keeps the format when a repair switches the guard off", async () => {
    const error = await pgError(
      asOwner(db, async (tx) => {
        await tx.query("alter table public.inspections disable trigger guard");
        return tx.query("insert into public.inspections (template_id, inspector_id) values ($1, $2)", [
          templateId,
          people.inspector,
        ]);
      }),
    );
    expect(error).toMatchObject({ code: "23514", message: expect.stringContaining("inspections_ref_no_format") });
  });

  it("defaults the inspector, the date, the status and the data shape", async () => {
    const made = await createInspection(db, people.inspector, templateId);
    expect(made).toMatchObject({
      inspector_id: people.inspector,
      status: "draft",
      data: { modules: {}, custom: {} },
      module_overrides: {},
      lot_numbers: [],
    });
    expect(made.inspection_date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("rejects data without the modules and custom objects", async () => {
    const throughTheApp = await pgError(createInspection(db, people.inspector, templateId, { data: { modules: [] } }));
    const byAnAdmin = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query(
          `insert into public.inspections (template_id, inspector_id, data) values ($1, $2, '{"modules": []}')`,
          [templateId, people.inspector],
        ),
      ),
    );
    for (const error of [throughTheApp, byAnAdmin]) {
      expect(error).toMatchObject({ code: "23514", message: expect.stringContaining("inspections_data_shape") });
    }
  });

  it("finds inspections by lot number", async () => {
    const made = await createInspection(db, people.inspector, templateId, { lot_numbers: ["LOT-A1", "LOT-B2"] });
    const found = await asUser(db, people.inspector, (tx) =>
      column<string>(tx, "select id from public.inspections where lot_numbers @> array['LOT-B2']"),
    );
    expect(found).toEqual([made.id]);
  });
});

describe("templates once used", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;
  let templateId: string;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
    templateId = await createTemplate(db, { code: "SAFEDON_EG", standard: "ASTM_D6319" });
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  const editAsAdmin = (sql: string, params: unknown[]) => asUser(db, people.admin, (tx) => tx.query(sql, params));

  it("can be edited freely until an inspection uses them", async () => {
    const result = await editAsAdmin(
      `update public.templates set definition = '{"code": "SAFEDON_EG", "modules": [{"key": "header"}]}'
        where id = $1`,
      [templateId],
    );
    expect(result.affectedRows).toBe(1);
  });

  it.each([
    ["definition", `definition = '{"code": "SAFEDON_EG", "modules": []}'`],
    ["resolved", `resolved = '{"changed": true}'`],
    ["code", "code = 'SAFEDON_EG2'"],
    ["version", "version = 2"],
    ["scope", "standard = 'EN455'"],
  ])("freezes %s once used", async (_field, assignment) => {
    await createInspection(db, people.inspector, templateId);
    const error = await pgError(editAsAdmin(`update public.templates set ${assignment} where id = $1`, [templateId]));
    expect(error).toMatchObject({ code: "42501", message: expect.stringContaining("is in use") });
  });

  it("can still be retired, but not sent back to draft", async () => {
    const retired = await editAsAdmin("update public.templates set status = 'retired' where id = $1", [templateId]);
    expect(retired.affectedRows).toBe(1);
    const draft = await pgError(editAsAdmin("update public.templates set status = 'draft' where id = $1", [templateId]));
    expect(draft.code).toBe("42501");
  });

  it("cannot be deleted while inspections refer to them", async () => {
    const error = await pgError(editAsAdmin("delete from public.templates where id = $1", [templateId]));
    // on delete restrict: 23503 on Postgres 17 (Supabase), 23001 from Postgres 18 (PGlite 0.5).
    expect(["23503", "23001"]).toContain(error.code);
  });

  it("allows one active version per code", async () => {
    await createTemplate(db, { code: "STD_EG", version: 1, status: "active" });
    const second = await pgError(createTemplate(db, { code: "STD_EG", version: 2, status: "active" }));
    expect(second.code).toBe("23505");
    const draftV2 = await createTemplate(db, { code: "STD_EG", version: 2, status: "draft" });
    expect(draftV2).toBeTruthy();
  });

  it("keeps an inspection on the template version it started with", async () => {
    const newVersion = await createTemplate(db, { code: "SAFEDON_EG", version: 2, status: "active" });
    const made = await createInspection(db, people.inspector, newVersion);
    const error = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("update public.inspections set template_id = $2 where id = $1", [made.id, templateId]),
      ),
    );
    expect(error).toMatchObject({ code: "42501", message: "inspections.template_id cannot change" });
  });
});

describe("timestamps", { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  beforeAll(async () => {
    db = await createTestDb();
    people = await createPeople(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("sets created_at and updated_at itself and keeps created_at fixed", async () => {
    type Manufacturer = Tables<"manufacturers">;
    const made = await asUser(db, people.admin, (tx) =>
      tx.query<Manufacturer>(
        `insert into public.manufacturers (name, created_at, updated_at)
         values ('Backdated Gloves', '2000-01-01', '2000-01-01') returning *`,
      ),
    );
    const row = made.rows[0];
    expect(row.created_at.startsWith("2000")).toBe(false);
    expect(row.updated_at).toBe(row.created_at);

    const changed = await asUser(db, people.admin, (tx) =>
      tx.query<Manufacturer>(
        "update public.manufacturers set notes = 'x', created_at = '2000-01-01' where id = $1 returning *",
        [row.id],
      ),
    );
    expect(changed.rows[0].created_at).toBe(row.created_at);
    expect(changed.rows[0].updated_at > row.updated_at).toBe(true);
  });
});
