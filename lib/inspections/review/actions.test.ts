import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// One part unless a test says otherwise: the inspection alone (lib/inspections/parts.ts).
vi.mock("@/lib/inspections/parts-server", () => ({ loadParts: vi.fn() }));
vi.mock("@/lib/inspections/part-moves-server", () => ({ readPartStates: vi.fn() }));

import { refresh } from "next/cache";
import { authorizeAction } from "@/lib/auth/session";
import { PART_VERSION_FIELD, type PartState } from "@/lib/inspections/part-moves";
import { readPartStates } from "@/lib/inspections/part-moves-server";
import { partLabel } from "@/lib/inspections/parts";
import { loadParts } from "@/lib/inspections/parts-server";
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
  vi.mocked(loadParts).mockImplementation(async (_client, id) => [
    { id, refNo: "INS-2026-0001", poNo: null, productName: null, status: "submitted", primary: true },
  ]);
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

  it.each(run)("%s refuses anyone who is not an active admin, before touching the database", async (_, action) => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await action()).toEqual({ status: "error", message: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith("admin");
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

describe("an inspection of several PO parts", () => {
  const P2 = "4a1d3b2f-6c7e-4f80-9b1c-2d3e4f5a6b7c";
  const P3 = "5b2e4c3a-7d8f-4091-8c2d-3e4f5a6b7c8d";
  const PARTS = [
    { id: ID, refNo: "INS-2026-0001", poNo: "2680276", primary: true },
    { id: P2, refNo: "INS-2026-0002", poNo: "2680277", primary: false },
    { id: P3, refNo: "INS-2026-0003", poNo: null, primary: false },
  ].map((part) => ({ ...part, productName: null, status: "submitted" as const }));

  /** The parts as the database has them now: submitted at VERSION, each with `changes[id]`. */
  function useParts(changes: Record<string, Partial<PartState>> = {}) {
    vi.mocked(loadParts).mockResolvedValue(PARTS);
    vi.mocked(readPartStates).mockResolvedValue(
      PARTS.map((part, index) => ({
        id: part.id,
        label: partLabel(part, index),
        refNo: part.refNo,
        status: "submitted",
        version: VERSION,
        primary: part.primary,
        result: "pass",
        suggestedResult: "pass",
        ...changes[part.id],
      })),
    );
  }

  /** The approve form as the page renders it: every part it showed, with the version it showed. */
  function partsForm(ids = PARTS.map((part) => part.id)) {
    const data = approveForm();
    for (const id of ids) data.append(PART_VERSION_FIELD, `${id}@${VERSION}`);
    return data;
  }

  const updated = (queries: Query[]) => queries.filter(isUpdate).map((query) => calls(query, "eq")[0][1]);

  describe("approveInspection", () => {
    it("approves every part, each at the version the page showed, then refreshes the page", async () => {
      const { queries } = useClient(() => ({ data: { ref_no: "INS-2026-0001" }, error: null }));
      useParts();
      expect(await approveInspection(IDLE, partsForm())).toEqual({
        status: "success",
        message: "INS-2026-0001 is approved with all 3 POs: PO 2680276, PO 2680277 and PO 3. It is final and can no longer be changed.",
      });
      expect(queries.filter(isUpdate).map((query) => calls(query, "eq"))).toEqual(
        [ID, P2, P3].map((id) => [
          ["id", id],
          ["status", "submitted"],
          ["updated_at", VERSION],
        ]),
      );
      expect(refresh).toHaveBeenCalledOnce();
    });

    it.each([
      ["a part is a draft", { [P2]: { status: "draft" as const } }, undefined, "PO 2680277 is a draft now, so nothing was approved. The page shows the current state."],
      [
        "a part changed after the page showed it",
        { [P3]: { version: NEWER } },
        undefined,
        "PO 3 changed after you opened it, so nothing was approved. The page now shows the latest version: check it, then approve it.",
      ],
      [
        "the page showed other parts",
        {},
        [ID, P2],
        "The POs of INS-2026-0001 changed after you opened it, so nothing was approved. The page now shows them: check them, then approve.",
      ],
    ])("approves none when %s, and shows the page as it is now", async (_, changes, shown, message) => {
      const { queries } = useClient(() => ({ data: { ref_no: "INS-2026-0001" }, error: null }));
      useParts(changes);
      expect(await approveInspection(IDLE, partsForm(shown))).toEqual({ status: "warning", message });
      expect(queries.filter(isUpdate)).toHaveLength(0);
      expect(refresh).toHaveBeenCalledOnce();
    });

    it("leaves a part approved already as it is", async () => {
      const { queries } = useClient(() => ({ data: { ref_no: "INS-2026-0002" }, error: null }));
      useParts({ [ID]: { status: "approved" } });
      expect(await approveInspection(IDLE, partsForm())).toEqual({
        status: "success",
        message: "PO 2680277 and PO 3 are approved, and PO 2680276 was approved already. INS-2026-0001 is final and can no longer be changed.",
      });
      expect(updated(queries)).toEqual([P2, P3]);
    });

    it("says which parts were approved when a later one changed in between", async () => {
      useClient((query) =>
        isUpdate(query) && calls(query, "eq")[0][1] === P3 ? { data: null, error: null } : { data: { ref_no: "x" }, error: null },
      );
      useParts();
      expect(await approveInspection(IDLE, partsForm())).toEqual({
        status: "warning",
        message:
          "PO 2680276 and PO 2680277 are approved, but PO 3 changed in between, so it was not approved. The page now shows the latest version: check it, then approve it.",
      });
    });

    it("says when the inspection is gone before its parts could be read", async () => {
      vi.mocked(loadParts).mockResolvedValue(null);
      useClient(() => ({ data: null, error: null }));
      expect(await approveInspection(IDLE, partsForm())).toEqual({ status: "error", message: REVIEW_MESSAGES.notFound });
    });
  });

  describe("reopenInspection", () => {
    it("reopens every submitted part, with the reason in each part's own log", async () => {
      const { client, queries } = useClient(() => ({ data: { ref_no: "x" }, error: null }));
      useParts();
      expect(await reopenInspection(IDLE, reopenForm())).toEqual({
        status: "success",
        message: "INS-2026-0001 is reopened with all 3 POs. The inspector can change them and submit them again.",
      });
      expect(updated(queries)).toEqual([ID, P2, P3]);
      expect(client.rpc.mock.calls).toEqual(
        [ID, P2, P3].map((id) => [
          "log_inspection_event",
          { inspection_id: id, action: "review.reopened", changes: { reason: "Retest size M with new samples." } },
        ]),
      );
    });

    it("reopens none while a part is approved", async () => {
      const { client, queries } = useClient(() => ({ data: { ref_no: "x" }, error: null }));
      useParts({ [P2]: { status: "approved" } });
      expect(await reopenInspection(IDLE, reopenForm())).toEqual({
        status: "warning",
        message: "PO 2680277 is approved now, so nothing was reopened. The page shows the current state.",
      });
      expect(queries.filter(isUpdate)).toHaveLength(0);
      expect(client.rpc).not.toHaveBeenCalled();
    });

    it("leaves a part that is with the inspector already as it is", async () => {
      const { queries } = useClient(() => ({ data: { ref_no: "x" }, error: null }));
      useParts({ [P3]: { status: "reopened" } });
      expect(await reopenInspection(IDLE, reopenForm())).toEqual({
        status: "success",
        message:
          "PO 2680276 and PO 2680277 are reopened, and PO 3 was with the inspector already. The inspector can change them and submit them again.",
      });
      expect(updated(queries)).toEqual([ID, P2]);
    });
  });
});
