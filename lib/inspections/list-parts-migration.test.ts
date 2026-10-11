// The database half of the inspections list across PO parts (migration
// 20261011150400): the parts_* computed columns through which a first part
// stands for every part of its inspection, read the way PostgREST reads a
// filter on them (Postgres's attribute notation: public.inspections.parts_po_nos
// is parts_po_nos(inspections)) under each reader's Row Level Security, and
// listSearchFilter()'s conditions on them. Runs the migrations in PGlite,
// like tests/db.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPeople, createTemplate, setStatus, type People } from "@/tests/db/fixtures";
import {
  applyAsOwner,
  asUser,
  createTestDb,
  pgError,
  readMigrations,
  schemaSnapshot,
  type Db,
} from "@/tests/db/harness";
import type { InspectionStatus } from "@/lib/schemas/common";
import { summedStatus } from "./part-summary";
import { listSearchFilter, PARTS_COLUMNS_MIGRATION } from "./query";

type Inserted = { id: string; ref_no: string };

type PartValues = {
  po?: string | null;
  lots?: string[];
  /** Sampled in size M (Finished Goods Sampling). */
  cartons?: number[];
  /** The first part, for any other part of its inspection. */
  group?: string;
};

/**
 * Inserts a part through the Data API. Only an admin's session writes
 * inspections directly (inspectors write through the app's functions), so
 * the admin `adminId` sends it, for `inspectorId`.
 */
async function insertPart(
  db: Db,
  adminId: string,
  inspectorId: string,
  templateId: string,
  part: PartValues = {},
): Promise<Inserted> {
  const data = { modules: { carton_sampling: { sizes: { M: { cartonNumbers: part.cartons ?? [] } } } }, custom: {} };
  const result = await asUser(db, adminId, (tx) =>
    tx.query<Inserted>(
      `insert into public.inspections (template_id, inspector_id, po_no, lot_numbers, data, group_id)
       values ($1, $2, $3, $4, $5, $6) returning id, ref_no`,
      [templateId, inspectorId, part.po ?? null, part.lots ?? [], JSON.stringify(data), part.group ?? null],
    ),
  );
  return result.rows[0];
}

/**
 * Reads a logic tree back the way PostgREST's parser does (as in
 * query.test.ts): `column.operator."value"`, split on top-level commas.
 */
function conditionsOf(tree: string): { column: string; operator: string; value: string }[] {
  const conditions: { column: string; operator: string; value: string }[] = [];
  let at = 0;
  while (at < tree.length) {
    const head = /^([a-z_]+)\.([a-z]+)\."/.exec(tree.slice(at));
    if (!head) throw new Error(`expected column.operator."value" at ${at}: ${tree.slice(at)}`);
    at += head[0].length;
    let value = "";
    while (tree[at] !== '"') {
      if (at >= tree.length) throw new Error("unterminated quoted value");
      if (tree[at] === "\\") at += 1;
      value += tree[at];
      at += 1;
    }
    conditions.push({ column: head[1], operator: head[2], value });
    at += 1;
    if (at < tree.length && tree[at++] !== ",") throw new Error(`expected a comma at ${at - 1}`);
  }
  return conditions;
}

/**
 * The list's search as PostgREST runs it on the first parts: each condition
 * of listSearchFilter() on its computed column (imatch is ~*, ov is &&, cs is
 * @>), the column named the way PostgREST names it.
 */
function searchSql(text: string): { where: string; params: string[] } {
  const params: string[] = [];
  const conditions = conditionsOf(listSearchFilter(text)).map(({ column, operator, value }) => {
    params.push(value);
    const field = `public.inspections.${column}`;
    const param = `$${params.length}`;
    if (operator === "imatch") return `${field} ~* ${param}`;
    if (operator === "ov") return `${field} && ${param}::text[]`;
    if (operator === "cs") return `${field} @> ${param}::integer[]`;
    throw new Error(`unexpected operator ${operator}`);
  });
  return { where: `group_id is null and (${conditions.join(" or ")})`, params };
}

