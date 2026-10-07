"use client";

import { useEffect } from "react";
import { RotateCwIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";

/**
 * When the list cannot be loaded (Supabase unreachable, an unexpected error).
 * Renders inside the app shell, which provides the page padding.
 */
export default function ClientsError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <div className="flex flex-col gap-6">
      <PageHeader eyebrow="Admin" title="Clients" />
      <Empty className="border border-border bg-card shadow-sm">
        <EmptyHeader>
          <EmptyMedia variant="icon" className="bg-warn-tint text-warn">
            <TriangleAlertIcon aria-hidden />
          </EmptyMedia>
          <EmptyTitle>The clients could not be loaded</EmptyTitle>
          <EmptyDescription>
            Check the connection and try again. If it keeps happening, Supabase may be unavailable.
          </EmptyDescription>
        </EmptyHeader>
        <EmptyContent>
          <Button onClick={() => retry()}>
            <RotateCwIcon aria-hidden />
            Try Again
          </Button>
          {error.digest && <p className="text-sm text-muted-foreground">Reference: {error.digest}</p>}
        </EmptyContent>
      </Empty>
    </div>
  );
}
