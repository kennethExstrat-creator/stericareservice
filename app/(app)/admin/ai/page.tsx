import type { Metadata } from "next";
import { unstable_rethrow } from "next/navigation";
import { PageHeader } from "@/components/qc";
import { AiReviewCard } from "@/components/shell/admin-status-cards";
import { getAiStatus } from "@/lib/ai";
import { latestBnmRate, pickMyrRate } from "@/lib/ai/myr-rate";
import { loadAiEnv, loadAiPrices, readAiSettingsView, readSummarySettingsView } from "@/lib/ai/settings";
import { requirePermission } from "@/lib/auth/session";
import { loadSummaryPreviewTargets, type SummaryPreviewTarget } from "@/lib/inspections/ai/summary-runner";
import { createClient } from "@/lib/supabase/server";
import { CostView } from "./_components/cost-view";
import { GeneralView } from "./_components/general-view";
import { InspectionSettingsView } from "./_components/inspection-settings-view";
import { ViewFrame } from "./_components/view-frame";
import { parseAiViewState, type AiViewState } from "./_components/view-state";

/** Checks the role too, so the title never names this page on an inspector's 404 (see /admin). */
export async function generateMetadata(): Promise<Metadata> {
  await requirePermission("ai_settings");
  return { title: "Steri-AI Settings" };
}

/**
 * Admin > Steri-AI Settings (docs/AI.md, "AI Settings"), three views the
 * address names (?view=, _components/view-state.ts): General, the Anthropic
 * API key and the connection test, then whether the second opinion is
 * connected; Inspection Settings, the Claude model for each job,
 * the second opinion's effort and photos, and the Inspection Summary's model
 * and house style with Try It; Steri-AI Cost, what Steri-AI costs to run, in
 * ringgit or US dollars. Each view loads only its own data. The page shows
 * only where the key comes from and its last four characters, never the key:
 * the status card gets getAiStatus()'s view, which holds no key or URL.
 *
 * Someone whose role has no Steri-AI Settings switch gets a 404 from
 * requirePermission(); a layout is not a security boundary, so the page
 * checks for itself. No outer padding or width: the app shell's main area
 * provides both.
 */
export default async function AiSettingsPage({ searchParams }: PageProps<"/admin/ai">) {
  const admin = await requirePermission("ai_settings");
  const params = await searchParams;
  const state = parseAiViewState(params);
  const body = await viewBody(state);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeader eyebrow="Admin" title="Steri-AI Settings" />
      {/* The admin's id keys the currency they last chose on this device (cost-currency.ts). */}
      <ViewFrame state={state} viewerId={admin.id}>
        {body}
      </ViewFrame>
    </div>
  );
}

async function viewBody(state: AiViewState) {
  if (state.view === "cost") return <CostView period={state.period} currency={state.currency} />;
  if (state.view === "inspection") {
    // The prices say which chosen model has none yet; the rate, what a try costs in ringgit.
    const [settings, prices, summary, targets, bnmRate] = await Promise.all([
      readAiSettingsView(),
      loadAiPrices(),
      readSummarySettingsView(),
      tryItTargets(),
      latestBnmRate(),
    ]);
    return (
      <InspectionSettingsView
        view={settings}
        prices={prices}
        summary={summary}
        targets={targets}
        myrPerUsd={pickMyrRate(prices, bnmRate).myrPerUsd}
      />
    );
  }
  // The second opinion as every call finds it (loadAiEnv: the saved key lies over the variables), drawn
  // here on the server, under the key's form, in its left column. Save Key and Remove Saved Key
  // revalidate this page, so the card follows at once.
  const [view, env] = await Promise.all([readAiSettingsView(), loadAiEnv()]);
  const ai = getAiStatus(env);
  return (
    <div className="flex flex-col gap-6">
      <GeneralView view={view} />
      <div className="grid gap-6 lg:grid-cols-2">
        <AiReviewCard status={ai.review} />
      </div>
    </div>
  );
}

/** Try It's inspections, read as the admin (Row Level Security decides); none when they cannot be read. */
async function tryItTargets(): Promise<SummaryPreviewTarget[]> {
  try {
    return await loadSummaryPreviewTargets(await createClient());
  } catch (error) {
    unstable_rethrow(error);
    console.error("[ai settings] reading Try It's inspections failed", error);
    return [];
  }
}
