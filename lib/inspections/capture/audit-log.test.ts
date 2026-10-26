import { describe, expect, it } from "vitest";
import type { AuditRow } from "@/lib/inspections/review/audit";
import { auditLogEntries } from "./audit-log";
import { PASS_FAIL_CHANGED, SPEC_CHANGED } from "./dimension-events";

const INSPECTOR = "00000000-0000-4000-8000-000000000001";
const ADMIN = "00000000-0000-4000-8000-000000000002";

let nextId = 0;
const row = (action: string, changes: unknown, at: string, actorId: string | null = INSPECTOR): AuditRow => ({
  id: (nextId += 1),
  action,
  changes,
  at,
  actorId,
  actor: actorId === INSPECTOR ? { full_name: "Test Inspector", email: null } : null,
});

const WORDS = {
  people: { viewerId: INSPECTOR, viewerName: "Test Inspector", inspectorId: INSPECTOR, inspectorName: "Test Inspector" },
  moduleTitle: (key: string) => ({ dimensions: "Dimension", packing_config: "Packing Configuration" })[key] ?? key,
};

const PASS_FAIL = {
  module: "dimensions",
  moduleTitle: "Dimension",
  size: "M",
  column: "width",
  columnLabel: "Width",
  from: null,
  to: "fail",
  calculated: "pass",
  comment: "Torn cuffs on 3 gloves.",
  previousComment: null,
};

const SPEC = {
  module: "dimensions",
  moduleTitle: "Dimension",
  size: "M",
  column: "fingerThickness",
  columnLabel: "Finger Thickness",
  from: { kind: "tolerance", nominal: 0.18, tolerance: 0.04 },
  to: { kind: "na" },
  fromText: "0.18 ± 0.04",
  toText: "NA",
  template: { kind: "tolerance", nominal: 0.18, tolerance: 0.04 },
  change: "set",
};

describe("auditLogEntries: the Audit Log page in plain words (Kenneth, 26 October 2026)", () => {
  it("lists the rows newest first, with Malaysia's time and who acted", () => {
    const entries = auditLogEntries(
      [
        row("created", { ref_no: "SC-2026-0001" }, "2026-10-26T01:00:00.000Z"),
        row("status_changed", { from: "draft", to: "submitted" }, "2026-10-26T09:30:00.000Z"),
      ],
      WORDS,
    );
    expect(entries.map((entry) => entry.title)).toEqual(["Submitted", "Inspection Created"]);
    expect(entries[0]).toMatchObject({ when: "26 Oct 2026, 17:30", who: "Test Inspector", at: "2026-10-26T09:30:00.000Z" });
    expect(entries[1]).toMatchObject({ detail: "SC-2026-0001", special: false });
  });

  it("marks a P/F set by hand as a special action, with the size, the column, the readings' result and the comment", () => {
    const [set] = auditLogEntries([row(PASS_FAIL_CHANGED, PASS_FAIL, "2026-10-26T04:00:00.000Z")], WORDS);
    expect(set).toMatchObject({
      title: "P/F Changed by the Inspector",
      detail: "Dimension, Size M, Width: set to Failed; the readings give Passed. Comment: Torn cuffs on 3 gloves.",
      special: true,
    });
    const [changed] = auditLogEntries(
      [row(PASS_FAIL_CHANGED, { ...PASS_FAIL, from: "fail", to: "pass", comment: "Measured again." }, "2026-10-26T04:05:00.000Z")],
      WORDS,
    );
    expect(changed.detail).toBe("Dimension, Size M, Width: Failed changed to Passed; the readings give Passed. Comment: Measured again.");
    const [back] = auditLogEntries(
      [row(PASS_FAIL_CHANGED, { ...PASS_FAIL, from: "pass", to: null, comment: null }, "2026-10-26T04:10:00.000Z")],
      WORDS,
    );
    expect(back.detail).toBe("Dimension, Size M, Width: back to the readings' result (Passed), was Passed.");
  });

  it("says a spec changed for the inspection in a sentence: from what to what, or back to the template's", () => {
    const [set] = auditLogEntries([row(SPEC_CHANGED, SPEC, "2026-10-26T04:00:00.000Z")], WORDS);
    expect(set).toMatchObject({
      title: "Spec Changed",
      detail: "Size M Finger Thickness spec changed from 0.18 ± 0.04 to NA.",
      special: false,
    });
    const [cleared] = auditLogEntries(
      [row(SPEC_CHANGED, { ...SPEC, from: { kind: "na" }, to: SPEC.template, fromText: "NA", toText: "0.18 ± 0.04", change: "cleared" }, "2026-10-26T04:05:00.000Z")],
      WORDS,
    );
    expect(cleared.detail).toBe("Size M Finger Thickness spec changed from NA back to the template's 0.18 ± 0.04.");
  });

  it("names who acted on a row the service role wrote for them (`by`), an admin unnamed, and the system", () => {
    const entries = auditLogEntries(
      [
        row("source_document_read", { file: "form.jpg", modules: ["dimensions"], by: INSPECTOR }, "2026-10-26T03:00:00.000Z", null),
        row("module_override", { module: "packing_config", include: false, reason: "Not in this order." }, "2026-10-26T02:00:00.000Z", ADMIN),
        row("deleted_something", { note: "Cleared by a job." }, "2026-10-26T01:00:00.000Z", null),
      ],
      WORDS,
    );
    expect(entries.map((entry) => [entry.who, entry.title, entry.detail])).toEqual([
      ["Test Inspector", "Steri-AI Read a Source Document", "form.jpg; filled Dimension"],
      ["An admin", "Step Switched Off", "Packing Configuration: Not in this order."],
      ["The system", "Deleted Something", "Cleared by a job."],
    ]);
  });
});
