import type { Metadata } from "next";
import { NotFoundScreen } from "@/components/shell/status-screen";

export const metadata: Metadata = {
  title: "Page Not Found",
};

/**
 * An inspection that does not exist, or one this user may not read: the
 * same answer, so the address never tells whether someone else's inspection
 * is there. Rendered in the shell's content area, which keeps the nav.
 */
export default function InspectionPhotosNotFound() {
  return <NotFoundScreen />;
}
