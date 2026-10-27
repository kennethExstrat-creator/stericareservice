// The Steri-AI Summary button's Server Action (12 October 2026), a public
// endpoint: who may ask, what must match before Claude is called, what is
// recorded, and that it never writes the inspection. The inspection is
// the STD_EG example in a fake Supabase client; Claude (writeSummary) and
// the cost recorder are mocked.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: () => true }));
vi.mock("@/lib/ai/settings", () => ({ loadSummarySetup: vi.fn() }));
vi.mock("@/lib/ai/summary-writer", () => ({ writeSummary: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsageLater: vi.fn() }));

import { loadSummarySetup } from "@/lib/ai/settings";
import { writeSummary, type SummaryOutcome } from "@/lib/ai/summary-writer";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction } from "@/lib/auth/session";
import { createFakeSupabase, type FakeSupabase } from "@/lib/export/__fixtures__/fake-supabase";
import { STD_EG_IDS, stdEgRecord, stdEgTables } from "@/lib/export/__fixtures__/std-eg";
import type { InspectionRecord } from "@/lib/export/record";
import { normaliseData } from "@/lib/inspections/capture/load";
import { summaryBasisHash } from "@/lib/inspections/capture/summary-basis";
import { contentHash } from "@/lib/offline/stable-json";
import type { InspectionData } from "@/modules/_framework";
import { DEFAULT_SUMMARY_STYLE, SummaryStyleSchema } from "@/lib/schemas/summary-style";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { draftInspectionSummary } from "./summary-actions";

const INSPECTOR = { id: STD_EG_IDS.inspector, email: "inspector@test.local", fullName: "Inspector A", role: "inspector" as const };
const ADMIN = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };
const LEAD = { id: "8d3e5f2b-1c4a-4b6d-8e9f-2a3b4c5d6e7f", email: "lead@test.local", fullName: "Lead A", role: "inspector" as const, isLead: true };

const DRAFT_TEXT = "The inspection concluded PASSED, with 2,900 cartons.";
const DOC = { type: "doc" as const, content: [{ type: "paragraph" as const, content: [{ type: "text" as const, text: DRAFT_TEXT }] }] };
const WRITTEN: SummaryOutcome = {
  ok: true,
  doc: DOC,
  text: DRAFT_TEXT,
  notes: ["The weight is below the indicative weight."],
  figures: [],
  words: 8,
  model: "claude-sonnet-5-5",
  attempts: 1,
};
const ENV = { ANTHROPIC_API_KEY: "sk-ant-api03-test-0123456789abcdef" };
const NOTE = "The factory agreed to re-sort size M.";

let fake: FakeSupabase;
const adminRpc = vi.fn();

function useInspection(overrides: Partial<InspectionRecord> = {}): InspectionRecord {
  const record = stdEgRecord({ status: "draft", submittedAt: null, ...overrides });
  fake = createFakeSupabase({ tables: stdEgTables(record) });
  vi.mocked(createClient).mockResolvedValue(fake.client as never);
  return record;
}

const hashOf = (record: InspectionRecord) => contentHash(normaliseData(record.data));
const request = (record: InspectionRecord, options: Record<string, unknown> = { mode: "write" }) => ({
  inspectionId: record.id,
  dataHash: hashOf(record),
  options,
});

