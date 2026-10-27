import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { ArrowLeftIcon } from "lucide-react";
import { LoadedAiReviewPanel } from "@/components/ai";
import { Button } from "@/components/ui/button";
import { requireUser, userCan } from "@/lib/auth/session";
import { formatSize } from "@/lib/format";
import { readReportOptions } from "@/lib/inspections/capture/report";
import { loadAiPanel, type AiPanelLoad } from "@/lib/inspections/ai";
import { attentionItems } from "@/lib/inspections/review/attention";
import { inspectionSummary } from "@/lib/inspections/review/evaluate";
import { loadReview, type ReviewData } from "@/lib/inspections/review/load";
import { statusNotice } from "@/lib/inspections/review/notice";
import { canExportInspection } from "@/lib/export/access";
import { screenTitle } from "@/lib/design/screen-names";
import { isModuleKey } from "@/lib/schemas/module-result";
import type { ReportOptions } from "@/lib/schemas/report-options";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { createClient } from "@/lib/supabase/server";
import { Attention } from "./_components/attention";
import { ClientReport } from "./_components/client-report";
import { History } from "./_components/history";
import { InspectionFacts } from "./_components/inspection-facts";
import { InspectionSummary } from "./_components/inspection-summary";
import { moduleAnchor, ModuleResults } from "./_components/module-results";
import { PageIndex, type PageIndexItem } from "./_components/page-index";
import { ReportPhotos } from "./_components/report-photos";
import { ReviewHeader } from "./_components/review-header";
import { StatusNotice } from "./_components/status-notice";
import { SwitchedOffModules } from "./_components/switched-off-modules";
import { Verdict } from "./_components/verdict";

/**
 * Server Actions on this page run as long as the page may: "Request AI
 * Second Opinion" writes the opinion in after() inside its action, and
 * Claude may take up to 10 minutes at AI_REVIEW_EFFORT high, the default
 * (claudeTimeoutMs in lib/ai/providers/claude.ts; page.test.ts keeps this
 * above it). 800 seconds is the most Vercel allows a function on Pro. At
 * xhigh and max a review may take 30 minutes, more than that: keep the
 * effort at high or below there (docs/AI.md). A literal, as Next reads it.
 */
export const maxDuration = 800;

const IdSchema = z.uuid();

/**
 * The review, read once per request for the title and the page (React
 * cache). Row level security decides who may see it: an inspector asking
 * for someone else's inspection gets the same 404 as for one that does not
 * exist, title included, so the ref never leaks. A lead inspector also
 * reads their team's inspections (migration 20261007170000), read-only.
 */
const getReview = cache(async (id: string): Promise<ReviewData> => {
  const user = await requireUser();
  if (!IdSchema.safeParse(id).success) notFound();
  const supabase = await createClient();
  const loaded = await loadReview(supabase, id, {
    id: user.id,
    name: user.fullName?.trim() || user.email,
    role: user.role,
  });
  if (loaded.kind === "not_found") notFound();
  return loaded.review;
});

/**
 * The AI second opinion's panel (BUILD_SPEC 9.2), read as the signed-in
 * user beside the review: the system's results and the inspector's from the
 * export's own evaluation, and the stored opinions with their decisions.
 */
async function getAiPanel(id: string): Promise<AiPanelLoad> {
  return loadAiPanel(await requireUser(), id);
}

/**
 * The report options the inspection's Report page saved (data.report), for
 * the Client Report card: which report and paper. Read on their own, so the
 * review's load stays as it is; unreadable or unsaved, the defaults.
 */
async function getReportOptions(id: string): Promise<ReportOptions> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from("inspections").select("report:data->report").eq("id", id).maybeSingle();
    return readReportOptions({ report: data?.report ?? undefined });
  } catch (error) {
    console.error("Inspection review: the report options could not be read", error);
    return readReportOptions({});
  }
}

export async function generateMetadata({ params }: PageProps<"/inspections/[id]/review">): Promise<Metadata> {
  const { id } = await params;
  const { inspection } = await getReview(id);
  return { title: `Review ${inspection.refNo}` };
}

/**
 * /inspections/[id]/review (BUILD_SPEC 5, 9 and 10), layout A (Kenneth, 27
 * October 2026): a header that stays in view with the reference, status and
 * actions; on the desktop an index of the page down the left; then the
 * verdict, what needs attention, the client's report, the facts, the
 * inspection summary, the AI second opinion (with the AI report), every
 * included module as a row that opens to its sizes side by side, the
 * modules switched off, the report photos and the history. Labels and
 * values, no explanations: the page had "too much wording".
 * Who sees what follows the role's switches (lib/auth/permissions.ts):
 * Approve and Reopen, and choosing the report photos, which are part of the
 * decision, need Approve Inspections; Download PDF needs Export Reports, for
 * the inspection's own inspector or an admin (the Report page's rule); Map
 * Label needs Defects; the AI panel follows its own (lib/inspections/ai/panel.ts)
 * and stays with the owner and admins (canExportInspection in
 * lib/export/access.ts), so a lead sees none on a team member's review.
 *
 * No padding or <main> of its own: the app shell provides both.
 */
