// Try It's choice of inspections (12 October 2026): the admin's own client,
// inspections with a conclusion, most recently updated first.
import { describe, expect, it, vi } from "vitest";
import type { ExportClient } from "@/lib/export";
import { loadSummaryPreviewTargets } from "./summary-runner";

function client(rows: unknown[] | null, error: { code: string; message: string } | null = null) {
  const calls: [string, unknown[]][] = [];
  const builder = {
    select: (...args: unknown[]) => (calls.push(["select", args]), builder),
    not: (...args: unknown[]) => (calls.push(["not", args]), builder),
    order: (...args: unknown[]) => (calls.push(["order", args]), builder),
    limit: (...args: unknown[]) => (calls.push(["limit", args]), Promise.resolve({ data: rows, error })),
  };
  return { client: { from: (table: string) => (calls.push(["from", [table]]), builder) } as unknown as ExportClient, calls };
}

describe("loadSummaryPreviewTargets", () => {
  it("lists the 10 latest inspections with a conclusion, labelled like the report", async () => {
    const { client: fake, calls } = client([
      { id: "a", ref_no: "INS-2026-2192", status: "draft", result: "pass" },
      { id: "b", ref_no: "INS-2026-2190", status: "approved", result: "hold" },
    ]);
    expect(await loadSummaryPreviewTargets(fake)).toEqual([
      { id: "a", refNo: "INS-2026-2192", status: "draft", result: "pass", label: "INS-2026-2192 · Draft · PASSED" },
      { id: "b", refNo: "INS-2026-2190", status: "approved", result: "hold", label: "INS-2026-2190 · Approved · HOLD" },
    ]);
    expect(calls).toEqual([
      ["from", ["inspections"]],
      ["select", ["id, ref_no, status, result"]],
      ["not", ["result", "is", null]],
      ["order", ["updated_at", { ascending: false }]],
      ["limit", [10]],
    ]);
  });

  it("answers none when the read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await loadSummaryPreviewTargets(client(null, { code: "500", message: "down" }).client)).toEqual([]);
  });
});
