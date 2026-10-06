import type { Metadata } from "next";
import { addPrefill, buildCodeItems, defectsCounts, loadDefectsData } from "@/lib/admin/defects";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DefectCodesAdmin } from "./_components/codes-admin";

/**
 * The title checks the role too: Next resolves metadata apart from the page,
 * so a static title would name this page on an inspector's 404. The session
 * is cached per request, so this adds no query.
 */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Defect codes" };
}

/**
 * /admin/defects (BUILD_SPEC 4.2 rule 4, 5 and 10): the canonical defect
 * codes. Add, edit, deactivate; delete only a code nothing uses. Severity is
 * not here: it belongs to each template. The other tabs are label mapping
 * (labels/) and the one-off labels inspectors added (unmapped/).
 *
 * Inspectors get a 404 from requireAdmin(); a layout is not a security
 * boundary, so the page checks for itself, and RLS lets only admins write.
 * No outer padding or width: the app shell's main area provides both.
 */
export default async function DefectCodesPage({ searchParams }: PageProps<"/admin/defects">) {
  await requireAdmin();
  const supabase = await createClient();
  const [data, params] = await Promise.all([loadDefectsData(supabase), searchParams]);
  const query = typeof params.q === "string" ? params.q : "";

  return (
    <DefectCodesAdmin
      codes={buildCodeItems(data.codes, data.templates)}
      counts={defectsCounts(data)}
      initialQuery={query}
      prefill={addPrefill(params)}
    />
  );
}
