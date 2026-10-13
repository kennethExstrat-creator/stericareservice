import {
  EXPORT_SCHEMA_VERSION,
  ExportSchema,
  type ExportConclusion,
  type ExportCustomModule,
  type ExportFile,
  type ExportModule,
  type ExportPhoto,
} from "@/lib/schemas/export";
import { IsoDateSchema, type JsonValue } from "@/lib/schemas/common";
import type { ResolvedTemplate, TemplateUnit } from "@/lib/schemas/template";
import { sectionOrder } from "@/lib/templates";
import { exportIssuesOf } from "@/lib/validation";
import { readModuleEntry, type ModuleEvaluation } from "@/modules/_framework";
import { z } from "zod";
import { richTextHtml, richTextPlain } from "@/lib/rich-text";
import { conclusionDataForExport, inspectionSummaryOf, inspectorDecision, signAfterExportOf } from "./conclusion";
import type { EvaluatedInspection } from "./evaluate";
import type { FileRecord, InspectionRecord, PhotoRecord } from "./record";

/* ------------------------------------------------------------------ *
 * The export document (BUILD_SPEC 9.1) from an evaluated inspection and
 * its signed links. Pure: no I/O, so every rule is unit-tested. The
 * caller validates the result with ExportSchema.
 * ------------------------------------------------------------------ */

/** What the caller signed: object name to URL. */
export type SignedLinks = {
  photos: ReadonlyMap<string, string>;
  files: ReadonlyMap<string, string>;
  clientLogo: string | null;
  sourceFile: string | null;
};

export type AssembleInput = {
  record: InspectionRecord;
  evaluated: EvaluatedInspection;
  links: SignedLinks;
  /** ISO 8601, e.g. new Date().toISOString(). */
  exportedAt: string;
};

export type ExportInput = z.input<typeof ExportSchema>;

export function assembleExport({ record, evaluated, links, exportedAt }: AssembleInput): ExportInput {
  const { template, report } = evaluated;
  const order = sectionOrder(template);
  const templateRow = record.template;
  if (!templateRow) throw new Error("assembleExport needs the inspection's template row.");

  return {
    schemaVersion: EXPORT_SCHEMA_VERSION,
    refNo: record.refNo,
    status: record.status,
    timestamps: {
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      submittedAt: record.submittedAt,
      approvedAt: record.approvedAt,
      exportedAt,
    },
    inspector: {
      id: evaluated.inspector.id,
      name: evaluated.inspector.name,
      ...(validEmail(record.inspector?.email) ? { email: record.inspector?.email?.trim() } : {}),
    },
    template: {
      code: templateRow.code,
      version: templateRow.version,
      standard: templateRow.standard,
      productType: templateRow.productType,
      client: evaluated.client,
      manufacturer: evaluated.manufacturer,
      reportTitle: template.report.title,
      clientLogoUrl: links.clientLogo,
      sourceFile: links.sourceFile,
      ...templateDetails(template),
    },
    modules: report.modules.map((evaluation) => exportModule(evaluated, evaluation)),
    excludedModules: report.excluded.map(({ key, title, reason }) => ({ key, title, reason })),
    custom: report.custom.map(
      ({ custom, values }): ExportCustomModule => ({
        key: custom.key,
        title: custom.title,
        after: custom.after,
        layout: custom.layout,
        fields: custom.fields.map((field) => ({
          key: field.key,
          label: field.label,
          type: field.type,
          ...(field.unit ? { unit: field.unit } : {}),
        })),
        values: jsonObject(values),
      }),
    ),
    photos: sortByModule(record.photos, order).flatMap((photo): ExportPhoto[] => {
      const url = links.photos.get(photo.storagePath);
      return url
        ? [
            {
              id: photo.id,
              url,
              moduleKey: photo.moduleKey,
              target: blankToNull(photo.target),
              caption: blankToNull(photo.caption),
              takenAt: photo.takenAt,
              includeInReport: photo.includeInReport,
              flagged: photo.flagged,
            },
          ]
        : [];
    }),
    files: sortByModule(record.files, order).flatMap((file): ExportFile[] => {
      const url = links.files.get(file.storagePath);
      return url ? [{ id: file.id, url, moduleKey: file.moduleKey, kind: file.kind, name: file.name }] : [];
    }),
    conclusion: conclusionOf(record, evaluated),
  };
}

/** The template's sizes, unit and running header, for the report's fixed rows and later pages. */
export type ExportTemplateDetails = {
  /** Every size the template lists, in its order, with the name the report shows: its "Shown As", else the size itself. */
  sizes: { value: string; label: string }[];
  /** Gloves counted in pieces or in pairs. */
  unit: TemplateUnit;
  /** The header on pages after the first; null when the template sets none. */
  pageHeader: string | null;
};

