import { NextResponse, type NextRequest } from "next/server";
import { classifyPath, LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { updateSession } from "@/lib/supabase/proxy";

/**
 * Runs before every page request: refreshes the Supabase session cookie, sends
 * signed-out visitors to /login and signed-in ones away from it.
 *
 * This is an optimistic check only. Roles, deactivation and data access are
 * enforced by lib/auth/session.ts in every page, Server Action and Route
 * Handler, and by Row Level Security in the database.
 */
export async function proxy(request: NextRequest) {
  const { response, claims } = await updateSession(request);
  const { pathname, search, searchParams } = request.nextUrl;

  switch (classifyPath(pathname)) {
    case "api":
    case "open":
      return response;
    case "guest":
      return claims ? redirectKeepingSession(request, response, safeNextPath(searchParams.get("next"))) : response;
    case "protected": {
      if (claims) return response;
      const login = new URL(LOGIN_PATH, request.url);
      if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
      return redirectKeepingSession(request, response, login);
    }
  }
}

/** A redirect that still carries any refreshed auth cookies and cache headers. */
function redirectKeepingSession(request: NextRequest, from: NextResponse, to: URL | string) {
  const redirect = NextResponse.redirect(typeof to === "string" ? new URL(to, request.url) : to);
  for (const cookie of from.cookies.getAll()) redirect.cookies.set(cookie);
  for (const header of ["cache-control", "expires", "pragma"]) {
    const value = from.headers.get(header);
    if (value) redirect.headers.set(header, value);
  }
  return redirect;
}

export const config = {
  matcher: [
    // Everything except build assets and static files (images, icons, fonts,
    // the web manifest), which need no session.
    "/((?!_next/static|_next/image|favicon\\.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|txt|xml|webmanifest|woff2?)$).*)",
  ],
};
