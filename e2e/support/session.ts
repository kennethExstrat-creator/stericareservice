import type { BrowserContext } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";

/** The local test accounts from BUILD_SPEC section 11 (npm run seed:dev-users). */
export const TEST_ACCOUNTS = {
  inspector: "inspector@test.local",
  admin: "admin@test.local",
} as const;

export const TEST_PASSWORD = process.env.DEV_USER_PASSWORD?.trim() || "SteriCare-dev-2026";

function supabaseEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!url || !key) throw new Error("Supabase is not configured: copy .env.local into this checkout.");
  return { url, key };
}

/**
 * Signs in through @supabase/ssr itself, so the cookies are named, chunked and
 * encoded exactly as the app's server client expects.
 */
export async function sessionCookies(email: string, password: string = TEST_PASSWORD) {
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
  return [...jar].map(([name, value]) => ({ name, value }));
}

/** Puts a signed-in session for `email` into the browser context. */
export async function signIn(context: BrowserContext, baseURL: string, email: string, password?: string) {
  const cookies = await sessionCookies(email, password);
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}
