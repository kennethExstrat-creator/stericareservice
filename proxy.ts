import { NextResponse, type NextRequest } from "next/server";
import { proxyDecision } from "@/lib/auth/routes";
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

  const decision = proxyDecision({
    method: request.method,
    pathname,
    search,
    next: searchParams.get("next"),
    signedIn: claims !== null,
  });
  if (decision.action === "pass") return response;
  return redirectKeepingSession(request, response, decision.location);
}

/** A redirect that still carries any refreshed auth cookies and cache headers. */
function redirectKeepingSession(request: NextRequest, from: NextResponse, location: string) {
  const redirect = NextResponse.redirect(new URL(location, request.url));
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
