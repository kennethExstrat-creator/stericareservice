import type { Metadata } from "next";
import { NotFoundScreen } from "@/components/shell/status-screen";

export const metadata: Metadata = {
  title: "Page Not Found",
};

/**
 * notFound() from the capture screen: an id that is not an inspection, one
 * that was deleted, or one this user may not read. The same answer in every
 * case, so the address never tells whether someone else's inspection is
 * there. Rendered in the shell's content area, which keeps the nav (the root
 * not-found brings a frame of its own). The shell and its loading state have
 * streamed by then, so the HTTP status stays 200.
 */
export default function CaptureNotFound() {
  return <NotFoundScreen />;
}
