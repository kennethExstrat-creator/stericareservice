import { describe, expect, it } from "vitest";
import { stdEgRecord } from "@/lib/export/__fixtures__/std-eg";
import type { InspectionRecord } from "@/lib/export/record";
import { canonicalJson, FINGERPRINT_PATTERN, inspectionFingerprint } from "./fingerprint";

function fingerprint(overrides: Partial<InspectionRecord> = {}): string {
  return inspectionFingerprint(stdEgRecord(overrides));
}

/** The same JSON with every object's keys in reverse order, as another reader might return it. */
function reversedKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reversedKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .reverse()
      .map(([key, entry]) => [key, reversedKeys(entry)]),
  );
}

describe("inspectionFingerprint", () => {
  it("is a SHA-256 in lowercase hex, the same for the same content", () => {
    expect(fingerprint()).toMatch(FINGERPRINT_PATTERN);
    expect(fingerprint()).toBe(fingerprint());
  });

  it("does not depend on the order JSON keys or files come back in", () => {
    const record = stdEgRecord();
    const reordered = {
      ...record,
      data: reversedKeys(record.data),
      moduleOverrides: reversedKeys({ dimensions: { reason: "Calipers out.", by: "a", at: "b" } }),
      files: [...record.files, { ...record.files[0], id: "00000000-0000-4000-8000-000000000499" }].reverse(),
    };
    const ordered = {
      ...record,
      moduleOverrides: { dimensions: { at: "b", by: "a", reason: "Calipers out." } },
      files: [...record.files, { ...record.files[0], id: "00000000-0000-4000-8000-000000000499" }],
    };
    expect(inspectionFingerprint(reordered)).toBe(inspectionFingerprint(ordered));
  });

  it("stays the same when only the save, the status, the report link or the photos change", () => {
    const record = stdEgRecord();
    const saved: InspectionRecord = {
      ...record,
      status: "approved",
      updatedAt: "2025-04-13T10:00:00.000000+00:00",
      approvedAt: "2025-04-13T10:00:00.000000+00:00",
      reportUrl: "https://reports.example.com/INS-2025-0001.pdf",
      photos: record.photos.map((photo) => ({ ...photo, includeInReport: !photo.includeInReport })).slice(1),
    };
    expect(inspectionFingerprint(saved)).toBe(fingerprint());
  });

  it("stays the same whatever the Report page's options are: how the report is laid out is nothing a review reads (27 October 2026)", () => {
    const record = stdEgRecord();
    const withOptions: InspectionRecord = {
      ...record,
      data: { ...(record.data as object), report: { pageSize: "letter", omittedSteps: ["weight"], includePhotos: false } },
    };
    expect(inspectionFingerprint(withOptions)).toBe(fingerprint());
  });

  it("changes with anything a review depends on", () => {
    const record = stdEgRecord();
    const data = record.data as { modules: Record<string, Record<string, unknown>>; custom: object };
    const changed: Partial<InspectionRecord>[] = [
      { data: { ...data, modules: { ...data.modules, weight: { ...data.modules.weight, comment: "Weighed twice." } } } },
      { moduleOverrides: { dimensions: { reason: "Calipers out.", by: "00000000-0000-4000-8000-000000000102", at: "2025-04-11T08:00:00Z" } } },
      { result: "hold" },
      { remarks: "Waiting for the lab." },
      { template: { ...record.template!, id: "00000000-0000-4000-8000-000000000602" } },
      // A lab report deleted, or added in the gallery.
      { files: [] },
      { files: [...record.files, { ...record.files[0], id: "00000000-0000-4000-8000-000000000499" }] },
      { files: [{ ...record.files[0], kind: "certificate" }] },
    ];
    const prints = changed.map((overrides) => fingerprint(overrides));
    expect(new Set([fingerprint(), ...prints]).size).toBe(changed.length + 1);
  });
});

describe("canonicalJson", () => {
  it("sorts keys at every level, keeps array order and drops undefined values like JSON.stringify", () => {
    expect(canonicalJson({ b: 1, a: { d: [3, { f: 1, e: 2 }], c: undefined } })).toBe('{"a":{"d":[3,{"e":2,"f":1}]},"b":1}');
    expect(canonicalJson(undefined)).toBe("null");
    expect(canonicalJson(null)).toBe("null");
  });
});
