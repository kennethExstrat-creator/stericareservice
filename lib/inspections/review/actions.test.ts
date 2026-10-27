import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { refresh } from "next/cache";
import { authorizeAction } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { approveInspection, reopenInspection, type ReviewActionResult } from "./actions";
import { REOPEN_REASON_MAX, REVIEW_MESSAGES } from "./schemas";

const ID = "3f0c2a1e-5b6d-4e7f-8a9b-0c1d2e3f4a5b";
const VERSION = "2026-10-06T06:05:03.123456+00:00";
const NEWER = "2026-10-06T06:09:41.004521+00:00";
const IDLE: ReviewActionResult = { status: "idle" };
const ADMIN = { id: "00000000-0000-4000-8000-000000000102", email: "admin@test.local", fullName: "Admin A", role: "admin" as const };

/* ------------------------------------------------------------------ *
 * A fake Supabase client: each query records its chain and resolves to
 * what the test's responder returns for it.
 * ------------------------------------------------------------------ */

type Result = { data: unknown; error: unknown };
type Query = { table: string; calls: Array<[string, unknown[]]> };

function fakeClient(respond: (query: Query) => Result, rpcResult: Result = { data: 1, error: null }) {
  const queries: Query[] = [];
  const from = vi.fn((table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const builder: Record<string, unknown> = {};
    for (const method of ["select", "update", "eq"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    builder.maybeSingle = () => Promise.resolve(respond(query));
    return builder;
  });
  const rpc = vi.fn(() => Promise.resolve(rpcResult));
  return { client: { from, rpc }, queries };
}

const isUpdate = (query: Query) => query.calls.some(([name]) => name === "update");
const calls = (query: Query | undefined, method: string) =>
  query?.calls.filter(([name]) => name === method).map(([, args]) => args) ?? [];

function useClient(respond: (query: Query) => Result, rpcResult?: Result) {
  const fake = fakeClient(respond, rpcResult);
  vi.mocked(createClient).mockResolvedValue(fake.client as never);
  return fake;
}

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [name, value] of Object.entries(fields)) data.set(name, value);
  return data;
}

const approveForm = (overrides: Record<string, string> = {}) => form({ inspectionId: ID, version: VERSION, ...overrides });
const reopenForm = (overrides: Record<string, string> = {}) =>
  form({ inspectionId: ID, reason: "Retest size M with new samples.", ...overrides });

/** The update matches nothing; the re-read finds the row as given. */
const missThen = (row: unknown) => (query: Query) => (isUpdate(query) ? { data: null, error: null } : { data: row, error: null });

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: ADMIN });
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("both actions", () => {
  const run: Array<[string, () => Promise<ReviewActionResult>]> = [
    ["approveInspection", () => approveInspection(IDLE, approveForm())],
    ["reopenInspection", () => reopenInspection(IDLE, reopenForm())],
  ];

  it.each(run)("%s refuses anyone whose role does not approve and reopen, before touching the database", async (_, action) => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await action()).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "approve_inspections" });
    expect(createClient).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
  });

  it.each(run)("%s turns an unexpected failure into a message instead of an error page", async (_, action) => {
    vi.mocked(createClient).mockRejectedValue(new Error("fetch failed"));
    expect(await action()).toEqual({ status: "error", message: REVIEW_MESSAGES.unexpected });
  });

  it.each([
    ["approveInspection", () => approveInspection(IDLE, approveForm({ inspectionId: "1 or 1=1" }))],
    ["reopenInspection", () => reopenInspection(IDLE, reopenForm({ inspectionId: "1 or 1=1" }))],
  ])("%s refuses an id that is not an inspection id", async (_, action) => {
    expect(await action()).toEqual({ status: "error", message: REVIEW_MESSAGES.notFound });
    expect(createClient).not.toHaveBeenCalled();
  });
});

