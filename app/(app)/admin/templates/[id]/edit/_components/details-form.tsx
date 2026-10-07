"use client";

// The template's own facts (BUILD_SPEC 4.3): name, unit, sizes and the AI
// report settings, as a form generated from the template schema's parts;
// the AI second opinion on submit (9.2), on or off or as the base has it;
// where it applies (scope, 4.4), picked from the clients and manufacturers;
// and what is fixed for a version: its code and its base template.
import { useMemo } from "react";
import { RotateCcwIcon } from "lucide-react";
import type { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { ProductTypeSchema, StandardSchema } from "@/lib/schemas/common";
import { TemplateAiSchema } from "@/lib/schemas/template";
import { describeSchema, isPlainObject, pathKey } from "@/lib/zod-form";
import { OptionSelect, type SelectOption } from "@/lib/zod-form/controls";
import { fieldId, SchemaForm } from "@/lib/zod-form/schema-form";
import {
  AI_ON_SUBMIT_LABEL,
  DETAIL_KEYS,
  DetailsSchema,
  FIXED_LABELS,
  SCOPE_HEADING,
  SCOPE_LABELS,
  type ScopeKey,
} from "../_lib/details";
import type { ReferenceOption } from "../_lib/load";
import type { Draft } from "../_lib/model";
import type { EditorProblem } from "../_lib/problems";
import type { EditorApi } from "./editor-api";

/** The AI second opinion switch: the problem list links here. */
export const AI_ON_SUBMIT_ID = fieldId("details", ["ai", "reviewOnSubmit"]);

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
      <AiFields api={api} />
      <ScopeFields api={api} />
      <FixedFields api={api} />
    </section>
  );
}

/**
 * The AI second opinion on submit (BUILD_SPEC 9.2): the switch shows what
 * the template will do, its own setting or the one it inherits; turning it
 * writes this template's own, and the reset gives the inherited one back.
 */
function AiFields({ api }: { api: EditorApi }) {
  const own = TemplateAiSchema.safeParse(api.draft.ai);
  const inherited = api.context.inheritance.ai;
  const base = api.context.inheritance.bases[0];
  const setsOwn = api.draft.ai !== undefined;
  const on = own.success ? own.data.reviewOnSubmit : (inherited?.reviewOnSubmit ?? false);
  const word = (value: boolean | undefined) => (value ? "on" : "off");
  const messages = api.problems
    .filter((problem) => problem.place.area === "template" && problem.place.path[0] === "ai")
    .map((problem) => problem.message);
  const hintId = `${AI_ON_SUBMIT_ID}-hint`;
  const errorsId = `${AI_ON_SUBMIT_ID}-errors`;
  const label = AI_ON_SUBMIT_LABEL;
  // Where the switch's state comes from, when it is not this template's own.
  const source = base
    ? setsOwn
      ? `${base.code} has it ${word(inherited?.reviewOnSubmit)}.`
      : `Now as ${base.code} has it: ${word(inherited?.reviewOnSubmit)}.`
    : setsOwn
      ? ""
      : "Off unless switched on here.";

  return (
    <section
      // A problem with the whole setting (JSON-edited) links here.
      id={fieldId("details", ["ai"])}
      tabIndex={-1}
      aria-labelledby="details-ai-heading"
      className="grid min-w-0 gap-4 rounded-xl bg-card p-4 shadow-sm ring-1 ring-border outline-none sm:p-5"
      data-testid="template-ai"
    >
      <h3 id="details-ai-heading" className="text-base font-bold text-foreground">
        AI second opinion
      </h3>
      <div className="flex items-start gap-3">
        <Switch
          id={AI_ON_SUBMIT_ID}
          checked={on}
          disabled={!api.editable}
          onCheckedChange={(checked) => api.update((draft) => ({ ...draft, ai: { reviewOnSubmit: checked } }))}
          aria-describedby={[hintId, messages.length > 0 ? errorsId : null].filter(Boolean).join(" ")}
          aria-invalid={messages.length > 0 ? true : undefined}
          className="mt-0.5 touch:mt-0"
        />
        <div className="grid min-w-0 flex-1 gap-1">
          <div className="flex min-h-6 flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <Label htmlFor={AI_ON_SUBMIT_ID} className="leading-snug">
              {label}
            </Label>
            {setsOwn && (
              // A long base code wraps, then ends in an ellipsis, as on the settings (lib/zod-form FieldHeader).
              <span className="flex max-w-full min-w-0 flex-wrap items-center gap-1">
                <span className="rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700">Changed</span>
                {api.editable && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="max-w-full min-w-0 shrink"
                    title={api.resetLabel}
                    aria-label={`${api.resetLabel}: ${label}`}
                    onClick={() => {
                      api.update((draft) => {
                        const next: Record<string, unknown> = { ...draft };
                        delete next.ai;
                        return next as Draft;
                      });
                      // The button goes with the template's own setting: the keyboard stays on the switch.
                      requestAnimationFrame(() => document.getElementById(AI_ON_SUBMIT_ID)?.focus());
                    }}
                  >
                    <RotateCcwIcon aria-hidden />
                    <span className="truncate">{api.resetLabel}</span>
                  </Button>
                )}
              </span>
            )}
          </div>
          <p id={hintId} className="text-sm text-muted-foreground">
            When an inspection from this template is submitted, an AI reviews it next to the inspector&apos;s results
            and suggests; it never changes a result. Admins can always ask for one from the review screen.
            {source && ` ${source}`}
          </p>
        </div>
      </div>
      {messages.length > 0 && (
        <div id={errorsId} className="grid gap-1">
          {messages.map((message) => (
            <p key={message} className="text-sm text-destructive">
              {message}
            </p>
          ))}
        </div>
      )}
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
      label: SCOPE_LABELS.productType,
      options: ProductTypeSchema.options.map((option) => ({ value: option, label: PRODUCT_TYPE_LABELS[option] })),
    },
    {
      key: "standard",
      label: SCOPE_LABELS.standard,
      options: StandardSchema.options.map((option) => ({ value: option, label: STANDARD_LABELS[option] })),
    },
    {
      key: "clientId",
      label: SCOPE_LABELS.clientId,
      options: referenceOptions("Any client", api.scopeOptions.clients, scope.clientId),
    },
    {
      key: "manufacturerId",
      label: SCOPE_LABELS.manufacturerId,
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
          {SCOPE_HEADING}
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
      label: FIXED_LABELS.code,
      value: typeof api.draft.code === "string" ? api.draft.code : "",
      hint: "Every version of a template keeps its code.",
    },
    {
      key: "extends",
      label: FIXED_LABELS.extends,
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
