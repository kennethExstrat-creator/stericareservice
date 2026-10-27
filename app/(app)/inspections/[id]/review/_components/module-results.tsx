// Every included module's computed result, in the template's order (BUILD_SPEC
// 4.2 rule 7, 9.2), as one-line rows that open (layout A, Kenneth, 27 October
// 2026; ModuleRows). Open, a module shows its sizes side by side, built from
// what its calc computed (lib/inspections/review/size-table.ts), its errors
// and warnings as one short line each, and the inspector's comment when
// there is one. A module with no table shows its result's summary, or its
// per-size lines. Custom modules sit after the module they follow, with
// their values. "Not done" is a module's own result, so the framework's
// not-done warning is not repeated under it, and the conclusion's HOLD
// reads "On Hold", as the final result does (lib/inspections/review/results.ts).
// The header is General Information, as on the capture screen
// (lib/design/screen-names.ts).
import type { ReactNode } from "react";
import { CircleXIcon, TriangleAlertIcon } from "lucide-react";
import { StatusPill } from "@/components/qc";
import type { Status } from "@/lib/design/status";
import { screenTitle } from "@/lib/design/screen-names";
import { formatNumber, formatSize } from "@/lib/format";
import { formatInspectionDate } from "@/lib/inspections/format";
import { attentionItems, type AttentionItem } from "@/lib/inspections/review/attention";
import { isListedIssue, type ReviewEvaluation } from "@/lib/inspections/review/evaluate";
import { plural } from "@/lib/inspections/review/format";
import { moduleSummary, shownStatus, sizeResults } from "@/lib/inspections/review/results";
import { sizeTable } from "@/lib/inspections/review/size-table";
import type { CustomModule, Field } from "@/lib/schemas/template";
import { templateSections } from "@/lib/templates";
import type { ValidationIssue } from "@/lib/validation";
import { cn } from "@/lib/utils";
import type { CustomModuleEvaluation, InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { sizesText } from "./attention";
import { ModuleRows, type ModuleRowModel } from "./module-rows";
import { Missing, Panel } from "./review-section";
import { SizeTableView, type SizeColumn } from "./size-table-view";

const TEXT = "text-base fine:text-sm";

/** A module's row id, which links from elsewhere on the page land on. */
export function moduleAnchor(key: string, custom = false): string {
  return custom ? `custom-${key}` : `module-${key}`;
}

export function ModuleResults({ evaluation }: { evaluation: ReviewEvaluation }) {
  if (!evaluation.ok) {
    return (
      <section id="modules" aria-labelledby="modules-heading" className="space-y-3">
        <h2 id="modules-heading" className="text-lg font-bold text-foreground">
          Module Results
        </h2>
        <Panel className="flex gap-3 p-5">
          <TriangleAlertIcon aria-hidden className="mt-0.5 size-5 shrink-0 text-warn" />
          <p className={cn("text-foreground", TEXT)}>{evaluation.message}</p>
        </Panel>
      </section>
    );
  }

  const { rows, elsewhere } = moduleRowsOf(evaluation);
  const { context } = evaluation;
  const sizeLabel = (size: string) => formatSize(size, { sizes: context.templateSizes });

  return (
    <ModuleRows rows={rows}>
      {elsewhere.length > 0 && (
        <div className="border-t border-border px-5 py-4">
          <h3 className="mb-2 text-base font-bold text-foreground">Other Issues</h3>
          <IssueLines items={attentionItems(elsewhere, context.sizes)} sizeLabel={sizeLabel} />
        </div>
      )}
    </ModuleRows>
  );
}

/**
 * The rows in the template's order, each with its body rendered, and the
 * issues of modules no row shows.
 */
export function moduleRowsOf(evaluation: Extract<ReviewEvaluation, { ok: true }>): {
  rows: ModuleRowModel[];
  elsewhere: ValidationIssue[];
} {
  const { report, template, context } = evaluation;
  const listed = report.issues.filter(isListedIssue);
  const issuesOf = (key: string) => listed.filter((issue) => issue.moduleKey === key);
  const modules = new Map<string, ModuleEvaluation>(report.modules.map((entry) => [entry.key, entry]));
  const custom = new Map(report.custom.map((entry) => [entry.custom.key, entry]));
  const sections = templateSections(template);
  const shown = new Set(sections.map((section) => section.key));

  const rows = sections.flatMap((section): ModuleRowModel[] => {
    if (section.kind === "module") {
      const entry = modules.get(section.key);
      return entry ? [moduleRow(entry, issuesOf(section.key), context)] : [];
    }
    const entry = custom.get(section.key);
    return entry ? [customRow(entry, issuesOf(section.key), context)] : [];
  });
  return { rows, elsewhere: listed.filter((issue) => !shown.has(issue.moduleKey)) };
}

function counts(issues: readonly ValidationIssue[]): { errors: number; warnings: number } {
  return {
    errors: issues.filter((issue) => issue.level === "error").length,
    warnings: issues.filter((issue) => issue.level === "warning").length,
  };
}

function moduleRow(entry: ModuleEvaluation, issues: ValidationIssue[], context: InspectionContext): ModuleRowModel {
  // The conclusion's HOLD reads "On Hold", as the final result does.
  const status = shownStatus(entry);
  const title = screenTitle(entry.key, entry.title);
  const sizes = sizeResults(entry, context);
  const judged = sizes.some((own) => own.status !== "info");
  return {
    key: entry.key,
    anchor: moduleAnchor(entry.key),
    title,
    group: status === "info" ? "info" : "result",
    status,
    // Size by size only where sizes are judged: an Info module's sizes are all Info.
    sizes: judged ? sizes.map((own) => ({ size: own.size, label: own.label, status: own.status })) : [],
    ...counts(issues),
    body: <ModuleBody entry={entry} title={title} issues={issues} context={context} />,
  };
}

function ModuleBody({
  entry,
  title,
  issues,
  context,
}: {
  entry: ModuleEvaluation;
  title: string;
  issues: ValidationIssue[];
  context: InspectionContext;
}) {
  const sizeLabel = (size: string) => formatSize(size, { sizes: context.templateSizes });
  const table = sizeTable(entry, context);
  const sizes = sizeResults(entry, context);
  const columns: SizeColumn[] = context.sizes.map((size) => ({ size, label: sizeLabel(size) }));
  const perSize = entry.result.perSize ?? {};
  const results = columns.map((column) => (perSize[column.size]?.status as Status | undefined) ?? null);
  const judged = results.some((status) => status !== null && status !== "info");
  // What the summary says beyond its sizes: shown with a table only where it holds facts no size has
  // (MODULE_FACTS), or why a module has not passed; with size lines, always, as above them before.
  const beyond = moduleSummary(entry, context);
  const facts =
    beyond !== null && (!table || MODULE_FACTS.has(entry.key) || (entry.result.status !== "pass" && entry.result.status !== "info"));
  return (
    <div className="space-y-3">
      {facts && <p className={cn("text-foreground", TEXT)}>{beyond}</p>}
      {table ? (
        <SizeTableView title={title} table={table} sizes={columns} results={judged ? results : undefined} />
      ) : sizes.length > 0 ? (
        <ul aria-label={`${title}: result per size`} className="grid gap-1.5">
          {sizes.map((own) => (
            <li key={own.size} data-size={own.size} className="flex flex-wrap items-center gap-x-3 gap-y-1">
              {/* Spaces between the parts for screen readers; the gap spaces them on screen. */}
              <span className={cn("min-w-10 font-medium text-foreground", TEXT)}>{own.label}</span>{" "}
              <StatusPill status={own.status} size="sm" />{" "}
              {own.summary && <span className={cn("whitespace-pre-line text-muted-foreground", TEXT)}>{own.summary}</span>}
            </li>
          ))}
        </ul>
      ) : (
        !facts && <p className={cn("text-foreground", TEXT)}>{entry.result.summary}</p>
      )}
      {issues.length > 0 && <IssueLines items={attentionItems(issues, context.sizes)} sizeLabel={sizeLabel} />}
      {entry.comment && <Comment text={entry.comment} />}
    </div>
  );
}

/**
 * Modules whose summary holds facts no size has, which their table cannot
 * show: the order's and the sampling plan's totals, a lab report missing.
 */
const MODULE_FACTS: ReadonlySet<string> = new Set(["order_lots", "sampling_plan", "tensile", "dye_leak"]);

function customRow(entry: CustomModuleEvaluation, issues: ValidationIssue[], context: InspectionContext): ModuleRowModel {
  const sizeLabel = (size: string) => formatSize(size, { sizes: context.templateSizes });
  return {
    key: entry.custom.key,
    anchor: moduleAnchor(entry.custom.key, true),
    title: entry.custom.title,
    group: "info",
    status: null,
    // A pill's place, without a result's colour: extra fields have no verdict.
    badge: "Extra Fields",
    sizes: [],
    ...counts(issues),
    body: (
      <div className="space-y-3">
        <CustomValues custom={entry.custom} values={entry.values} context={context} />
        {issues.length > 0 && <IssueLines items={attentionItems(issues, context.sizes)} sizeLabel={sizeLabel} />}
        {entry.comment && <Comment text={entry.comment} />}
      </div>
    ),
  };
}

/** A module's errors and warnings, one short line per problem with its sizes. */
function IssueLines({ items, sizeLabel }: { items: readonly AttentionItem[]; sizeLabel: (size: string) => string }) {
  return (
    <ul className="grid gap-1.5">
      {items.map((item) => {
        const error = item.level === "error";
        const Icon = error ? CircleXIcon : TriangleAlertIcon;
        const sizes = sizesText(item, sizeLabel);
        return (
          <li
            key={item.key}
            data-issue={item.code}
            data-level={item.level}
            className={cn("flex gap-2", TEXT, error ? "text-fail" : "text-warn")}
          >
            <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="[overflow-wrap:anywhere]">
              <span className="sr-only">{error ? "Error:" : "Warning:"} </span>
              {item.text}
              {sizes && <span className="font-semibold">{`: ${sizes}`}</span>}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function Comment({ text }: { text: string }): ReactNode {
  return (
    // relative: anchors the screen-reader label (docs/DESIGN.md).
    <div className="relative">
      <p className="sr-only">Inspector Comment</p>
      <blockquote
        className={cn("border-l-2 border-brand-300 pl-3 whitespace-pre-line text-foreground [overflow-wrap:anywhere]", TEXT)}
      >
        {text}
      </blockquote>
    </div>
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
