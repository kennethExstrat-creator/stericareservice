import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { signOut } from "@/lib/auth/actions";
import { MESSAGES } from "@/lib/auth/forms";
import { ROLE_CHOICE_LABEL, roleChoiceOf } from "@/lib/auth/org";
import { DEACTIVATED_PATH, getSession, hasJoined, type SessionUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { AuthHeading } from "../_components/auth-heading";
import { BackToSignIn } from "../_components/back-to-sign-in";
import { SetupNotice } from "../_components/setup-notice";
import { SubmitButton } from "../_components/submit-button";
import { dashboardPathFor } from "../dashboard-path";
import { sessionStartedByRecentLink } from "../link-session";
import { CreateAccountForm } from "./create-account-form";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession();
  if (session.status === "signed-out") return { title: "Invitation Expired" };
  if (session.status === "active" && !hasJoined(session.user) && !(await sessionStartedByRecentLink())) {
    return { title: "Ask for a New Invitation" };
  }
  return { title: "Create Your Account" };
}

/**
 * /create-account: Account Creation (Kenneth, 27 October 2026). An admin
 * invites someone by email with their role already chosen; the invitation
 * link (/auth/confirm) signs them in and lands here, where they fill in their
 * name and phone and choose a password, then go straight to their dashboard.
 * requireUser() sends here anyone invited who has not finished, so this page
 * reads getSession() itself rather than send them round in a loop.
 *
 * - No session: the invitation link was used or has expired.
 * - A deactivated account leaves through the sign-out route, as requireUser's.
 * - An account created already goes to its dashboard.
 * - A session no invitation link started in the last hour (the link opened
 *   yesterday, the tab left open) is not offered the form: they ask for the
 *   invitation again. Hardening of the app's screens, as /reset-password.
 *
 * createAccount checks all of it again.
 */
export default async function CreateAccountPage() {
  const session = await getSession();
  if (session.status === "unconfigured") return <SetupNotice />;
  if (session.status === "signed-out") return <InvitationExpired />;
  if (session.status === "deactivated") redirect(DEACTIVATED_PATH);

  const { user } = session;
  if (hasJoined(user)) redirect(dashboardPathFor(user.role));
  if (!(await sessionStartedByRecentLink())) return <AskForNewInvitation />;

  const role = await chosenRole(user);
  return (
    <div className="space-y-6">
      <AuthHeading
        title="Create Your Account"
        description={
          <>
            You are joining as {article(role)} <span className="font-medium text-foreground">{role}</span>.
          </>
        }
      />
      <CreateAccountForm fullName={user.fullName ?? ""} email={user.email} />
    </div>
  );
}

/**
 * The role the admin chose in the invitation, by its name: a custom role's
 * own (my_role(), migration 20261027150000), else the built-in role for the
 * account's level, as the Users screen labels it.
 */
async function chosenRole(user: SessionUser): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.rpc("my_role");
    const name = data?.[0]?.name?.trim();
    if (name) return name;
  } catch {
    // Only words on the page: the level's name below will do.
  }
  return ROLE_CHOICE_LABEL[roleChoiceOf(user)];
}

/** "an Inspector", "a Lead Inspector", "an Admin". */
function article(label: string): "a" | "an" {
  return /^[AEIOU]/i.test(label) ? "an" : "a";
}

function InvitationExpired() {
  return (
    <div className="space-y-6">
      <AuthHeading title="This Invitation Has Expired or Was Already Used" description={MESSAGES.invitationExpired} />
      <BackToSignIn variant="outline" />
    </div>
  );
}

/** Signed in by an invitation link, but not in the last hour. */
function AskForNewInvitation() {
  return (
    <div className="space-y-6">
      <AuthHeading
        title="Ask for a New Invitation"
        description={`${MESSAGES.invitationLinkRequired} Then open the link in the new email.`}
      />
      <form action={signOut}>
        <SubmitButton pendingLabel="Signing Out…">Sign Out</SubmitButton>
      </form>
    </div>
  );
}
