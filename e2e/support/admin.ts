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

/**
 * Deletes a test inspection, approved ones included. The service role may not
 * delete approved inspections directly (their audit history must stay), so
 * teardown goes through delete_test_inspection(), which only accepts
 * inspections of @test.local inspectors. Delete its Storage files first.
 */
export async function deleteTestInspection(
  admin: ReturnType<typeof createTestAdminClient>,
  inspectionId: string,
): Promise<void> {
  const { error } = await admin.rpc("delete_test_inspection", { inspection_id: inspectionId });
  if (error) throw new Error(`Could not delete test inspection ${inspectionId}: ${error.message}`);
}