describe("approveInspection", () => {
  it("approves only the submitted version the admin reviewed, then refreshes the page", async () => {
    const { queries } = useClient(() => ({ data: { ref_no: "INS-2026-0001" }, error: null }));
    const result = await approveInspection(IDLE, approveForm());

    expect(result).toEqual({ status: "success", message: "INS-2026-0001 is approved. It is final and can no longer be changed." });
    const [update] = queries;
    expect(update.table).toBe("inspections");
    expect(calls(update, "update")).toEqual([[{ status: "approved" }]]);
    expect(calls(update, "eq")).toEqual([
      ["id", ID],
      ["status", "submitted"],
      ["updated_at", VERSION],
    ]);
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("needs the version the page was rendered with", async () => {
    expect(await approveInspection(IDLE, approveForm({ version: "" }))).toEqual({
      status: "error",
      message: REVIEW_MESSAGES.staleForm,
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("does not approve a version that changed after the admin opened it, and shows the latest", async () => {
    useClient(missThen({ ref_no: "INS-2026-0001", status: "submitted", updated_at: NEWER }));
    expect(await approveInspection(IDLE, approveForm())).toEqual({
      status: "warning",
      message:
        "INS-2026-0001 changed after you opened it, so it was not approved. The page now shows the latest version: check it, then approve it.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["approved", "INS-2026-0001 was already approved. Nothing was changed."],
    ["reopened", "INS-2026-0001 is reopened now, so it was not approved. The page shows its current state."],
    ["draft", "INS-2026-0001 is a draft now, so it was not approved. The page shows its current state."],
  ])("says so when someone else moved it to %s first", async (status, message) => {
    useClient(missThen({ ref_no: "INS-2026-0001", status, updated_at: NEWER }));
    expect(await approveInspection(IDLE, approveForm())).toEqual({ status: "warning", message });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("reads an unchanged, still submitted inspection it could not update as not allowed", async () => {
    useClient(missThen({ ref_no: "INS-2026-0001", status: "submitted", updated_at: VERSION }));
    expect(await approveInspection(IDLE, approveForm())).toEqual({
      status: "error",
      message: "You do not have permission to approve inspections.",
    });
    expect(refresh).not.toHaveBeenCalled();
  });

  it("says when the inspection is gone", async () => {
    useClient(missThen(null));
    expect(await approveInspection(IDLE, approveForm())).toEqual({ status: "error", message: REVIEW_MESSAGES.notFound });
  });

  it.each([
    [{ code: "42501", message: "only an admin can approve an inspection" }, "You do not have permission to approve inspections."],
    [{ code: "42501", message: "your role cannot approve or reopen inspections" }, "You do not have permission to approve inspections."],
    [
      { code: "23514", message: "status cannot change from reopened to approved" },
      "This inspection cannot be approved now: only submitted inspections can.",
    ],
    [{ code: "PGRST303", message: "JWT expired" }, "Your session has ended. Sign in again."],
    [{ code: "XX000", message: "internal error" }, REVIEW_MESSAGES.unexpected],
  ])("puts a refused update (%j) in plain words", async (error, message) => {
    useClient(() => ({ data: null, error }));
    expect(await approveInspection(IDLE, approveForm())).toEqual({ status: "error", message });
    expect(refresh).not.toHaveBeenCalled();
  });
});

describe("reopenInspection", () => {
  it("reopens a submitted inspection, records the reason, then refreshes the page", async () => {
    const { client, queries } = useClient(() => ({ data: { ref_no: "INS-2026-0002" }, error: null }));
    const result = await reopenInspection(IDLE, reopenForm({ reason: "  Retest size M with new samples.  " }));

    expect(result).toEqual({
      status: "success",
      message: "INS-2026-0002 is reopened. The inspector can change it and submit it again.",
    });
    const [update] = queries;
    expect(calls(update, "update")).toEqual([[{ status: "reopened" }]]);
    // Not tied to a version: reopening is not final, and a typed reason is not lost.
    expect(calls(update, "eq")).toEqual([
      ["id", ID],
      ["status", "submitted"],
    ]);
    expect(client.rpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: ID,
      action: "review.reopened",
      changes: { reason: "Retest size M with new samples." },
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it("takes a reason on several lines up to the field's limit, and logs it with plain line ends", async () => {
    const { client } = useClient(() => ({ data: { ref_no: "INS-2026-0002" }, error: null }));
    const lines = "Retest size M with new samples.\nAdd the photos of the burst gloves.\n";
    // As long as the field allows: it counts a line break as one character.
    const reason = lines + "x".repeat(REOPEN_REASON_MAX - lines.length);
    // The browser sends each line break as CRLF.
    const result = await reopenInspection(IDLE, reopenForm({ reason: reason.replaceAll("\n", "\r\n") }));

    expect(result).toMatchObject({ status: "success" });
    expect(client.rpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: ID,
      action: "review.reopened",
      changes: { reason },
    });
  });

  it.each([
    ["empty", "", REVIEW_MESSAGES.reasonMissing],
    ["blank", "   ", REVIEW_MESSAGES.reasonMissing],
    ["too long", "x".repeat(REOPEN_REASON_MAX + 1), REVIEW_MESSAGES.reasonTooLong],
  ])("asks for a reason when it is %s, next to the field", async (_, reason, message) => {
    expect(await reopenInspection(IDLE, reopenForm({ reason }))).toEqual({
      status: "error",
      message,
      fieldErrors: { reason: message },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("warns, with the reason to pass on, when the reopen worked but the reason was not saved", async () => {
    useClient(() => ({ data: { ref_no: "INS-2026-0002" }, error: null }), { data: null, error: { code: "42501", message: "no" } });
    expect(await reopenInspection(IDLE, reopenForm())).toEqual({
      status: "warning",
      message:
        "INS-2026-0002 is reopened, but the reason could not be saved. Tell the inspector what to change: Retest size M with new samples.",
    });
    expect(refresh).toHaveBeenCalledOnce();
  });

  it.each([
    ["reopened", "INS-2026-0002 was already reopened. Nothing was changed."],
    ["approved", "INS-2026-0002 is approved now, so it was not reopened. The page shows its current state."],
  ])("says so when someone else moved it to %s first, and logs no reason", async (status, message) => {
    const { client } = useClient(missThen({ ref_no: "INS-2026-0002", status, updated_at: NEWER }));
    expect(await reopenInspection(IDLE, reopenForm())).toEqual({ status: "warning", message });
    expect(client.rpc).not.toHaveBeenCalled();
  });

  it("puts a refused update in plain words", async () => {
    useClient(() => ({ data: null, error: { code: "42501", message: "only an admin can reopen an inspection" } }));
    expect(await reopenInspection(IDLE, reopenForm())).toEqual({
      status: "error",
      message: "You do not have permission to reopen inspections.",
    });
  });
});
