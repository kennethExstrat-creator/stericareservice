"use client";

// Which template the inspection will use (BUILD_SPEC 4.4), worked out live
// from the picks with lib/templates' selection rule, and why. An admin can
// choose another template that is not retired. The Server Action decides
// again from the database; this is what the inspector sees before creating.
import { CheckIcon, CircleDashedIcon, LayoutTemplateIcon, TriangleAlertIcon } from "lucide-react";
import { FieldDescription, FieldError, FieldLabel } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from "@/components/ui/select";
import { choiceReason, PRODUCT_TYPE_LABEL, type TemplateChoice } from "@/lib/inspections/create";
import type { ProductType } from "@/lib/schemas/common";
import { templateLabel } from "../_lib/text";
import { STANDARD_LABEL, type TemplateOption } from "../_lib/types";
import { Panel } from "./panel";

/** The override picker's value for "use the rule". */
export const AUTOMATIC = "automatic";

/** One of the choices the rule needs, and whether it is made. */
export type PickState = { label: string; done: boolean };

type TemplatePanelProps = {
  id: string;
  role: "inspector" | "admin";
  picks: readonly PickState[];
  productType: ProductType | null;
  names: { client: string | null; manufacturer: string | null };
  choice: TemplateChoice | null;
  chosen: TemplateOption | null;
  /** Admin only: the templates they may choose instead. */
  overrides: readonly TemplateOption[];
  overrideId: string;
  onOverrideChange?: (id: string) => void;
  overrideError?: string;
  disabled?: boolean;
};

export function TemplatePanel(props: TemplatePanelProps) {
  const { id, role, picks, productType, names, choice, chosen } = props;
  const waiting = picks.some((entry) => !entry.done);
  const announcement = waiting
    ? ""
    : chosen && choice?.ok
      ? `Template: ${chosen.name}, ${templateLabel(chosen)}.`
      : choice && !choice.ok
        ? choice.message
        : "";

  return (
    <Panel
      headingId={`${id}-template-heading`}
      icon={LayoutTemplateIcon}
      title="Template"
      className="gap-4"
      data-testid="template-panel"
    >
      {/* Read out whenever the template changes. */}
      <p role="status" className="sr-only">
        {announcement}
      </p>

      {waiting ? (
        <Waiting picks={picks} />
      ) : chosen && choice?.ok ? (
        <Chosen
          template={chosen}
          reason={choiceReason(choice.specificity, names, chosen.productType)}
          ties={role === "admin" ? choice.ties : []}
        />
      ) : (
        <NoTemplate message={choice && !choice.ok ? choice.message : "No template applies."} role={role} />
      )}

      {role === "admin" && !waiting && productType && <OverridePicker {...props} productType={productType} />}
    </Panel>
  );
}

