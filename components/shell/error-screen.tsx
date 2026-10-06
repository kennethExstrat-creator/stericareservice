"use client";

// The error boundary message (app/error.tsx inside the shell's frame,
// app/(app)/error.tsx inside the shell). Error boundaries are Client
// Components; `retry` re-fetches and re-renders the failed segment.
import Link from "next/link";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/auth/routes";
import { StatusScreen } from "./status-screen";

/** The tab title while the error shows (the root layout's "%s · SteriCare QC" template, written out). */
export const ERROR_SCREEN_TITLE = "This page did not load · SteriCare QC";

type ErrorScreenProps = {
  error: Error & { digest?: string };
  retry: () => void;
};

export function ErrorScreen({ error, retry }: ErrorScreenProps) {
  const titleRef = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    // Shows in the browser console; the digest matches the server log entry.
    console.error(error);
    // The message replaces what was on screen, often after a tap or a
    // client-side navigation, and focus would fall to <body> with nothing
    // said. Focus the heading, so VoiceOver reads what happened and Tab goes
    // on to Try again. A retry that fails brings a new error: said again.
    titleRef.current?.focus();
  }, [error]);

  return (
    <>
      {/* React moves this into <head>: the tab, and Next's route announcer after a navigation, say what happened. */}
      <title>{ERROR_SCREEN_TITLE}</title>
      <StatusScreen
        icon={TriangleAlertIcon}
        tone="error"
        eyebrow="Error"
        title="This page did not load"
        titleRef={titleRef}
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
    </>
  );
}
