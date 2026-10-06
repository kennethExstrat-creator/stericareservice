import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache } from "react";
import { z } from "zod";
import { ArrowLeftIcon, ClipboardListIcon, PencilLineIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { Button } from "@/components/ui/button";
import { requireUser } from "@/lib/auth/session";
import { approvalChecks } from "@/lib/inspections/review/approval";
import { loadReview, type ReviewData, type ReviewInspection } from "@/lib/inspections/review/load";
import { statusNotice } from "@/lib/inspections/review/notice";
import { INSPECTIONS_PATH } from "@/lib/inspections/search-params";
import { createClient } from "@/lib/supabase/server";
import { InspectionStatusBadge } from "../../_components/inspection-status-badge";
import { AiPanelSlot } from "./_components/ai-panel-slot";
import { FocusOnChange } from "./_components/focus-on-change";
import { History } from "./_components/history";
import { InspectionFacts } from "./_components/inspection-facts";
import { ModuleResults } from "./_components/module-results";
import { ReportPhotos } from "./_components/report-photos";
import { ReviewActions } from "./_components/review-actions";
import { StatusNotice, STATUS_HEADING_ID } from "./_components/status-notice";
import { SwitchedOffModules } from "./_components/switched-off-modules";
import { Verdict } from "./_components/verdict";

const IdSchema = z.uuid();

/**
 * The review, read once per request for the title and the page (React
 * cache). Row level security decides who may see it: an inspector asking
 * for someone else's inspection gets the same 404 as for one that does not
 * exist, title included, so the ref never leaks.
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

export async function generateMetadata({ params }: PageProps<"/inspections/[id]/review">): Promise<Metadata> {
  const { id } = await params;
  const { inspection } = await getReview(id);
  return { title: `Review ${inspection.refNo}` };
}

/**
 * /inspections/[id]/review (BUILD_SPEC 5, 9.2 and 10): the facts, every
 * included module's computed result beside the inspector's comment, the
 * issues, the modules switched off, the suggested and final result, the
 * report photos, the AI second opinion's slot and the history. Admins
 * approve or reopen a submitted inspection here; inspectors read their own.
 *
 * No padding or <main> of its own: the app shell provides both.
 */
export default async function InspectionReviewPage({ params }: PageProps<"/inspections/[id]/review">) {
  const { id } = await params;
  const review = await getReview(id);
  const { viewer, inspection, template, evaluation, overrides, photos, history } = review;
  const isAdmin = viewer.role === "admin";

  return (
    <div className="flex flex-col gap-8 md:gap-10">
      <div className="flex flex-col gap-3">
        <Button asChild variant="link" className="h-auto w-fit gap-1.5 px-0 touch:h-11 touch:px-0">
          <Link href={INSPECTIONS_PATH}>
            <ArrowLeftIcon aria-hidden />
            Inspections
          </Link>
        </Button>
        <PageHeader
          eyebrow="Inspection review"
          title={inspection.refNo}
          description={<HeaderLine inspection={inspection} />}
          actions={<HeaderActions review={review} />}
        />
      </div>

      <FocusOnChange value={inspection.status} labelledBy={STATUS_HEADING_ID}>
        <StatusNotice notice={statusNotice(inspection, viewer, history.entries)} />
      </FocusOnChange>

      <InspectionFacts inspection={inspection} template={template} />
      <Verdict inspection={inspection} evaluation={evaluation} />
      <AiPanelSlot inspectionId={inspection.id} />
      <ModuleResults evaluation={evaluation} />
      <SwitchedOffModules overrides={overrides} />
      <ReportPhotos inspectionId={inspection.id} photos={photos} canChoose={isAdmin} />
      <History history={history} />
    </div>
  );
}

/** Status, client and product under the ref. */
function HeaderLine({ inspection }: { inspection: ReviewInspection }) {
  const about = [inspection.client, inspection.productName].filter(Boolean).join(" · ");
  return (
    <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-2">
      <InspectionStatusBadge status={inspection.status} />
      {/* A space for screen readers; the gap spaces them on screen. */}{" "}
      {about && <span className="[overflow-wrap:anywhere]">{about}</span>}
    </span>
  );
}

/**
 * Admins approve or reopen a submitted inspection. Whoever owns a draft or a
 * reopened inspection goes on with it; everyone else can open it.
 */
function HeaderActions({ review }: { review: ReviewData }) {
  const { viewer, inspection, evaluation } = review;
  const href = `${INSPECTIONS_PATH}/${inspection.id}`;
  const owner = viewer.id === inspection.inspector.id;
  const editable = inspection.status === "draft" || inspection.status === "reopened";

  if (owner && editable) {
    return (
      <Button asChild>
        <Link href={href}>
          <PencilLineIcon aria-hidden />
          {inspection.status === "reopened" ? "Make changes" : "Continue inspection"}
        </Link>
      </Button>
    );
  }

  const open = (
    <Button asChild variant="outline">
      <Link href={href}>
        <ClipboardListIcon aria-hidden />
        Open inspection
      </Link>
    </Button>
  );
  if (viewer.role !== "admin" || inspection.status !== "submitted") return open;

  return (
    <>
      {open}
      <ReviewActions
        inspectionId={inspection.id}
        refNo={inspection.refNo}
        version={inspection.version}
        finalResult={inspection.result}
        // No suggestion and no error count when the results could not be worked out: the dialog says so.
        {...approvalChecks(evaluation)}
      />
    </>
  );
}
