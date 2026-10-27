import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ loadAiEnv: vi.fn() }));
vi.mock("@/lib/ai/media-sorter", () => ({ sortMedia: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsageLater: vi.fn() }));

import { sortMedia } from "@/lib/ai/media-sorter";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction } from "@/lib/auth/session";
import { MEDIA_MESSAGES } from "@/lib/inspections/media-moves";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { moveMedia, sortMediaWithAi, type SortMediaItem } from "./media-actions";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const PHOTO = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const PHOTO_2 = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";
const VIDEO = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const ELSEWHERE = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";

/** Base64 of a few bytes behind a JPEG's, a PNG's, and no image's head. */
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(120, 7)]).toString("base64");
const PNG = Buffer.concat([Buffer.from("\x89PNG\r\n\x1a\n", "latin1"), Buffer.alloc(120, 7)]).toString("base64");
const TEXT = Buffer.from("x".repeat(124)).toString("base64");

/* ------------------------------------------------------------------ *
 * A fake Supabase client: every query records its chain and resolves to
 * what the test's responder returns; can_edit_inspection answers `canEdit`.
 * ------------------------------------------------------------------ */

type Answer = { data: unknown; error: { code?: string; message: string } | null };
type Query = { table: string; calls: Array<[string, unknown[]]> };

let queries: Query[] = [];
const rpc = vi.fn();
const adminRpc = vi.fn();

function useDatabase(responder: (query: Query) => Answer, canEdit = true) {
  queries = [];
  const from = (table: string) => {
    const query: Query = { table, calls: [] };
    queries.push(query);
    const resolve = () => {
      const answer = responder(query);
      return Promise.resolve({ status: answer.error ? 400 : 200, ...answer });
    };
    const builder: Record<string, unknown> = {
      maybeSingle: () => resolve(),
      then: (onFulfilled: (value: unknown) => unknown, onRejected: (reason: unknown) => unknown) =>
        resolve().then(onFulfilled, onRejected),
    };
    for (const method of ["select", "update", "eq", "in"]) {
      builder[method] = (...args: unknown[]) => {
        query.calls.push([method, args]);
        return builder;
      };
    }
    return builder;
  };
  rpc.mockResolvedValue({ data: canEdit, error: null });
  vi.mocked(createClient).mockResolvedValue({ from, rpc } as never);
}

const arg = (query: Query | undefined, method: string) => query?.calls.find(([name]) => name === method)?.[1];
const writes = () => queries.filter((query) => arg(query, "update"));

/** The inspection's media as the database holds it: reads answer these rows, writes answer the id. */
function mediaRows(photos: Array<Record<string, unknown>>, files: Array<Record<string, unknown>>) {
  return (query: Query): Answer => {
    if (arg(query, "update")) return { data: { id: arg(query, "eq")?.[1] }, error: null };
    return { data: query.table === "inspection_photos" ? photos : files, error: null };
  };
}

const item = (kind: "photo" | "video", id: string, preview = JPEG): SortMediaItem => ({ kind, id, preview });

