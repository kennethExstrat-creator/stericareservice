import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth/session";
import { HOME_PATH, LOGIN_PATH } from "@/lib/auth/routes";
import { createClient } from "@/lib/supabase/server";

/**
 * Clears the session of a deactivated user. Server Components cannot write
 * cookies, so requireUser() redirects here instead of signing out itself.
 *
 * It only acts when the account really is blocked, so a forged link cannot
 * sign an active user out. Everyday sign-out is the signOut Server Action.
 */
export async function GET() {
  const session = await getSession();

  if (session.status === "active") redirect(HOME_PATH);

  if (session.status === "deactivated") {
    const supabase = await createClient();
    await supabase.auth.signOut({ scope: "local" });
    redirect(`${LOGIN_PATH}?error=deactivated`);
  }

  redirect(LOGIN_PATH);
}
