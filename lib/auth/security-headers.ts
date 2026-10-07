/**
 * Response headers every page, Server Action and Route Handler answers with.
 * proxy.ts sets them, on its redirects too; static files (build assets,
 * images, icons), which the proxy skips, carry nothing these headers guard.
 *
 * - No other site may show the app in a frame (clickjacking): the CSP's
 *   frame-ancestors, plus X-Frame-Options for browsers that predate it.
 * - The policy starts small, so nothing the app loads can break: it also stops
 *   an injected <base> tag and plugins. Script and style rules can be added
 *   here later, with nonces from proxy.ts (Next.js CSP guide).
 * - Links to other sites send the origin only, never a path with an id in it.
 * - No content-type guessing, and no device features beyond the camera (photo
 *   capture): no microphone, location, payments or USB.
 */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-Content-Type-Options": "nosniff",
  "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=()",
};

/** Adds SECURITY_HEADERS to a response and returns it. */
export function withSecurityHeaders<T extends { headers: Headers }>(response: T): T {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) response.headers.set(name, value);
  return response;
}
