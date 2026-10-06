"use client";

import { useEffect } from "react";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/** When the user list cannot be loaded (Supabase unreachable, an unexpected error). */
export default function UsersError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 md:px-6 md:py-8 xl:px-8">
      <PageHeader eyebrow="Admin" title="Users" />
      <Empty className="border border-border bg-card shadow-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-warn-tint text-warn">
            <TriangleAlertIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>The user list could not be loaded</EmptyTitle>
          <EmptyDescription>
            Check the connection and try again. If it keeps happening, Supabase may be unavailable or not set up yet.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => retry()}>
            <RotateCwIcon aria-hidden />
            Try again
          </Button>
          {error.digest && <p className="text-sm text-muted-foreground">Reference: {error.digest}</p>}
        </EmptyContent>
      </Empty>
    </div>
  );
}
