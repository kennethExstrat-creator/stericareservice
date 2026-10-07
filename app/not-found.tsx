import type { Metadata } from "next";
import { NotFoundScreen, StandaloneFrame } from "@/components/shell/status-screen";

export const metadata: Metadata = {
  title: "Page Not Found",
};

/**
 * Unknown addresses, and notFound() anywhere without a closer not-found file:
 * /admin for non-admins, a missing record. Static on purpose: it renders for
 * signed-in and signed-out visitors alike, and "Go to Inspections" sends a
 * signed-out one to sign in.
 */
export default function NotFound() {
  return (
    <StandaloneFrame>
      <NotFoundScreen />
    </StandaloneFrame>
  );
}
