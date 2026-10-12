import type { Metadata } from "next";
import { PageHeader } from "@/components/qc";
import { loadAiPrices, readAiSettingsView } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/auth/session";
import { CostView } from "./_components/cost-view";
import { GeneralView } from "./_components/general-view";
import { InspectionSettingsView } from "./_components/inspection-settings-view";
import { ViewFrame } from "./_components/view-frame";
import { parseAiViewState, type AiViewState } from "./_components/view-state";

/** Checks the role too, so the title never names this page on an inspector's 404 (see /admin). */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Steri-AI Settings" };
}

/**
 * Admin > Steri-AI Settings (docs/AI.md, "AI Settings"), three views the
 * address names (?view=, _components/view-state.ts): General, the Anthropic
 * API key and the connection test; Inspection Settings, the Claude model for
 * each job and the second opinion's effort and photos; Steri-AI Cost, what
 * Steri-AI costs to run. Each view loads only its own data. The page learns
 * only where the key comes from and its last four characters, never the key.
 *
 * Inspectors get a 404 from requireAdmin(); a layout is not a security
 * boundary, so the page checks for itself. No outer padding or width: the
 * app shell's main area provides both.
 */
export default async function AiSettingsPage({ searchParams }: PageProps<"/admin/ai">) {
  await requireAdmin();
  const params = await searchParams;
  const state = parseAiViewState(params);
  const body = await viewBody(state);

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeader eyebrow="Admin" title="Steri-AI Settings" />
      <ViewFrame state={state}>{body}</ViewFrame>
    </div>
  );
}

async function viewBody(state: AiViewState) {
  if (state.view === "cost") return <CostView period={state.period} currency={state.currency} />;
  if (state.view === "inspection") {
    // The prices say which chosen model has none yet.
    const [settings, prices] = await Promise.all([readAiSettingsView(), loadAiPrices()]);
    return <InspectionSettingsView view={settings} prices={prices} />;
  }
  return <GeneralView view={await readAiSettingsView()} />;
}
