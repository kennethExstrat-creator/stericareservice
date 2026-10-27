import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LayoutDashboardIcon, TriangleAlertIcon } from "lucide-react";
import { PageHeader } from "@/components/qc";
import { firstAdminHref } from "@/components/shell/nav";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from "@/components/ui/empty";
import { chartColumns, parseDashboardPeriod, type DashboardSummary } from "@/lib/admin/dashboard";
import { loadDashboardSummary, loadOpenCounts } from "@/lib/admin/dashboard-data";
import { requirePermission, requireUser, userCan } from "@/lib/auth/session";
import { buildInspectionsHref } from "@/lib/inspections/search-params";
import { createClient } from "@/lib/supabase/server";
import { BreakdownCard } from "./_components/breakdown-card";
import { DashboardFrame } from "./_components/dashboard-frame";
import { ActivityTiles, OpenTiles } from "./_components/dashboard-tiles";
import { InspectionsChart } from "./_components/inspections-chart";

/**
 * The title checks the role too. Next resolves metadata on its own, so a
 * static title would still name this page on a 404 (in the tab and the
 * HTML); notFound() here swaps in the 404 page's metadata. The session is
 * cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requirePermission("dashboard");
  return { title: "Admin Dashboard" };
}

/**
 * The admin home, a dashboard (Kenneth, 27 October 2026: "the overview should
 * be a dashboard"; the system status it showed moved to General Settings and
 * Steri-AI Settings). First the inspections not approved yet, each count a
 * link to the list filtered to it; then Activity for the period the picker
 * names (?period=, lib/admin/dashboard.ts): the inspections and their
 * results, per day or month, and by client, manufacturer and inspector.
 * Read as the signed-in person: Row Level Security gives them the inspections
 * their role sees (an admin every one).
 *
 * The Admin tab opens /admin. A role without the Dashboard switch lands on the
 * first admin screen it opens instead (firstAdminHref), and one that opens
 * none gets the 404 (the admin layout says so first).
 *
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function AdminDashboardPage({ searchParams }: PageProps<"/admin">) {
  const user = await requireUser();
  if (!userCan(user, "dashboard")) {
    const first = firstAdminHref(user.role, (permission) => userCan(user, permission));
    if (first && first !== "/admin") redirect(first);
  }
  await requirePermission("dashboard");
  const period = parseDashboardPeriod((await searchParams).period);
  const supabase = await createClient();
  const [open, summary] = await Promise.all([loadOpenCounts(supabase), loadDashboardSummary(supabase, period)]);

  return (
    <div className="flex flex-col gap-10">
      <PageHeader eyebrow="Admin" title="Dashboard" />

      <section aria-labelledby="open-inspections" className="flex flex-col gap-4">
        <h2 id="open-inspections" className="text-2xl font-bold tracking-tight text-foreground">
          Open Inspections
        </h2>
        <OpenTiles counts={open} />
      </section>

      <DashboardFrame id="activity" title="Activity" period={period}>
        <Activity summary={summary} />
      </DashboardFrame>
    </div>
  );
}

function Activity({ summary }: { summary: DashboardSummary | null }) {
  if (!summary) {
    return (
      <Alert variant="destructive">
        <TriangleAlertIcon aria-hidden />
        <AlertDescription className="text-destructive">
          The figures could not be loaded. Reload the page to try again.
        </AlertDescription>
      </Alert>
    );
  }
  if (summary.since === null) return <NoInspectionsYet />;
  return (
    <>
      <ActivityTiles summary={summary} />
      <InspectionsChart bucket={summary.trend.bucket} columns={chartColumns(summary.trend)} />
      <div className="grid gap-6 lg:grid-cols-3">
        <BreakdownCard
          id="by-client"
          title="By Client"
          rows={summary.byClient}
          noun={{ one: "client", many: "clients" }}
          hrefFor={(id) => buildInspectionsHref({ client: id })}
        />
        <BreakdownCard
          id="by-manufacturer"
          title="By Manufacturer"
          rows={summary.byManufacturer}
          noun={{ one: "manufacturer", many: "manufacturers" }}
          hrefFor={(id) => buildInspectionsHref({ manufacturer: id })}
        />
        <BreakdownCard
          id="by-inspector"
          title="By Inspector"
          rows={summary.byInspector}
          noun={{ one: "inspector", many: "inspectors" }}
        />
      </div>
    </>
  );
}

function NoInspectionsYet() {
  return (
    <Empty className="border border-dashed border-slate-300 bg-card px-6 py-12 md:py-16" data-testid="dashboard-empty">
      <EmptyHeader className="max-w-md">
        <EmptyMedia variant="icon" className="size-12 rounded-xl bg-brand-50 text-brand-600">
          <LayoutDashboardIcon aria-hidden />
        </EmptyMedia>
        <EmptyTitle>
          <h3 className="text-lg font-bold text-foreground">No Inspections Yet</h3>
        </EmptyTitle>
        <EmptyDescription className="text-base text-muted-foreground fine:text-sm">
          The figures fill in as inspectors create inspections.
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}
