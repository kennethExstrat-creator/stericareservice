import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/modules/registry", async () => {
  const { TEST_REGISTRY } = await import("@/modules/_framework/__fixtures__/test-registry");
  return { MODULE_REGISTRY: TEST_REGISTRY, getModuleDefinition: (key: keyof typeof TEST_REGISTRY) => TEST_REGISTRY[key] };
});

import { POST as mockReportReceiver } from "@/app/api/dev/mock-ai-report/route";
import { requestAiReport } from "@/lib/ai";
import { createFakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import {
  IDS,
  makeInspectionRow,
  makeObjects,
  makePartObjects,
  makePartRow,
  makePartTables,
  makeTables,
} from "@/lib/export/__fixtures__/inspection";
import { ExportSchema } from "@/lib/schemas/export";
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
  it("says 'AI not connected' and offers the JSON download when no report service is set", async () => {
    vi.stubEnv("AI_REPORT_WEBHOOK_URL", "");
    const db = fake();
    expect(await sendInspectionToAiReport({ client: db.client, inspectionId: IDS.inspection, viewer: ADMIN })).toEqual({
      ok: false,
      reason: "not_connected",
      message: "AI not connected.",
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
      message: "The AI report was not made. The report service did not answer within 180 seconds.",
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

/* PO parts (lib/inspections/parts.ts): one report for all POs (Kenneth, 11 October 2026). */
describe("sendInspectionToAiReport for an inspection of several POs", () => {
  const FIRST_REPORT = "http://localhost:3000/api/dev/mock-ai-report?ref=INS-2026-0042";
  const PART_IDS = [IDS.inspection, IDS.part2, IDS.part3];

  function withParts(tables = makePartTables()) {
    return createFakeSupabase({ tables, objects: makePartObjects() });
  }

  function loggedOn(db: ReturnType<typeof withParts>) {
    return db.rpcCalls.map((call) => (call.args as { inspection_id: string; action: string }).inspection_id).sort();
  }

  it("posts the whole export, every PO in it, from any part, and stores the one report's link on every part", async () => {
    const db = withParts();
    const posted: unknown[] = [];
    const toReceiver: typeof fetch = async (input, init) => {
      posted.push(JSON.parse(String(init?.body)));
      return toMockReceiver(input, init);
    };
    const result = await sendInspectionToAiReport({
      client: db.client,
      inspectionId: IDS.part3,
      viewer: ADMIN,
      send: (doc) => requestAiReport(doc, { env: REPORT_ENV, fetch: toReceiver }),
    });
    expect(result).toEqual({ ok: true, reportUrl: FIRST_REPORT });

    // One request: the first part's export with the other parts in part order, as the receiver validated it.
    expect(posted).toHaveLength(1);
    const doc = ExportSchema.parse(posted[0]);
    expect(doc.refNo).toBe("INS-2026-0042");
    expect(doc.parts?.map((part) => part.refNo)).toEqual(["INS-2026-0043", "INS-2026-0044"]);

    expect(db.tables.inspections.map((row) => row.report_url)).toEqual([FIRST_REPORT, FIRST_REPORT, FIRST_REPORT]);
    expect(loggedOn(db)).toEqual([...PART_IDS].sort());
    expect(db.rpcCalls[0]).toMatchObject({
      args: {
        action: "ai_report.sent",
        changes: { reportUrl: FIRST_REPORT, parts: ["INS-2026-0042", "INS-2026-0043", "INS-2026-0044"] },
      },
    });
  });

  it("waits until every part is submitted or approved, naming the part that is not", async () => {
    const tables = makePartTables();
    tables.inspections = tables.inspections.map((row) => (row.id === IDS.part3 ? makePartRow(3, { status: "reopened" }) : row));
    const send = vi.fn();
    const result = await sendInspectionToAiReport({ client: withParts(tables).client, inspectionId: IDS.inspection, viewer: ADMIN, send });
    expect(result).toEqual({
      ok: false,
      reason: "not_reportable",
      message: "The AI report covers every PO of this inspection, and PO-0003 is not submitted or approved.",
    });
    expect(send).not.toHaveBeenCalled();
  });

  it("logs a failed report on every part and stores nothing", async () => {
    const db = withParts();
    const result = await sendInspectionToAiReport({
      client: db.client,
      inspectionId: IDS.inspection,
      viewer: ADMIN,
      send: async () => ({ ok: false, reason: "error", message: "The webhook answered HTTP 502." }),
    });
    expect(result).toMatchObject({ ok: false, reason: "report_failed" });
    expect(db.tables.inspections.map((row) => row.report_url)).toEqual([null, null, null]);
    expect(loggedOn(db)).toEqual([...PART_IDS].sort());
    expect(db.rpcCalls.every((call) => (call.args as { action: string }).action === "ai_report.failed")).toBe(true);
  });

  it("answers not found to someone who may not export it, from any part", async () => {
    const send = vi.fn();
    for (const inspectionId of PART_IDS) {
      const viewer = { id: IDS.otherInspector, role: "inspector" } as const;
      expect(await sendInspectionToAiReport({ client: withParts().client, inspectionId, viewer, send })).toMatchObject({
        ok: false,
        reason: "not_found",
      });
    }
    expect(send).not.toHaveBeenCalled();
  });
});
