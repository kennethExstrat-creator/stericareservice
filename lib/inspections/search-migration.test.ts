// The database half of searching the list by carton number, and by lot
// number in any case (migration 20261007191137): the columns a trigger keeps
// from each row, the values the inspections already there get, and the
// conditions listSearchFilter() adds, run the way Postgres runs them. Runs
// the migrations in PGlite, like tests/db.
import { readFile } from "node:fs/promises";
import { PGlite, types } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createPeople, createTemplate, setStatus, type People } from "@/tests/db/fixtures";
import {
  applyAsOwner,
  asOwner,
  asUser,
  createTestDb,
  pgError,
  readMigrations,
  schemaSnapshot,
  type Db,
} from "@/tests/db/harness";
import { inspectionSearchFilter } from "./postgrest";
import { listSearchFilter, SEARCH_COLUMNS_MIGRATION } from "./query";

type SearchColumns = { id: string; carton_numbers: number[]; lot_numbers_upper: string[] };

/** Module data with a Finished Goods Sampling grid: carton numbers by size, as saved. */
function withCartons(sizes: Record<string, unknown>): Record<string, unknown> {
  return {
    modules: {
      carton_sampling: {
        sizes: Object.fromEntries(Object.entries(sizes).map(([size, cartons]) => [size, { cartonNumbers: cartons }])),
      },
    },
    custom: {},
  };
}

const EMPTY_DATA = { modules: {}, custom: {} };

/** Inserts an inspection as `userId`, the way the app does, with whatever the caller sends. */
async function insertInspection(
  db: Db,
  userId: string,
  templateId: string,
  values: { data?: unknown; lots?: string[]; cartons?: number[]; lotsUpper?: string[] } = {},
): Promise<SearchColumns> {
  const columns = ["template_id", "data", "lot_numbers"];
  const params: unknown[] = [templateId, JSON.stringify(values.data ?? EMPTY_DATA), values.lots ?? []];
  if (values.cartons) {
    columns.push("carton_numbers");
    params.push(values.cartons);
  }
  if (values.lotsUpper) {
    columns.push("lot_numbers_upper");
    params.push(values.lotsUpper);
  }
  const result = await asUser(db, userId, (tx) =>
    tx.query<SearchColumns>(
      `insert into public.inspections (${columns.join(", ")})
       values (${columns.map((_, index) => `$${index + 1}`).join(", ")})
       returning id, carton_numbers, lot_numbers_upper`,
      params,
    ),
  );
  return result.rows[0];
}

/** Runs `set` (an UPDATE's SET list) on one inspection as `userId`. */
async function update(db: Db, userId: string, id: string, set: string, params: unknown[] = []): Promise<SearchColumns> {
  const result = await asUser(db, userId, (tx) =>
    tx.query<SearchColumns>(
      `update public.inspections set ${set} where id = $1 returning id, carton_numbers, lot_numbers_upper`,
      [id, ...params],
    ),
  );
  if (result.rows.length !== 1) throw new Error(`update matched ${result.rows.length} rows`);
  return result.rows[0];
}

async function searchColumnsOf(db: Db, id: string): Promise<Omit<SearchColumns, "id">> {
  const result = await asOwner(db, (tx) =>
    tx.query<SearchColumns>("select carton_numbers, lot_numbers_upper from public.inspections where id = $1", [id]),
  );
  return { carton_numbers: result.rows[0].carton_numbers, lot_numbers_upper: result.rows[0].lot_numbers_upper };
}

