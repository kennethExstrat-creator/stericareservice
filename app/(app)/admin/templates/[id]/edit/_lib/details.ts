// The template's own facts in the Details tab (BUILD_SPEC 4.3): the parts of
// the definition the tab edits, and what it calls each of them. The Details
// form and the problem list both read from here, so a field has one name.
import { z } from "zod";
import { TemplateReportSchema, TemplateSizeSchema, TemplateUnitSchema } from "@/lib/schemas/template";
import { describeSchema, humanize, pathLabels, type FormPath } from "@/lib/zod-form";

/** The parts of the definition the Details tab's generated form edits. */
export const DETAIL_KEYS = ["name", "unit", "sizes", "report"] as const;

/** Template paths the Details tab shows; the rest belong to the JSON tab. */
const DETAIL_AREAS: readonly unknown[] = [...DETAIL_KEYS, "ai", "scope", "code", "extends"];

export const DetailsSchema = z.strictObject({
  name: z.string().trim().min(1).meta({ title: "Name", description: "How admins and inspectors know this template." }),
  unit: TemplateUnitSchema.meta({ title: "Counted In", description: "Pieces for examination gloves, pairs for surgical." }),
  sizes: z
    .array(
      TemplateSizeSchema.extend({
        value: TemplateSizeSchema.shape.value.meta({ title: "Size", description: "XS to XXL, or 5.5 to 9.0." }),
        label: TemplateSizeSchema.shape.label.meta({ title: "Shown As", description: "Optional, e.g. Medium." }),
      }),
    )
    .min(1)
    .meta({ title: "Sizes", description: "The sizes this template offers, in order. Order lots picks from them." }),
  report: TemplateReportSchema.extend({
    title: TemplateReportSchema.shape.title.meta({ title: "Report Title" }),
    showClientLogo: TemplateReportSchema.shape.showClientLogo.meta({ title: "Show the Client's Logo" }),
    pageHeader: TemplateReportSchema.shape.pageHeader.meta({ title: "Header on Later Pages" }),
  })
    .optional()
    .meta({ title: "AI Report", description: "For the report the AI writes from the export. Inherited when not set." }),
});

/** The AI second opinion switch (BUILD_SPEC 9.2). */
export const AI_ON_SUBMIT_LABEL = "AI Second Opinion on Submit";

/** Where the template applies (BUILD_SPEC 4.4). */
export const SCOPE_HEADING = "Where It Applies";

export const SCOPE_LABELS = {
  productType: "Product Type",
  standard: "Standard",
  clientId: "Client",
  manufacturerId: "Manufacturer",
} as const;

export type ScopeKey = keyof typeof SCOPE_LABELS;

/** What is fixed for a version: shown on the tab, changed only in the JSON tab. */
export const FIXED_LABELS = { code: "Code", extends: "Base Template" } as const;

/** Template problems the Details tab shows; the rest belong to the JSON tab. */
export function isDetailPath(path: FormPath): boolean {
  return DETAIL_AREAS.includes(path[0]);
}

/**
 * A path in the Details tab, named as the tab names it:
 * ["scope", "clientId"] -> ["Where It Applies", "Client"],
 * ["sizes", 1, "label"] -> ["Sizes", "Size 2", "Shown As"].
 */
export function detailPathLabels(path: FormPath): string[] {
  const [head, next] = path;
  if (head === "ai") return [AI_ON_SUBMIT_LABEL];
  if (head === "code" || head === "extends") return [FIXED_LABELS[head]];
  if (head === "scope") {
    const rest = path.slice(1).map((segment) => (typeof segment === "number" ? String(segment + 1) : humanize(segment)));
    return [SCOPE_HEADING, ...(typeof next === "string" && next in SCOPE_LABELS ? [SCOPE_LABELS[next as ScopeKey]] : rest)];
  }
  // describeSchema keeps what it read, per schema: this is no work after the first call.
  return pathLabels(describeSchema(DetailsSchema), path);
}
