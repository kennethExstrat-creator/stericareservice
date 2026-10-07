import type { CookieOptionsWithName } from "@supabase/ssr";

/**
 * Attributes of the Supabase session cookies, for every client that writes
 * them (./server.ts, ./proxy.ts, ./client.ts). @supabase/ssr adds Max-Age.
 *
 * - Secure when the request came over HTTPS (Vercel), so the session never
 *   travels in clear text, even on a host without HSTS. Over plain http a
 *   browser would drop a Secure cookie, so the dev server, which the iPad opens
 *   by the Mac's LAN address, gets cookies without it.
 * - SameSite=Lax: requests from other sites (posts, frames) arrive without
 *   the session.
 * - Not HttpOnly, by @supabase/ssr's design: the browser client reads the
 *   session from these cookies.
 */
export function sessionCookieOptions(https: boolean): CookieOptionsWithName {
  return { path: "/", sameSite: "lax", secure: https };
}

/**
 * Whether a request reached the app over HTTPS, from the first entry of
 * x-forwarded-proto: Vercel sets it, and Next.js fills it in from the
 * connection when it is missing. A visitor who sends a false one only changes
 * the attributes of their own cookies.
 */
export function isHttpsRequest(headers: Pick<Headers, "get">): boolean {
  return headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() === "https";
}
