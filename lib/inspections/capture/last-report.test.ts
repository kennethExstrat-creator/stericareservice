// The Report page's Open Last Report (Kenneth, 27 October 2026): the link
// the AI report stored, and when it was made, from the audit row written
// with it.
import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { loadLastReport } from "./last-report";

const ID = "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e";
const URL = "https://reports.example.com/INS-2026-0042.pdf";

function sent(at: string, reportUrl: string, inspectionId = ID) {
  return { id: at, inspection_id: inspectionId, action: "ai_report.sent", at, changes: { reportUrl, inspectionUpdatedAt: at } };
}

describe("loadLastReport", () => {
  it("is the stored link with when it was made, in Malaysia time, from the newest audit row that names it", async () => {
    const db = createFakeSupabase({
      tables: {
        inspections: [{ id: ID, report_url: URL }],
        audit_log: [
          sent("2026-10-26T02:00:00.000Z", "https://reports.example.com/older.pdf"),
          sent("2026-10-27T06:05:00.000Z", URL),
          { id: "x", inspection_id: ID, action: "ai_review.requested", at: "2026-10-27T07:00:00.000Z", changes: {} },
          sent("2026-10-28T01:00:00.000Z", URL, "00000000-0000-4000-8000-000000000999"),
        ],
      },
    });
    expect(await loadLastReport(db.client, ID)).toEqual({ url: URL, madeAt: { iso: "2026-10-27T06:05:00.000Z", label: "27 Oct 2026, 14:05" } });
  });

  it("is the link alone when the audit log does not say when that link was made", async () => {
    const elsewhere = createFakeSupabase({
      tables: { inspections: [{ id: ID, report_url: URL }], audit_log: [sent("2026-10-27T06:05:00.000Z", "https://reports.example.com/other.pdf")] },
    });
    expect(await loadLastReport(elsewhere.client, ID)).toEqual({ url: URL, madeAt: null });
    const unread = createFakeSupabase({
      tables: { inspections: [{ id: ID, report_url: URL }], audit_log: [sent("2026-10-27T06:05:00.000Z", URL)] },
      failQuery: (query) => (query.table === "audit_log" ? { message: "permission denied" } : null),
    });
    expect(await loadLastReport(unread.client, ID)).toEqual({ url: URL, madeAt: null });
  });

  it("is nothing without a report link, or when the inspection cannot be read: the screen opens all the same", async () => {
    expect(await loadLastReport(createFakeSupabase({ tables: { inspections: [{ id: ID, report_url: null }] } }).client, ID)).toBeNull();
    expect(await loadLastReport(createFakeSupabase({ tables: { inspections: [] } }).client, ID)).toBeNull();
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const failing = createFakeSupabase({ failQuery: (query) => (query.table === "inspections" ? { message: "down" } : null) });
    expect(await loadLastReport(failing.client, ID)).toBeNull();
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});