/**
 * What the report needs from the template besides its title (BUILD_SPEC 9.1,
 * Phase 3: everything to write the report without opening the app): the
 * fixed size rows (XS to XL for EG, 5.5 to 9.0 for STD_SG) whatever was
 * ordered, the unit, and the running header the template editor sets under
 * "AI report". ExportTemplateSchema lists all three: validating the document
 * drops any key it does not list.
 */
export function templateDetails(template: Pick<ResolvedTemplate, "sizes" | "unit" | "report">): ExportTemplateDetails {
  return {
    sizes: template.sizes.map(({ value, label }) => ({ value, label })),
    unit: template.unit,
    pageHeader: template.report.pageHeader ?? null,
  };
}

function exportModule(evaluated: EvaluatedInspection, evaluation: ModuleEvaluation): ExportModule {
  const { warnings, errors } = exportIssuesOf(evaluated.report.issues, evaluation.key);
  return {
    key: evaluation.key,
    title: evaluation.title,
    labels: { ...evaluation.labels },
    // As parsed by the module, from the inspection's template version; a config
    // the module refuses goes out as the template has it, beside its invalid_config error.
    ...(isRecord(evaluation.config) ? { config: jsonObject(evaluation.config) } : {}),
    data: moduleData(evaluated, evaluation),
    computed: jsonObject(evaluation.computed),
    result: evaluation.result,
    warnings,
    errors,
    comment: evaluation.comment,
  };
}

/**
 * What the inspector entered, ordered sizes only, as calc saw it. Data that
 * fails the module's schema has no parsed form; it goes out as saved
 * (without the comment), next to the invalid_data error, so nothing is lost.
 * The conclusion's goes without its drawn signature while the report is to
 * be signed by hand after export (conclusionDataForExport).
 */
function moduleData(evaluated: EvaluatedInspection, evaluation: ModuleEvaluation): Record<string, JsonValue> {
  const data = enteredData(evaluated, evaluation);
  return evaluation.key === "conclusion" ? conclusionDataForExport(data) : data;
}

function enteredData(evaluated: EvaluatedInspection, evaluation: ModuleEvaluation): Record<string, JsonValue> {
  if (isRecord(evaluation.data)) return jsonObject(evaluation.data);
  const saved = readModuleEntry(evaluated.data, "modules", evaluation.key).value;
  return isRecord(saved) ? jsonObject(saved) : {};
}

/**
 * The conclusion block. The suggested result is the framework's, from this
 * evaluation. The final result and remark are what the inspector entered in
 * the conclusion module, the row's copies standing in where it holds none
 * (inspectorDecision, the same rule as the review). The date is the
 * conclusion's own (the report date, DATA_DICTIONARY decision 1), or null
 * until it is recorded. The inspection summary goes as HTML for the report
 * and as plain text (lib/rich-text), or null when none is written.
 * signAfterExport says whether the report is to be signed by hand after
 * export (Kenneth, 13 October 2026); the module's data then carries no
 * drawn signature.
 */
export function conclusionOf(record: InspectionRecord, evaluated: EvaluatedInspection): ExportConclusion {
  const saved = evaluated.report.modules.find((evaluation) => evaluation.key === "conclusion");
  const data = saved && isRecord(saved.data) ? saved.data : {};
  const decision = inspectorDecision({ result: record.result, remarks: record.remarks }, data);
  const summary = inspectionSummaryOf(data);
  return {
    suggestedResult: evaluated.report.suggested.result,
    finalResult: decision.result,
    remark: decision.remarks,
    inspector: evaluated.inspector,
    date: IsoDateSchema.safeParse(data.date).success ? (data.date as string) : null,
    inspectionSummary: summary ? { html: richTextHtml(summary), text: richTextPlain(summary) } : null,
    signAfterExport: signAfterExportOf(data),
  };
}

/** Photos and files in screen order of their module, then as captured. Untagged ones last. */
function sortByModule<T extends PhotoRecord | FileRecord>(items: readonly T[], order: readonly string[]): T[] {
  const rank = (key: string | null) => {
    const index = key === null ? -1 : order.indexOf(key.trim());
    return index === -1 ? order.length : index;
  };
  const when = (item: T) => ("takenAt" in item && item.takenAt ? item.takenAt : item.createdAt);
  return [...items].sort(
    (a, b) =>
      rank(a.moduleKey) - rank(b.moduleKey) ||
      Date.parse(when(a)) - Date.parse(when(b)) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
}

/** A plain JSON object: whatever survives JSON.stringify (no undefined, functions or NaN). */
function jsonObject(value: unknown): Record<string, JsonValue> {
  const copy: unknown = JSON.parse(JSON.stringify(value ?? {}));
  return isRecord(copy) ? (copy as Record<string, JsonValue>) : {};
}

function blankToNull(value: string | null | undefined): string | null {
  return typeof value === "string" && value.trim() !== "" ? value : null;
}

/** The export's own email rule, so an address it would reject is left out instead of failing the export. */
function validEmail(value: string | null | undefined): boolean {
  return typeof value === "string" && z.email().safeParse(value.trim()).success;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
