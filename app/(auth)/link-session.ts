import "server-only";
import type { JwtPayload } from "@supabase/supabase-js";
import { cache } from "react";
import { createClient } from "@/lib/supabase/server";

/**
 * Whom /reset-password offers the password form to: only a session that an
 * invite or reset link started within the last hour, not one signed in with a
 * password.
 *
 * This is hardening of the app's own screens, not a security boundary. Any
 * signed-in session can still change its password straight through Supabase
 * Auth (PUT /auth/v1/user with the session's access token, which page scripts
 * can read from the @supabase/ssr cookie). Supabase's "secure password change"
 * (secure_password_change, off in supabase/config.toml) would not close that:
 * it asks for an emailed nonce only once a session is over 24 hours old.
 * Supabase Auth's "require current password" setting
 * (GOTRUE_SECURITY_UPDATE_PASSWORD_REQUIRE_CURRENT_PASSWORD) would enforce the
 * idea server-side: it wants the current password unless the session came
 * from an email link (amr otp, magiclink or recovery).
 */

/** Matches the links themselves, which expire after an hour (otp_expiry). */
export const LINK_SESSION_MAX_AGE_SECONDS = 60 * 60;

// Supabase records every email link (verifyOtp, whatever its type) as "otp";
// the other names are older or alternative spellings of the same thing.
const LINK_METHODS: ReadonlySet<string> = new Set(["otp", "recovery", "invite", "magiclink"]);

/**
 * Reads the JWT `amr` claim. Supabase sends entries with a timestamp (the sign-in
 * time, kept across token refreshes). The plain RFC 8176 form carries no time,
 * so for it only the method is checked.
 */
export function startedByRecentLink(amr: JwtPayload["amr"], nowSeconds: number = Date.now() / 1000): boolean {
  return (amr ?? []).some((entry) => {
    if (typeof entry === "string") return LINK_METHODS.has(entry);
    const age = nowSeconds - entry.timestamp;
    return LINK_METHODS.has(entry.method) && age >= -60 && age <= LINK_SESSION_MAX_AGE_SECONDS;
  });
}

/**
 * The rule above, for the signed-in user's verified claims. Memoised per render
 * (the page and its metadata share one check); Server Actions get a fresh one.
 */
export const sessionStartedByRecentLink = cache(async (): Promise<boolean> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return false;
  return startedByRecentLink(data.claims.amr);
});
