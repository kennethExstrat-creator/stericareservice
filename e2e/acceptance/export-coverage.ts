import {
  isConfigTarget,
  isCustomTarget,
  isFieldTarget,
  isLabelTarget,
  isLayoutTarget,
  isTemplateTarget,
  MODULE_DICTIONARY,
  sourceFields,
  type FieldTarget,
  type SourceField,
  type SourceId,
  type SourceTarget,
} from "../../lib/coverage";
import type { ExportModule, InspectionExport } from "../../lib/schemas/export";

/* ------------------------------------------------------------------ *
 * Checks an inspection export (BUILD_SPEC 9.1) against a source report's
 * fields in the coverage inventory (lib/coverage/sources.ts): every target a
 * field maps to must be in the document the report is written from.
 *
 *   field     the module's entered data or computed values hold the key
 *             (inside the class or level it names, with the map key it
 *             names), for every ordered size where the field is per size;
 *             references and recorded people are on the document itself
 *   config    the module's exported settings hold it
 *   label     the module's title, or its labels, hold the caption
 *   custom    the custom module lists the field and holds its value
 *   template  the document carries the template value (the size list,
 *             the report title lines, the client logo, the unit)
 *   layout    the report draws it itself: nothing to carry
 *
 * "Present but empty" is reported apart: a key that is there with no value
 * (null or "") where the inspection was filled in.
 * ------------------------------------------------------------------ */

export type CoverageGap = { id: string; label: string; target: string; problem: string };

export type CoverageReport = {
  /** Source fields checked, and their targets. */
  fields: number;
  targets: number;
  /** Targets the report draws itself (page numbers, running headers, legends). */
  layout: number;
  gaps: CoverageGap[];
  /** Targets whose key is there with no value. */
  empty: CoverageGap[];
};

type Found = { path: string[]; value: unknown };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Every property named `key` anywhere under `root`, with its path. */
function findKey(root: unknown, key: string, path: string[] = []): Found[] {
  if (Array.isArray(root)) return root.flatMap((item, index) => findKey(item, key, [...path, String(index)]));
  if (!isRecord(root)) return [];
  const here = Object.prototype.hasOwnProperty.call(root, key) ? [{ path: [...path, key], value: root[key] }] : [];
  return [...here, ...Object.entries(root).flatMap(([name, value]) => findKey(value, key, [...path, name]))];
}

