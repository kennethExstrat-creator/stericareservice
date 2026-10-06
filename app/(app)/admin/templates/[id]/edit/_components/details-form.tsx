"use client";

// The template's own facts (BUILD_SPEC 4.3): name, unit, sizes and the AI
// report settings, as a form generated from the template schema's parts.
// Code, scope and extends are fixed for a version; the JSON view shows them.
import { useMemo } from "react";
import { z } from "zod";
import {
  TemplateReportSchema,
  TemplateSizeSchema,
  TemplateUnitSchema,
} from "@/lib/schemas/template";
import { describeSchema, pathKey } from "@/lib/zod-form";
import { SchemaForm } from "@/lib/zod-form/schema-form";
import type { Draft } from "../_lib/model";
import type { EditorProblem } from "../_lib/problems";
import type { EditorApi } from "./editor-api";

const DETAIL_KEYS = ["name", "unit", "sizes", "report"] as const;

const DetailsSchema = z.strictObject({
  name: z.string().trim().min(1).meta({ title: "Name", description: "How admins and inspectors know this template." }),
  unit: TemplateUnitSchema.meta({ title: "Counted in", description: "Pieces for examination gloves, pairs for surgical." }),
  sizes: z
    .array(
      TemplateSizeSchema.extend({
        value: TemplateSizeSchema.shape.value.meta({ title: "Size", description: "XS to XXL, or 5.5 to 9.0." }),
        label: TemplateSizeSchema.shape.label.meta({ title: "Shown as", description: "Optional, e.g. Medium." }),
      }),
    )
    .min(1)
    .meta({ title: "Sizes", description: "The sizes this template offers, in order. Order lots picks from them." }),
  report: TemplateReportSchema.extend({
    title: TemplateReportSchema.shape.title.meta({ title: "Report title" }),
    showClientLogo: TemplateReportSchema.shape.showClientLogo.meta({ title: "Show the client's logo" }),
    pageHeader: TemplateReportSchema.shape.pageHeader.meta({ title: "Header on later pages" }),
  })
    .optional()
    .meta({ title: "AI report", description: "For the report the AI writes from the export. Inherited when not set." }),
});

const OPTION_LABELS: Readonly<Record<string, string>> = { pcs: "Pieces (pcs)", pairs: "Pairs" };

export function DetailsForm({ api }: { api: EditorApi }) {
  const node = useMemo(() => describeSchema(DetailsSchema), []);
  const value = Object.fromEntries(DETAIL_KEYS.filter((key) => api.draft[key] !== undefined).map((key) => [key, api.draft[key]]));
  const issues = useMemo(() => detailIssues(api.problems), [api.problems]);

  return (
    <section aria-labelledby="details-heading" className="grid max-w-3xl gap-4" data-testid="template-details">
      <div className="grid gap-1">
        <h2 id="details-heading" className="text-lg font-bold text-foreground">
          Details
        </h2>
        <p className="text-sm text-muted-foreground">
          The code, scope and base template are fixed for this version; the JSON tab shows them.
        </p>
      </div>
      <div className="rounded-xl bg-card p-4 shadow-sm ring-1 ring-border sm:p-5">
        <SchemaForm
          node={node}
          value={value}
          idPrefix="details"
          issues={issues}
          readOnly={!api.editable}
          hooks={{ labelForOption: (option) => (typeof option === "string" ? OPTION_LABELS[option] : undefined) }}
          onChange={(next) =>
            api.update((draft) => {
              const fields = (next ?? {}) as Partial<Draft>;
              const updated: Record<string, unknown> = { ...draft };
              for (const key of DETAIL_KEYS) {
                if (fields[key] === undefined) delete updated[key];
                else updated[key] = fields[key];
              }
              return updated as Draft;
            })
          }
        />
      </div>
    </section>
  );
}

/** Template problems about the details, by their path inside the details form. */
function detailIssues(problems: readonly EditorProblem[]): Map<string, string[]> {
  const issues = new Map<string, string[]>();
  for (const problem of problems) {
    if (problem.place.area !== "template") continue;
    const head = problem.place.path[0];
    if (!(DETAIL_KEYS as readonly unknown[]).includes(head)) continue;
    const id = pathKey(problem.place.path);
    issues.set(id, [...(issues.get(id) ?? []), problem.message]);
  }
  return issues;
}

/** Template problems the details form shows; the rest belong to the JSON tab. */
export function isDetailPath(path: readonly (string | number)[]): boolean {
  return (DETAIL_KEYS as readonly unknown[]).includes(path[0]);
}
