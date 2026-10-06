import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { applyAsOwner, asOwner, column, createTestDb, readMigrations, type Db } from "./harness";

/**
 * Every definition the migrations control, as text: functions with their
 * privileges, policies, constraints, triggers, indexes, column defaults and
 * table privileges. ACL entries are sorted, so a revoke and an identical grant
 * compare equal.
 */
async function schemaSnapshot(db: Db): Promise<string[]> {
  const result = await db.query<{ item: string }>(
    `with acl(oid, list) as (
       select c.oid, array(select a::text from unnest(c.relacl) a order by 1)::text from pg_class c
       union all
       select p.oid, array(select a::text from unnest(p.proacl) a order by 1)::text from pg_proc p
     )
     select 'function ' || pg_get_functiondef(p.oid) || ' acl ' || coalesce(acl.list, '-') as item
       from pg_proc p join acl on acl.oid = p.oid
      where p.pronamespace = 'public'::regnamespace
     union all
     select format('policy %s.%s %s %s using %s check %s', schemaname, tablename, policyname, cmd,
                   coalesce(qual, '-'), coalesce(with_check, '-')) || ' to ' || roles::text
       from pg_policies where schemaname in ('public', 'storage')
     union all
     select format('constraint %s.%s %s', conrelid::regclass, conname, pg_get_constraintdef(oid))
       from pg_constraint where connamespace = 'public'::regnamespace
     union all
     select 'trigger ' || pg_get_triggerdef(t.oid)
       from pg_trigger t join pg_class c on c.oid = t.tgrelid
      where not t.tgisinternal and c.relnamespace in ('public'::regnamespace, 'auth'::regnamespace)
     union all
     select 'index ' || indexdef from pg_indexes where schemaname = 'public'
     union all
     select format('default %s.%s %s', d.adrelid::regclass, a.attname, pg_get_expr(d.adbin, d.adrelid))
       from pg_attrdef d join pg_attribute a on a.attrelid = d.adrelid and a.attnum = d.adnum
      where d.adrelid in (select oid from pg_class where relnamespace = 'public'::regnamespace)
     union all
     select format('privileges %s %s', c.oid::regclass, coalesce(acl.list, '-'))
       from pg_class c join acl on acl.oid = c.oid
      where c.relnamespace = 'public'::regnamespace and c.relkind in ('r', 'S')
     order by 1`,
  );
  return result.rows.map((row) => row.item);
}

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
