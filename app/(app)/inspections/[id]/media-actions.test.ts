import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn(), userCan: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ loadAiEnv: vi.fn() }));
vi.mock("@/lib/ai/media-sorter", () => ({ sortMedia: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsageLater: vi.fn() }));
vi.mock("@/lib/ai/photo-image", () => ({ imageForClaude: vi.fn() }));

import { sortMedia } from "@/lib/ai/media-sorter";
import { imageForClaude } from "@/lib/ai/photo-image";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction, userCan } from "@/lib/auth/session";
import { MEDIA_MESSAGES } from "@/lib/inspections/media-moves";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { moveMedia, savePhotoMarkers, sortMediaWithAi, type SortMediaItem } from "./media-actions";

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
/** Storage's download, for the photo Steri-AI looks at again. */
const download = vi.fn();
const storageFrom = vi.fn(() => ({ download }));

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
  vi.mocked(createClient).mockResolvedValue({ from, rpc, storage: { from: storageFrom } } as never);
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
  vi.mocked(userCan).mockReturnValue(true);
  storageFrom.mockImplementation(() => ({ download }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
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

/* ------------------------------------------------------------------ *
 * Defect marks (Kenneth, 27 October 2026)
 * ------------------------------------------------------------------ */

describe("savePhotoMarkers", () => {
  const CIRCLE = { x: 0.4, y: 0.6, r: 0.1 };
  const STORED = `${INSPECTION}/${PHOTO}.jpg`;
  const THUMB = `${INSPECTION}/thumbs/${PHOTO}.jpg`;
  const JPEG_BYTES = Buffer.from(JPEG, "base64");
  const ROW = { id: PHOTO, module_key: null, target: null, markers: [], width: 2048, height: 1536, storage_path: STORED, thumb_path: THUMB, flagged: false };

  /** The 1,600 px copy of a photo Claude is sent (lib/ai/photo-image.ts), here a stand-in. */
  const COPY = { mediaType: "image/jpeg" as const, base64: "/9j/COPY" };

  /** One photo of an inspection at `status` as the database holds it: the reads answer the row, every write its id. */
  function useOnePhoto(row: Record<string, unknown>, canEdit = true, status = "draft") {
    useDatabase((query) => {
      if (arg(query, "update")) return { data: { id: PHOTO }, error: null };
      if (query.table === "inspections") return { data: { status }, error: null };
      return { data: { ...ROW, ...row }, error: null };
    }, canEdit);
  }

  const updates = () => writes().map((query) => arg(query, "update")?.[0]);
  const moves = () =>
    adminRpc.mock.calls
      .filter(([, args]) => (args as { action: string }).action === "media_moved")
      .map(([, args]) => (args as { changes: unknown }).changes);

  beforeEach(() => {
    download.mockResolvedValue({ data: new Blob([JPEG_BYTES]), error: null });
    vi.mocked(imageForClaude).mockResolvedValue(COPY);
  });

  it.each([
    ["a centre off the photo", [{ ...CIRCLE, x: 1.2 }], MEDIA_MESSAGES.badMarkers],
    ["a circle that is no circle", ["circle"], MEDIA_MESSAGES.badMarkers],
    ["marks that are no list", { x: 0.5 }, MEDIA_MESSAGES.badMarkers],
    ["21 circles", Array.from({ length: 21 }, () => CIRCLE), MEDIA_MESSAGES.tooManyMarkers],
  ])("refuses %s before it reads anything", async (_name, markers, error) => {
    expect(await savePhotoMarkers(INSPECTION, PHOTO, markers as never)).toEqual({ ok: false, error });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a photo id that is no id, and checks the session first", async () => {
    expect(await savePhotoMarkers(INSPECTION, "nope", [CIRCLE])).toEqual({ ok: false, error: MEDIA_MESSAGES.itemGone });
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "Your session has ended. Sign in again." });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: false, error: "Your session has ended. Sign in again." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("puts a photo in Product Defects with its first mark, in the same write, recorded as a move by hand is", async () => {
    useOnePhoto({ module_key: "visual", target: "size:M/defect:thin_spot" });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE], { width: 2048, height: 1536 })).toEqual({
      ok: true,
      markers: [CIRCLE],
      moved: { moduleKey: "media_defects" },
      size: null,
    });
    expect(rpc).toHaveBeenCalledWith("can_edit_inspection", { inspection_id: INSPECTION });
    // The photo's size is stored already: only the marks and the move are written.
    expect(updates()).toEqual([{ markers: [CIRCLE], module_key: "media_defects", target: null }]);
    expect(moves()).toEqual([
      { by: "inspector-id", photo_id: PHOTO, from: "visual", to: "media_defects", target: "size:M/defect:thin_spot", via: "defect_marked" },
    ]);
    expect(sortMedia).not.toHaveBeenCalled();
  });

  it("keeps marks without a move when the photo is in Product Defects already, or has marks already", async () => {
    useOnePhoto({ module_key: "media_defects" });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: true, markers: [CIRCLE], size: null });
    expect(updates()).toEqual([{ markers: [CIRCLE] }]);

    // Moved by hand to Warehouse after its first mark: a second mark leaves it there.
    useOnePhoto({ module_key: "media_warehouse", markers: [CIRCLE] });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE, { x: 0.1, y: 0.1, r: 0.05 }])).toMatchObject({ ok: true });
    expect(updates()).toEqual([{ markers: [CIRCLE, { x: 0.1, y: 0.1, r: 0.05 }] }]);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("saves the preview's natural size with the marks of a photo stored without one", async () => {
    useOnePhoto({ module_key: "media_defects", width: null, height: null, flagged: true });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE], { width: 4032, height: 3024 })).toEqual({
      ok: true,
      markers: [CIRCLE],
      size: { width: 4032, height: 3024 },
    });
    expect(updates()).toEqual([{ markers: [CIRCLE], width: 4032, height: 3024 }]);

    // A size that is no size is left out, never a refusal.
    useOnePhoto({ module_key: "media_defects", width: null, height: null });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE], { width: 0, height: 3024 })).toEqual({ ok: true, markers: [CIRCLE], size: null });
    expect(updates()).toEqual([{ markers: [CIRCLE] }]);
  });

  it("has Steri-AI sort a photo again among the other categories once its last mark is taken off in Product Defects", async () => {
    useOnePhoto({ module_key: "media_defects", markers: [CIRCLE] });
    vi.mocked(sortMedia).mockResolvedValue({ ok: true, categories: ["media_samples"], model: "claude-opus-5-5" });
    const recorder = vi.fn();
    vi.mocked(recordAiUsageLater).mockReturnValue(recorder);

    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toEqual({ ok: true, markers: [], moved: { moduleKey: "media_samples" }, size: null });

    expect(userCan).toHaveBeenCalledWith(expect.objectContaining({ id: "inspector-id" }), "ai_reading");
    expect(storageFrom).toHaveBeenCalledWith("inspection-photos");
    expect(download).toHaveBeenCalledWith(STORED);
    // Claude gets the 1,600 px copy Describing photos sends, made from the stored photo's bytes.
    expect(Buffer.from(vi.mocked(imageForClaude).mock.calls[0][0])).toEqual(JPEG_BYTES);
    const [previews, , onCall, options] = vi.mocked(sortMedia).mock.calls[0];
    expect(previews).toEqual([{ kind: "photo", ...COPY }]);
    expect(options).toEqual({ exclude: ["media_defects"] });
    expect(onCall).toBe(recorder);
    expect(recordAiUsageLater).toHaveBeenCalledWith({ feature: "media_sort", inspectionId: INSPECTION, actorId: "inspector-id", itemCount: 1 });
    // The marks first, then the move, as a move by hand writes it.
    expect(updates()).toEqual([{ markers: [] }, { module_key: "media_samples", target: null }]);
    expect(moves()).toEqual([
      { by: "inspector-id", photo_id: PHOTO, from: "media_defects", to: "media_samples", target: null, via: "marks_removed", model: "claude-opus-5-5" },
    ]);
  });

  it("puts the photo in Other when Steri-AI is unsure, fails or has nothing it can read", async () => {
    useOnePhoto({ module_key: "media_defects", markers: [CIRCLE] });
    vi.mocked(sortMedia).mockResolvedValue({ ok: true, categories: [null], model: "claude-opus-5-5" });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toEqual({ ok: true, markers: [], moved: { moduleKey: null }, size: null });
    expect(updates()).toEqual([{ markers: [] }, { module_key: null, target: null }]);
    expect(moves()).toEqual([
      { by: "inspector-id", photo_id: PHOTO, from: "media_defects", to: null, target: null, via: "marks_removed", model: "claude-opus-5-5" },
    ]);

    adminRpc.mockClear();
    useOnePhoto({ module_key: "media_defects", markers: [CIRCLE] });
    vi.mocked(sortMedia).mockResolvedValue({ ok: false, reason: "not_connected", message: "Auto-Sort needs Steri-AI." });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toEqual({ ok: true, markers: [], moved: { moduleKey: null }, size: null });
    expect(moves()).toEqual([{ by: "inspector-id", photo_id: PHOTO, from: "media_defects", to: null, target: null, via: "marks_removed" }]);

    // A flagged HEIC original without a thumbnail: nothing Claude reads, so no request.
    vi.mocked(sortMedia).mockClear();
    useOnePhoto({ module_key: "media_defects", markers: [CIRCLE], flagged: true, thumb_path: null, storage_path: `${INSPECTION}/${PHOTO}.heic` });
    vi.mocked(imageForClaude).mockResolvedValue(null);
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toMatchObject({ ok: true, moved: { moduleKey: null } });
    expect(sortMedia).not.toHaveBeenCalled();
  });

  it("sends the thumbnail when the stored photo is no image Claude reads", async () => {
    useOnePhoto({ module_key: "media_defects", markers: [CIRCLE] });
    vi.mocked(imageForClaude).mockResolvedValueOnce(null).mockResolvedValueOnce(COPY);
    vi.mocked(sortMedia).mockResolvedValue({ ok: true, categories: ["media_proof"], model: "claude-opus-5-5" });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toMatchObject({ ok: true, moved: { moduleKey: "media_proof" } });
    expect(download.mock.calls.map(([path]) => path)).toEqual([STORED, THUMB]);
    expect(vi.mocked(sortMedia).mock.calls[0][0]).toEqual([{ kind: "photo", ...COPY }]);
  });

  it("puts the photo in Other without asking Steri-AI for a role without Steri-AI Reading", async () => {
    vi.mocked(userCan).mockReturnValue(false);
    useOnePhoto({ module_key: "media_defects", markers: [CIRCLE] });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toEqual({ ok: true, markers: [], moved: { moduleKey: null }, size: null });
    expect(download).not.toHaveBeenCalled();
    expect(sortMedia).not.toHaveBeenCalled();
    expect(moves()).toEqual([{ by: "inspector-id", photo_id: PHOTO, from: "media_defects", to: null, target: null, via: "marks_removed" }]);
  });

  it("leaves a photo where it is when its last mark is taken off anywhere but Product Defects", async () => {
    useOnePhoto({ module_key: "media_samples", markers: [CIRCLE] });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [])).toEqual({ ok: true, markers: [], size: null });
    expect(updates()).toEqual([{ markers: [] }]);
    expect(sortMedia).not.toHaveBeenCalled();
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("refuses a photo the user can no longer change, and says when the server has nowhere to keep marks", async () => {
    useOnePhoto({}, false);
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: false, error: MEDIA_MESSAGES.forbidden });
    expect(writes()).toEqual([]);

    // Marks follow Media's board (Kenneth, 27 October 2026): a submitted inspection's are read-only, also for an admin
    // the database would let change its photos; a reopened one's change again.
    useOnePhoto({}, true, "submitted");
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: false, error: MEDIA_MESSAGES.forbidden });
    expect(writes()).toEqual([]);
    useOnePhoto({}, true, "approved");
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: false, error: MEDIA_MESSAGES.forbidden });
    expect(writes()).toEqual([]);
    useOnePhoto({ module_key: "media_defects" }, true, "reopened");
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toMatchObject({ ok: true });

    useDatabase(() => ({ data: null, error: { code: "42703", message: "column inspection_photos.markers does not exist" } }));
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: false, error: MEDIA_MESSAGES.markersNotReady });
    expect(writes()).toEqual([]);

    // The media guard refuses the write itself (the inspection approved meanwhile).
    useDatabase((query) => {
      if (arg(query, "update")) return { data: null, error: { code: "42501", message: "the photos and files of an approved inspection are read-only" } };
      return query.table === "inspections" ? { data: { status: "draft" }, error: null } : { data: ROW, error: null };
    });
    expect(await savePhotoMarkers(INSPECTION, PHOTO, [CIRCLE])).toEqual({ ok: false, error: MEDIA_MESSAGES.forbidden });
    expect(adminRpc).not.toHaveBeenCalled();
  });
});
