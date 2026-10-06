import type { Metadata } from "next";
import { isSupabaseConfigured } from "@/lib/env";
import { SetupNotice } from "../_components/setup-notice";
import { ForgotPasswordForm } from "./forgot-password-form";

export const metadata: Metadata = { title: "Reset your password" };

/**
 * /forgot-password (BUILD_SPEC 3). A guest screen like /login: proxy.ts sends
 * signed-in visitors on, and the reply never says whether an account exists.
 */
export default function ForgotPasswordPage() {
  if (!isSupabaseConfigured()) return <SetupNotice />;
  return <ForgotPasswordForm />;
}