describe("the search columns", { timeout: 30_000 }, () => {
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

  it("hold every sampled carton number and every lot in capitals, each once, from what is saved", async () => {
    const inspection = await insertInspection(db, people.inspector, templateId, {
      data: withCartons({ M: [5420, null, 5421, 5420], "7.0": [3], L: [] }),
      lots: ["Lt081315", "LT081315", "b2"],
    });
    expect(inspection).toMatchObject({ carton_numbers: [3, 5420, 5421], lot_numbers_upper: ["B2", "LT081315"] });

    const blank = await insertInspection(db, people.inspector, templateId);
    expect(blank).toMatchObject({ carton_numbers: [], lot_numbers_upper: [] });
  });

  it("follow every save of the data or the lots", async () => {
    const { id } = await insertInspection(db, people.inspector, templateId, { data: withCartons({ M: [1] }), lots: ["a1"] });

    // An autosave: the data and the mirrored columns together.
    expect(await update(db, people.inspector, id, "data = $2, lot_numbers = $3", [JSON.stringify(withCartons({ M: [1, 2], S: [9] })), ["a1", "Lt7"]])).toMatchObject({
      carton_numbers: [1, 2, 9],
      lot_numbers_upper: ["A1", "LT7"],
    });
    expect(await update(db, people.inspector, id, "lot_numbers = '{}'")).toMatchObject({ carton_numbers: [1, 2, 9], lot_numbers_upper: [] });
    expect(await update(db, people.inspector, id, "data = $2", [JSON.stringify(EMPTY_DATA)])).toMatchObject({ carton_numbers: [] });
  });

  it("never take a value from the caller", async () => {
    const forged = await insertInspection(db, people.inspector, templateId, {
      data: withCartons({ M: [5] }),
      lots: ["x1"],
      cartons: [9999],
      lotsUpper: ["FORGED"],
    });
    expect(forged).toMatchObject({ carton_numbers: [5], lot_numbers_upper: ["X1"] });
    expect(await update(db, people.inspector, forged.id, "carton_numbers = '{1}', lot_numbers_upper = '{Y}'")).toMatchObject({
      carton_numbers: [5],
      lot_numbers_upper: ["X1"],
    });
  });

  it("leave out what is not a carton number, and never fail a save over it", async () => {
    const odd = await insertInspection(db, people.inspector, templateId, {
      data: withCartons({ M: [12.0, 12.5, -1, 0, "77", 99999999999, null, true, { n: 5 }, 7], S: "x", L: null }),
    });
    expect(odd.carton_numbers).toEqual([7, 12]);
    for (const data of [
      { modules: { carton_sampling: "x" }, custom: {} },
      { modules: { carton_sampling: { sizes: [1, 2] } }, custom: {} },
      { modules: { carton_sampling: { sizes: { M: { cartonNumbers: "5420" } } } }, custom: {} },
      { modules: { carton_sampling: { sizes: { M: {} } } }, custom: {} },
    ]) {
      expect((await insertInspection(db, people.inspector, templateId, { data })).carton_numbers, JSON.stringify(data)).toEqual([]);
    }
  });

  it("leave an approved inspection read-only, its report link to the admin", async () => {
    const { id } = await insertInspection(db, people.inspector, templateId, { data: withCartons({ M: [31] }), lots: ["Lt31"] });
    await setStatus(db, people.inspector, id, "submitted");
    await setStatus(db, people.admin, id, "approved");

    // The report link is the one change an approved inspection takes; the columns stay as they are.
    expect(await update(db, people.admin, id, "report_url = 'https://example.com/report.pdf'")).toMatchObject({
      carton_numbers: [31],
      lot_numbers_upper: ["LT31"],
    });
    for (const set of ["carton_numbers = '{1}'", "lot_numbers_upper = '{X}'", "lot_numbers = '{x}'"]) {
      const refused = await pgError(update(db, people.admin, id, set));
      expect(refused, set).toMatchObject({ code: "42501" });
      expect(refused.message, set).toContain("an approved inspection is read-only");
    }
  });

  /** The conditions listSearchFilter() adds to the ref, PO and lot search, as SQL (PostgREST: ov is &&, cs is @>). */
  function addedConditions(text: string): { sql: string; value: string }[] {
    const added = listSearchFilter(text).slice(inspectionSearchFilter(text).length + 1);
    return added.split(",").map((condition) => {
      const parts = /^(lot_numbers_upper|carton_numbers)\.(ov|cs)\."(.*)"$/.exec(condition);
      if (!parts) throw new Error(`unexpected condition ${condition}`);
      const [, column, operator, quoted] = parts;
      const type = column === "carton_numbers" ? "integer[]" : "text[]";
      return {
        sql: `${column} ${operator === "ov" ? "&&" : "@>"} $1::${type}`,
        value: quoted.replace(/\\(.)/g, "$1"),
      };
    });
  }

  it("find an inspection by a whole lot in any case, or by a carton number, as the list asks", async () => {
    const match = await insertInspection(db, people.otherInspector, templateId, {
      data: withCartons({ M: [24680, 24681] }),
      lots: ["Lt-SEARCH-1"],
    });
    const other = await insertInspection(db, people.otherInspector, templateId, {
      data: withCartons({ S: [97] }),
      lots: ["LT-SEARCH-2"],
    });

    const found = async (text: string) => {
      const ids = new Set<string>();
      for (const { sql, value } of addedConditions(text)) {
        const rows = await asUser(db, people.otherInspector, (tx) =>
          tx.query<{ id: string }>(`select id from public.inspections where ${sql}`, [value]),
        );
        for (const row of rows.rows) ids.add(row.id);
      }
      return [...ids].sort();
    };

    for (const text of ["LT-SEARCH-1", "lt-search-1", "Lt-SEARCH-1", "24680", "024681"]) {
      expect(await found(text), text).toEqual([match.id]);
    }
    expect(await found("97")).toEqual([other.id]);
    // Whole values only: part of a lot or a carton number is no match.
    for (const text of ["LT-SEARCH", "2468", "246800"]) expect(await found(text), text).toEqual([]);
  });
});

