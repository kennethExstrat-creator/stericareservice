import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { passwordFlow } from "@/lib/auth/forms";
import { getSession, requireUser } from "@/lib/auth/session";
import { AuthHeading } from "../_components/auth-heading";
import { BackToSignIn } from "../_components/back-to-sign-in";
import { SetupNotice } from "../_components/setup-notice";
import { ResetPasswordForm } from "./reset-password-form";

const TITLES = { invite: "Set your password", recovery: "Choose a new password" } as const;

export async function generateMetadata({ searchParams }: PageProps<"/reset-password">): Promise<Metadata> {
  const session = await getSession();
  if (session.status === "signed-out") return { title: "Link expired" };
  return { title: TITLES[passwordFlow((await searchParams).flow)] };
}

/**
 * /reset-password: where invite and reset emails land, through /auth/confirm,
 * which turns the email's one-time token into a session (BUILD_SPEC 3). With
 * no session the link was used or has expired. ?flow=invite|recovery only
 * picks the wording; the updatePassword action checks the session again.
 */
export default async function ResetPasswordPage({ searchParams }: PageProps<"/reset-password">) {
  const session = await getSession();
  if (session.status === "unconfigured") return <SetupNotice />;
  if (session.status === "signed-out") return <LinkExpired />;

  // A deactivated account leaves through requireUser's sign-out route.
  const user = await requireUser();
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
        title="This link has expired or was already used"
        description="Invite and reset links work once and expire after a short time. Get a new link to choose your password."
      />
      <div className="space-y-3">
        <Button asChild size="lg" className="w-full">
          <Link href="/forgot-password">Get a new link</Link>
        </Button>
        <BackToSignIn />
      </div>
    </div>
  );
}
