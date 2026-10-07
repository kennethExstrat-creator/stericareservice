import { isIP } from "node:net";

/**
 * The visitor's IP address for Supabase Auth's Sb-Forwarded-For header
 * (createAuthClient in ./server.ts), or null when there is none to trust.
 *
 * Only on Vercel, whose edge sets x-real-ip and overwrites x-forwarded-for on
 * every request, so a visitor cannot choose them. Under next dev and next
 * start these headers come from whoever sends the request (Next.js only fills
 * x-forwarded-for in when it is missing): trusting them would let one visitor
 * spread password guesses over made-up addresses, each with its own sign-in
 * limit. There the server's own address stays the key, as before.
 */
export function trustedVisitorIp(
  headers: Pick<Headers, "get">,
  onVercel: boolean = process.env.VERCEL === "1",
): string | null {
  if (!onVercel) return null;
  const candidate = (headers.get("x-real-ip") ?? headers.get("x-forwarded-for")?.split(",")[0] ?? "").trim();
  return isIP(candidate) === 0 ? null : candidate;
}
