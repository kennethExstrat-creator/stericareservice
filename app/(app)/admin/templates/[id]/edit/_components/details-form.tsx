"use client";

// The template's own facts (BUILD_SPEC 4.3): name, unit, sizes and the AI
// report settings, as a form generated from the template schema's parts;
// where it applies (scope, 4.4), picked from the clients and manufacturers;
// and what is fixed for a version: its code and its base template.
import { useMemo } from "react";
import { z } from "zod";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ProductTypeSchema, StandardSchema } from "@/lib/schemas/common";
import {
  TemplateReportSchema,
  TemplateSizeSchema,
  TemplateUnitSchema,
} from "@/lib/schemas/template";
import { describeSchema, isPlainObject, pathKey } from "@/lib/zod-form";
import { OptionSelect, type SelectOption } from "@/lib/zod-form/controls";
import { fieldId, SchemaForm } from "@/lib/zod-form/schema-form";
import type { ReferenceOption } from "../_lib/load";
import type { Draft } from "../_lib/model";
import type { EditorProblem } from "../_lib/problems";
import type { EditorApi } from "./editor-api";

const DETAIL_KEYS = ["name", "unit", "sizes", "report"] as const;

/** Template paths the Details tab shows; the rest belong to the JSON tab. */
const DETAIL_AREAS: readonly unknown[] = [...DETAIL_KEYS, "scope", "code", "extends"];

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

const PRODUCT_TYPE_LABELS: Readonly<Record<z.infer<typeof ProductTypeSchema>, string>> = {
  examination: "Examination gloves",
  surgical: "Surgical gloves",
};

const STANDARD_LABELS: Readonly<Record<z.infer<typeof StandardSchema>, string>> = {
  EN455: "EN 455",
  ASTM_D6319: "ASTM D6319",
  ASTM_D3578: "ASTM D3578",
  ASTM_D3577: "ASTM D3577",
  custom: "Custom",
};

type ScopeKey = "productType" | "standard" | "clientId" | "manufacturerId";

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
        <p className="text-sm text-muted-foreground">The template&apos;s name, sizes and report, and where it applies.</p>
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
      <ScopeFields api={api} />
      <FixedFields api={api} />
    </section>
  );
}

