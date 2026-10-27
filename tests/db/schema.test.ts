import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { FILE_TYPES } from "@/lib/photos/paths";
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

  it("has the eleven tables of BUILD_SPEC 5, the AI settings, the AI usage and the roles", async () => {
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
      "ai_settings",
      "ai_usage",
      "audit_log",
      "clients",
      "defect_codes",
      "inspection_files",
      "inspection_photos",
      "inspections",
      "manufacturers",
      "profiles",
      "roles",
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

  // Migrations whose functions a later one restates are run again where they
  // stand: on a project that has run up to them. 20261006000700 restates
  // rules that a project may already have, and 20261007190000 restates its
  // inspections guard and log_inspection_event(); 20261008140000 restates the
  // profiles guard of 20261007170000; 20261027120000 restates
  // save_inspection_with_events() of 20261026130000; 20261027150000 (roles)
  // restates the profiles guard of 20261008140000 and the ai_usage policy of
  // 20261013120000.
  it.each([
    "20261006000700_review_fixes.sql",
    "20261007170000_lead_inspectors.sql",
    "20261008140000_profile_uid.sql",
    "20261013120000_ai_usage.sql",
    "20261026130000_save_inspection_with_events.sql",
  ])(
    "applies %s again where it stands without changing the schema",
    async (name) => {
      const upToIt = await createTestDb({ seed: false, until: name });
      try {
        const before = await schemaSnapshot(upToIt);
        const migration = (await readMigrations()).find((file) => file.name === name);
        expect(migration).toBeDefined();
        await applyAsOwner(upToIt, migration!);
        expect(await schemaSnapshot(upToIt)).toEqual(before);
      } finally {
        await upToIt.close();
      }
    },
  );

  // The migrations that say "Idempotent: running it again changes nothing",
  // run again on top of all of them (those a later migration restates are in
  // the list above).
  it.each([
    "20261007151500_delete_draft_inspection.sql",
    "20261007190000_inspector_writes_through_the_app.sql",
    "20261007193000_admins_delete_drafts_only.sql",
    "20261013130000_steri_ai_summary.sql",
    "20261026120000_source_reading_proposals.sql",
    "20261026140000_source_spreadsheets.sql",
    "20261027120000_code_letter_events.sql",
  ])("applies %s again without changing the schema", async (name) => {
    const before = await schemaSnapshot(db);
    const migration = (await readMigrations()).find((file) => file.name === name);
    expect(migration).toBeDefined();
    await applyAsOwner(db, migration!);
    expect(await schemaSnapshot(db)).toEqual(before);
  });

  // Migration 20261007193000 (data audit D1): signed-in users, admins included,
  // delete an inspection only through delete_draft_inspection().
  it("has no policy that lets a signed-in user delete an inspection", async () => {
    const result = await db.query<{ policyname: string }>(
      `select policyname from pg_policies
        where schemaname = 'public' and tablename = 'inspections' and cmd in ('DELETE', 'ALL')`,
    );
    expect(result.rows).toEqual([]);
  });

  it("keeps the functions that write for an inspector to the service role", async () => {
    const result = await db.query<{ fn: string; anon: boolean; authenticated: boolean; service_role: boolean }>(
      `select p.oid::regprocedure::text as fn,
              has_function_privilege('anon', p.oid, 'execute') as anon,
              has_function_privilege('authenticated', p.oid, 'execute') as authenticated,
              has_function_privilege('service_role', p.oid, 'execute') as service_role
         from pg_proc p
        where p.pronamespace = 'public'::regnamespace
          and p.proname in ('create_inspection', 'save_inspection', 'save_inspection_with_events', 'submit_inspection')
        order by 1`,
    );
    expect(result.rows).toEqual([
      {
        fn: "create_inspection(uuid,uuid,uuid,uuid,jsonb,jsonb)",
        anon: false,
        authenticated: false,
        service_role: true,
      },
      {
        fn: "save_inspection(uuid,uuid,timestamp with time zone,jsonb,jsonb)",
        anon: false,
        authenticated: false,
        service_role: true,
      },
      {
        fn: "save_inspection_with_events(uuid,uuid,timestamp with time zone,jsonb,jsonb,jsonb)",
        anon: false,
        authenticated: false,
        service_role: true,
      },
      {
        fn: "submit_inspection(uuid,uuid,timestamp with time zone,jsonb)",
        anon: false,
        authenticated: false,
        service_role: true,
      },
    ]);
  });

  // The upload queue stores each file with its own type (lib/photos/files.ts), which the bucket must
  // take: Source Documents' Excel and CSV files since migration 20261026140000 (Kenneth, 26 October 2026).
  it("lets inspection-files take every type the app uploads there, and no other", async () => {
    const types = await asOwner(db, (tx) =>
      column<string[]>(tx, "select allowed_mime_types from storage.buckets where id = 'inspection-files'"),
    );
    expect([...types[0]].sort()).toEqual([...FILE_TYPES].sort());
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
