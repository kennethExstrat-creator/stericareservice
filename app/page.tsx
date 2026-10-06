import { redirect } from "next/navigation";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";

/**
 * The root has no screen of its own. Signed-in users go to the inspections
 * list; requireUser() sends everyone else to /login (deactivated accounts to
 * the sign-out route), as proxy.ts already does for visitors without a session.
 */
export default async function Home() {
  await requireUser();
  redirect(HOME_PATH);
}
