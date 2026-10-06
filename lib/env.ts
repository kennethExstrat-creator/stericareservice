/**
 * Environment access shared by server and client code.
 *
 * NEXT_PUBLIC_ variables are inlined at build time, so each one is read with a
 * literal `process.env.NAME` expression; a dynamic lookup would come back
 * undefined in the browser bundle. Server-only secrets are read in the modules
 * that need them (lib/supabase/admin.ts, lib/ai/), never here.
 */

export type SupabasePublicEnv = { url: string; publishableKey: string };

/** The Supabase URL and publishable key, or null while they are not set. */
export function getSupabasePublicEnv(): SupabasePublicEnv | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !publishableKey) return null;
  return { url, publishableKey };
}

/**
 * The app runs without Supabase credentials (the /design page and the login
 * screen's setup notice work), so callers check this instead of crashing.
 */
export function isSupabaseConfigured(): boolean {
  return getSupabasePublicEnv() !== null;
}

/** Public origin used to build links in auth emails. No trailing slash. */
export function getSiteUrl(): string {
  const raw = process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000";
  return raw.replace(/\/+$/, "");
}

export class SupabaseNotConfiguredError extends Error {
  constructor() {
    super(
      "Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local.",
    );
    this.name = "SupabaseNotConfiguredError";
  }
}
