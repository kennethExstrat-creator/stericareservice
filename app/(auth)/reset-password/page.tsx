import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { HOME_PATH } from "@/lib/auth/routes";
import { getSession, requireUser } from "@/lib/auth/session";
import { AuthHeading } from "../_components/auth-heading";
import { BackToSignIn } from "../_components/back-to-sign-in";
import { SetupNotice } from "../_components/setup-notice";
import { SubmitButton } from "../_components/submit-button";
import { sessionStartedByRecentLink } from "../link-session";
import { ResetPasswordForm } from "./reset-password-form";

export async function generateMetadata(): Promise<Metadata> {
  const session = await getSession();
  if (session.status === "signed-out") return { title: "Link Expired" };
  if (session.status === "active" && !(await sessionStartedByRecentLink())) return { title: "Use Your Email Link" };
  return { title: "Choose a New Password" };
}

/**
 * /reset-password: where reset emails land, through /auth/confirm, which turns
 * the email's one-time token into a session (BUILD_SPEC 3).
 *
 * - No session: the link was used or has expired.
 * - A deactivated account leaves through requireUser's sign-out route.
 * - Someone invited who has not created their account yet goes on to
 *   /create-account, also through requireUser: an invitation link from before
 *   Account Creation (?flow=invite), or a reset link an admin sent for a lost
 *   invitation, ends there.
 * - A session that no invite or reset link started in the last hour (a normal
 *   password sign-in) is not offered the form. That keeps the app's own
 *   screens to the email-link flow; it is not a security boundary, since
 *   Supabase Auth itself accepts a password change from any session
 *   (../link-session.ts).
 */
export default async function ResetPasswordPage() {
  const session = await getSession();
  if (session.status === "unconfigured") return <SetupNotice />;
  if (session.status === "signed-out") return <LinkExpired />;

  const user = await requireUser();
  if (!(await sessionStartedByRecentLink())) return <UseEmailLink />;

  return (
    <div className="space-y-6">
      <AuthHeading
        title="Choose a New Password"
        description={
          <>
            For <span className="font-medium break-all text-foreground">{user.email}</span>. You stay signed in on this
            device.
          </>
        }
      />
      <ResetPasswordForm email={user.email} />
    </div>
  );
}

function LinkExpired() {
  return (
    <div className="space-y-6">
      <AuthHeading
        title="This Link Has Expired or Was Already Used"
        description="Invite and reset links work once and expire after a short time. Get a new link to choose your password."
      />
      <div className="space-y-3">
        <Button asChild size="lg" className="w-full">
          <Link href="/forgot-password">Get a New Link</Link>
        </Button>
        <BackToSignIn />
      </div>
    </div>
  );
}

/** Signed in, but not through a recent invite or reset link. */
function UseEmailLink() {
  return (
    <div className="space-y-6">
      <AuthHeading
        title="Use Your Email Link"
        description="Passwords are set from an invite or reset link opened in the last hour."
      />
      <p className="text-sm text-muted-foreground">
        To get a new link, sign out, then choose “Forgot Password?” on the sign-in screen.
      </p>
      <div className="space-y-3">
        <form action={signOut}>
          <SubmitButton pendingLabel="Signing Out…">Sign Out</SubmitButton>
        </form>
        <Button asChild variant="link" className="w-full">
          <Link href={HOME_PATH}>
            <ArrowLeftIcon aria-hidden data-icon="inline-start" />
            Back to Inspections
          </Link>
        </Button>
      </div>
    </div>
  );
}
