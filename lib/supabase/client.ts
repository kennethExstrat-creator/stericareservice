import { createBrowserClient } from "@supabase/ssr";
import { getSupabasePublicEnv, SupabaseNotConfiguredError } from "@/lib/env";
import { sessionCookieOptions } from "./cookie-options";
import type { Database } from "./database.types";

/**
 * Supabase client for Client Components. It reads and writes the same auth
 * cookies as the server client, with the same attributes (./cookie-options.ts),
 * and only ever holds the publishable key: Row Level Security decides what the
 * signed-in user can touch.
 */
export function createClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();
  const https = typeof window !== "undefined" && window.location.protocol === "https:";
  return createBrowserClient<Database>(env.url, env.publishableKey, { cookieOptions: sessionCookieOptions(https) });
}
