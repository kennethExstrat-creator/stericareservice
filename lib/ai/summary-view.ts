// What Steri-AI reads to write the Inspection Summary (docs/AI.md,
// "Steri-AI Summary"; 12 October 2026): one inspection, compact. It is the
// prompt lab's view reading the record and its evaluation directly instead
// of the export, so nothing is signed and no link can leak. It keeps the
// report's own result lines, which already carry the key figures in the
// template's wording, and leaves out what a summary never needs: URLs, ids,
// emails, timestamps, the labels and config maps, raw readings, the
// signature and the Inspection Summary itself (sent only as
// <inspector_draft> when polishing). Pure, so every rule is unit-tested.
import { inspectorDecision } from "@/lib/export/conclusion";
import type { EvaluatedInspection } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import { isMediaVideoKey } from "@/lib/inspections/media-moves";
import { MEDIA_CATEGORIES, SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE, SOURCE_MEDIA_KEY } from "@/lib/inspections/source-documents";
import { IsoDateSchema, type InspectionResult, type InspectionStatus, type ProductType, type Standard } from "@/lib/schemas/common";
import type { ModuleStatus } from "@/lib/schemas/module-result";
import type { TemplateUnit } from "@/lib/schemas/template";
import { exportIssuesOf } from "@/lib/validation/issues";
import type { ModuleEvaluation } from "@/modules/_framework";
import { CONCLUSION_LABELS } from "@/modules/conclusion/config";
import { HEADER_LABELS, type HeaderField } from "@/modules/header/config";

/** The template's words for the three conclusions: PASSED, FAILED, HOLD. */
export type ResultWords = { pass: string; fail: string; hold: string };

export type SummaryViewSection = {
  /** As this inspection shows it. */
  title: string;
  status: ModuleStatus;
  /** The report's own result line, with its key figures. */
  summary: string;
  /** "status: result line" per ordered size. */
  perSize?: Record<string, string>;
  /** The computed headings that name the code letter and AQL, parts switched off left out. */
  details?: string[];
  /** Points the report raised about the goods. */
  warnings?: string[];
  /** While the inspection is a draft or reopened. */
  errors?: string[];
  /** The inspector's own comment. */
  comment?: string;
};

export type SummaryView = {
  refNo: string;
  status: InspectionStatus;
  reportTitle: string | null;
  /** "EN 455", "ASTM D6319"; null for a template's own. */
  standard: string | null;
  productType: ProductType | null;
  unit: TemplateUnit | null;
  /** The report header's details that are recorded, keyed by the template's labels. */
  order: Record<string, string>;
  /** The sizes ordered: the only sizes inspected. */
  sizesOrdered: string[];
  sections: SummaryViewSection[];
  sectionsSwitchedOff: { title: string; reason: string }[];
  customFields: { title: string; values: Record<string, string | number | boolean> }[];
  evidence: {
    photos: { total: number; byPlace: Record<string, number>; captions: { place: string; caption: string }[] };
    videos: number;
    documents: { kind: string; attachedTo: string }[];
  };
  conclusion: {
    words: ResultWords;
    /** The inspector's conclusion in the template's word; null while not chosen. */
    finalResult: string | null;
    suggestedResult: string | null;
    /** The sections behind the suggestion, by title. */
    suggestionReasons: { failed: string[]; notDone: string[]; warnings: string[] };
    remark: string | null;
    date: string | null;
    inspectedBy: string | null;
  };
};

/** Characters of JSON the view may take; captions go first, then details. */
export const SUMMARY_VIEW_MAX_CHARACTERS = 60_000;
export const SUMMARY_VIEW_MAX_CAPTIONS = 30;
export const SUMMARY_CAPTION_MAX_CHARACTERS = 200;

/** Warnings about the record, not the goods: never summary material (the conclusion block carries final_result_differs). */
const HOUSEKEEPING_WARNINGS: ReadonlySet<string> = new Set([
  "module_not_done",
  "defect_unmapped",
  "final_result_differs",
  "mapped_value_ignored",
]);

