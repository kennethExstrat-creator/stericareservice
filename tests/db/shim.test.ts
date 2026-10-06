import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { asAnon, asOwner, asService, asUser, column, createTestDb, OWNER_ROLE, type Db } from "./harness";

// The other suites only mean something if the shim behaves like Supabase where
// the migrations depend on it. These pin that behaviour.
describe("supabase shim", { timeout: 30_000 }, () => {
  let db: Db;

  beforeAll(async () => {
    db = await createTestDb();
  }, 120_000);

  afterAll(async () => {
    await db?.close();
  });

  it("keeps the API roles and the migration owner away from superuser powers", async () => {
    const result = await db.query<{ rolname: string; rolsuper: boolean; rolbypassrls: boolean }>(
      `select rolname, rolsuper, rolbypassrls from pg_roles
        where rolname in ('anon', 'authenticated', 'service_role', $1) order by rolname`,
      [OWNER_ROLE],
    );
    expect(result.rows).toEqual([
      { rolname: "anon", rolsuper: false, rolbypassrls: false },
      { rolname: "authenticated", rolsuper: false, rolbypassrls: false },
      { rolname: "service_role", rolsuper: false, rolbypassrls: true },
      { rolname: OWNER_ROLE, rolsuper: false, rolbypassrls: true },
    ]);
  });

  it("ran the migrations as the owner role, not as a superuser", async () => {
    const result = await db.query<{ owner: string }>(
      "select distinct tableowner as owner from pg_tables where schemaname = 'public'",
    );
    expect(result.rows.map((row) => row.owner)).toEqual([OWNER_ROLE]);
  });

  it("grants the API roles everything on new public tables by default, as Supabase does", async () => {
    await asOwner(db, (tx) => tx.query("create table public.shim_probe (id int)"));
    try {
      const rows = await asAnon(db, (tx) => tx.query("select * from public.shim_probe"));
      expect(rows.rows).toEqual([]);
    } finally {
      await asOwner(db, (tx) => tx.query("drop table public.shim_probe"));
    }
  });

  it("reads the user from request.jwt.claims and from the older request.jwt.claim.sub", async () => {
    const id = "6f1c2a52-6a52-4b4f-9a3e-0c3a7e8d9b10";
    const modern = await asUser(db, id, (tx) =>
      tx.query<{ uid: string; role: string; sub: string }>(
        "select auth.uid() as uid, auth.role() as role, auth.jwt() ->> 'sub' as sub",
      ),
    );
    expect(modern.rows[0]).toEqual({ uid: id, role: "authenticated", sub: id });

    const legacy = await db.transaction(async (tx) => {
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [id]);
      return tx.query<{ uid: string }>("select auth.uid() as uid");
    });
    expect(legacy.rows[0].uid).toBe(id);
  });

  it("has no user outside a request", async () => {
    const result = await asOwner(db, (tx) => tx.query<{ uid: string | null }>("select auth.uid() as uid"));
    expect(result.rows[0].uid).toBeNull();
  });

  it("lets the service role bypass RLS but not anon", async () => {
    await asService(db, (tx) =>
      tx.query("insert into storage.objects (bucket_id, name) values ('client-logos', 'probe.png')"),
    );
    const service = await asService(db, (tx) => column<string>(tx, "select name from storage.objects"));
    const anon = await asAnon(db, (tx) => column<string>(tx, "select name from storage.objects"));
    expect(service).toEqual(["probe.png"]);
    expect(anon).toEqual([]);
  });

  it("splits storage paths like Supabase Storage", async () => {
    const result = await db.query<{ folders: string[]; file: string; ext: string; root: string[] }>(
      `select storage.foldername('a/b/c.png') as folders, storage.filename('a/b/c.png') as file,
              storage.extension('a/b/c.png') as ext, storage.foldername('c.png') as root`,
    );
    expect(result.rows[0]).toEqual({ folders: ["a", "b"], file: "c.png", ext: "png", root: [] });
  });
});
