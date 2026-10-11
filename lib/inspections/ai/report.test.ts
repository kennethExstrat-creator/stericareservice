import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { POST as mockReportReceiver } from "@/app/api/dev/mock-ai-report/route";
import { requestAiReport } from "@/lib/ai";
import { createFakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { IDS, makeInspectionRow, makeObjects, makeTables } from "@/lib/export/__fixtures__/inspection";
import { NOT_REPORTABLE } from "./panel-model";
import { sendInspectionToAiReport } from "./report";

const ADMIN = { id: IDS.admin, role: "admin" } as const;
const REPORT_URL = "https://reports.test/INS-2026-0042.pdf";
const REPORT_ENV = { AI_REPORT_WEBHOOK_URL: "http://localhost:3000/api/dev/mock-ai-report" };

function fake(tables = makeTables()) {
  return createFakeSupabase({ tables, objects: makeObjects() });
}

/** Routes the webhook POST straight into the mock report receiver, which validates the export. */
const toMockReceiver: typeof fetch = async (input, init) => mockReportReceiver(new Request(input, init));

beforeEach(() => {
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("AI_WEBHOOK_SECRET", "");
  vi.stubEnv("AI_REPORT_WEBHOOK_URL", REPORT_ENV.AI_REPORT_WEBHOOK_URL);
  vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("sendInspectionToAiReport", () => {
  it("says 'Steri-AI not connected' and offers the JSON download when no report service is set", async () => {
    vi.stubEnv("AI_REPORT_WEBHOOK_URL", "");
    const db = fake();
    expect(await sendInspectionToAiReport({ client: db.client, inspectionId: IDS.inspection, viewer: ADMIN })).toEqual({
      ok: false,
      reason: "not_connected",
      message: "Steri-AI not connected.",
      downloadHref: `/api/inspections/${IDS.inspection}/export`,
    });
    expect(db.queries).toEqual([]);
  });

  it("posts the export to the report service and stores the link it answers with", async () => {
    const db = fake();
    const result = await sendInspectionToAiReport({
      client: db.client,
      inspectionId: IDS.inspection,
      viewer: ADMIN,
      send: (doc) => requestAiReport(doc, { env: REPORT_ENV, fetch: toMockReceiver }),
    });
    expect(result).toEqual({
      ok: true,
      reportUrl: "http://localhost:3000/api/dev/mock-ai-report?ref=INS-2026-0042",
    });
    expect(db.tables.inspections[0].report_url).toBe("http://localhost:3000/api/dev/mock-ai-report?ref=INS-2026-0042");
    expect(db.rpcCalls).toEqual([
      expect.objectContaining({ args: expect.objectContaining({ action: "ai_report.sent" }) }),
    ]);
  });

  it("works for approved inspections too, and never for drafts", async () => {
    const approved = fake({ ...makeTables(), inspections: [makeInspectionRow({ status: "approved" })] });
    const send = vi.fn(async () => ({ ok: true as const, reportUrl: REPORT_URL }));
    expect(await sendInspectionToAiReport({ client: approved.client, inspectionId: IDS.inspection, viewer: ADMIN, send })).toEqual({
      ok: true,
      reportUrl: REPORT_URL,
    });

    const draft = fake({ ...makeTables(), inspections: [makeInspectionRow({ status: "draft" })] });
    expect(await sendInspectionToAiReport({ client: draft.client, inspectionId: IDS.inspection, viewer: ADMIN, send })).toEqual({
      ok: false,
      reason: "not_reportable",
      message: NOT_REPORTABLE,
    });
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("passes on the report service's failure, logs it, and stores nothing", async () => {
    const db = fake();
    const result = await sendInspectionToAiReport({
      client: db.client,
      inspectionId: IDS.inspection,
      viewer: ADMIN,
      send: async () => ({ ok: false, reason: "timeout", message: "The report service did not answer within 180 seconds." }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "report_failed",
      message: "Steri-AI's report was not made. The report service did not answer within 180 seconds.",
    });
    expect(db.tables.inspections[0].report_url).toBeNull();
    expect(db.rpcCalls[0]).toMatchObject({ args: { action: "ai_report.failed", changes: { reason: "timeout" } } });
  });

  it("gives the link when the report was made but could not be saved", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const db = createFakeSupabase({
      tables: makeTables(),
      objects: makeObjects(),
      failQuery: (query) =>
        query.table === "inspections" && query.operation === "update" ? { code: "42501", message: "denied" } : null,
    });
    const result = await sendInspectionToAiReport({
      client: db.client,
      inspectionId: IDS.inspection,
      viewer: ADMIN,
      send: async () => ({ ok: true, reportUrl: REPORT_URL }),
    });
    expect(result).toEqual({
      ok: false,
      reason: "database_error",
      message: `The report was made but its link could not be saved. Open it here: ${REPORT_URL}`,
    });
  });

  it("answers not found to someone who may not export the inspection", async () => {
    const send = vi.fn();
    const result = await sendInspectionToAiReport({
      client: fake().client,
      inspectionId: IDS.inspection,
      viewer: { id: IDS.otherInspector, role: "inspector" },
      send,
    });
    expect(result).toMatchObject({ ok: false, reason: "not_found" });
    expect(send).not.toHaveBeenCalled();
  });
});