const STANDARD_NAMES: Readonly<Record<Standard, string | null>> = {
  EN455: "EN 455",
  ASTM_D6319: "ASTM D6319",
  ASTM_D3578: "ASTM D3578",
  ASTM_D3577: "ASTM D3577",
  custom: null,
};

const DOCUMENT_KINDS: Readonly<Record<InspectionRecord["files"][number]["kind"], string>> = {
  lab_report: "lab report",
  certificate: "certificate",
  other: "document",
};

/** The header's details a summary may name, in report order. */
const ORDER_FIELDS = [
  "poNo",
  "productName",
  "productCode",
  "factoryGloveCode",
  "client",
  "manufacturer",
  "inspectionDate",
  "mfgDate",
  "expiryDate",
] as const satisfies readonly HeaderField[];

const UNTAGGED = "Untagged";
const OTHER_PLACE = "Other";

const EDITABLE: ReadonlySet<InspectionStatus> = new Set(["draft", "reopened"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
}

/** Every computed `heading` (code letter and AQL), skipping parts switched off (include: false). */
function headings(value: unknown, depth = 0, found: string[] = []): string[] {
  if (depth > 4 || !isRecord(value) || value.include === false) return found;
  const heading = text(value.heading);
  if (heading && !found.includes(heading)) found.push(heading);
  for (const [key, child] of Object.entries(value)) if (key !== "heading") headings(child, depth + 1, found);
  return found;
}

/** The template's words for the conclusions, else the reports' (PASSED, FAILED, HOLD). */
export function resultWordsOf(evaluated: EvaluatedInspection): ResultWords {
  const labels = evaluated.report.modules.find((evaluation) => evaluation.key === "conclusion")?.labels ?? {};
  const word = (key: keyof ResultWords) => text(labels[key]) ?? CONCLUSION_LABELS[key];
  return { pass: word("pass"), fail: word("fail"), hold: word("hold") };
}

/**
 * The inspector's final result: the conclusion's, the row's copy standing in
 * where it holds none (inspectorDecision, as the export and the review).
 */
export function finalResultOf(record: Pick<InspectionRecord, "result" | "remarks">, evaluated: EvaluatedInspection): InspectionResult | null {
  const conclusion = evaluated.report.modules.find((evaluation) => evaluation.key === "conclusion");
  return inspectorDecision({ result: record.result, remarks: record.remarks }, conclusion?.data).result;
}

function orderOf(evaluated: EvaluatedInspection): Record<string, string> {
  const header = evaluated.report.modules.find((evaluation) => evaluation.key === "header");
  const data = isRecord(header?.data) ? header.data : {};
  const computed = isRecord(header?.computed) ? header.computed : {};
  const fields = isRecord(header?.config) && isRecord(header.config.fields) ? header.config.fields : {};
  const values: Readonly<Record<(typeof ORDER_FIELDS)[number], unknown>> = {
    poNo: data.poNo,
    productName: data.productName,
    productCode: data.productCode,
    factoryGloveCode: data.factoryGloveCode,
    client: computed.client ?? evaluated.client?.name,
    manufacturer: computed.manufacturer ?? evaluated.manufacturer?.name,
    inspectionDate: computed.inspectionDate ?? data.inspectionDate,
    mfgDate: computed.mfgDate ?? data.mfgDate,
    expiryDate: computed.expiryDate ?? data.expiryDate,
  };
  const order: Record<string, string> = {};
  for (const field of ORDER_FIELDS) {
    const value = text(values[field]);
    // A row the template switches off is not on the report.
    if (value === null || fields[field] === false) continue;
    order[text(header?.labels[field]) ?? HEADER_LABELS[field]] = value;
  }
  return order;
}

function sectionOf(evaluation: ModuleEvaluation, evaluated: EvaluatedInspection, status: InspectionStatus): SummaryViewSection {
  const { result } = evaluation;
  const issues = exportIssuesOf(evaluated.report.issues, evaluation.key);
  const warnings = [...new Set(issues.warnings.filter((issue) => !HOUSEKEEPING_WARNINGS.has(issue.code)).map((issue) => issue.message))];
  const errors = EDITABLE.has(status) ? [...new Set(issues.errors.map((issue) => issue.message))] : [];
  const perSize = Object.entries(result.perSize ?? {}).filter(([size]) => evaluated.context.sizes.includes(size));
  const details = headings(evaluation.computed);
  const comment = text(evaluation.comment);
  return {
    title: evaluation.title,
    status: result.status,
    summary: result.summary,
    ...(perSize.length > 0
      ? { perSize: Object.fromEntries(perSize.map(([size, entry]) => [size, entry.summary ? `${entry.status}: ${entry.summary}` : entry.status])) }
      : {}),
    ...(details.length > 0 ? { details } : {}),
    ...(warnings.length > 0 ? { warnings } : {}),
    ...(errors.length > 0 ? { errors } : {}),
    ...(comment ? { comment } : {}),
  };
}

/** label: value for each recorded field, per size as "label (size)" for a table or a grid per size. */
function customValues(fields: readonly { key: string; label: string }[], values: Record<string, unknown>): Record<string, string | number | boolean> {
  const found: Record<string, string | number | boolean> = {};
  const put = (label: string, value: unknown) => {
    if (typeof value === "boolean") found[label] = value;
    else if (typeof value === "number" && Number.isFinite(value)) found[label] = value;
    else if (typeof value === "string" && value.trim() !== "") found[label] = value.trim();
  };
  for (const field of fields) put(field.label, values[field.key]);
  if (isRecord(values.sizes)) {
    for (const [size, record] of Object.entries(values.sizes)) {
      if (isRecord(record)) for (const field of fields) put(`${field.label} (${size})`, record[field.key]);
    }
  }
  return found;
}

/** Where a photo or file sits: its module's or custom module's title, Media's category, Source Documents, or Untagged. */
function placeNames(evaluated: EvaluatedInspection): (key: string | null) => string {
  const titles = new Map<string, string>();
  for (const evaluation of evaluated.report.modules) titles.set(evaluation.key, evaluation.title);
  for (const excluded of evaluated.report.excluded) titles.set(excluded.key, excluded.title);
  for (const { custom } of evaluated.report.custom) titles.set(custom.key, custom.title);
  for (const category of MEDIA_CATEGORIES) titles.set(category.key, category.title);
  titles.set(SOURCE_DOCUMENTS_KEY, SOURCE_DOCUMENTS_TITLE);
  titles.set(SOURCE_MEDIA_KEY, "Media (Other)");
  return (key) => {
    const tag = key?.trim() ?? "";
    return tag === "" ? UNTAGGED : (titles.get(tag) ?? OTHER_PLACE);
  };
}

/** At most `max` characters, never half an emoji. */
function cut(value: string, max: number): string {
  const characters = Array.from(value);
  return characters.length <= max ? value : characters.slice(0, max).join("");
}

function evidenceOf(record: InspectionRecord, evaluated: EvaluatedInspection): SummaryView["evidence"] {
  const placeOf = placeNames(evaluated);
  const photos = [...record.photos].sort(
    (a, b) => (a.takenAt ?? a.createdAt).localeCompare(b.takenAt ?? b.createdAt) || a.id.localeCompare(b.id),
  );
  const byPlace: Record<string, number> = {};
  for (const photo of photos) byPlace[placeOf(photo.moduleKey)] = (byPlace[placeOf(photo.moduleKey)] ?? 0) + 1;
  const captions = photos
    .flatMap((photo) => {
      const caption = text(photo.caption);
      return caption ? [{ place: placeOf(photo.moduleKey), caption: cut(caption, SUMMARY_CAPTION_MAX_CHARACTERS) }] : [];
    })
    .slice(0, SUMMARY_VIEW_MAX_CAPTIONS);
  const videos = record.files.filter((file) => isMediaVideoKey(file.moduleKey));
  const documents = record.files
    .filter((file) => !isMediaVideoKey(file.moduleKey))
    .map((file) => ({ kind: DOCUMENT_KINDS[file.kind] ?? "document", attachedTo: placeOf(file.moduleKey) }));
  return { photos: { total: photos.length, byPlace, captions }, videos: videos.length, documents };
}

function conclusionOf(record: InspectionRecord, evaluated: EvaluatedInspection): SummaryView["conclusion"] {
  const words = resultWordsOf(evaluated);
  const conclusion = evaluated.report.modules.find((evaluation) => evaluation.key === "conclusion");
  const data = isRecord(conclusion?.data) ? conclusion.data : {};
  const decision = inspectorDecision({ result: record.result, remarks: record.remarks }, data);
  const { suggested } = evaluated.report;
  const titles = new Map(evaluated.report.modules.map((evaluation) => [evaluation.key, evaluation.title]));
  const titleOf = (key: string) => titles.get(key as ModuleEvaluation["key"]) ?? key.replaceAll("_", " ");
  return {
    words,
    finalResult: decision.result ? words[decision.result] : null,
    suggestedResult: words[suggested.result],
    suggestionReasons: {
      failed: suggested.failed.map(titleOf),
      notDone: suggested.notDone.map(titleOf),
      warnings: suggested.warned.map(titleOf),
    },
    remark: decision.remarks,
    date: IsoDateSchema.safeParse(data.date).success ? (data.date as string) : null,
    // The profile's full name only: the evaluation's name falls back to the email
    // (inspectorRef), which never goes to Steri-AI (review, 12 October 2026).
    inspectedBy: text(record.inspector?.fullName),
  };
}

/**
 * The view within SUMMARY_VIEW_MAX_CHARACTERS of JSON: the captions go
 * first, then the details. What is left is sent whole.
 */
export function capSummaryView(view: SummaryView): SummaryView {
  const fits = (candidate: SummaryView) => JSON.stringify(candidate).length <= SUMMARY_VIEW_MAX_CHARACTERS;
  if (fits(view)) return view;
  const noCaptions: SummaryView = { ...view, evidence: { ...view.evidence, photos: { ...view.evidence.photos, captions: [] } } };
  if (fits(noCaptions)) return noCaptions;
  return {
    ...noCaptions,
    sections: noCaptions.sections.map((section) => {
      const rest = { ...section };
      delete rest.details;
      return rest;
    }),
  };
}

/** The inspection as Steri-AI reads it for the summary. */
export function summaryViewOf({ record, evaluated }: { record: InspectionRecord; evaluated: EvaluatedInspection }): SummaryView {
  const template = record.template;
  const view: SummaryView = {
    refNo: record.refNo,
    status: record.status,
    reportTitle: text(evaluated.template.report.title),
    standard: template ? STANDARD_NAMES[template.standard] : null,
    productType: template?.productType ?? null,
    unit: evaluated.template.unit ?? null,
    order: orderOf(evaluated),
    sizesOrdered: [...evaluated.context.sizes],
    sections: evaluated.report.modules
      .filter((evaluation) => evaluation.key !== "header" && evaluation.key !== "conclusion")
      .map((evaluation) => sectionOf(evaluation, evaluated, record.status)),
    sectionsSwitchedOff: evaluated.report.excluded.map(({ title, reason }) => ({ title, reason })),
    customFields: evaluated.report.custom
      .map(({ custom, values }) => ({ title: custom.title, values: customValues(custom.fields, values) }))
      .filter((custom) => Object.keys(custom.values).length > 0),
    evidence: evidenceOf(record, evaluated),
    conclusion: conclusionOf(record, evaluated),
  };
  return capSummaryView(view);
}
