import {
  EXPORT_SCHEMA_VERSION,
  ExportSchema,
  type ExportConclusion,
  type ExportCustomModule,
  type ExportFile,
  type ExportModule,
  type ExportPhoto,
} from "@/lib/schemas/export";
import { InspectionResultSchema, IsoDateSchema, type InspectionResult, type JsonValue } from "@/lib/schemas/common";
import { sectionOrder } from "@/lib/templates";
import { exportIssuesOf } from "@/lib/validation";
import { readModuleEntry, type ModuleEvaluation } from "@/modules/_framework";
import { z } from "zod";
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

function exportModule(evaluated: EvaluatedInspection, evaluation: ModuleEvaluation): ExportModule {
  const { warnings, errors } = exportIssuesOf(evaluated.report.issues, evaluation.key);
  return {
    key: evaluation.key,
    title: evaluation.title,
    labels: { ...evaluation.labels },
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
 */
function moduleData(evaluated: EvaluatedInspection, evaluation: ModuleEvaluation): Record<string, JsonValue> {
  if (isRecord(evaluation.data)) return jsonObject(evaluation.data);
  const saved = readModuleEntry(evaluated.data, "modules", evaluation.key).value;
  return isRecord(saved) ? jsonObject(saved) : {};
}

/**
 * The conclusion block. The suggested result is the framework's, from this
 * evaluation. The final result and remark are the inspection row's columns
 * (what lists and approval read), else what the conclusion module saved;
 * the date is the conclusion's own (the report date, DATA_DICTIONARY
 * decision 1), or null until it is recorded.
 */
export function conclusionOf(record: InspectionRecord, evaluated: EvaluatedInspection): ExportConclusion {
  const saved = evaluated.report.modules.find((evaluation) => evaluation.key === "conclusion");
  const data = saved && isRecord(saved.data) ? saved.data : {};
  return {
    suggestedResult: evaluated.report.suggested.result,
    finalResult: record.result ?? resultOrNull(data.finalResult),
    remark: blankToNull(record.remarks) ?? (typeof data.remark === "string" ? blankToNull(data.remark) : null),
    inspector: evaluated.inspector,
    date: IsoDateSchema.safeParse(data.date).success ? (data.date as string) : null,
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

function resultOrNull(value: unknown): InspectionResult | null {
  const parsed = InspectionResultSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
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
