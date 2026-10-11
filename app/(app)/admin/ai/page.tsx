import type { Metadata } from "next";
import { PageHeader } from "@/components/qc";
import { readAiSettingsView } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/auth/session";
import { AiSettingsForm } from "./_components/ai-settings-form";
import { GlossaryForm } from "./_components/glossary-form";

/** Checks the role too, so the title never names this page on an inspector's 404 (see /admin). */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Steri-AI Settings" };
}

/**
 * Admin > AI Settings (docs/AI.md, "AI Settings"): the Anthropic API key and
 * the Claude models for reading order documents and for the second opinion.
 * The page learns only where the key comes from and its last four
 * characters, never the key.
 */
export default async function AiSettingsPage() {
  await requireAdmin();
  const view = await readAiSettingsView();

  return (
    <div className="flex w-full flex-1 flex-col gap-6">
      <PageHeader
        eyebrow="Admin"
        title="Steri-AI Settings"
        description="The API key and the Claude models the app uses to read order documents and to give second opinions."
      />
      <AiSettingsForm view={view} />
      <div className="max-w-3xl">
        <GlossaryForm initial={view.glossary} disabled={view.storage !== "ready"} />
      </div>
    </div>
  );
}
