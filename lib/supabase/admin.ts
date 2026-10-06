import "server-only";
import { createClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";

/**
 * Supabase client with the secret (service role) key. It bypasses Row Level
 * Security, so it is only for work no user session can do: inviting users,
 * banning deactivated accounts, admin-only lookups. Call it from server code
 * that has already checked the caller is an active admin (lib/auth/session.ts).
 *
 * `server-only` makes the build fail if a Client Component imports this file.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) {
    throw new Error(
      "Supabase admin client is not configured: set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY in .env.local.",
    );
  }

  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false, detectSessionInUrl: false },
  });
}

/** True when the secret key is present, so admin screens can explain what is missing. */
export function isAdminClientConfigured(): boolean {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() && process.env.SUPABASE_SECRET_KEY?.trim());
}
