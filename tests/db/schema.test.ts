import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAsOwner, asOwner, column, createTestDb, readMigrations, schemaSnapshot, type Db } from "./harness";

// Guards that catch a new table or function shipped without its access rules.
describe("schema guards", { timeout: 30_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("enables RLS on every public table and gives each at least one policy", async () => {
    const result = await db.query<{ table_name: string; rls: boolean; policies: number }>(
      `select c.relname as table_name, c.relrowsecurity as rls,
              (select count(*)::int from pg_policies p
                where p.schemaname = 'public' and p.tablename = c.relname) as policies
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p')
        order by c.relname`,
    );
    expect(result.rows.length).toBeGreaterThan(0);
    const unprotected = result.rows.filter((row) => !row.rls || row.policies === 0);
    expect(unprotected).toEqual([]);
  });

  it("has the eleven tables of BUILD_SPEC 5", async () => {
    const tables = await asOwner(db, (tx) =>
      column<string>(
        tx,
        `select table_name from information_schema.tables
          where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
      ),
    );
    expect(tables).toEqual([
      "ai_review_actions",
      "ai_reviews",
      "audit_log",
      "clients",
      "defect_codes",
      "inspection_files",
      "inspection_photos",
      "inspections",
      "manufacturers",
      "profiles",
      "templates",
    ]);
  });

  it("grants anon nothing on public tables, sequences or functions", async () => {
    const result = await db.query<{ object: string }>(
      `select c.relname as object from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm', 'S')
          and (has_table_privilege('anon', c.oid, 'select, insert, update, delete, truncate, references, trigger')
               or (c.relkind = 'S' and has_sequence_privilege('anon', c.oid, 'usage, select, update')))
       union all
       select p.oid::regprocedure::text from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('anon', p.oid, 'execute')`,
    );
    expect(result.rows).toEqual([]);
  });

  it("never grants TRUNCATE, REFERENCES or TRIGGER to authenticated", async () => {
    const result = await db.query<{ table_name: string }>(
      `select c.relname as table_name from pg_class c
         join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
          and has_table_privilege('authenticated', c.oid, 'truncate, references, trigger')`,
    );
    expect(result.rows).toEqual([]);
  });

  it("pins search_path on every function in public", async () => {
    const result = await db.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public'
          and not coalesce(p.proconfig @> array['search_path=""'], false)`,
    );
    expect(result.rows).toEqual([]);
  });

  it("keeps trigger functions out of reach of the API roles", async () => {
    const result = await db.query<{ fn: string }>(
      `select p.oid::regprocedure::text as fn from pg_proc p
         join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.prorettype = 'trigger'::regtype
          and (has_function_privilege('anon', p.oid, 'execute')
               or has_function_privilege('authenticated', p.oid, 'execute'))`,
    );
    expect(result.rows).toEqual([]);
  });

  it("indexes every foreign key", async () => {
    const result = await db.query<{ constraint_name: string }>(
      `select con.conname as constraint_name from pg_constraint con
         join pg_namespace n on n.oid = con.connamespace
        where n.nspname = 'public' and con.contype = 'f'
          and not exists (
            select 1 from pg_index i
             where i.indrelid = con.conrelid
               and (i.indkey::int2[])[0:cardinality(con.conkey) - 1] = con.conkey
          )`,
    );
    expect(result.rows).toEqual([]);
  });

  // 20261006000700 restates rules that a project may already have, so running
  // it again must change nothing.
  it("applies the review fixes again without changing the schema", async () => {
    const before = await schemaSnapshot(db);
    const fixes = (await readMigrations()).find((file) => file.name === "20261006000700_review_fixes.sql");
    expect(fixes).toBeDefined();
    await applyAsOwner(db, fixes!);
    expect(await schemaSnapshot(db)).toEqual(before);
  });

  it("creates every bucket private", async () => {
    const buckets = await asOwner(db, (tx) =>
      tx.query<{ id: string; public: boolean }>("select id, public from storage.buckets order by id"),
    );
    expect(buckets.rows).toEqual([
      { id: "client-logos", public: false },
      { id: "inspection-files", public: false },
      { id: "inspection-photos", public: false },
      { id: "signatures", public: false },
      { id: "template-sources", public: false },
    ]);
  });
});