/** The record with its conclusion's data changed. */
function withConclusion(change: Record<string, unknown>, base = stdEgRecord({ status: "draft", submittedAt: null })): InspectionRecord {
  const saved = structuredClone(base.data) as InspectionData;
  const data: InspectionData = {
    ...saved,
    modules: { ...saved.modules, conclusion: { ...(saved.modules.conclusion as Record<string, unknown>), ...change } },
  };
  return { ...base, data };
}

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: INSPECTOR });
  vi.mocked(loadSummarySetup).mockResolvedValue({ env: ENV, style: DEFAULT_SUMMARY_STYLE });
  vi.mocked(writeSummary).mockResolvedValue(WRITTEN);
  vi.mocked(recordAiUsageLater).mockImplementation((context) => Object.assign(vi.fn(), { context }));
  adminRpc.mockResolvedValue({ data: 1, error: null });
  vi.mocked(createAdminClient).mockReturnValue({ rpc: adminRpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

const nothingCalled = () => {
  expect(writeSummary).not.toHaveBeenCalled();
  expect(recordAiUsageLater).not.toHaveBeenCalled();
  expect(adminRpc).not.toHaveBeenCalled();
};

describe("who may ask", () => {
  it("refuses a signed-out user before reading anything", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await draftInspectionSummary(request(useInspection()))).toEqual({
      ok: false,
      reason: "forbidden",
      message: "Your session has ended. Sign in again.",
    });
    expect(createClient).not.toHaveBeenCalled();
    nothingCalled();
  });

  it("asks for the role's Steri-AI Summary, and calls nobody for a role without it", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await draftInspectionSummary(request(useInspection()))).toEqual({
      ok: false,
      reason: "forbidden",
      message: "You do not have permission to do that.",
    });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "ai_summary" });
    nothingCalled();
  });

  it.each([
    ["no inspection id", { dataHash: "0123456789abcdef", options: { mode: "write" } }],
    ["an id that is no id", { inspectionId: "INS-2025-0001", dataHash: "0123456789abcdef", options: { mode: "write" } }],
    ["a hash that is no hash", { inspectionId: STD_EG_IDS.inspection, dataHash: "abc", options: { mode: "write" } }],
    ["a mode it does not know", { inspectionId: STD_EG_IDS.inspection, dataHash: "0123456789abcdef", options: { mode: "shorter" } }],
    ["a note over 300 characters", { inspectionId: STD_EG_IDS.inspection, dataHash: "0123456789abcdef", options: { mode: "write", note: "x".repeat(301) } }],
    ["a field it does not know", { inspectionId: STD_EG_IDS.inspection, dataHash: "0123456789abcdef", options: { mode: "write" }, model: "claude-opus-5-5" }],
  ])("does not understand %s", async (_name, input) => {
    useInspection();
    expect(await draftInspectionSummary(input)).toEqual({
      ok: false,
      reason: "error",
      message: "The request was not understood. Reload the page and try again.",
    });
    expect(createClient).not.toHaveBeenCalled();
    nothingCalled();
  });

  it("answers an inspection the user cannot read as not available", async () => {
    const record = useInspection();
    fake.tables.inspections = [];
    expect(await draftInspectionSummary(request(record))).toEqual({ ok: false, reason: "forbidden", message: "This inspection is not available." });
    nothingCalled();
  });

  it.each([
    ["submitted", INSPECTOR, { status: "submitted" as const }],
    ["approved", ADMIN, { status: "approved" as const }],
    ["a team member's, for their lead", LEAD, {}],
  ])("never calls Claude for an inspection that is %s", async (_name, user, overrides) => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user });
    const record = useInspection(overrides);
    expect(await draftInspectionSummary(request(record))).toEqual({
      ok: false,
      reason: "forbidden",
      message: "This inspection can no longer be changed here.",
    });
    nothingCalled();
  });

  it("lets an admin draft on someone's reopened inspection", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN });
    const record = useInspection({ status: "reopened" });
    expect(await draftInspectionSummary(request(record))).toMatchObject({ ok: true });
    expect(recordAiUsageLater).toHaveBeenCalledWith({ feature: "inspection_summary", inspectionId: record.id, actorId: ADMIN.id, itemCount: 1 });
  });
});

describe("before Claude is called", () => {
  it("needs the saved data to be what the screen holds", async () => {
    const record = useInspection();
    expect(await draftInspectionSummary({ ...request(record), dataHash: "0123456789abcdef" })).toEqual({
      ok: false,
      reason: "changed",
      message: "This inspection changed on another device since this one last saved. Reload the page, then try again.",
    });
    nothingCalled();
  });

  it("needs the conclusion to write, in the template's words", async () => {
    const record = withConclusion({ finalResult: null });
    fake = createFakeSupabase({ tables: stdEgTables({ ...record, result: null }) });
    vi.mocked(createClient).mockResolvedValue(fake.client as never);
    expect(await draftInspectionSummary(request(record))).toEqual({
      ok: false,
      reason: "needs_result",
      message: "Choose PASSED, FAILED or HOLD first: the summary starts with the conclusion.",
    });
    nothingCalled();
  });

  it("needs text to polish", async () => {
    const record = useInspection();
    expect(await draftInspectionSummary(request(record, { mode: "polish" }))).toEqual({
      ok: false,
      reason: "error",
      message: "There is no text to polish yet.",
    });
    nothingCalled();
  });
});

