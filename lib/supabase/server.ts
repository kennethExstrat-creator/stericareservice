import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabasePublicEnv, SupabaseNotConfiguredError } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers,
 * acting as the signed-in user (publishable key + session cookie, so RLS
 * applies). Create one per request; never share it between requests.
 */
export async function createClient() {
  const env = getSupabasePublicEnv();
  if (!env) throw new SupabaseNotConfiguredError();

  const cookieStore = await cookies();

  return createServerClient<Database>(env.url, env.publishableKey, {
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
  });
}