describe(`inspections saved before ${SEARCH_COLUMNS_MIGRATION}`, { timeout: 30_000 }, () => {
  let db: Db;
  let people: People;

  /** A database with every migration before this one, like a project that has not had it yet. */
  async function databaseBefore(migration: string): Promise<Db> {
    const before = await PGlite.create({
      parsers: {
        [types.TIMESTAMPTZ]: (value) => value,
        [types.TIMESTAMP]: (value) => value,
        [types.DATE]: (value) => value,
      },
    });
    await before.exec("set timezone to 'UTC'");
    await before.exec(await readFile(new URL("../../tests/db/supabase-shim.sql", import.meta.url), "utf8"));
    for (const file of await readMigrations()) if (file.name < migration) await applyAsOwner(before, file);
    return before;
  }

  async function migration() {
    const file = (await readMigrations()).find(({ name }) => name === SEARCH_COLUMNS_MIGRATION);
    if (!file) throw new Error(`${SEARCH_COLUMNS_MIGRATION} is not in supabase/migrations`);
    return file;
  }

  beforeAll(async () => {
    db = await databaseBefore(SEARCH_COLUMNS_MIGRATION);
    people = await createPeople(db);
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("get their values, without a save: updated_at and the audit trail stay, an approved one included", async () => {
    const templateId = await createTemplate(db);
    const insert = (data: unknown, lots: string[]) =>
      asUser(db, people.inspector, (tx) =>
        tx.query<{ id: string }>(
          "insert into public.inspections (template_id, data, lot_numbers) values ($1, $2, $3) returning id",
          [templateId, JSON.stringify(data), lots],
        ),
      ).then((result) => result.rows[0].id);
    const draft = await insert(withCartons({ M: [5421, 5420] }), ["Lt081315"]);
    const approved = await insert(withCartons({ L: [77] }), ["L-77"]);
    await setStatus(db, people.inspector, approved, "submitted");
    await setStatus(db, people.admin, approved, "approved");

    const saves = () =>
      asOwner(db, (tx) => tx.query("select id, updated_at::text as saved from public.inspections order by id")).then((r) => r.rows);
    const audit = () => asOwner(db, (tx) => tx.query("select count(*)::int as n from public.audit_log")).then((r) => r.rows);
    const savedBefore = await saves();
    const auditBefore = await audit();

    await applyAsOwner(db, await migration());

    expect(await searchColumnsOf(db, draft)).toEqual({ carton_numbers: [5420, 5421], lot_numbers_upper: ["LT081315"] });
    expect(await searchColumnsOf(db, approved)).toEqual({ carton_numbers: [77], lot_numbers_upper: ["L-77"] });
    expect(await saves()).toEqual(savedBefore);
    expect(await audit()).toEqual(auditBefore);

    // From now on the trigger keeps them: the next autosave of the draft, the approved one's report link.
    expect(await update(db, people.inspector, draft, "data = $2", [JSON.stringify(withCartons({ M: [1] }))])).toMatchObject({
      carton_numbers: [1],
    });
    expect(await update(db, people.admin, approved, "report_url = 'https://example.com/report.pdf'")).toMatchObject({
      carton_numbers: [77],
    });

    // Idempotent: running it again changes nothing.
    const schema = await schemaSnapshot(db);
    const values = await searchColumnsOf(db, approved);
    await applyAsOwner(db, await migration());
    expect(await schemaSnapshot(db)).toEqual(schema);
    expect(await searchColumnsOf(db, approved)).toEqual(values);
  });
});
