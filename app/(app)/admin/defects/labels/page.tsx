import type { Metadata } from "next";
import { buildLabelMaps, defectsCounts, loadDefectsData } from "@/lib/admin/defects";
import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { MODULE_REGISTRY } from "@/modules/registry";
import { DefectsHeader } from "../_components/defects-header";
import { LabelMapView } from "../_components/label-map-view";

/** Checks the role first, so the title never names this page on an inspector's 404. */
export async function generateMetadata(): Promise<Metadata> {
  await requireAdmin();
  return { title: "Label mapping" };
}

/**
 * /admin/defects/labels (BUILD_SPEC 4.2 rule 4, 10): for every template, its
 * defect labels per class with the code each maps to and its severity, read
 * from the templates' resolved definitions. Read only: templates are changed
 * in the template editor, which each template links to.
 */
export default async function LabelMappingPage({ searchParams }: PageProps<"/admin/defects/labels">) {
  await requireAdmin();
  const supabase = await createClient();
  const [data, params] = await Promise.all([loadDefectsData(supabase, MODULE_REGISTRY), searchParams]);
  const maps = buildLabelMaps(data.templates, data.codes);

  return (
    <div className="flex flex-col gap-6">
      <DefectsHeader current="labels" counts={defectsCounts(data, maps)} />
      <p className="max-w-3xl text-base text-muted-foreground">
        Each template&rsquo;s defect labels, in its own wording, and the code each one counts as. A visual defect&rsquo;s
        class is its severity in that template. The version shown is the active one, or the newest if none is active.
      </p>
      <LabelMapView maps={maps} initialQuery={typeof params.q === "string" ? params.q : ""} />
    </div>
  );
}
