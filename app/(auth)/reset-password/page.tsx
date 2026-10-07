import { ArrowLeftIcon } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { signOut } from "@/lib/auth/actions";
import { passwordFlow } from "@/lib/auth/forms";
import { HOME_PATH } from "@/lib/auth/routes";
import { getSession, requireUser } from "@/lib/auth/session";
import { AuthHeading } from "../_components/auth-heading";
import { BackToSignIn } from "../_components/back-to-sign-in";
import { SetupNotice } from "../_components/setup-notice";
import { SubmitButton } from "../_components/submit-button";
import { sessionStartedByRecentLink } from "../link-session";
import { ResetPasswordForm } from "./reset-password-form";

const TITLES = { invite: "Set Your Password", recovery: "Choose a New Password" } as const;

export async function generateMetadata({ searchParams }: PageProps<"/reset-password">): Promise<Metadata> {
  const session = await getSession();
  if (session.status === "signed-out") return { title: "Link Expired" };
  if (session.status === "active" && !(await sessionStartedByRecentLink())) return { title: "Use Your Email Link" };
  return { title: TITLES[passwordFlow((await searchParams).flow)] };
}

/**
 * /reset-password: where invite and reset emails land, through /auth/confirm,
 * which turns the email's one-time token into a session (BUILD_SPEC 3).
 *
 * - No session: the link was used or has expired.
 * - A deactivated account leaves through requireUser's sign-out route.
 * - A session that no invite or reset link started in the last hour (a normal
 *   password sign-in) is not offered the form. That keeps the app's own
 *   screens to the email-link flow; it is not a security boundary, since
 *   Supabase Auth itself accepts a password change from any session
 *   (../link-session.ts).
 *
 * ?flow=invite|recovery only picks the wording; updatePassword checks it all again.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const session = await getSession();
  if (session.status === "unconfigured") return <SetupNotice />;
  if (session.status === "signed-out") return <LinkExpired />;

  const user = await requireUser();
  if (!(await sessionStartedByRecentLink())) return <UseEmailLink />;
  const flow = passwordFlow((await searchParams).flow);

  return (
    <div className="space-y-6">
      <AuthHeading
        title={TITLES[flow]}
        description={
          flow === "invite" ? (
            <>
              Welcome to SteriCare QC{user.fullName ? `, ${user.fullName}` : ""}. Choose a password for{" "}
              <span className="font-medium break-all text-foreground">{user.email}</span> to finish setting up your
              account.
            </>
          ) : (
            <>
              For <span className="font-medium break-all text-foreground">{user.email}</span>. You stay signed in on
              this device.
            </>
          )
        }
      />
      <ResetPasswordForm flow={flow} email={user.email} />
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