describe("a draft", () => {
  it("is written from the inspection in the house style, its cost recorded once the checks have passed", async () => {
    const record = useInspection();
    const answer = await draftInspectionSummary(request(record, { mode: "write", note: ` ${NOTE} ` }));
    expect(answer).toEqual({
      ok: true,
      mode: "write",
      doc: DOC,
      text: DRAFT_TEXT,
      notes: ["The weight is below the indicative weight."],
      figures: [],
      words: 8,
      model: "claude-sonnet-5-5",
      basis: summaryBasisHash(normaliseData(record.data)),
    });

    const [written, env, callbacks] = vi.mocked(writeSummary).mock.calls[0];
    expect(env).toBe(ENV);
    expect(written).toMatchObject({ mode: "write", note: NOTE, draft: null, finalResult: "pass", style: DEFAULT_SUMMARY_STYLE });
    expect(written.view).toMatchObject({ refNo: "INS-2025-0001", conclusion: { finalResult: "PASSED" } });
    expect(vi.mocked(recordAiUsageLater).mock.calls).toEqual([
      [{ feature: "inspection_summary", inspectionId: record.id, actorId: INSPECTOR.id, itemCount: 1 }],
      [{ feature: "inspection_summary", inspectionId: record.id, actorId: INSPECTOR.id, itemCount: 0 }],
    ]);
    expect((callbacks?.onCall as unknown as { context: unknown }).context).toMatchObject({ itemCount: 1 });
    expect((callbacks?.onRetryCall as unknown as { context: unknown }).context).toMatchObject({ itemCount: 0 });
  });

  it("is recorded as summary_drafted by the service role, with the choices and hashes, never the text or the note", async () => {
    const record = useInspection();
    await draftInspectionSummary(request(record, { mode: "write", length: "brief", note: NOTE }));
    expect(adminRpc).toHaveBeenCalledTimes(1);
    const [name, args] = adminRpc.mock.calls[0] as [string, { inspection_id: string; action: string; changes: Record<string, unknown> }];
    expect(name).toBe("log_inspection_event");
    expect(args.inspection_id).toBe(record.id);
    expect(args.action).toBe("summary_drafted");
    expect(args.changes).toEqual({
      by: INSPECTOR.id,
      model: "claude-sonnet-5-5",
      mode: "write",
      length: "brief",
      paragraphs: "auto",
      format: "paragraphs",
      language: "en-GB",
      note: true,
      words: 8,
      attempts: 1,
      style_hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      text_hash: expect.stringMatching(/^[0-9a-f]{16}$/),
      basis_hash: summaryBasisHash(normaliseData(record.data)),
    });
    expect(JSON.stringify(args.changes)).not.toContain(DRAFT_TEXT);
    expect(JSON.stringify(args.changes)).not.toContain(NOTE);
  });

  it("never writes the inspection: no save, no update, nothing in the user's name", async () => {
    const record = useInspection();
    await draftInspectionSummary(request(record));
    expect(fake.rpcCalls).toEqual([]);
    expect(fake.queries.filter((query) => query.operation !== "select")).toEqual([]);
    expect(adminRpc.mock.calls.map(([name]) => name)).toEqual(["log_inspection_event"]);
  });

  it("applies the inspector's menu only as the house style allows", async () => {
    const options = { mode: "write", length: "detailed", format: "bullets", language: "ms" };
    await draftInspectionSummary(request(useInspection(), options));
    expect(vi.mocked(writeSummary).mock.calls[0][0].style).toMatchObject({ length: "detailed", format: "bullets", language: "en-GB" });

    vi.mocked(loadSummarySetup).mockResolvedValue({
      env: ENV,
      style: SummaryStyleSchema.parse({ inspectorsCanAdjust: false, languagesOffered: ["en-GB", "ms"] }),
    });
    await draftInspectionSummary(request(useInspection(), options));
    expect(vi.mocked(writeSummary).mock.calls[1][0].style).toMatchObject({ length: "standard", format: "paragraphs", language: "en-GB" });
  });

  it("polishes the saved summary, its house wording kept out of Steri-AI's hands", async () => {
    const closing = "This summary reflects the goods sampled at the time and place of inspection.";
    vi.mocked(loadSummarySetup).mockResolvedValue({ env: ENV, style: SummaryStyleSchema.parse({ closingSentence: closing }) });
    const record = withConclusion({
      inspectionSummary: {
        type: "doc",
        content: [
          { type: "paragraph", content: [{ type: "text", text: "Lot " }, { type: "text", text: "PASSED", marks: [{ type: "bold" }] }, { type: "text", text: ", weight low." }] },
          { type: "paragraph", content: [{ type: "text", text: closing }] },
        ],
      },
    });
    fake = createFakeSupabase({ tables: stdEgTables(record) });
    vi.mocked(createClient).mockResolvedValue(fake.client as never);

    expect(await draftInspectionSummary(request(record, { mode: "polish" }))).toMatchObject({ ok: true, mode: "polish" });
    expect(vi.mocked(writeSummary).mock.calls[0][0]).toMatchObject({
      mode: "polish",
      draft: "Lot **PASSED**, weight low.",
      houseWording: { verdict: null, closing },
    });
  });

  it("passes on what Steri-AI answered when it could not write", async () => {
    vi.mocked(writeSummary).mockResolvedValue({ ok: false, reason: "not_connected", message: "Steri-AI Summary needs Steri-AI, which is not connected yet." });
    expect(await draftInspectionSummary(request(useInspection()))).toEqual({
      ok: false,
      reason: "not_connected",
      message: "Steri-AI Summary needs Steri-AI, which is not connected yet.",
    });
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("answers in words when something unexpected breaks", async () => {
    vi.mocked(writeSummary).mockRejectedValue(new Error("boom"));
    expect(await draftInspectionSummary(request(useInspection()))).toEqual({
      ok: false,
      reason: "error",
      message: "Steri-AI could not write the summary. Try again.",
    });
  });
});
