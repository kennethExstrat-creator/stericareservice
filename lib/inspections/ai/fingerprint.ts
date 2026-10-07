import "server-only";
import { createHash } from "node:crypto";
import type { InspectionRecord } from "@/lib/export";

/* ------------------------------------------------------------------ *
 * Which version of an inspection an AI second opinion is about (BUILD_SPEC
 * 9.2: "a new review is kept for each version of the inspection"). A
 * version is the inspection's content, what the review depends on: the
 * entered data (the conclusion's final result and remark among it, which
 * the row copies into `result` and `remarks`), the modules switched off for
 * it, the template version it uses, and its lab reports and certificates,
 * which decide module results (docs/MODULES.md 10.1). Not the row's
 * updated_at: approving the inspection, reopening it or storing its report
 * link saves the row too, and an opinion is no less about what is there.
 * Photos are left out: they decide no result, and choosing report photos is
 * part of an admin's review.
 *
 * Stored as ai_reviews.inspection_fingerprint (migration 20261007113245).
 * ------------------------------------------------------------------ */

/** What a fingerprint looks like: SHA-256, lowercase hex. */
export const FINGERPRINT_PATTERN = /^[0-9a-f]{64}$/;

export type InspectionContent = Pick<
  InspectionRecord,
  "data" | "moduleOverrides" | "result" | "remarks" | "template" | "files"
>;

/**
 * SHA-256 of the inspection's content, the same whatever order Postgres
 * returns JSON keys and files in.
 */
export function inspectionFingerprint(record: InspectionContent): string {
  const content = {
    data: record.data ?? null,
    moduleOverrides: record.moduleOverrides ?? null,
    result: record.result ?? null,
    remarks: record.remarks ?? null,
    templateId: record.template?.id ?? null,
    files: record.files
      .map(({ id, moduleKey, kind }) => ({ id, moduleKey, kind }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  };
  return createHash("sha256").update(canonicalJson(content)).digest("hex");
}

/** JSON with every object's keys sorted, at every level; undefined values are dropped, as JSON.stringify does. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortKeys(value)) ?? "null";
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record)
      .sort()
      .map((key) => [key, sortKeys(record[key])]),
  );
}