function Waiting({ picks }: { picks: readonly PickState[] }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-muted-foreground touch:text-base">
        The template follows from the client, manufacturer and product type.
      </p>
      <ul className="flex flex-col gap-2" aria-label="Choices the template needs">
        {picks.map((entry) => (
          <li key={entry.label} className="flex items-center gap-2 text-sm touch:text-base">
            {entry.done ? (
              <CheckIcon aria-hidden className="size-4 text-pass" />
            ) : (
              <CircleDashedIcon aria-hidden className="size-4 text-slate-500" />
            )}
            <span className={entry.done ? "text-foreground" : "text-muted-foreground"}>
              {entry.label}
              <span className="sr-only">{entry.done ? ": chosen" : ": not chosen yet"}</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Chosen({
  template,
  reason,
  ties,
}: {
  template: TemplateOption;
  reason: string;
  ties: readonly { code: string; version: number }[];
}) {
  return (
    <div className="flex flex-col gap-3" data-testid="chosen-template" data-code={template.code} data-version={template.version}>
      <div className="flex flex-col gap-1">
        <p className="font-heading text-xl leading-snug font-bold text-foreground">{template.name}</p>
        <p className="text-sm text-muted-foreground tabular-nums touch:text-base">
          {templateLabel(template)} · {STANDARD_LABEL[template.standard]}
          {template.status === "draft" && " · Draft"}
        </p>
      </div>
      <p data-testid="choice-reason" className="w-fit rounded-lg bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700">
        {reason}
      </p>
      {template.status === "draft" && (
        <p className="flex gap-2 text-sm text-warn touch:text-base">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          A draft is frozen once an inspection uses it: later edits become a new version.
        </p>
      )}
      {template.ready ? (
        <>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm touch:text-base">
            <dt className="text-muted-foreground">Sizes</dt>
            <dd className="text-foreground">
              {template.sizes.join(", ")}{" "}
              <span className="text-muted-foreground">({template.unit === "pairs" ? "pairs" : "pieces"})</span>
            </dd>
            <dt className="text-muted-foreground">Sections</dt>
            <dd className="text-foreground tabular-nums">{template.sections.length}</dd>
          </dl>
          {template.sections.length > 0 && (
            <details className="text-sm touch:text-base">
              <summary className="w-fit cursor-pointer rounded-md py-1 font-medium text-brand-600 focus-ring-inset touch:py-2.5">
                Show the Sections
              </summary>
              <ol className="mt-2 list-decimal space-y-1 pl-5 text-foreground marker:text-muted-foreground">
                {template.sections.map((title, index) => (
                  <li key={`${index}-${title}`}>{title}</li>
                ))}
              </ol>
            </details>
          )}
        </>
      ) : (
        <p className="flex gap-2 text-sm text-fail touch:text-base">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          This version cannot be used yet: an admin needs to save it again.
        </p>
      )}
      {ties.length > 0 && (
        <p className="text-sm text-muted-foreground touch:text-base">
          Also applies just as closely: {ties.map(templateLabel).join(", ")}. The first by code was taken.
        </p>
      )}
    </div>
  );
}

function NoTemplate({ message, role }: { message: string; role: "inspector" | "admin" }) {
  return (
    <div
      data-testid="no-template"
      className="flex gap-3 rounded-lg border border-warn-border bg-warn-tint p-4 text-sm text-warn touch:text-base"
    >
      <TriangleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
      <div className="flex flex-col gap-1">
        <p className="font-semibold">{message}</p>
        {role === "admin" && <p>Choose a template below, or activate one first.</p>}
      </div>
    </div>
  );
}

function OverridePicker({
  id,
  productType,
  overrides,
  overrideId,
  onOverrideChange,
  overrideError,
  disabled,
  choice,
}: TemplatePanelProps & { productType: ProductType }) {
  const forType = overrides.filter((template) => template.productType === productType);
  const automatic = choice?.ok && choice.specificity !== "override" ? choice.template : null;
  return (
    <div className="flex flex-col gap-1.5 border-t border-border pt-4">
      <FieldLabel htmlFor={`${id}-template`}>Use Another Template</FieldLabel>
      <Select
        value={overrideId || AUTOMATIC}
        onValueChange={(value) => onOverrideChange?.(value === AUTOMATIC ? "" : value)}
        disabled={disabled}
      >
        <SelectTrigger
          id={`${id}-template`}
          className="w-full"
          aria-invalid={overrideError ? true : undefined}
          aria-describedby={overrideError ? `${id}-template-error` : `${id}-template-hint`}
        >
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AUTOMATIC}>{automatic ? `Automatic: ${templateLabel(automatic)}` : "Automatic"}</SelectItem>
          {forType.length > 0 && <SelectSeparator />}
          {forType.map((template) => (
            <SelectItem key={template.id} value={template.id} disabled={!template.ready}>
              <span className="truncate">
                {templateLabel(template)}
                {template.status === "draft" ? " · Draft" : ""}
                {template.ready ? "" : " · cannot be used yet"}
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {overrideError ? (
        <FieldError id={`${id}-template-error`}>{overrideError}</FieldError>
      ) : (
        <FieldDescription id={`${id}-template-hint`}>
          Admins only: any active or draft template for {PRODUCT_TYPE_LABEL[productType].toLowerCase()}. The choice is
          recorded.
        </FieldDescription>
      )}
    </div>
  );
}
