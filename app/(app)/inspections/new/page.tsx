import type { Metadata } from "next";
import Link from "next/link";
import { TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { Empty, EmptyContent, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { requireUser } from "@/lib/auth/session";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { createClient } from "@/lib/supabase/server";
import { NewInspectionForm } from "./_components/new-inspection-form";
import { loadNewInspectionOptions } from "./_lib/options";

export const metadata: Metadata = {
  title: "New Inspection",
};

/**
 * Starting an inspection (BUILD_SPEC 10): any signed-in inspector or admin.
 * Everything is read through the user's own client, so Row Level Security
 * decides what the pickers offer.
 */
export default async function NewInspectionPage() {
  const user = await requireUser();
  const options = await loadNewInspectionOptions(await createClient(), user.role);

  // No padding of its own: the app shell's <main> sets the page margins.
  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeader
        eyebrow="Inspections"
        title="New Inspection"
      />
      {options ? (
        <NewInspectionForm
          userId={user.id}
          role={user.role}
          clients={options.clients}
          manufacturers={options.manufacturers}
          templates={options.templates}
        />
      ) : (
        <LoadFailed />
      )}
    </div>
  );
}

function LoadFailed() {
  return (
    <Empty data-testid="load-failed" className="border border-solid border-fail-border bg-card px-6 py-12 md:py-16">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon" className="size-12 rounded-xl bg-fail-tint text-fail">
          <TriangleAlertIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <h2 className="text-lg font-bold text-foreground">The Lists Could Not Be Loaded</h2>
        </EmptyTitle>
        <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
          Clients, manufacturers and templates did not load. Check the connection and try again.
        </EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button asChild>
          <Link href={`${INSPECTIONS_PATH}/new`}>Try Again</Link>
        </Button>
      </EmptyContent>
    </Empty>
  );
}