export default async function InspectionReviewPage({ params }: PageProps<"/inspections/[id]/review">) {
  const { id } = await params;
  const [review, aiPanel, user, reportOptions] = await Promise.all([
    getReview(id),
    getAiPanel(id),
    requireUser(),
    getReportOptions(id),
  ]);
  const { viewer, inspection, template, evaluation, overrides, photos, history } = review;
  const canApprove = userCan(user, "approve_inspections");
  const canDownload =
    userCan(user, "export_reports") && canExportInspection({ id: user.id, role: user.role }, { inspectorId: inspection.inspector.id });
  const canMapLabels = userCan(user, "defects");

  const sizes = evaluation.ok ? evaluation.context.sizes : [];
  const sizeLabel = (size: string) => (evaluation.ok ? formatSize(size, { sizes: evaluation.context.templateSizes }) : size);
  const attention = evaluation.ok ? attentionItems(evaluation.report.issues, sizes) : [];
  const titleOf = (key: string) => {
    if (!evaluation.ok) return key;
    const found = evaluation.report.modules.find((entry) => entry.key === key);
    if (found) return screenTitle(found.key, found.title);
    return evaluation.report.custom.find((entry) => entry.custom.key === key)?.custom.title ?? key;
  };
  const anchorOf = (key: string) => moduleAnchor(key, !isModuleKey(key));
  const hasSummary = inspectionSummary(evaluation) !== null;
  const hasAiPanel = aiPanel.ok || aiPanel.reason !== "not_found";
  // Waiting for review, those who decide have Approve and Reopen in the header and no notice; everyone
  // else is told who acts next, and every other status says what happened (a reopen's reason, an approval).
  const notice =
    inspection.status === "submitted" && canApprove ? null : statusNotice(inspection, { ...viewer, canApprove }, history.entries);

  const index: PageIndexItem[] = [
    { id: "result", label: "Overview" },
    ...(attention.length > 0
      ? [
          {
            id: "attention",
            label: "Needs Attention",
            count: attention.length,
            tone: attention.some((item) => item.level === "error") ? ("fail" as const) : ("warn" as const),
          },
        ]
      : []),
    ...(canDownload ? [{ id: "client-report", label: "Client Report" }] : []),
    { id: "details", label: "Details" },
    ...(hasSummary ? [{ id: "summary", label: "Summary" }] : []),
    ...(hasAiPanel ? [{ id: "steri-ai", label: "Steri-AI" }] : []),
    { id: "modules", label: "Module Results", ...(evaluation.ok ? { count: evaluation.report.modules.length } : {}) },
    ...(overrides.length > 0 ? [{ id: "switched-off", label: "Switched Off", count: overrides.length }] : []),
    { id: "photos", label: "Report Photos", count: photos.items.length },
    { id: "history", label: "History", count: history.entries.length },
  ];

  return (
    <div className="flex flex-col gap-4">
      <Button asChild variant="link" className="h-auto w-fit gap-1.5 px-0 touch:h-11 touch:px-0">
        <Link href={INSPECTIONS_PATH}>
          <ArrowLeftIcon aria-hidden />
          Inspections
        </Link>
      </Button>
      <ReviewHeader review={review} canApprove={canApprove} />

      <div className="flex flex-col gap-5 pt-1 xl:grid xl:grid-cols-[11.5rem_minmax(0,1fr)] xl:items-start xl:gap-8">
        <PageIndex items={index} />
        <div className="flex min-w-0 flex-col gap-5">
          {notice && <StatusNotice notice={notice} />}
          <Verdict inspection={inspection} evaluation={evaluation} />
          <Attention
            items={attention}
            titleOf={titleOf}
            anchorOf={anchorOf}
            sizeLabel={sizeLabel}
            canMapLabels={canMapLabels}
          />
          {canDownload && <ClientReport inspectionId={inspection.id} options={reportOptions} />}
          <InspectionFacts inspection={inspection} template={template} />
          <InspectionSummary evaluation={evaluation} />
          {hasAiPanel && (
            <div id="steri-ai">
              <LoadedAiReviewPanel load={aiPanel} />
            </div>
          )}
          <ModuleResults evaluation={evaluation} />
          <SwitchedOffModules overrides={overrides} />
          <ReportPhotos inspectionId={inspection.id} photos={photos} canChoose={canApprove} />
          <History history={history} />
        </div>
      </div>
    </div>
  );
}
