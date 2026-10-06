import { randomUUID } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { PGlite, types, type Transaction } from "@electric-sql/pglite";

/**
 * Builds a throwaway Supabase-like database in memory: the shim, every
 * migration in filename order, then the seed. Each test file creates its own.
 */

const repoRoot = new URL("../../", import.meta.url);
const migrationsDir = new URL("supabase/migrations/", repoRoot);
const seedFile = new URL("supabase/seed.sql", repoRoot);
const shimFile = new URL("./supabase-shim.sql", import.meta.url);

/** Runs migrations and seeds: the shim's stand-in for Supabase's `postgres`. */
export const OWNER_ROLE = "supabase_migrations";

export type Db = PGlite;
export type Tx = Transaction;

export interface SqlFile {
  name: string;
  sql: string;
}

export async function readMigrations(): Promise<SqlFile[]> {
  const names = (await readdir(migrationsDir)).filter((name) => name.endsWith(".sql")).sort();
  return Promise.all(
    names.map(async (name) => ({ name, sql: await readFile(new URL(name, migrationsDir), "utf8") })),
  );
}

export async function readSeed(): Promise<SqlFile> {
  return { name: "seed.sql", sql: await readFile(seedFile, "utf8") };
}

/** Applies one file in a transaction as the owner, like `supabase db push`. */
export async function applyAsOwner(db: Db, file: SqlFile): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await tx.exec(`set local role ${OWNER_ROLE}`);
      await tx.exec(file.sql);
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`${file.name}: ${message}`, { cause: error });
  }
}

export interface TestDbOptions {
  seed?: boolean;
  /** Runs after the shim, before the first migration (e.g. pre-existing auth users). */
  beforeMigrations?: (db: Db) => Promise<void>;
}

export async function createTestDb({ seed = true, beforeMigrations }: TestDbOptions = {}): Promise<Db> {
  const db = await PGlite.create({
    // Timestamps and dates come back as strings, the way PostgREST returns them.
    parsers: {
      [types.TIMESTAMPTZ]: (value) => value,
      [types.TIMESTAMP]: (value) => value,
      [types.DATE]: (value) => value,
    },
  });
  // Hosted Supabase runs in UTC; PGlite would otherwise follow this machine.
  await db.exec("set timezone to 'UTC'");
  await db.exec(await readFile(shimFile, "utf8"));
  await beforeMigrations?.(db);
  for (const migration of await readMigrations()) {
    await applyAsOwner(db, migration);
  }
  if (seed) {
    await applyAsOwner(db, await readSeed());
  }
  return db;
}

type Claims = Record<string, string>;

/** What PostgREST and the Storage API do at the start of every request. */
async function withSession<T>(
  db: Db,
  role: string,
  claims: Claims | null,
  fn: (tx: Tx) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    await tx.query("select set_config('role', $1, true), set_config('request.jwt.claims', $2, true)", [
      role,
      claims ? JSON.stringify(claims) : "",
    ]);
    return fn(tx);
  });
}

/** A signed-in user: role `authenticated` with their id in the JWT. */
export function asUser<T>(db: Db, userId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withSession(db, "authenticated", { sub: userId, role: "authenticated", aud: "authenticated" }, fn);
}

export function asAnon<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withSession(db, "anon", { role: "anon" }, fn);
}

/** The secret key: role `service_role`, no user. */
export function asService<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withSession(db, "service_role", { role: "service_role" }, fn);
}

/** The database owner without a JWT, as in the SQL editor. */
export function asOwner<T>(db: Db, fn: (tx: Tx) => Promise<T>): Promise<T> {
  return withSession(db, OWNER_ROLE, null, fn);
}

export interface NewAuthUser {
  email: string;
  fullName?: string;
  metadata?: Record<string, unknown>;
  /**
   * New accounts start inactive (migration 20261006000600); like an admin's
   * invite, the helper activates them unless told not to. Pass false to see
   * the raw trigger result, and for users created before the migrations run.
   */
  active?: boolean;
}

/** Inserts into auth.users the way Supabase Auth does, firing the profile trigger. */
export async function createAuthUser(db: Db, user: NewAuthUser): Promise<string> {
  const id = randomUUID();
  const metadata = { ...user.metadata, ...(user.fullName ? { full_name: user.fullName } : {}) };
  await db.transaction(async (tx) => {
    await tx.query(
      "select set_config('role', 'supabase_auth_admin', true), set_config('search_path', 'auth', true)",
    );
    await tx.query(
      `insert into auth.users (
         instance_id, id, aud, role, email, raw_app_meta_data, raw_user_meta_data,
         email_confirmed_at, created_at, updated_at
       ) values (
         '00000000-0000-0000-0000-000000000000', $1, 'authenticated', 'authenticated', $2,
         '{"provider": "email", "providers": ["email"]}', $3, now(), now(), now()
       )`,
      [id, user.email, JSON.stringify(metadata)],
    );
  });
  if (user.active !== false) {
    await asOwner(db, (tx) => tx.query("update public.profiles set active = true where id = $1", [id]));
  }
  return id;
}

export interface PgError {
  code: string | undefined;
  message: string;
}

/** Resolves with the database error the action failed with; fails if it succeeded. */
export async function pgError(action: Promise<unknown>): Promise<PgError> {
  try {
    await action;
  } catch (error) {
    return {
      code: (error as { code?: string }).code,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error("expected the database to reject the statement");
}

/** Rows of a single-column query, for compact assertions. */
export async function column<T>(tx: Tx, sql: string, params: unknown[] = []): Promise<T[]> {
  const result = await tx.query<Record<string, T>>(sql, params);
  return result.rows.map((row) => Object.values(row)[0] as T);
}
