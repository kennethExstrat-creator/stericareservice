import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies, headers } from "next/headers";
import { getSupabasePublicEnv, SupabaseNotConfiguredError } from "@/lib/env";
import { isHttpsRequest, sessionCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";
import { trustedVisitorIp } from "./forwarded-for";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting as the signed-in user (publishable key + session cookie, so RLS
 * applies). Create one per request; never share it between requests.
 */
export async function createClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  return createCookieClient(env.url, env.publishableKey);
}

/**
 * Supabase Auth for the calls the server makes for a visitor who is not signed
 * in yet: signing in, opening an email link, asking for a reset email. A
 * session it starts goes into the same cookies createClient() reads.
 *
 * Supabase limits these calls per IP address, and they all come from this
 * server, so one visitor flooding the sign-in form would lock everyone out.
 * With the secret key (sb_secret_…) each call names the visitor's own address
 * in Sb-Forwarded-For (on Vercel only, ./forwarded-for.ts), which Supabase
 * counts instead once IP address forwarding is on (Dashboard > Authentication
 * > Rate Limits). Without a secret key the calls use the publishable key and
 * count against the server's address, as they used to.
 *
 * Only the auth API comes back: a client holding the secret key must never run
 * a query, which would bypass Row Level Security. Read data with createClient().
 * Supabase skips its own CAPTCHA check on secret-key calls, so a CAPTCHA added
 * to the sign-in forms must be verified by the app before these calls.
 */
export async function createAuthClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();

  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey?.startsWith("sb_secret_")) {
    return (await createCookieClient(env.url, env.publishableKey)).auth;
  }
  const visitorIp = trustedVisitorIp(await headers());
  const client = await createCookieClient(env.url, secretKey, visitorIp ? { "Sb-Forwarded-For": visitorIp } : undefined);
  return client.auth;
}

async function createCookieClient(url: string, key: string, extraHeaders?: Record<string, string>) {
  const [cookieStore, headerStore] = await Promise.all([cookies(), headers()]);

  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Server Components cannot write cookies. That is fine: proxy.ts has
          // already refreshed the session for this request, and Server Actions
          // and Route Handlers (which can write) reach the branch above.
        }
      },
    },
    cookieOptions: sessionCookieOptions(isHttpsRequest(headerStore)),
    ...(extraHeaders ? { global: { headers: extraHeaders } } : {}),
  });
}
