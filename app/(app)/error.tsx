"use client";

import { ErrorScreen } from "@/components/shell/error-screen";

/**
 * Errors in an app page show here, inside the shell, so the nav and the user
 * menu still work. Errors in the shell itself reach app/error.tsx.
 */
export default function AppError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return <ErrorScreen error={error} retry={retry} />;
}
