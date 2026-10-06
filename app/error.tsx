"use client";

import { ErrorScreen } from "@/components/shell/error-screen";
import { StandaloneFrame } from "@/components/shell/status-screen";

/**
 * Errors outside an app page: in the app shell itself (loading the session),
 * the sign-in screens or other routes. The root layout still renders, so the
 * theme and fonts hold. Errors in the root layout reach app/global-error.tsx.
 */
export default function RootError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <StandaloneFrame>
      <ErrorScreen error={error} retry={retry} />
    </StandaloneFrame>
  );
}
