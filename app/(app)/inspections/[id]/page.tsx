import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { FileWarningIcon } from "lucide-react";
import { PhotoQueueProvider } from "@/components/capture/photos";
import { StatusScreen } from "@/components/shell/status-screen";
import { Button } from "@/components/ui/button";
import { getAiStatus } from "@/lib/ai";
import { loadSummaryMenu } from "@/lib/ai/settings";
import { HOME_PATH } from "@/lib/auth/routes";
import { grantOf, requireUser, userCan } from "@/lib/auth/session";
import { canExportInspection } from "@/lib/export/access";
import { AI_STATUSES } from "@/lib/inspections/ai";
import { captureAccess } from "@/lib/inspections/capture/access";
import { loadDefectUsage, type DefectUsage } from "@/lib/inspections/capture/defect-usage";
import { loadLastReport } from "@/lib/inspections/capture/last-report";
import { loadCaptureInspection, loadOverrideAuthors } from "@/lib/inspections/capture/load";
import { loadReopenNote } from "@/lib/inspections/capture/reopen";
import { generateAvailability } from "@/lib/inspections/capture/report";
import { readSectionParam } from "@/lib/inspections/capture/schemas";
import { personLabel } from "@/lib/inspections/format";
import { createClient } from "@/lib/supabase/server";
import { CaptureScreen } from "./_components/capture-screen";

/**
 * Server Actions on this page run as long as the page may: submit starts
 * the AI second opinion when the template asks for it, and the review is
 * written in after() inside that action; Claude may take up to 10 minutes
 * at AI_REVIEW_EFFORT high, the default (docs/AI.md). 800 seconds is the
 * most Vercel allows a function on Pro, as on the review page. A literal,
 * as Next reads it.
 */
export const maxDuration = 800;

/** Modules whose rows are defect codes, ordered most-used first (BUILD_SPEC 8). */
const DEFECT_MODULES = ["watertight", "visual"];

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
 * overrides, read on the server through the user's own client. With them:
 * why it was reopened, when it was, how often each defect was counted
 * before, so the defect lists open on the most-used ones, where the
 * inspection can be changed here, the Steri-AI Summary's menu from the house
 * style (docs/AI.md, "Steri-AI Summary"), and for the Report page, whether
 * Send to Steri-AI Report may run (the AI report's rules, BUILD_SPEC 9.1),
 * the report last made, whether this user may download the PDF (the
 * export's rule, which the print route checks again) and the template
 * version's facts its preview needs. What the user's role switches off is
 * not offered (lib/auth/permissions.ts): switching steps, Steri-AI's
 * reading, sorting and summary, and the report's export.
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
        title="This Inspection Cannot Be Opened"
        description="Its template could not be read by this version of the app. Nothing has been changed. Ask an admin to check the template."
        actions={
          <Button asChild size="lg">
            <Link href={HOME_PATH}>Back to Inspections</Link>
          </Button>
        }
      />
    );
  }

  const { inspection } = loaded;
  const supabase = await createClient();
  const inspectorName = inspection.meta.inspector?.name ?? "Inspector";
  const countsDefects = inspection.template.resolved.modules.some((entry) => entry.include && DEFECT_MODULES.includes(entry.key));
  const access = captureAccess({
    status: inspection.status,
    role: user.role,
    userId: user.id,
    inspectorId: inspection.inspectorId,
    grant: grantOf(user),
  });
  // The report's export, the PDF and Steri-AI Report alike: the role's Export Reports on top of the export's rule.
  const exportsReports = userCan(user, "export_reports");
  const [authors, query, reopen, defectUsage, summaryMenu, lastReport] = await Promise.all([
    loadOverrideAuthors(supabase, inspection.overrides),
    searchParams,
    loadReopenNote(
      supabase,
      { id: inspection.id, status: inspection.status },
      { id: user.id, role: user.role },
      {
        viewerId: user.id,
        viewerName: personLabel({ full_name: user.fullName, email: user.email }) ?? "You",
        inspectorId: inspection.inspectorId,
        inspectorName,
      },
    ),
    countsDefects
      ? loadDefectUsage(supabase, {
          id: inspection.id,
          clientId: inspection.meta.client?.id ?? null,
          manufacturerId: inspection.meta.manufacturer?.id ?? null,
        })
      : Promise.resolve<DefectUsage>({}),
    // Only where the button can show, for a role with Steri-AI Summary; never throws (the house style's defaults stand in).
    access.editable && userCan(user, "ai_summary") ? loadSummaryMenu() : Promise.resolve(null),
    // Never throws: without it, Open Last Report does not show.
    loadLastReport(supabase, inspection.id),
  ]);
  // The Report page's Send to Steri-AI Report is the review's action, which checks all three again:
  // an admin (it writes the report's link) whose role allows Export Reports.
  const generate = generateAvailability({
    isAdmin: user.role === "admin" && exportsReports,
    reportable: AI_STATUSES.includes(inspection.status),
    connected: getAiStatus().report.connected,
  });

  return (
    // The page's upload queue starts for this user at once, offline too (components/capture/photos).
    <PhotoQueueProvider userId={user.id}>
      <CaptureScreen
        inspectionId={inspection.id}
        heading={{
          refNo: inspection.refNo,
          status: inspection.status,
          templateName: inspection.template.resolved.name,
          templateVersion: inspection.template.version,
          clientName: inspection.meta.client?.name ?? null,
          manufacturerLabel: inspection.manufacturerLabel,
          manufacturerName: inspection.meta.manufacturer?.name ?? null,
          inspectionDate: inspection.inspectionDate,
          inspectorName,
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
        reopenNote={reopen}
        defectUsage={defectUsage}
        summaryMenu={summaryMenu}
        reportPage={{
          generate,
          lastReport,
          // A lead inspector reads a team member's inspection here, but only its inspector and admins export it.
          canDownload:
            exportsReports && canExportInspection({ id: user.id, role: user.role }, { inspectorId: inspection.inspectorId }),
          record: {
            standard: inspection.template.standard,
            productType: inspection.template.productType,
            submittedAt: inspection.submittedAt,
            result: inspection.result,
          },
        }}
      />
    </PhotoQueueProvider>
  );
}
