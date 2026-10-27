import type { EntityRef } from "@/lib/schemas/common";
import { ResolvedTemplateSchema, type ResolvedTemplate } from "@/lib/schemas/template";
import { applyModuleOverrides, parseModuleOverrides } from "@/lib/templates";
import { validateInspection, type ValidationReport } from "@/lib/validation";
import { personLabel } from "@/lib/inspections/format";
import {
  buildInspectionView,
  InspectionDataSchema,
  type InspectionContext,
  type InspectionData,
  type InspectionFileRef,
  type InspectionMeta,
  type ModuleRegistry,
} from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { InspectionRecord } from "./record";

/* ------------------------------------------------------------------ *
 * The inspection run through the module framework, as the capture
 * screen and submit see it (docs/MODULES.md section 13): the template
 * version with this inspection's overrides applied and its titles as
 * the inspection shows them, the context, and every module's result,
 * computed values, issues and comment. Pure: the registry is passed
 * in, so tests can use the framework's test modules.
 * ------------------------------------------------------------------ */

export type EvaluatedInspection = {
  /**
   * The inspection's copy of its template version: modules switched off for
   * it are excluded, and a count in a title is the inspection's (withShownTitles).
   */
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

  const effective = applyModuleOverrides(resolved.data, parseModuleOverrides(record.moduleOverrides));
  const inspector = inspectorRef(record);
  const client = record.client ? { id: record.client.id, name: record.client.name } : null;
  const manufacturer = record.manufacturer ? { id: record.manufacturer.id, name: record.manufacturer.name } : null;
  const meta = inspectionMeta({ refNo: record.refNo, inspectionDate: record.inspectionDate, inspector, client, manufacturer }, record.files);
  const { template, context } = buildInspectionView({ template: effective, data: data.data, meta }, registry);
  const report = validateInspection(data.data, template, context, registry);
  return { ok: true, evaluated: { template, data: data.data, context, report, inspector, client, manufacturer } };
}

/**
 * What the context knows about the inspection itself, with its lab reports
 * and certificates (`files`, docs/MODULES.md 10.1 and 13): with them a module
 * tells a file it keeps by id that has since been deleted (missing: a
 * warning, and tensile not done) from one that is attached, and counts a lab
 * report added in the gallery, which keeps no id. `files` null means not
 * known (a read that failed), which the framework takes as attached; an
 * empty list means the inspection has none.
 */
export function inspectionMeta(
  meta: Omit<InspectionMeta, "files">,
  files: readonly InspectionFileRef[] | null,
): InspectionMeta {
  return { ...meta, files: files === null ? null : files.map(fileRef) };
}

/** An inspection_files row (a FileRecord, say) as the context knows it: id, module and kind only. */
export function fileRef({ id, moduleKey, kind }: InspectionFileRef): InspectionFileRef {
  return { id, moduleKey, kind };
}

/** The inspector by name, else email; the id alone never shows. */
export function inspectorRef(record: Pick<InspectionRecord, "inspectorId" | "inspector">): EntityRef {
  const name = record.inspector
    ? personLabel({ full_name: record.inspector.fullName, email: record.inspector.email })
    : null;
  return { id: record.inspectorId, name: name ?? "Unknown inspector" };
}
