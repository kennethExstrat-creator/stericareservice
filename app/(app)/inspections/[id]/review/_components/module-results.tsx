// Every included module's computed result, in the template's order, beside
// the inspector's comment on it (BUILD_SPEC 4.2 rule 7, 9.2). Custom modules
// sit after the module they follow, with their values. Each module lists its
// errors and warnings; "not done" is its own result, so the framework's
// not-done warning is not repeated under it.
//
// Desktop (from 1024 px): one row per module in three columns under a
// header row. iPad portrait: each module stacks, and the comment is labelled.
import type { ReactNode } from "react";
import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { StatusPill } from "@/components/qc";
import { formatNumber, formatSize } from "@/lib/format";
import { formatInspectionDate } from "@/lib/inspections/format";
import { isListedIssue, type ReviewEvaluation } from "@/lib/inspections/review/evaluate";
import { inTemplateOrder, plural } from "@/lib/inspections/review/format";
import type { CustomModule, Field } from "@/lib/schemas/template";
import { templateSections } from "@/lib/templates";
import type { ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";
import type { CustomModuleEvaluation, InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { Missing, Panel, ReviewSection } from "./review-section";

/** Module, result, comment. The module column fits the longest report headings on two lines. */
const COLUMNS = "lg:grid-cols-[minmax(0,15rem)_minmax(0,1fr)_minmax(0,18rem)] xl:grid-cols-[minmax(0,17rem)_minmax(0,1fr)_minmax(0,20rem)]";
const TEXT = "text-base fine:text-sm";

export function ModuleResults({ evaluation }: { evaluation: ReviewEvaluation }) {
  if (!evaluation.ok) {
    return (
      <ReviewSection id="modules" title="Module results">
        <Panel className="flex gap-3 border-l-4 border-l-warn-border p-5">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <p className={cn("text-foreground", TEXT)}>{evaluation.message}</p>
        </Panel>
      </ReviewSection>
    );
  }

  const { report, template, context } = evaluation;
  const listed = report.issues.filter(isListedIssue);
  const issuesOf = (key: string) => listed.filter((issue) => issue.moduleKey === key);
  const modules = new Map<string, ModuleEvaluation>(report.modules.map((entry) => [entry.key, entry]));
  const custom = new Map(report.custom.map((entry) => [entry.custom.key, entry]));
  const sections = templateSections(template);
  const shown = new Set(sections.map((section) => section.key));
  const elsewhere = listed.filter((issue) => !shown.has(issue.moduleKey));

  return (
    <ReviewSection
      id="modules"
      title="Module results"
      description="In the template's order, worked out from the saved data with the template version this inspection uses."
    >
      <Panel className="overflow-hidden">
        <div
          aria-hidden
          className={cn(
            "hidden gap-x-6 border-b border-border bg-slate-50 px-5 py-2 text-sm font-medium text-muted-foreground lg:grid",
            COLUMNS,
          )}
        >
          <span>Module</span>
          <span>Result</span>
          <span>Inspector&apos;s comment</span>
        </div>
        <ol className="divide-y divide-border">
          {sections.map((section) => {
            if (section.kind === "module") {
              const entry = modules.get(section.key);
              return entry ? (
                <ModuleRow key={section.key} entry={entry} issues={issuesOf(section.key)} context={context} />
              ) : null;
            }
            const entry = custom.get(section.key);
            return entry ? (
              <CustomRow key={section.key} entry={entry} issues={issuesOf(section.key)} context={context} />
            ) : null;
          })}
        </ol>
        {elsewhere.length > 0 && (
          <div className="border-t border-border px-5 py-4">
            <h3 className="mb-2 text-base font-bold text-foreground">Other issues</h3>
            <IssueList title="Other issues" issues={elsewhere} />
          </div>
        )}
      </Panel>
    </ReviewSection>
  );
}

function Row({
  id,
  dataAttributes,
  heading,
  badge,
  result,
  comment,
}: {
  id: string;
  dataAttributes: Record<string, string>;
  heading: string;
  badge: ReactNode;
  result: ReactNode;
  comment: string | null;
}) {
  return (
    <li id={id} {...dataAttributes} className={cn("grid scroll-mt-[calc(var(--shell-top)+1rem)] gap-x-6 gap-y-3 px-5 py-4", COLUMNS)}>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 lg:flex-col lg:items-start lg:justify-start">
        <h3 className="text-base leading-snug font-bold text-balance text-foreground">{heading}</h3>
        {badge}
      </div>
      <div className="min-w-0 space-y-3">{result}</div>
      {/* relative: anchors the screen-reader labels (docs/DESIGN.md). */}
      <div className="relative min-w-0 space-y-1">
        {comment ? (
          <>
            <p className="text-sm font-medium text-muted-foreground lg:sr-only">Inspector&apos;s comment</p>
            <blockquote
              className={cn("border-l-2 border-brand-300 pl-3 whitespace-pre-line text-foreground [overflow-wrap:anywhere]", TEXT)}
            >
              {comment}
            </blockquote>
          </>
        ) : (
          <p className={cn("text-muted-foreground", TEXT)}>
            <span className="lg:hidden">No comment from the inspector</span>
            <span className="hidden lg:inline">
              <span className="sr-only">Inspector&apos;s comment: </span>No comment
            </span>
          </p>
        )}
      </div>
    </li>
  );
}

function ModuleRow({ entry, issues, context }: { entry: ModuleEvaluation; issues: ValidationIssue[]; context: InspectionContext }) {
  const { result } = entry;
  const sizes = result.perSize ? inTemplateOrder(context, Object.keys(result.perSize)) : [];
  return (
    <Row
      id={`module-${entry.key}`}
      dataAttributes={{ "data-module": entry.key, "data-status": result.status }}
      heading={entry.title}
      badge={<StatusPill status={result.status} size="sm" />}
      comment={entry.comment}
      result={
        <>
          {result.summary.trim() && <p className={cn("text-foreground", TEXT)}>{result.summary}</p>}
          {sizes.length > 0 && (
            <ul aria-label={`${entry.title}: result per size`} className="grid gap-1.5">
              {sizes.map((size) => {
                const own = result.perSize?.[size];
                if (!own) return null;
                return (
                  <li key={size} data-size={size} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    {/* Spaces between the parts for screen readers; the gap spaces them on screen. */}
                    <span className={cn("min-w-18 font-medium text-foreground", TEXT)}>
                      {formatSize(size, { sizes: context.templateSizes, prefix: true })}
                    </span>{" "}
                    <StatusPill status={own.status} size="sm" />{" "}
                    {own.summary && <span className={cn("text-muted-foreground", TEXT)}>{own.summary}</span>}
                  </li>
                );
              })}
            </ul>
          )}
          {issues.length > 0 && <IssueList title={entry.title} issues={issues} />}
        </>
      }
    />
  );
}

function CustomRow({
  entry,
  issues,
  context,
}: {
  entry: CustomModuleEvaluation;
  issues: ValidationIssue[];
  context: InspectionContext;
}) {
  return (
    <Row
      id={`custom-${entry.custom.key}`}
      dataAttributes={{ "data-custom": entry.custom.key }}
      heading={entry.custom.title}
      badge={
        // A pill's size, without a result's colour: extra fields have no verdict.
        <span className="inline-flex h-6 items-center rounded-full border border-slate-300 bg-card px-2 text-xs font-semibold text-slate-700 touch:h-8 touch:px-3 touch:text-base">
          Extra fields
        </span>
      }
      comment={entry.comment}
      result={
        <>
          <CustomValues custom={entry.custom} values={entry.values} context={context} />
          {issues.length > 0 && <IssueList title={entry.custom.title} issues={issues} />}
        </>
      }
    />
  );
}

function IssueList({ title, issues }: { title: string; issues: readonly ValidationIssue[] }) {
  return (
    <ul aria-label={`Issues: ${title}`} className="grid gap-1.5">
      {issues.map((issue, index) => {
        const error = issue.level === "error";
        const Icon = error ? CircleXIcon : TriangleAlertIcon;
        return (
          <li
            key={`${issue.code}-${index}`}
            data-issue={issue.code}
            data-level={issue.level}
            className={cn("flex gap-2", TEXT, error ? "text-fail" : "text-warn")}
          >
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="[overflow-wrap:anywhere]">
              <span className="font-semibold">{error ? "Error:" : "Warning:"}</span> {issue.message}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/* ------------------------------------------------------------------ *
 * Custom module values (BUILD_SPEC 4.3): fields, a row per size, or a
 * grid of repeated columns, as lib/validation/custom.ts shapes them.
 * ------------------------------------------------------------------ */

/** A saved value as text, or null when nothing is entered. */
export function formatCustomValue(field: Pick<Field, "type" | "unit">, value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "string") {
    if (value.trim() === "") return null;
    return field.type === "date" ? formatInspectionDate(value) : value;
  }
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "number") {
    // As entered, with thousands separators and the field's unit: "1,250", "240.5 mm", "88%".
    return formatNumber(value, { grouping: true, unit: field.unit }) || null;
  }
  if (Array.isArray(value)) {
    if (field.type === "photo") return value.length === 0 ? null : plural(value.length, "photo");
    if (value.length === 0) return null;
    return value.map((cell) => formatCustomValue(field, cell) ?? "—").join(", ");
  }
  return null;
}

function Value({ field, value }: { field: Field; value: unknown }) {
  const text = formatCustomValue(field, value);
  return text === null ? <Missing label="Not entered" /> : <>{text}</>;
}

function recordOf(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function CustomValues({
  custom,
  values,
  context,
}: {
  custom: CustomModule;
  values: Record<string, unknown>;
  context: InspectionContext;
}) {
  const perSize = custom.layout === "table" || (custom.layout === "grid" && custom.grid?.repeatPer === "size");
  if (!perSize) return <FieldList fields={custom.fields} values={values} />;

  const bySize = recordOf(values.sizes);
  if (context.sizes.length === 0) {
    return <p className={cn("text-muted-foreground", TEXT)}>No sizes ordered yet.</p>;
  }
  if (custom.layout === "grid") {
    return (
      <div className="grid gap-3">
        {context.sizes.map((size) => (
          <div key={size}>
            <p className={cn("font-medium text-foreground", TEXT)}>
              {formatSize(size, { sizes: context.templateSizes, prefix: true })}
            </p>
            <FieldList fields={custom.fields} values={recordOf(bySize[size])} />
          </div>
        ))}
      </div>
    );
  }
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-left", TEXT)}>
        <caption className="sr-only">{custom.title}, per size</caption>
        <thead>
          <tr className="border-b border-border text-sm text-muted-foreground">
            <th scope="col" className="py-1.5 pr-4 font-medium">
              Size
            </th>
            {custom.fields.map((field) => (
              <th key={field.key} scope="col" className="py-1.5 pr-4 font-medium">
                {field.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {context.sizes.map((size) => {
            const row = recordOf(bySize[size]);
            return (
              <tr key={size}>
                <th scope="row" className="py-1.5 pr-4 font-medium text-foreground">
                  {/* Under the "Size" column heading: "M", or the template's "Medium". */}
                  {formatSize(size, { sizes: context.templateSizes })}
                </th>
                {custom.fields.map((field) => (
                  <td key={field.key} className="py-1.5 pr-4 text-foreground tabular-nums">
                    <Value field={field} value={row[field.key]} />
                  </td>
                ))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function FieldList({ fields, values }: { fields: readonly Field[]; values: Record<string, unknown> }) {
  return (
    <dl className={cn("grid gap-x-4 gap-y-1 sm:grid-cols-[minmax(0,auto)_minmax(0,1fr)]", TEXT)}>
      {fields.map((field) => (
        <div key={field.key} className="contents">
          <dt className="text-muted-foreground">{field.label}</dt>
          <dd className="font-medium text-foreground [overflow-wrap:anywhere] tabular-nums">
            <Value field={field} value={values[field.key]} />
          </dd>
        </div>
      ))}
    </dl>
  );
}
