import type { Metadata } from "next";
import { defectsCounts, loadDefectsData } from "@/lib/admin/defects";
import { buildShortformItems, type LibraryCode } from "@/lib/admin/shortforms";
import { loadGlossaryState } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY } from "@/modules/registry";
import { ShortformsAdmin } from "../_components/shortforms-admin";

/** Checks the role first, so the title never names this page on an inspector's 404. */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Shortforms" };
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/**
 * /admin/defects/shortforms (docs/AI.md, "The paper form and shortforms"):
 * what inspectors write on their paper forms, a reading aid for Steri-AI.
 * Each defect is linked to the library codes it counts under (picked from the
 * codes on the Codes tab, never typed); the other terms (tests, product
 * words, factory codes) have none. Kept in ai_settings.glossary, which only
 * the service role reads: lib/ai/settings.ts reads it after the admin check.
 */
export default async function ShortformsPage({ searchParams }: PageProps<"/admin/defects/shortforms">) {
  await requireAdmin();
  const supabase = await createClient();
  const [data, glossary, params] = await Promise.all([
    loadDefectsData(supabase, MODULE_REGISTRY),
    loadGlossaryState(),
    searchParams,
  ]);
  const library: LibraryCode[] = data.codes
    .map(({ code, name, active }) => ({ code, name, active }))
    .sort((a, b) => byName.compare(a.name, b.name));

  return (
    <ShortformsAdmin
      items={buildShortformItems(glossary.entries, library)}
      library={library}
      counts={defectsCounts(data, glossary.entries)}
      storage={glossary.storage}
      initialQuery={typeof params.q === "string" ? params.q : ""}
    />
  );
}
