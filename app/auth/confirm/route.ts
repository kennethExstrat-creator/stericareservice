import type { EmailOtpType } from "@supabase/supabase-js";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";
import { LOGIN_PATH, safeNextPath } from "@/lib/auth/routes";
import { isSupabaseConfigured } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";

/**
 * Landing route for the links in auth emails (supabase/templates/). The link
 * carries a one-time token hash; verifying it here sets the session cookie.
 * This works on any device, which the PKCE code flow cannot promise for
 * invites: the admin's browser started them, not the invitee's.
 */

// Invite and recovery both end on the password screen; flow picks its wording.
const DESTINATIONS: Partial<Record<EmailOtpType, string>> = {
  invite: "/reset-password?flow=invite",
  recovery: "/reset-password?flow=recovery",
};
const ACCEPTED: ReadonlySet<string> = new Set<EmailOtpType>(["invite", "recovery", "email", "email_change"]);

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const tokenHash = searchParams.get("token_hash");
  const type = searchParams.get("type");

  if (isSupabaseConfigured() && tokenHash && type && ACCEPTED.has(type)) {
    const otpType = type as EmailOtpType;
    const supabase = await createClient();
    const { error } = await supabase.auth.verifyOtp({ type: otpType, token_hash: tokenHash });
    if (!error) redirect(DESTINATIONS[otpType] ?? safeNextPath(searchParams.get("next")));
  }

  redirect(`${LOGIN_PATH}?error=link_invalid`);
}