/** Where the template applies (BUILD_SPEC 4.4): product type and standard, and a client or manufacturer of its own. */
function ScopeFields({ api }: { api: EditorApi }) {
  const scope: Record<string, unknown> = isPlainObject(api.draft.scope) ? api.draft.scope : {};
  const readOnly = !api.editable;
  const set = (key: ScopeKey, next: string | null) =>
    api.update((draft) => {
      const current: Record<string, unknown> = isPlainObject(draft.scope) ? { ...draft.scope } : {};
      if (next === null) delete current[key];
      else current[key] = next;
      return { ...draft, scope: current } as Draft;
    });

  const fields: { key: ScopeKey; label: string; options: SelectOption[] }[] = [
    {
      key: "productType",
      label: "Product type",
      options: ProductTypeSchema.options.map((option) => ({ value: option, label: PRODUCT_TYPE_LABELS[option] })),
    },
    {
      key: "standard",
      label: "Standard",
      options: StandardSchema.options.map((option) => ({ value: option, label: STANDARD_LABELS[option] })),
    },
    {
      key: "clientId",
      label: "Client",
      options: referenceOptions("Any client", api.scopeOptions.clients, scope.clientId),
    },
    {
      key: "manufacturerId",
      label: "Manufacturer",
      options: referenceOptions("Any manufacturer", api.scopeOptions.manufacturers, scope.manufacturerId),
    },
  ];

  return (
    <section
      aria-labelledby="details-scope-heading"
      className="grid min-w-0 gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border sm:p-5"
      data-testid="template-scope"
    >
      <div className="grid gap-1">
        <h3 id="details-scope-heading" className="text-base font-bold text-foreground">
          Where it applies
        </h3>
        <p className="text-sm text-muted-foreground" id="details-scope-hint">
          A new inspection takes the most specific active template: client and manufacturer, then client, then
          manufacturer, then the standard template for the product type.
        </p>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {fields.map((field) => {
          const id = fieldId("details", ["scope", field.key]);
          const messages = scopeMessages(api.problems, field.key);
          return (
            <div key={field.key} className="grid content-start gap-1.5">
              <Label htmlFor={id}>{field.label}</Label>
              <OptionSelect
                id={id}
                value={scope[field.key] ?? (field.key === "clientId" || field.key === "manufacturerId" ? null : undefined)}
                options={field.options}
                readOnly={readOnly}
                invalid={messages.length > 0}
                describedBy={messages.length > 0 ? `${id}-errors` : "details-scope-hint"}
                onChange={(next) => set(field.key, typeof next === "string" ? next : null)}
              />
              {messages.length > 0 && (
                <div id={`${id}-errors`} className="grid gap-1">
                  {messages.map((message) => (
                    <p key={message} className="text-sm text-destructive">
                      {message}
                    </p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

/** "Any client", then the clients by name; an id that is not among them stays choosable, named as unknown. */
function referenceOptions(none: string, options: readonly ReferenceOption[], current: unknown): SelectOption[] {
  const listed: SelectOption[] = [{ value: null, label: none }, ...options.map((option) => ({ value: option.id, label: option.name }))];
  if (typeof current === "string" && !options.some((option) => option.id === current)) {
    listed.push({ value: current, label: `Unknown (${current.slice(0, 8)}…)` });
  }
  return listed;
}

/** The code and the base template: fixed for a version, shown here and changed only in the JSON tab. */
function FixedFields({ api }: { api: EditorApi }) {
  const base = api.context.inheritance.bases[0];
  const extendsCode = typeof api.draft.extends === "string" ? api.draft.extends : null;
  const rows = [
    {
      key: "code",
      label: "Code",
      value: typeof api.draft.code === "string" ? api.draft.code : "",
      hint: "Every version of a template keeps its code.",
    },
    {
      key: "extends",
      label: "Base template",
      value: extendsCode === null ? "None" : base ? `${base.code}, version ${base.version}` : extendsCode,
      hint:
        extendsCode === null
          ? "A template of its own: it inherits nothing."
          : "It lists only what differs from its base. Change the base in the JSON tab.",
    },
  ];
  return (
    <div className="grid gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border sm:grid-cols-2 sm:p-5">
      {rows.map((row) => {
        const id = fieldId("details", [row.key]);
        const messages = api.problems
          .filter((problem) => problem.place.area === "template" && problem.place.path[0] === row.key)
          .map((problem) => problem.message);
        return (
          <div key={row.key} className="grid content-start gap-1.5">
            <Label htmlFor={id}>{row.label}</Label>
            <Input
              id={id}
              value={row.value}
              readOnly
              aria-invalid={messages.length > 0 ? true : undefined}
              aria-describedby={`${id}-hint${messages.length > 0 ? ` ${id}-errors` : ""}`}
              className="bg-muted font-mono"
            />
            <p id={`${id}-hint`} className="text-sm text-muted-foreground">
              {row.hint}
            </p>
            {messages.length > 0 && (
              <div id={`${id}-errors`} className="grid gap-1">
                {messages.map((message) => (
                  <p key={message} className="text-sm text-destructive">
                    {message}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function scopeMessages(problems: readonly EditorProblem[], key: ScopeKey): string[] {
  return problems
    .filter(
      (problem) =>
        problem.place.area === "template" &&
        problem.place.path[0] === "scope" &&
        (problem.place.path[1] === key || problem.place.path.length === 1),
    )
    .map((problem) => problem.message);
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

/** Template problems the Details tab shows; the rest belong to the JSON tab. */
export function isDetailPath(path: readonly (string | number)[]): boolean {
  return DETAIL_AREAS.includes(path[0]);
}
