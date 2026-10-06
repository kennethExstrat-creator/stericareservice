import { createServerClient } from "@supabase/ssr";
import type { JwtPayload } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";
import { getSupabasePublicEnv } from "@/lib/env";
import type { Database } from "./database.types";

/**
 * Refreshes the Supabase session for one request and reports who it belongs
 * to. Used only by proxy.ts.
 *
 * Refreshed tokens are written twice: onto the request, so Server Components
 * rendering this request see them, and onto the response, so the browser keeps
 * them. The cache headers @supabase/ssr hands over stop a CDN from caching a
 * response that carries one user's session cookie.
 */
export async function updateSession(
  request: NextRequest,
): Promise<{ response: NextResponse; claims: JwtPayload | null }> {
  let response = NextResponse.next({ request });

  const env = getSupabasePublicEnv();
  if (!env) return { response, claims: null };

  const supabase = createServerClient<Database>(env.url, env.publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
        for (const [key, value] of Object.entries(headers)) response.headers.set(key, value);
      },
    },
  });

  // Nothing may run between creating the client and this call: getClaims()
  // refreshes an expiring session and verifies the JWT, and a refresh that
  // lands after the response is built is lost.
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return { response, claims: null };
  return { response, claims: data.claims };
}
