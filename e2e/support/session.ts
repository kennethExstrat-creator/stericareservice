import { createHash } from "node:crypto";
import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

/** The local test accounts from BUILD_SPEC section 11 (npm run seed:dev-users). */
export const TEST_ACCOUNTS = {
  inspector: "inspector@test.local",
  admin: "admin@test.local",
} as const;

export const TEST_PASSWORD = process.env.DEV_USER_PASSWORD?.trim() || "SteriCare-dev-2026";

export type SessionCookie = { name: string; value: string };

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase is not configured: copy .env.local into this checkout.");
  return { url, key };
}

/**
 * When the access token in a session's cookies expires, in ms since the
 * epoch: @supabase/ssr keeps the session as JSON ("base64-" and base64url, or
 * URI-encoded), split into name.0, name.1 ... when long. Null when it cannot
 * be read.
 */
export function sessionExpiry(cookies: readonly SessionCookie[]): number | null {
  const chunks = cookies
    .map((cookie) => ({ cookie, match: /-auth-token(?:\.(\d+))?$/.exec(cookie.name) }))
    .filter((entry) => entry.match !== null)
    .sort((a, b) => Number(a.match![1] ?? -1) - Number(b.match![1] ?? -1));
  if (chunks.length === 0) return null;
  const raw = chunks.map((entry) => entry.cookie.value).join("");
  try {
    const json = raw.startsWith("base64-") ? Buffer.from(raw.slice("base64-".length), "base64url").toString("utf8") : decodeURIComponent(raw);
    const session = JSON.parse(json) as { expires_at?: unknown };
    return typeof session.expires_at === "number" ? session.expires_at * 1000 : null;
  } catch {
    return null;
  }
}

/**
 * E2E_SESSION_CACHE=<directory>, off unless set: a session signed in here is
 * kept in that directory and handed out again, to other workers, projects
 * and runs, while its access token has half an hour left (no context then
 * outlives it, so none refreshes a token another context still holds). The
 * shared project limits sign-ins to about 30 in five minutes for the whole
 * machine, and a failed test restarts its worker, whose hooks sign in again.
 * Each real sign-in is logged to sign-ins.log there. The files hold live
 * tokens of the test accounts: use a private temporary directory and delete
 * it afterwards.
 */
const SESSION_CACHE = process.env.E2E_SESSION_CACHE?.trim() || null;
const CACHE_MIN_LEFT_MS = 30 * 60 * 1000;

function cacheFile(email: string, password: string): string {
  const key = createHash("sha256").update(`${email.toLowerCase()}\n${password}`).digest("hex").slice(0, 32);
  return join(SESSION_CACHE!, `session-${key}.json`);
}

function cachedSession(email: string, password: string): SessionCookie[] | null {
  if (!SESSION_CACHE) return null;
  try {
    const cookies = JSON.parse(readFileSync(cacheFile(email, password), "utf8")) as SessionCookie[];
    const expiry = sessionExpiry(cookies);
    return expiry !== null && expiry - Date.now() >= CACHE_MIN_LEFT_MS ? cookies : null;
  } catch {
    return null;
  }
}

function keepSession(email: string, password: string, cookies: SessionCookie[]): void {
  if (!SESSION_CACHE) return;
  mkdirSync(SESSION_CACHE, { recursive: true, mode: 0o700 });
  writeFileSync(cacheFile(email, password), JSON.stringify(cookies), { mode: 0o600 });
  logSignIn(email);
}

/** Every real sign-in, cached or not, goes into sign-ins.log while the cache is on. */
function logSignIn(email: string): void {
  if (!SESSION_CACHE) return;
  mkdirSync(SESSION_CACHE, { recursive: true, mode: 0o700 });
  appendFileSync(join(SESSION_CACHE, "sign-ins.log"), `${new Date().toISOString()} ${email}\n`, { mode: 0o600 });
}

/**
 * Signs in through @supabase/ssr itself, so the cookies are named, chunked and
 * encoded exactly as the app's server client expects.
 */
export async function sessionCookies(
  email: string,
  password: string = TEST_PASSWORD,
  { fresh = false }: { fresh?: boolean } = {},
): Promise<SessionCookie[]> {
  const cached = fresh ? null : cachedSession(email, password);
  if (cached) return cached;

  const { url, key } = supabaseEnv();
  const jar = new Map<string, string>();

  const supabase = createServerClient(url, key, {
    cookies: {
      getAll: () => [...jar].map(([name, value]) => ({ name, value })),
      setAll: (cookies) => {
        for (const { name, value } of cookies) {
          if (value) jar.set(name, value);
          else jar.delete(name);
        }
      },
    },
  });

  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  const cookies = [...jar].map(([name, value]) => ({ name, value }));
  if (fresh) logSignIn(email);
  else keepSession(email, password, cookies);
  return cookies;
}

/**
 * Puts a signed-in session for `email` into the browser context. `fresh`: a
 * session of its own, never taken from or kept in the cache, for a test that
 * signs it out (signing out revokes the session for everyone holding it).
 */
export async function signIn(
  context: BrowserContext,
  baseURL: string,
  email: string,
  password?: string,
  { fresh = false }: { fresh?: boolean } = {},
) {
  const cookies = await sessionCookies(email, password, { fresh });
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}
