import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { CREATE_ACCOUNT_PATH, LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { isSupabaseConfigured } from "@/lib/env";
import { createAuthClient } from "@/lib/supabase/server";

/**
 * Landing route for the links in auth emails (supabase/templates/). The link
 * carries a one-time token hash; verifying it here sets the session cookie.
 * This works on any device, which the PKCE code flow cannot promise for
 * invites: the admin's browser started them, not the invitee's. The check
 * counts against the visitor's own limit for link checks (createAuthClient).
 */

// An invitation opens Account Creation, a reset the password screen, whatever
// ?next= the email carries (older invitations said next=/reset-password). A
// reset link opened by someone who has not created their account yet (an
// admin's link for a lost invitation) goes on to Account Creation from there.
const DESTINATIONS: Partial<Record<EmailOtpType, string>> = {
  invite: CREATE_ACCOUNT_PATH,
  recovery: "/reset-password",
};
const ACCEPTED: ReadonlySet<string> = new Set<EmailOtpType>(["invite", "recovery", "email", "email_change"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (isSupabaseConfigured() && tokenHash && type && ACCEPTED.has(type)) {
    const otpType = type as EmailOtpType;
    const auth = await createAuthClient();
    const { error } = await auth.verifyOtp({ type: otpType, token_hash: tokenHash });
    if (!error) redirect(DESTINATIONS[otpType] ?? safeNextPath(searchParams.get("next")));
  }

  redirect(`${LOGIN_PATH}?error=link_invalid`);
}
