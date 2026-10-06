"use client";

// The error boundary message (app/error.tsx inside the shell's frame,
// app/(app)/error.tsx inside the shell). Error boundaries are Client
// Components; `retry` re-fetches and re-renders the failed segment.
import Link from "next/link";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/auth/routes";
import { StatusScreen } from "./status-screen";

type ErrorScreenProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export function ErrorScreen({ error, retry }: ErrorScreenProps) {
  useEffect(() => {
    // Shows in the browser console; the digest matches the server log entry.
    console.error(error);
  }, [error]);

  return (
    <StatusScreen
      icon={TriangleAlertIcon}
      tone="error"
      eyebrow="Error"
      title="This page did not load"
      description={
        error.digest
          ? "Something went wrong on our side. Try again. If it keeps happening, tell your admin and quote the reference below."
          : "Something went wrong on our side. Try again. If it keeps happening, tell your admin."
      }
      actions={
        <>
          <Button size="lg" onClick={() => retry()}>
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={HOME_PATH}>Go to inspections</Link>
          </Button>
        </>
      }
      footer={
        error.digest ? (
          <p>
            Reference: <span className="font-mono text-foreground">{error.digest}</span>
          </p>
        ) : null
      }
    />
  );
}
