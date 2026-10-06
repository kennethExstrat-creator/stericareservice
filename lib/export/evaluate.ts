import type { EntityRef } from "@/lib/schemas/common";
import { ResolvedTemplateSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates";
import { validateInspection, type ValidationReport } from "@/lib/validation";
import { manufacturerLabel, personLabel } from "@/lib/inspections/format";
import {
  buildInspectionContext,
  InspectionDataSchema,
  type InspectionContext,
  type InspectionData,
  type InspectionMeta,
  type ModuleRegistry,
} from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { FileRecord, InspectionRecord } from "./record";

/* ------------------------------------------------------------------ *
 * The inspection run through the module framework, as the capture
 * screen and submit see it (docs/MODULES.md section 13): the template
 * version with this inspection's overrides applied, the context, and
 * every module's result, computed values, issues and comment. Pure: the
 * registry is passed in, so tests can use the framework's test modules.
 * ------------------------------------------------------------------ */

export type EvaluatedInspection = {
  /** The inspection's copy of its template version: modules switched off for it are excluded. */
  template: ResolvedTemplate;
  data: InspectionData;
  context: InspectionContext;
  report: ValidationReport;
  inspector: EntityRef;
  client: EntityRef | null;
  manufacturer: EntityRef | null;
};

export type EvaluateResult =
  | { ok: true; evaluated: EvaluatedInspection }
  | { ok: false; reason: "unreadable_template" | "unreadable_data"; message: string };

export function evaluateRecord(record: InspectionRecord, registry: ModuleRegistry = MODULE_REGISTRY): EvaluateResult {
  const resolved = ResolvedTemplateSchema.safeParse(record.template?.resolved);
  if (!record.template || !resolved.success) {
    const which = record.template ? `${record.template.code} version ${record.template.version}` : "its template";
    return {
      ok: false,
      reason: "unreadable_template",
      message: `Inspection ${record.refNo} uses ${which}, which could not be read.`,
    };
  }
  const data = InspectionDataSchema.safeParse(record.data);
  if (!data.success) {
    return { ok: false, reason: "unreadable_data", message: `The saved data of inspection ${record.refNo} could not be read.` };
  }

  const template = applyModuleOverrides(resolved.data, parseModuleOverrides(record.moduleOverrides));
  const inspector = inspectorRef(record);
  const client = record.client ? { id: record.client.id, name: record.client.name } : null;
  const manufacturer = record.manufacturer
    ? { id: record.manufacturer.id, name: manufacturerLabel({ name: record.manufacturer.name, factory_name: record.manufacturer.factoryName }) }
    : null;
  const meta = inspectionMeta({ refNo: record.refNo, inspectionDate: record.inspectionDate, inspector, client, manufacturer }, record.files);
  const context = buildInspectionContext({ template, data: data.data, meta }, registry);
  const report = validateInspection(data.data, template, context, registry);
  return { ok: true, evaluated: { template, data: data.data, context, report, inspector, client, manufacturer } };
}

/** An inspection_files row as the context knows it (the framework's InspectionFileRef). */
export type InspectionFileMeta = { id: string; moduleKey: string | null; kind: FileRecord["kind"] };

/** InspectionMeta with the inspection's files, which the framework reads from phase 3 on. */
export type InspectionMetaWithFiles = InspectionMeta & { files?: readonly InspectionFileMeta[] | null };

/**
 * What the context knows about the inspection itself, with its lab reports
 * and certificates (`files`, docs/MODULES.md 10.1): with them, a module can
 * tell a file it keeps by id that has since been deleted (missing) from one
 * that is attached. `files` null means not known (a read that failed), which
 * the framework takes as attached; an empty list means the inspection has
 * none. A framework that does not read `files` yet ignores it.
 */
export function inspectionMeta(
  meta: InspectionMeta,
  files: readonly Pick<FileRecord, "id" | "moduleKey" | "kind">[] | null,
): InspectionMetaWithFiles {
  return { ...meta, files: files === null ? null : files.map(({ id, moduleKey, kind }) => ({ id, moduleKey, kind })) };
}

/** The inspector by name, else email; the id alone never shows. */
export function inspectorRef(record: Pick<InspectionRecord, "inspectorId" | "inspector">): EntityRef {
  const name = record.inspector
    ? personLabel({ full_name: record.inspector.fullName, email: record.inspector.email })
    : null;
  return { id: record.inspectorId, name: name ?? "Unknown inspector" };
}
