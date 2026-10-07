import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { FileWarningIcon } from "lucide-react";
import { StatusScreen } from "@/components/shell/status-screen";
import { Button } from "@/components/ui/button";
import { HOME_PATH } from "@/lib/auth/routes";
import { requireUser } from "@/lib/auth/session";
import { captureAccess } from "@/lib/inspections/capture/access";
import { loadCaptureInspection, loadOverrideAuthors } from "@/lib/inspections/capture/load";
import { readSectionParam } from "@/lib/inspections/capture/schemas";
import { createClient } from "@/lib/supabase/server";
import { CaptureScreen } from "./_components/capture-screen";

/** One read per request, shared by the title and the page. RLS decides whether it exists for this user. */
const loadInspection = cache(async (id: string) => loadCaptureInspection(await createClient(), id));

/**
 * The title is the reference number. The session is checked first, and an
 * inspection this user cannot see is a 404 here too, so the title never
 * names it.
 */
export async function generateMetadata({ params }: PageProps<"/inspections/[id]">): Promise<Metadata> {
  await requireUser();
  const { id } = await params;
  const loaded = await loadInspection(id);
  if (loaded.kind === "not_found") notFound();
  return { title: loaded.kind === "found" ? loaded.inspection.refNo : loaded.refNo };
}

/**
 * The capture screen (BUILD_SPEC 8 and 10): the inspection, the exact
 * template version it started with (templates.resolved) and its module
 * overrides, read on the server through the user's own client.
 */
export default async function CapturePage({ params, searchParams }: PageProps<"/inspections/[id]">) {
  const user = await requireUser();
  const { id } = await params;
  const loaded = await loadInspection(id);
  if (loaded.kind === "not_found") notFound();

  if (loaded.kind === "template_unreadable") {
    console.error(`[capture] the template of ${loaded.refNo} cannot be read: ${loaded.problem}`);
    return (
      <StatusScreen
        icon={FileWarningIcon}
        tone="error"
        eyebrow={loaded.refNo}
        title="This inspection cannot be opened"
        description="Its template could not be read by this version of the app. Nothing has been changed. Ask an admin to check the template."
        actions={
          <Button asChild size="lg">
            <Link href={HOME_PATH}>Back to inspections</Link>
          </Button>
        }
      />
    );
  }

  const { inspection } = loaded;
  const [authors, query] = await Promise.all([
    loadOverrideAuthors(await createClient(), inspection.overrides),
    searchParams,
  ]);
  const access = captureAccess({
    status: inspection.status,
    role: user.role,
    userId: user.id,
    inspectorId: inspection.inspectorId,
  });

  return (
    <CaptureScreen
      inspectionId={inspection.id}
      heading={{
        refNo: inspection.refNo,
        status: inspection.status,
        templateName: inspection.template.resolved.name,
        templateVersion: inspection.template.version,
        clientName: inspection.meta.client?.name ?? null,
        manufacturerLabel: inspection.manufacturerLabel,
        inspectionDate: inspection.inspectionDate,
        inspectorName: inspection.meta.inspector?.name ?? "Inspector",
      }}
      template={inspection.template.resolved}
      meta={inspection.meta}
      initialData={inspection.data}
      initialUpdatedAt={inspection.updatedAt}
      initialOverrides={inspection.overrides}
      overrideAuthors={authors}
      user={{ id: user.id, role: user.role }}
      access={access}
      initialSection={readSectionParam(query.module)}
    />
  );
}
