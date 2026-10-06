import type { Metadata } from "next";
import { defectsCounts, loadDefectsData } from "@/lib/admin/defects";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { DefectsHeader } from "../_components/defects-header";
import type { CodeOption } from "../_components/map-label-dialog";
import { UnmappedView } from "../_components/unmapped-view";

/** Checks the role first, so the title never names this page on an inspector's 404. */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Unmapped labels" };
}

const byName = new Intl.Collator("en-GB", { sensitivity: "base", numeric: true });

/**
 * /admin/defects/unmapped (BUILD_SPEC 4.2 rule 4, 8): the one-off defect
 * labels inspectors added during capture, found in the visual and watertight
 * data of every inspection that is not approved, with where each came from.
 * An admin maps one to a code, or adds a code for it; the mapping is
 * recorded on that inspection's data (actions.ts, mapDefectLabel).
 */
export default async function UnmappedLabelsPage() {
  await requireAdmin();
  const supabase = await createClient();
  const data = await loadDefectsData(supabase);
  const codes: CodeOption[] = data.codes
    .filter((code) => code.active)
    .map((code) => ({ code: code.code, name: code.name }))
    .sort((a, b) => byName.compare(a.name, b.name));

  return (
    <div className="flex flex-col gap-6">
      <DefectsHeader current="unmapped" counts={defectsCounts(data)} />
      <p className="max-w-3xl text-base text-muted-foreground">
        Defects inspectors recorded in their own words because the template&rsquo;s list did not have them. Map each
        to a code so it counts with that code from then on. Labels on a submitted inspection can be mapped; drafts and
        reopened inspections wait for the inspector. Approved inspections are final and are not listed.
      </p>
      <UnmappedView inspections={data.inspections} codes={codes} />
    </div>
  );
}