beforeEach(() => {
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: "inspector-id", email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" },
  });
  adminRpc.mockResolvedValue({ data: 1, error: null });
  vi.mocked(createAdminClient).mockReturnValue({ rpc: adminRpc } as never);
  vi.spyOn(console, "error").mockImplementation(() => {});
  useDatabase(() => ({ data: [], error: null }));
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("input checks", () => {
  it.each([
    ["an inspection id that is no id", () => sortMediaWithAi("nope", [item("photo", PHOTO)]), MEDIA_MESSAGES.inspectionGone],
    ["no items", () => sortMediaWithAi(INSPECTION, []), MEDIA_MESSAGES.batchSize],
    [
      "more than 12 items",
      () => sortMediaWithAi(INSPECTION, Array.from({ length: 13 }, (_, n) => item("photo", `${String(n).padStart(8, "0")}-0000-4000-8000-000000000000`))),
      MEDIA_MESSAGES.batchSize,
    ],
    ["a kind that is neither", () => sortMediaWithAi(INSPECTION, [{ kind: "pdf", id: PHOTO, preview: JPEG } as never]), MEDIA_MESSAGES.itemGone],
    ["the same item twice", () => sortMediaWithAi(INSPECTION, [item("photo", PHOTO), item("photo", PHOTO)]), MEDIA_MESSAGES.sentTwice],
    ["a preview that is no image", () => sortMediaWithAi(INSPECTION, [item("photo", PHOTO, TEXT)]), MEDIA_MESSAGES.badPreview],
    ["a preview that is no base64", () => sortMediaWithAi(INSPECTION, [item("photo", PHOTO, `${JPEG.slice(0, 120)}%%%%`)]), MEDIA_MESSAGES.badPreview],
    ["a key that is no category", () => moveMedia(INSPECTION, { kind: "photo", id: PHOTO }, "visual" as never), MEDIA_MESSAGES.chooseCategory],
  ])("refuses %s before it reads anything", async (_name, run, error) => {
    expect(await run()).toEqual({ ok: false, error });
    expect(createClient).not.toHaveBeenCalled();
    expect(sortMedia).not.toHaveBeenCalled();
  });

  it("checks the session first", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await moveMedia(INSPECTION, { kind: "photo", id: PHOTO }, null)).toEqual({ ok: false, error: "Your session has ended. Sign in again." });
    expect(createClient).not.toHaveBeenCalled();
  });

  // Roles and permissions (migration 20261027150000): moving by hand is anyone's who may change the photos.
  it("sorts with Steri-AI only for a role with Steri-AI Reading", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await sortMediaWithAi(INSPECTION, [{ kind: "photo", id: PHOTO, preview: "AAAA" }])).toEqual({
      ok: false,
      error: "You do not have permission to do that.",
    });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "ai_reading" });
    expect(createClient).not.toHaveBeenCalled();
    expect(sortMedia).not.toHaveBeenCalled();
  });
});

