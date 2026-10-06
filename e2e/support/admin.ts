import { createClient } from "@supabase/supabase-js";
import type { Database } from "../../lib/supabase/database.types";

/**
 * Secret-key client for test setup and teardown only (throwaway accounts,
 * temporary rows). It bypasses RLS: never use it to assert what a user can see.
 */
export function createTestAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!url || !secretKey) throw new Error("Supabase is not configured: copy .env.local into this checkout.");
  return createClient<Database>(url, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

/** A unique throwaway address, e.g. e2e-auth-1a2b3c@test.local. Delete the account afterwards. */
export function throwawayEmail(owner: string): string {
  return `e2e-${owner}-${Math.random().toString(36).slice(2, 8)}@test.local`;
}
