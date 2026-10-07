import { readFileSync } from "node:fs";
import { createServerClient } from "@supabase/ssr";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../../lib/supabase/database.types";

/*
 * Helpers for the security acceptance spec: signed-in sessions as plain
 * supabase-js clients plus the cookies the app reads, Server Action calls
 * over HTTP (encoded the way React's client encodes them), action discovery
 * from the client bundles, and signed URL lifetimes.
 *
 * Requests to the app go through Node's fetch with redirects off, so every
 * status code and Location header is what the server sent, and no cookie
 * jar carries one user's session into another user's probe.
 */

export type Client = SupabaseClient<Database>;

export function supabasePublicEnv(): { url: string; key: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase is not configured: copy .env.local into this checkout.");
  return { url, key };
}

/** The anon (publishable key) client, with no session. */
export function anonClient(): Client {
  const { url, key } = supabasePublicEnv();
  return createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

export type Session = {
  email: string;
  userId: string;
  /** supabase-js acting as this user (publishable key + their session): RLS applies. */
  client: Client;
  /** The @supabase/ssr cookies the app's server client reads, as a Cookie header. */
  cookie: string;
  cookies: { name: string; value: string }[];
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Signs in once through @supabase/ssr, so the cookies are named, chunked and
 * encoded as the app expects, and the same client then works as that user.
 * Supabase limits sign-ins (about 30 in a few minutes): on 429 it waits a
 * minute and tries again.
 */
export async function signInSession(email: string, password: string): Promise<Session> {
  const { url, key } = supabasePublicEnv();
  const jar = new Map<string, string>();
  const client = createServerClient<Database>(url, key, {
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
  for (let attempt = 1; ; attempt++) {
    const { data, error } = await client.auth.signInWithPassword({ email, password });
    if (!error && data.user) {
      const cookies = [...jar].map(([name, value]) => ({ name, value }));
      return {
        email,
        userId: data.user.id,
        client,
        cookies,
        cookie: cookies.map(({ name, value }) => `${name}=${value}`).join("; "),
      };
    }
    if (error?.status === 429 && attempt < 4) {
      await sleep(65_000);
      continue;
    }
    throw new Error(`Sign-in failed for ${email}: ${error?.message ?? "no user"}`);
  }
}

/* ------------------------------------------------------------------ *
 * HTTP
 * ------------------------------------------------------------------ */

export type Probe = { status: number; location: string | null; headers: Headers; body: string };

/** One request to the app, redirects not followed. */
export async function probe(
  baseURL: string,
  path: string,
  options: { session?: Session | null; method?: string; headers?: Record<string, string>; body?: string } = {},
): Promise<Probe> {
  const headers: Record<string, string> = { ...options.headers };
  if (options.session) headers.Cookie = options.session.cookie;
  const response = await fetch(new URL(path, baseURL), {
    method: options.method ?? "GET",
    headers,
    body: options.body,
    redirect: "manual",
  });
  return {
    status: response.status,
    location: response.headers.get("location"),
    headers: response.headers,
    body: options.method === "HEAD" ? "" : await response.text(),
  };
}

/** A Location header resolved against the app, so its origin can be compared. */
export function resolvedLocation(baseURL: string, location: string | null): URL | null {
  return location === null ? null : new URL(location, baseURL);
}

/** Where a redirect leads on this site: path and query, or the whole URL when it leaves the site. */
export function where(baseURL: string, answer: Pick<Probe, "location">): string | null {
  const url = resolvedLocation(baseURL, answer.location);
  if (!url) return null;
  return url.origin === new URL(baseURL).origin ? `${url.pathname}${url.search}` : url.href;
}

/* ------------------------------------------------------------------ *
 * Server Actions over HTTP
 * ------------------------------------------------------------------ */

/** A FormData argument: its fields as text. */
export type FormArg = { form: Record<string, string> };
export type ActionArg = FormArg | Record<string, unknown> | string | null;

function isForm(arg: ActionArg): arg is FormArg {
  return typeof arg === "object" && arg !== null && "form" in arg && Object.keys(arg).length === 1;
}

export type ActionReply = {
  status: number;
  /** x-action-redirect, e.g. "/login;push". */
  redirect: string | null;
  /** Set-Cookie headers of the answer. */
  setCookies: string[];
  /** The action's return value (row 1 of the Flight answer), or null. */
  result: unknown;
  /** The raw answer, cut short. */
  raw: string;
};

/**
 * Calls a Server Action as React's client does: the `Next-Action` header, and
 * the arguments as JSON (`text/plain`) or, with a FormData argument, as
 * multipart with the root at field "0" and the form's fields under "_1_".
 * `origin: null` leaves the Origin header out; the default is the app's own.
 */
export async function callAction(
  baseURL: string,
  action: { id: string; path: string },
  args: ActionArg[],
  options: { session?: Session | null; origin?: string | null } = {},
): Promise<ActionReply> {
  const headers: Record<string, string> = { "Next-Action": action.id, Accept: "text/x-component" };
  const origin = options.origin === undefined ? new URL(baseURL).origin : options.origin;
  if (origin !== null) headers.Origin = origin;
  if (options.session) headers.Cookie = options.session.cookie;

  let body: string | FormData;
  const formAt = args.findIndex(isForm);
  if (formAt >= 0) {
    const data = new FormData();
    for (const [name, value] of Object.entries((args[formAt] as FormArg).form)) data.append(`_1_${name}`, value);
    data.append("0", JSON.stringify(args.map((arg, index) => (index === formAt ? "$K1" : arg))));
    body = data;
  } else {
    headers["Content-Type"] = "text/plain;charset=UTF-8";
    body = JSON.stringify(args);
  }

  const response = await fetch(new URL(action.path, baseURL), { method: "POST", headers, body, redirect: "manual" });
  const raw = await response.text();
  const rows = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const match = /^([0-9a-f]+):(.*)$/.exec(line);
    if (match) rows.set(match[1], match[2]);
  }
  let result: unknown = null;
  try {
    const head = JSON.parse(rows.get("0") ?? "null") as { a?: unknown } | null;
    const ref = head?.a;
    const row = typeof ref === "string" && ref.startsWith("$@") ? rows.get(ref.slice(2)) : undefined;
    result = row === undefined ? (ref ?? null) : JSON.parse(row);
  } catch {
    result = null;
  }
  return {
    status: response.status,
    redirect: response.headers.get("x-action-redirect"),
    setCookies: response.headers.getSetCookie(),
    result,
    raw: raw.slice(0, 600),
  };
}

/**
 * Every Server Action the client bundles can call, by exported name: the
 * pages' scripts and every chunk they load, followed transitively. Client
 * bundles name each reference (`createServerReference)("<id>", ..., "<name>")`).
 */
export async function discoverActions(baseURL: string, pages: { path: string; session: Session | null }[]) {
  const actions = new Map<string, string>();
  const seen = new Set<string>();
  const queue: string[] = [];
  const enqueue = (chunk: string) => {
    const path = chunk.startsWith("/") ? chunk : `/_next/${chunk}`;
    if (!seen.has(path)) {
      seen.add(path);
      queue.push(path);
    }
  };
  for (const page of pages) {
    const html = (await probe(baseURL, page.path, { session: page.session })).body;
    for (const match of html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_.~-]+\.js/g)) enqueue(match[0]);
  }
  const chunkTexts: { path: string; text: string }[] = [];
  while (queue.length > 0) {
    const path = queue.shift()!;
    const text = (await probe(baseURL, path)).body;
    chunkTexts.push({ path, text });
    for (const match of text.matchAll(/static\/chunks\/[A-Za-z0-9_.~-]+\.js/g)) enqueue(match[0]);
    for (const match of text.matchAll(/createServerReference\)\("([0-9a-f]{40,44})",[^"]*"([A-Za-z_$][A-Za-z0-9_$]*)"\)/g)) {
      actions.set(match[2], match[1]);
    }
  }
  return { actions, chunks: chunkTexts };
}

/* ------------------------------------------------------------------ *
 * Signed URLs
 * ------------------------------------------------------------------ */

/** The claims of a JWT, unverified (for reading lifetimes only). */
export function jwtClaims(token: string): Record<string, unknown> {
  const [, payload] = token.split(".");
  return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
}

/** How long a Supabase Storage signed URL works, in seconds (exp - iat of its token). */
export function signedUrlLifetime(url: string): number {
  const token = new URL(url.replace(/&amp;/g, "&")).searchParams.get("token");
  if (!token) throw new Error(`Not a signed URL: ${url.slice(0, 80)}`);
  const claims = jwtClaims(token);
  return Number(claims.exp) - Number(claims.iat);
}

/** Signed Storage URLs in a page or JSON body. */
export function signedUrlsIn(text: string): string[] {
  const found = text.match(/https:\/\/[a-z0-9-]+\.supabase\.co\/storage\/v1\/object\/sign\/[^"'\s\\<>]+/g) ?? [];
  return [...new Set(found.map((url) => url.replace(/\\u0026/g, "&").replace(/&amp;/g, "&")))];
}

/* ------------------------------------------------------------------ *
 * Secrets for the bundle scan
 * ------------------------------------------------------------------ */

/** Server-only values from .env.local that must never reach a browser, by name. Empty ones are skipped. */
export function serverSecrets(envFile = ".env.local"): Record<string, string> {
  const secrets: Record<string, string> = {};
  let text = "";
  try {
    text = readFileSync(envFile, "utf8");
  } catch {
    return secrets;
  }
  for (const line of text.split("\n")) {
    const match = /^(SUPABASE_SECRET_KEY|SUPABASE_DB_URL|ANTHROPIC_API_KEY|AI_WEBHOOK_SECRET)=(.*)$/.exec(line.trim());
    const value = match?.[2].trim().replace(/^["']|["']$/g, "");
    if (match && value) secrets[match[1]] = value;
  }
  if (secrets.SUPABASE_DB_URL) {
    try {
      const url = new URL(secrets.SUPABASE_DB_URL);
      if (url.password) secrets.SUPABASE_DB_PASSWORD = decodeURIComponent(url.password);
    } catch {
      // Not a URL: the whole value is still checked.
    }
  }
  return secrets;
}
