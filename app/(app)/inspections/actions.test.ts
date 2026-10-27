import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ refresh: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn(), isAdminClientConfigured: vi.fn() }));

import { refresh } from "next/cache";
import { authorizeAction } from "@/lib/auth/session";
import { DELETE_MESSAGES } from "@/lib/inspections/delete";
import { createAdminClient, isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { deleteInspection } from "./actions";

const ID = "9b0b4c55-1b6e-4c50-9a39-0f6f1e1f0001";
const USER = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" as const };

type RpcAnswer = { data?: unknown; error?: { code?: string; message: string } | null; status?: number };

/** The signed-in user's client: only rpc() is used, and only through the database function. */
function useUserClient(answer: RpcAnswer) {
  const rpc = vi.fn().mockResolvedValue({ data: null, error: null, status: 200, ...answer });
  const from = vi.fn(() => {
    throw new Error("the action must not touch tables directly");
  });
  vi.mocked(createClient).mockResolvedValue({ rpc, from } as never);
  return rpc;
}

/** The secret-key client's Storage, with every call recorded. */
function useAdminStorage(objects: Record<string, string[]> = {}) {
  const removed: Record<string, string[]> = {};
  const storage = {
    from: (bucket: string) => ({
      list: vi.fn(async (path: string) => ({
        data: (objects[bucket] ?? [])
          .filter((name) => name.startsWith(`${path}/`) && !name.slice(path.length + 1).includes("/"))
          .map((name) => ({ name: name.slice(path.length + 1), id: name })),
        error: null,
      })),
      remove: vi.fn(async (paths: string[]) => {
        (removed[bucket] ??= []).push(...paths);
        return { data: [], error: null };
      }),
    }),
  };
  vi.mocked(createAdminClient).mockReturnValue({ storage } as never);
  return removed;
}

const DELETED = {
  inspection_id: ID,
  ref_no: "INS-2026-0001",
  photo_paths: [`${ID}/p1.jpg`, `${ID}/thumbs/p1.jpg`],
  file_paths: [`${ID}/f1.pdf`],
};

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({ ok: true, user: USER });
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("deleteInspection", () => {
  it("checks the session before anything else", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    const rpc = useUserClient({ data: DELETED });

    expect(await deleteInspection({ inspectionId: ID })).toEqual({
      status: "error",
      message: "Your session has ended. Sign in again.",
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });

  it("asks for the role's Delete Drafts, and deletes nothing for a role without it", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    const rpc = useUserClient({ data: DELETED });

    expect(await deleteInspection({ inspectionId: ID })).toEqual({
      status: "error",
      message: "You do not have permission to do that.",
    });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "delete_drafts" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ inspectionId: "INS-2026-0001" }], [null], ["not an object"], [{ inspectionId: 42 }]])(
    "refuses %j without asking the database",
    async (input) => {
      const rpc = useUserClient({ data: DELETED });
      expect(await deleteInspection(input)).toEqual({ status: "error", message: DELETE_MESSAGES.invalid });
      expect(rpc).not.toHaveBeenCalled();
    },
  );

  it("deletes through the database function as the user, then removes the objects and refreshes the list", async () => {
    const rpc = useUserClient({ data: DELETED });
    const removed = useAdminStorage({
      "inspection-photos": [`${ID}/p1.jpg`, `${ID}/orphan.jpg`],
      "inspection-files": [`${ID}/f1.pdf`],
    });

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "deleted" });

    expect(rpc).toHaveBeenCalledWith("delete_draft_inspection", { inspection_id: ID });
    expect(removed["inspection-photos"]?.sort()).toEqual([`${ID}/orphan.jpg`, `${ID}/p1.jpg`, `${ID}/thumbs/p1.jpg`]);
    expect(removed["inspection-files"]).toEqual([`${ID}/f1.pdf`]);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("only removes objects after the database has deleted the row", async () => {
    const order: string[] = [];
    vi.mocked(createClient).mockResolvedValue({
      rpc: vi.fn(async () => {
        order.push("rpc");
        return { data: DELETED, error: null, status: 200 };
      }),
    } as never);
    vi.mocked(createAdminClient).mockImplementation(() => {
      order.push("storage");
      return { storage: { from: () => ({ list: async () => ({ data: [], error: null }), remove: async () => ({ data: [], error: null }) }) } } as never;
    });

    await deleteInspection({ inspectionId: ID });

    expect(order).toEqual(["rpc", "storage"]);
  });

  it("still reports the deletion when Storage fails, and logs what was left", async () => {
    useUserClient({ data: DELETED });
    vi.mocked(createAdminClient).mockReturnValue({
      storage: {
        from: () => ({
          list: async () => ({ data: null, error: { message: "Storage is down" } }),
          remove: async () => ({ data: null, error: { message: "Storage is down" } }),
        }),
      },
    } as never);

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "deleted" });
    expect(console.error).toHaveBeenCalledWith(
      "[inspections] Storage objects of a deleted inspection left",
      expect.objectContaining({ inspectionId: ID, refNo: "INS-2026-0001" }),
    );
    expect(refresh).toHaveBeenCalled();
  });

  it("still reports the deletion when the secret key is missing", async () => {
    useUserClient({ data: DELETED });
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "deleted" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      "[inspections] Storage objects of a deleted inspection left: no secret key",
      expect.objectContaining({ inspectionId: ID }),
    );
  });

  it("refreshes the list and says so when the inspection is already gone", async () => {
    useUserClient({ data: null });

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "error", message: DELETE_MESSAGES.gone });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("refreshes the list and says so when the inspection was submitted meanwhile", async () => {
    useUserClient({ error: { code: "23514", message: "only a draft that was never submitted can be deleted" }, status: 400 });

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "error", message: DELETE_MESSAGES.notDraft });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ code: "42501", message: "the account is not active" }, 403, DELETE_MESSAGES.notAllowed],
    [{ code: "PGRST202", message: "Could not find the function" }, 404, DELETE_MESSAGES.unavailable],
    [{ message: "fetch failed" }, 0, DELETE_MESSAGES.network],
  ])("answers %j with a plain message and leaves the list alone", async (error, status, message) => {
    useUserClient({ error, status });

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "error", message });
    expect(refresh).not.toHaveBeenCalled();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("turns an unexpected failure into a message, not an error page", async () => {
    vi.mocked(createClient).mockRejectedValue(new Error("cookies() failed"));

    expect(await deleteInspection({ inspectionId: ID })).toEqual({ status: "error", message: DELETE_MESSAGES.failed });
    expect(console.error).toHaveBeenCalledWith("[inspections] deleteInspection failed", expect.any(Error));
  });
});
