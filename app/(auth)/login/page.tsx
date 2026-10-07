import type { Metadata } from "next";
import { loginNotice } from "@/lib/auth/forms";
import { isSupabaseConfigured } from "@/lib/env";
import { AuthHeading } from "../_components/auth-heading";
import { SetupNotice } from "../_components/setup-notice";
import { LoginForm } from "./login-form";

export const metadata: Metadata = { title: "Sign in" };

/**
 * /login (BUILD_SPEC 3, 10). A guest screen: proxy.ts sends signed-in visitors
 * on, and the signIn action checks the account itself, so there is no session
 * to require here. No sign-up: accounts come from an admin's invite.
 */
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  if (!isSupabaseConfigured()) return <SetupNotice />;

  const { error, next } = await searchParams;

  return (
    <div className="space-y-6">
      <AuthHeading
        size="display"
        title="Sign in"
      />
      <LoginForm next={Array.isArray(next) ? next[0] : next} notice={loginNotice(error)} />
    </div>
  );
}