describe("moveMedia", () => {
  it("tags a photo with the category, drops its old target and records the move", async () => {
    useDatabase(mediaRows([{ id: PHOTO, module_key: "visual", target: "size:M/defect:thin_spot" }], []));
    expect(await moveMedia(INSPECTION, { kind: "photo", id: PHOTO }, "media_defects")).toEqual({ ok: true });

    expect(rpc).toHaveBeenCalledWith("can_edit_inspection", { inspection_id: INSPECTION });
    const [write] = writes();
    expect(write.table).toBe("inspection_photos");
    expect(arg(write, "update")).toEqual([{ module_key: "media_defects", target: null }]);
    expect(write.calls.filter(([name]) => name === "eq").map(([, args]) => args)).toEqual([["id", PHOTO], ["inspection_id", INSPECTION]]);
    expect(adminRpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: INSPECTION,
      action: "media_moved",
      changes: { by: "inspector-id", photo_id: PHOTO, from: "visual", to: "media_defects", target: "size:M/defect:thin_spot" },
    });
  });

  it("puts a video back in Other as source_media, and writes nothing for one already there", async () => {
    useDatabase(mediaRows([], [{ id: VIDEO, module_key: "media_warehouse" }]));
    expect(await moveMedia(INSPECTION, { kind: "video", id: VIDEO }, null)).toEqual({ ok: true });
    expect(writes().map((query) => [query.table, arg(query, "update")])).toEqual([["inspection_files", [{ module_key: "source_media" }]]]);

    useDatabase(mediaRows([], [{ id: VIDEO, module_key: "media_warehouse" }]));
    expect(await moveMedia(INSPECTION, { kind: "video", id: VIDEO }, "media_warehouse")).toEqual({ ok: true });
    expect(writes()).toEqual([]);
    expect(adminRpc).toHaveBeenCalledTimes(1);
  });

  it("refuses an inspection the user can no longer change, and a file that is not Media's", async () => {
    useDatabase(mediaRows([{ id: PHOTO, module_key: null, target: null }], []), false);
    expect(await moveMedia(INSPECTION, { kind: "photo", id: PHOTO }, "media_proof")).toEqual({ ok: false, error: MEDIA_MESSAGES.forbidden });

    useDatabase(mediaRows([], [{ id: VIDEO, module_key: "source_documents" }]));
    expect(await moveMedia(INSPECTION, { kind: "video", id: VIDEO }, "media_proof")).toEqual({ ok: false, error: MEDIA_MESSAGES.videoGone });
    expect(writes()).toEqual([]);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});

describe("sortMediaWithAi", () => {
  it("files what the AI is sure of, leaves the rest where it is, and records the batch", async () => {
    useDatabase(
      mediaRows(
        [
          { id: PHOTO, module_key: null, target: null },
          { id: PHOTO_2, module_key: null, target: null },
        ],
        [{ id: VIDEO, module_key: "source_media" }],
      ),
    );
    vi.mocked(sortMedia).mockResolvedValue({ ok: true, categories: ["media_samples", null, "media_proof"], model: "claude-opus-5-5" });
    const recorder = vi.fn();
    vi.mocked(recordAiUsageLater).mockReturnValue(recorder);

    const result = await sortMediaWithAi(INSPECTION, [item("photo", PHOTO), item("photo", PHOTO_2, PNG), item("video", VIDEO), item("photo", ELSEWHERE)]);

    expect(result).toEqual({
      ok: true,
      sorted: [
        { kind: "photo", id: PHOTO, category: "media_samples" },
        { kind: "photo", id: PHOTO_2, category: null },
        { kind: "video", id: VIDEO, category: "media_proof" },
        // Not this inspection's: never sent to the AI, never written.
        { kind: "photo", id: ELSEWHERE, category: null },
      ],
    });
    expect(vi.mocked(sortMedia).mock.calls[0][0]).toEqual([
      { kind: "photo", mediaType: "image/jpeg", base64: JPEG },
      { kind: "photo", mediaType: "image/png", base64: PNG },
      { kind: "video", mediaType: "image/jpeg", base64: JPEG },
    ]);
    // The batch's cost (Steri-AI Cost): this inspection, the caller, the three previews sent.
    expect(recordAiUsageLater).toHaveBeenCalledWith({ feature: "media_sort", inspectionId: INSPECTION, actorId: "inspector-id", itemCount: 3 });
    expect(vi.mocked(sortMedia).mock.calls[0][2]).toBe(recorder);
    expect(writes().map((query) => [query.table, arg(query, "update")])).toEqual([
      ["inspection_photos", [{ module_key: "media_samples", target: null }]],
      ["inspection_files", [{ module_key: "media_proof" }]],
    ]);
    expect(adminRpc).toHaveBeenCalledTimes(1);
    expect(adminRpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: INSPECTION,
      action: "media_sorted",
      changes: {
        by: "inspector-id",
        model: "claude-opus-5-5",
        photos: 2,
        videos: 1,
        categories: { media_warehouse: 0, media_samples: 1, media_proof: 1, media_defects: 0 },
        unsure: 1,
      },
    });
  });

  it("passes on the AI's words when it cannot sort, and changes nothing", async () => {
    useDatabase(mediaRows([{ id: PHOTO, module_key: null, target: null }], []));
    const message = "Auto-Sort needs Steri-AI, which is not connected yet. Ask an admin to add the Anthropic API key under Admin > Steri-AI Settings.";
    vi.mocked(sortMedia).mockResolvedValue({ ok: false, reason: "not_connected", message });

    expect(await sortMediaWithAi(INSPECTION, [item("photo", PHOTO)])).toEqual({ ok: false, error: message });
    expect(writes()).toEqual([]);
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
