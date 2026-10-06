/**
 * Route policy shared by proxy.ts and the auth pages. Pure functions, so the
 * rules are unit-tested without a request.
 */

export const HOME_PATH = "/inspections";
export const LOGIN_PATH = "/login";

/**
 * - `guest`: sign-in screens; a signed-in user is sent on to the app.
 * - `open`: reachable signed in or out (email-link landing, sign-off page).
 * - `api`: Route Handlers answer with status codes and check auth themselves.
 * - `protected`: everything else needs a session.
 */
export type RouteKind = "guest" | "open" | "api" | "protected";

const GUEST = ["/login", "/forgot-password"];
// /reset-password needs the session an email link creates, but a visitor
// without one must still reach it to see "this link has expired".
const OPEN = ["/reset-password", "/auth", "/design"];

function matches(pathname: string, base: string): boolean {
  return pathname === base || pathname.startsWith(`${base}/`);
}

export function classifyPath(pathname: string): RouteKind {
  if (matches(pathname, "/api")) return "api";
  if (GUEST.some((base) => matches(pathname, base))) return "guest";
  if (OPEN.some((base) => matches(pathname, base))) return "open";
  return "protected";
}

/**
 * Only same-origin, relative destinations survive, so `?next=` can never send
 * someone to another site (`//evil.example`, `/\evil.example`, absolute URLs)
 * or bounce them back into the sign-in screens.
 */
export function safeNextPath(raw: string | null | undefined, fallback: string = HOME_PATH): string {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//") || raw.includes("\\")) return fallback;

  let url: URL;
  try {
    url = new URL(raw, "http://internal.invalid");
  } catch {
    return fallback;
  }
  if (url.origin !== "http://internal.invalid") return fallback;

  const path = url.pathname;
  if (classifyPath(path) === "guest" || matches(path, "/auth")) return fallback;
  return `${path}${url.search}${url.hash}`;
}