function isBlank(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

/** Whether a config value or map holds an entry for `key`: an object key, or a list entry with that code. */
function holdsKey(value: unknown, key: string): boolean {
  if (Array.isArray(value)) {
    return value.some((entry) => entry === key || (isRecord(entry) && [entry.code, entry.key, entry.value, entry.size].includes(key)));
  }
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

function describe(target: SourceTarget): string {
  if (isFieldTarget(target)) {
    return `${target.module}.${target.field}${target.group ? `[${target.group}]` : ""}${target.key ? `.${target.key}` : ""}`;
  }
  if (isConfigTarget(target)) return `${target.module}.config.${target.config}${target.key ? `.${target.key}` : ""}`;
  if (isLabelTarget(target)) return `${target.module}.label.${target.label}`;
  if (isCustomTarget(target)) return `custom.${target.custom}.${target.field}`;
  if (isTemplateTarget(target)) return `template.${target.template}`;
  return `layout: ${target.layout}`;
}

/** Ordered sizes: the keys of order_lots' sizes. */
function orderedSizes(doc: InspectionExport): string[] {
  const order = doc.modules.find((module) => module.key === "order_lots");
  const sizes = order && isRecord(order.data.sizes) ? Object.keys(order.data.sizes) : [];
  return sizes;
}

type Verdict = { ok: true; empty?: boolean } | { ok: false; problem: string };

function checkField(doc: InspectionExport, module: ExportModule, target: FieldTarget): Verdict {
  const spec = MODULE_DICTIONARY[target.module].data.find((field) => field.key === target.field);
  if (!spec) return { ok: false, problem: "not in the data dictionary" };

  // References and recorded people: the document itself names them.
  const column = "column" in spec ? spec.column : undefined;
  if (column === "inspections.inspector_id") {
    return isBlank(doc.inspector.name) ? { ok: false, problem: "no inspector on the document" } : { ok: true };
  }
  if (column === "inspections.manufacturer_id") {
    return doc.template.manufacturer ? { ok: true } : { ok: true, empty: true };
  }
  if (column === "inspections.client_id") {
    return doc.template.client ? { ok: true } : { ok: true, empty: true };
  }

  let found = [...findKey(module.data, target.field, ["data"]), ...findKey(module.computed, target.field, ["computed"])];
  if (target.group) found = found.filter((entry) => entry.path.includes(target.group!));
  if (found.length === 0) {
    return { ok: false, problem: `no "${target.field}"${target.group ? ` in ${target.group}` : ""} in the module's data or computed values` };
  }

  const per = spec.per as readonly string[];
  if (per.includes("size")) {
    const sizes = orderedSizes(doc);
    const missing = sizes.filter((size) => !found.some((entry) => entry.path.includes(size) || holdsKey(entry.value, size)));
    if (missing.length > 0) return { ok: false, problem: `missing for ordered size ${missing.join(", ")}` };
  }

  if (target.key) {
    const withKey = found.filter((entry) => holdsKey(entry.value, target.key!));
    if (withKey.length === 0) return { ok: false, problem: `"${target.field}" holds no "${target.key}"` };
    const values = withKey.map((entry) => (entry.value as Record<string, unknown>)[target.key!]);
    return { ok: true, empty: values.every(isBlank) };
  }
  return { ok: true, empty: found.every((entry) => isBlank(entry.value)) };
}

function checkTarget(doc: InspectionExport, field: SourceField, target: SourceTarget): Verdict | "layout" {
  if (isLayoutTarget(target)) return "layout";
  if (isTemplateTarget(target)) {
    const template = doc.template as Record<string, unknown>;
    switch (target.template) {
      case "report.titleLines":
        // The title block, line by line: each line is in the report title.
        return doc.template.reportTitle.includes(field.corrected ?? field.label)
          ? { ok: true }
          : { ok: false, problem: `the report title "${doc.template.reportTitle}" lacks the line` };
      case "report.showClientLogo":
        return "clientLogoUrl" in template ? { ok: true, empty: doc.template.clientLogoUrl === null } : { ok: false, problem: "no client logo" };
      case "sizes":
        return Array.isArray(template.sizes) ? { ok: true } : { ok: false, problem: "the export has no template size list (template.sizes)" };
      case "unit":
        return typeof template.unit === "string" ? { ok: true } : { ok: false, problem: "the export has no unit (template.unit)" };
    }
  }
  if (isCustomTarget(target)) {
    const custom = doc.custom.find((entry) => entry.key === target.custom);
    if (!custom) return { ok: false, problem: `no custom module ${target.custom}` };
    if (!custom.fields.some((entry) => entry.key === target.field)) return { ok: false, problem: "the field is not listed" };
    return target.field in custom.values ? { ok: true, empty: isBlank(custom.values[target.field]) } : { ok: false, problem: "no value" };
  }

  if (!isFieldTarget(target) && !isLabelTarget(target) && !isConfigTarget(target)) {
    return { ok: false, problem: "a kind of target this check does not know" };
  }
  const key = target.module;
  const section = doc.modules.find((entry) => entry.key === key);
  if (!section) {
    const excluded = doc.excludedModules.find((entry) => entry.key === key);
    return { ok: false, problem: excluded ? `module switched off: ${excluded.reason}` : "module not in the export" };
  }
  if (isLabelTarget(target)) {
    if (target.label === "title") return isBlank(section.title) ? { ok: false, problem: "no title" } : { ok: true };
    return isBlank(section.labels[target.label]) ? { ok: false, problem: `no "${target.label}" label` } : { ok: true };
  }
  if (isConfigTarget(target)) {
    const config = section.config ?? {};
    if (!(target.config in config)) return { ok: false, problem: `no "${target.config}" setting` };
    if (target.key && !holdsKey(config[target.config], target.key)) {
      return { ok: false, problem: `"${target.config}" holds no "${target.key}"` };
    }
    return { ok: true };
  }
  return isFieldTarget(target) ? checkField(doc, section, target) : { ok: false, problem: "unknown target" };
}

export function exportCoverage(doc: InspectionExport, source: SourceId): CoverageReport {
  const fields = sourceFields(source);
  const report: CoverageReport = { fields: fields.length, targets: 0, layout: 0, gaps: [], empty: [] };
  for (const field of fields) {
    for (const target of field.targets) {
      report.targets += 1;
      const verdict = checkTarget(doc, field, target);
      if (verdict === "layout") {
        report.layout += 1;
        continue;
      }
      const entry = { id: field.id, label: field.corrected ?? field.label, target: describe(target) };
      if (!verdict.ok) report.gaps.push({ ...entry, problem: verdict.problem });
      else if (verdict.empty) report.empty.push({ ...entry, problem: "present, no value" });
    }
  }
  return report;
}
