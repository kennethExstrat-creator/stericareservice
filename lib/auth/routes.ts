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

export type ProxyDecision = { action: "pass" } | { action: "redirect"; location: string };

/**
 * What proxy.ts does with one request. Only page navigations (GET and HEAD)
 * are redirected: a Server Action is a POST, and a redirect in reply breaks it
 * on the client ("An unexpected response was received from the server"), so
 * actions pass through and answer for themselves through authorizeAction().
 */
export function proxyDecision(request: {
  method: string;
  pathname: string;
  search: string;
  next: string | null;
  signedIn: boolean;
}): ProxyDecision {
  const { method, pathname, search, next, signedIn } = request;
  if (method !== "GET" && method !== "HEAD") return { action: "pass" };

  switch (classifyPath(pathname)) {
    case "api":
    case "open":
      return { action: "pass" };
    case "guest":
      return signedIn ? { action: "redirect", location: safeNextPath(next) } : { action: "pass" };
    case "protected": {
      if (signedIn) return { action: "pass" };
      if (pathname === "/") return { action: "redirect", location: LOGIN_PATH };
      const login = new URLSearchParams({ next: `${pathname}${search}` });
      return { action: "redirect", location: `${LOGIN_PATH}?${login}` };
    }
  }
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

  // The parser collapses dot segments, so "/.//evil.example" arrives here as
  // "//evil.example": check the normalised path, not just the raw string.
  const path = url.pathname;
  if (path.startsWith("//")) return fallback;
  if (classifyPath(path) === "guest" || matches(path, "/auth")) return fallback;

  const next = `${path}${url.search}${url.hash}`;
  // Last line of defence: the result must stay on our origin when a browser
  // resolves it as a relative URL.
  if (new URL(next, "http://internal.invalid").origin !== "http://internal.invalid") return fallback;
  return next;
}