describe("the parts columns", { timeout: 30_000 }, () => {
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

  /** The first parts `userId` finds with the list's search for `text`. */
  async function found(userId: string, text: string): Promise<string[]> {
    const { where, params } = searchSql(text);
    const result = await asUser(db, userId, (tx) =>
      tx.query<{ id: string }>(`select id from public.inspections where ${where} order by id`, params),
    );
    return result.rows.map((row) => row.id);
  }

  type PartsColumns = {
    refs: string;
    pos: string;
    lots: string[];
    lots_upper: string[];
    cartons: number[];
    status: InspectionStatus;
  };

  async function partsColumnsOf(userId: string, id: string): Promise<PartsColumns> {
    const result = await asUser(db, userId, (tx) =>
      tx.query<PartsColumns>(
        `select public.inspections.parts_ref_nos as refs, public.inspections.parts_po_nos as pos,
                public.inspections.parts_lot_numbers as lots, public.inspections.parts_lot_numbers_upper as lots_upper,
                public.inspections.parts_carton_numbers as cartons, public.inspections.parts_status as status
           from public.inspections where id = $1`,
        [id],
      ),
    );
    return result.rows[0];
  }

  it("hold every part's refs, POs, lots and cartons on the first part, and only its own on another part", async () => {
    const first = await insertPart(db, people.admin, people.inspector, templateId, {
      po: "PO-P1",
      lots: ["Lt-P1"],
      cartons: [80011, 80012],
    });
    const second = await insertPart(db, people.admin, people.inspector, templateId, {
      po: "PO-P2",
      lots: ["LT-P2"],
      cartons: [80021],
      group: first.id,
    });
    const third = await insertPart(db, people.admin, people.inspector, templateId, { group: first.id });

    expect(await partsColumnsOf(people.inspector, first.id)).toEqual({
      refs: [first.ref_no, second.ref_no, third.ref_no].join("\n"),
      pos: "PO-P1\nPO-P2",
      lots: ["Lt-P1", "LT-P2"],
      lots_upper: ["LT-P1", "LT-P2"],
      cartons: [80011, 80012, 80021],
      status: "draft",
    });
    expect(await partsColumnsOf(people.inspector, second.id)).toEqual({
      refs: second.ref_no,
      pos: "PO-P2",
      lots: ["LT-P2"],
      lots_upper: ["LT-P2"],
      cartons: [80021],
      status: "draft",
    });
    // An inspection of one PO: its own values.
    const alone = await insertPart(db, people.admin, people.inspector, templateId, { po: "PO-ALONE" });
    expect(await partsColumnsOf(people.inspector, alone.id)).toMatchObject({ refs: alone.ref_no, pos: "PO-ALONE", lots: [] });
  });

  it("find an inspection by any of its parts, once, as its first part", async () => {
    const first = await insertPart(db, people.admin, people.inspector, templateId, {
      po: "PO-Q1",
      lots: ["LT-Q1"],
      cartons: [81011],
    });
    const second = await insertPart(db, people.admin, people.inspector, templateId, {
      po: "PO-Q2 (SO-Q2)",
      lots: ["Lt-Q2"],
      cartons: [81021],
      group: first.id,
    });

    for (const text of [
      "PO-Q1",
      // Another part's PO, in part or in any case, its ref, its lot in any case, its carton.
      "PO-Q2",
      "q2 (so",
      second.ref_no,
      "LT-Q2",
      "lt-q2",
      "Lt-Q2",
      "81021",
      "0081021",
      // Both parts: still one row.
      "PO-Q",
    ]) {
      expect(await found(people.inspector, text), text).toEqual([first.id]);
    }
    // Part of a lot or a carton number is no match, nor text running from one PO into the next.
    for (const text of ["LT-Q", "8102", "Q1 PO-Q2", "Q1PO"]) {
      expect(await found(people.inspector, text), text).toEqual([]);
    }
  });

  it("search only the parts the reader may see", async () => {
    // Another inspector's inspection: not found, through any of its parts.
    const theirs = await insertPart(db, people.admin, people.otherInspector, templateId, { po: "PO-R1" });
    await insertPart(db, people.admin, people.otherInspector, templateId, { po: "PO-R2", group: theirs.id });
    expect(await found(people.inspector, "PO-R2")).toEqual([]);
    expect(await found(people.otherInspector, "PO-R2")).toEqual([theirs.id]);
    expect(await found(people.admin, "PO-R2")).toEqual([theirs.id]);

    // A part the reader may not see (the app never makes one: a part is its inspection's inspector's)
    // finds nothing for them, as the list's own query would not show it.
    const mine = await insertPart(db, people.admin, people.inspector, templateId, { po: "PO-S1" });
    await insertPart(db, people.admin, people.otherInspector, templateId, { po: "PO-S2", group: mine.id });
    expect(await found(people.inspector, "PO-S2")).toEqual([]);
    expect(await found(people.inspector, "PO-S1")).toEqual([mine.id]);
    expect((await partsColumnsOf(people.inspector, mine.id)).pos).toBe("PO-S1");
    expect(await found(people.admin, "PO-S2")).toEqual([mine.id]);
  });

  /** A part moved along the status flow the way the app moves it. */
  async function partIn(status: InspectionStatus, group?: string): Promise<string> {
    const { id } = await insertPart(db, people.admin, people.inspector, templateId, { group });
    if (status === "draft") return id;
    await setStatus(db, people.inspector, id, "submitted");
    if (status !== "submitted") await setStatus(db, people.admin, id, status);
    return id;
  }

  it("give the inspection the least advanced status of its parts, in the app's order", async () => {
    const pairs: [InspectionStatus, InspectionStatus][] = [
      ["reopened", "draft"],
      ["draft", "approved"],
      ["submitted", "reopened"],
      ["approved", "submitted"],
      ["approved", "approved"],
      ["submitted", "submitted"],
    ];
    for (const [ofFirst, ofSecond] of pairs) {
      const first = await partIn(ofFirst);
      await partIn(ofSecond, first);
      const expected = summedStatus([ofFirst, ofSecond]).value;
      expect((await partsColumnsOf(people.inspector, first).then((row) => row.status)), `${ofFirst}, ${ofSecond}`).toBe(expected);

      // The status filter (parts_status=eq.…) finds it under that status only.
      const filtered = await asUser(db, people.inspector, (tx) =>
        tx.query<{ status: string }>(
          `select s.status from unnest('{draft,submitted,approved,reopened}'::public.inspection_status[]) as s (status)
            where exists (select 1 from public.inspections
                           where id = $1 and group_id is null and public.inspections.parts_status = s.status)`,
          [first],
        ),
      );
      expect(filtered.rows.map((row) => row.status), `${ofFirst}, ${ofSecond}`).toEqual([expected]);
    }
  });

  it("are for signed-in users only, and running the migration again changes nothing", async () => {
    const grants = await db.query<{ fn: string; anon: boolean; authenticated: boolean }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace and p.proname like 'parts\\_%'
        order by 1`,
    );
    expect(grants.rows).toEqual(
      [
        "parts_carton_numbers",
        "parts_lot_numbers",
        "parts_lot_numbers_upper",
        "parts_po_nos",
        "parts_ref_nos",
        "parts_status",
      ].map((name) => ({ fn: `${name}(inspections)`, anon: false, authenticated: true })),
    );

    const migration = (await readMigrations()).find(({ name }) => name === PARTS_COLUMNS_MIGRATION);
    if (!migration) throw new Error(`${PARTS_COLUMNS_MIGRATION} is not in supabase/migrations`);
    const before = await schemaSnapshot(db);
    await applyAsOwner(db, migration);
    expect(await schemaSnapshot(db)).toEqual(before);
  });
});

describe(`a project before ${PARTS_COLUMNS_MIGRATION}`, { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  beforeAll(async () => {
    const names = (await readMigrations()).map(({ name }) => name);
    db = await createTestDb({ until: names[names.indexOf(PARTS_COLUMNS_MIGRATION) - 1] });
    people = await createPeople(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("refuses a filter on the parts columns as a missing column (42703), so the list reads the first part instead", async () => {
    const { where, params } = searchSql("PO-1");
    const search = await pgError(
      asUser(db, people.admin, (tx) => tx.query(`select id from public.inspections where ${where}`, params)),
    );
    expect(search.code).toBe("42703");
    const status = await pgError(
      asUser(db, people.admin, (tx) =>
        tx.query("select id from public.inspections where public.inspections.parts_status = 'draft'"),
      ),
    );
    expect(status).toMatchObject({ code: "42703", message: expect.stringContaining("parts_status") });
  });
});
