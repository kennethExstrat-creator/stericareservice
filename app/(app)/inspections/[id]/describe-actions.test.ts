import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ loadAiEnv: vi.fn() }));
vi.mock("@/lib/ai/usage", () => ({ recordAiUsageLater: vi.fn() }));
vi.mock("@/lib/ai/photo-image", () => ({ imageForClaude: vi.fn() }));
vi.mock("@/lib/ai/photo-describer", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/photo-describer")>()),
  describePhotoBatch: vi.fn(),
}));

import { describePhotoBatch } from "@/lib/ai/photo-describer";
import { imageForClaude } from "@/lib/ai/photo-image";
import { recordAiUsageLater } from "@/lib/ai/usage";
import { authorizeAction } from "@/lib/auth/session";
import { stdEgTemplate } from "@/lib/export/__fixtures__/std-eg";
import { DESCRIBE_MESSAGES } from "@/lib/inspections/photos/descriptions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { describePhotos } from "./describe-actions";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const DEFECT = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const HOLE = "3e4f5a6b-7c8d-4e9f-8a0b-1c2d3e4f5a6b";
const DESCRIBED = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const HEIC = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const MISSING = "5a6b7c8d-9e0f-4a1b-8c2d-3e4f5a6b7c8d";

const IMAGE = { mediaType: "image/jpeg" as const, base64: "/9j/AAAA" };
const PINHOLE = { text: "Pinhole, palm area", kind: "defect" as const, defect: "hole_palm", location: "hole_palm", clarity: 0.9, check: "watertight" as const };
const RIG = { text: "Test rig", kind: "context" as const, defect: null, location: null, clarity: 0.8, check: "watertight" as const };

type Row = Record<string, unknown>;
const PHOTOS: Row[] = [
  { id: DEFECT, module_key: "media_defects", target: null, caption: null, flagged: false, storage_path: `${INSPECTION}/${DEFECT}.jpg`, ai_described_at: null },
  { id: HOLE, module_key: "watertight", target: "size:M/defect:hole_palm", caption: "Leak", flagged: false, storage_path: `${INSPECTION}/${HOLE}.jpg`, ai_described_at: null },
  { id: DESCRIBED, module_key: "media_samples", target: null, caption: null, flagged: false, storage_path: `${INSPECTION}/${DESCRIBED}.jpg`, ai_described_at: "2026-10-27T02:00:00+00:00" },
  { id: HEIC, module_key: "media_defects", target: null, caption: null, flagged: true, storage_path: `${INSPECTION}/${HEIC}.heic`, ai_described_at: null },
];

/* ------------------------------------------------------------------ *
 * The caller's client (reads, can_edit_inspection) and the secret key's
 * (downloads, the descriptions' writes, the audit row).
 * ------------------------------------------------------------------ */

let canEdit: boolean;
let photoRows: Row[];
let photosError: { code: string; message: string } | null;
/** The read of the inspector's defect marks (migration 20261027210000) alone fails with this. */
let markersError: { code: string; message: string } | null;
let writes: { payload: Row; filters: unknown[][] }[];
let refusedWrites: Set<string>;
const adminRpc = vi.fn();
const download = vi.fn();

function userClient() {
  const from = (table: string) => {
    const filters: unknown[][] = [];
    const builder: Record<string, unknown> = {};
    const answer = () => {
      if (table === "inspections") {
        return { data: { id: INSPECTION, module_overrides: {}, template: { resolved: stdEgTemplate() } }, error: null };
      }
      const columns = filters.find(([method]) => method === "select")?.[1];
      if (markersError && typeof columns === "string" && columns.includes("markers")) return { data: null, error: markersError };
      if (photosError) return { data: null, error: photosError };
      const ids = filters.find(([method]) => method === "in")?.[2] as string[];
      return { data: photoRows.filter((row) => ids.includes(row.id as string)), error: null };
    };
    for (const method of ["select", "eq", "in"]) {
      builder[method] = (...args: unknown[]) => {
        filters.push([method, ...args]);
        return builder;
      };
    }
    builder.maybeSingle = async () => answer();
    builder.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) => Promise.resolve(answer()).then(resolve, reject);
    return builder;
  };
  return { from, rpc: vi.fn(async () => ({ data: canEdit, error: null })) };
}

function adminClient() {
  const from = () => {
    const write = { payload: {} as Row, filters: [] as unknown[][] };
    const builder: Record<string, unknown> = {
      update: (payload: Row) => {
        write.payload = payload;
        writes.push(write);
        return builder;
      },
      eq: (...args: unknown[]) => {
        write.filters.push(args);
        return builder;
      },
      select: () => builder,
      maybeSingle: async () => {
        const id = write.filters.find(([column]) => column === "id")?.[1] as string;
        return refusedWrites.has(id)
          ? { data: null, error: { code: "42501", message: "the photos and files of an approved inspection are read-only" } }
          : { data: { id }, error: null };
      },
    };
    return builder;
  };
  return { from, rpc: adminRpc, storage: { from: () => ({ download }) } };
}

const usage = vi.fn();

beforeEach(() => {
  canEdit = true;
  photoRows = PHOTOS;
  photosError = null;
  markersError = null;
  writes = [];
  refusedWrites = new Set();
  vi.mocked(authorizeAction).mockResolvedValue({
    ok: true,
    user: { id: "inspector-id", email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" },
  } as never);
  vi.mocked(createClient).mockResolvedValue(userClient() as never);
  vi.mocked(createAdminClient).mockReturnValue(adminClient() as never);
  adminRpc.mockResolvedValue({ data: 1, error: null });
  download.mockImplementation(async () => ({ data: new Blob([Uint8Array.from([0xff, 0xd8, 0xff])]), error: null }));
  vi.mocked(imageForClaude).mockResolvedValue(IMAGE);
  vi.mocked(recordAiUsageLater).mockReturnValue(usage);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.resetAllMocks();
  vi.restoreAllMocks();
});

describe("describePhotos: who and what", () => {
  it("is for a role with Steri-AI Reading", async () => {
    vi.mocked(authorizeAction).mockResolvedValue({ ok: false, error: "You do not have permission to do that." });
    expect(await describePhotos(INSPECTION, [DEFECT])).toEqual({ ok: false, error: "You do not have permission to do that." });
    expect(authorizeAction).toHaveBeenCalledWith({ permission: "ai_reading" });
    expect(createClient).not.toHaveBeenCalled();
  });

  it.each([
    ["an inspection id that is no id", () => describePhotos("nope", [DEFECT])],
    ["no photos", () => describePhotos(INSPECTION, [])],
    ["more than a batch", () => describePhotos(INSPECTION, [DEFECT, HOLE, DESCRIBED, HEIC, MISSING])],
    ["a photo twice", () => describePhotos(INSPECTION, [DEFECT, DEFECT])],
    ["a photo id that is no id", () => describePhotos(INSPECTION, ["../etc"])],
  ])("refuses %s before it reads anything", async (_label, run) => {
    expect(await run()).toEqual({ ok: false, error: DESCRIBE_MESSAGES.invalid });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("follows the database's rule for the inspection's photos (can_edit_inspection), as Auto-Sort does", async () => {
    canEdit = false;
    expect(await describePhotos(INSPECTION, [DEFECT])).toEqual({ ok: false, error: DESCRIBE_MESSAGES.forbidden });
    expect(describePhotoBatch).not.toHaveBeenCalled();
    expect(writes).toEqual([]);
  });

  it("stops quietly on a project without migration 20261027200000", async () => {
    photosError = { code: "42703", message: "column inspection_photos.ai_described_at does not exist" };
    expect(await describePhotos(INSPECTION, [DEFECT])).toEqual({ ok: false, error: DESCRIBE_MESSAGES.notReady, quiet: true });
    expect(describePhotoBatch).not.toHaveBeenCalled();
  });
});

describe("describePhotos: describing", () => {
  it("describes the photos with the template's list, writes each description with the secret key, and records the batch", async () => {
    vi.mocked(describePhotoBatch).mockResolvedValue({
      ok: true,
      model: "claude-opus-5-5",
      answers: [{ description: RIG }, { description: PINHOLE }],
    });
    const result = await describePhotos(INSPECTION, [DEFECT, HOLE]);
    expect(result).toEqual({
      ok: true,
      photos: [
        { id: DEFECT, description: RIG, describedAt: expect.any(String) },
        { id: HOLE, description: PINHOLE, describedAt: expect.any(String) },
      ],
    });

    const [sent, vocabulary, , onCall] = vi.mocked(describePhotoBatch).mock.calls[0];
    expect(sent).toEqual([
      { image: IMAGE, tags: "Product Defects", caption: null },
      { image: IMAGE, tags: expect.stringMatching(/^Watertight.* · Size M · Palm$/), caption: "Leak" },
    ]);
    expect(vocabulary.holes.map((hole) => hole.code)).toContain("hole_palm");
    expect(onCall).toBe(usage);
    expect(recordAiUsageLater).toHaveBeenCalledWith({ feature: "photo_description", inspectionId: INSPECTION, actorId: "inspector-id", itemCount: 2 });
    expect(download).toHaveBeenCalledWith(`${INSPECTION}/${DEFECT}.jpg`);

    expect(writes.map((write) => [write.payload, write.filters])).toEqual([
      [{ ai_description: RIG, ai_described_at: expect.any(String) }, [["id", DEFECT], ["inspection_id", INSPECTION]]],
      [{ ai_description: PINHOLE, ai_described_at: expect.any(String) }, [["id", HOLE], ["inspection_id", INSPECTION]]],
    ]);
    expect(adminRpc).toHaveBeenCalledWith("log_inspection_event", {
      inspection_id: INSPECTION,
      action: "photos_described",
      changes: { by: "inspector-id", model: "claude-opus-5-5", photos: 2 },
    });
  });

  // Media's defect marks (Kenneth, 27 October 2026): the circles go with the photo they are on, for the caption to name
  // the defect circled and its place.
  it("tells Steri-AI where the inspector circled a defect, and describes as before where no marks can be read", async () => {
    const circle = { x: 0.42, y: 0.58, r: 0.12 };
    photoRows = PHOTOS.map((row) => ({ ...row, markers: row.id === DEFECT ? [circle] : [] }));
    vi.mocked(describePhotoBatch).mockResolvedValue({ ok: true, model: "claude-opus-5-5", answers: [{ description: PINHOLE }, { description: RIG }] });
    await describePhotos(INSPECTION, [DEFECT, HOLE]);
    expect(vi.mocked(describePhotoBatch).mock.calls[0][0]).toEqual([
      { image: IMAGE, tags: "Product Defects", caption: null, markers: [circle] },
      { image: IMAGE, tags: expect.stringMatching(/^Watertight.* · Size M · Palm$/), caption: "Leak" },
    ]);

    // A project without migration 20261027210000 has no marks to read: the photos are described all the same, quietly.
    vi.mocked(describePhotoBatch).mockClear();
    vi.mocked(console.error).mockClear();
    markersError = { code: "42703", message: "column inspection_photos.markers does not exist" };
    expect(await describePhotos(INSPECTION, [DEFECT])).toMatchObject({ ok: true });
    expect(vi.mocked(describePhotoBatch).mock.calls[0][0]).toEqual([{ image: IMAGE, tags: "Product Defects", caption: null }]);
    expect(console.error).not.toHaveBeenCalled();
  });

  it("never sends a flagged original, and a described photo only when asked again", async () => {
    expect(await describePhotos(INSPECTION, [DESCRIBED, HEIC])).toEqual({ ok: true, photos: [] });
    expect(describePhotoBatch).not.toHaveBeenCalled();

    vi.mocked(describePhotoBatch).mockResolvedValue({ ok: true, model: "claude-opus-5-5", answers: [{ description: RIG }] });
    const again = await describePhotos(INSPECTION, [DESCRIBED, HEIC], { again: true });
    expect(again).toEqual({ ok: true, photos: [{ id: DESCRIBED, description: RIG, describedAt: expect.any(String) }] });
    expect(adminRpc).toHaveBeenCalledWith("log_inspection_event", expect.objectContaining({ changes: { by: "inspector-id", model: "claude-opus-5-5", photos: 1, again: true } }));
  });

  it("answers that the photos are gone when none asked for is the inspection's", async () => {
    expect(await describePhotos(INSPECTION, [MISSING])).toEqual({ ok: false, error: DESCRIBE_MESSAGES.gone });
  });

  it("records a photo Steri-AI could not make out as looked at, and leaves one it gave no answer for", async () => {
    vi.mocked(describePhotoBatch).mockResolvedValue({ ok: true, model: "claude-opus-5-5", answers: [{ description: null }, null] });
    const result = await describePhotos(INSPECTION, [DEFECT, HOLE]);
    expect(result).toEqual({ ok: true, photos: [{ id: DEFECT, description: null, describedAt: expect.any(String) }] });
    expect(writes.map((write) => write.filters[0])).toEqual([["id", DEFECT]]);
    expect(adminRpc).toHaveBeenCalledWith("log_inspection_event", expect.objectContaining({ changes: { by: "inspector-id", model: "claude-opus-5-5", photos: 1, unclear: 1 } }));
  });

  it("records a photo that is no image Claude can read without asking Claude, and leaves one it could not download", async () => {
    vi.mocked(imageForClaude).mockResolvedValue(null);
    download.mockImplementation(async (path: string) =>
      path.includes(HOLE) ? { data: null, error: { message: "Object not found" } } : { data: new Blob([Uint8Array.from([1, 2, 3])]), error: null },
    );
    const result = await describePhotos(INSPECTION, [DEFECT, HOLE]);
    expect(result).toEqual({ ok: true, photos: [{ id: DEFECT, description: null, describedAt: expect.any(String) }] });
    expect(describePhotoBatch).not.toHaveBeenCalled();
    expect(adminRpc).toHaveBeenCalledWith("log_inspection_event", expect.objectContaining({ changes: { by: "inspector-id", photos: 1, unclear: 1 } }));

    download.mockResolvedValue({ data: null, error: { message: "Storage is down" } });
    expect(await describePhotos(INSPECTION, [DEFECT])).toEqual({ ok: false, error: DESCRIBE_MESSAGES.unreadable });
  });

  it("passes on Steri-AI's failure in its own words, writing nothing", async () => {
    vi.mocked(describePhotoBatch).mockResolvedValue({ ok: false, reason: "error", message: "Steri-AI is busy. Wait a minute and try again." });
    expect(await describePhotos(INSPECTION, [DEFECT])).toEqual({ ok: false, error: "Steri-AI is busy. Wait a minute and try again." });
    expect(writes).toEqual([]);
    expect(adminRpc).not.toHaveBeenCalled();
  });

  it("leaves out a description the database refused (the inspection approved meanwhile)", async () => {
    vi.mocked(describePhotoBatch).mockResolvedValue({ ok: true, model: "claude-opus-5-5", answers: [{ description: RIG }, { description: PINHOLE }] });
    refusedWrites = new Set([HOLE]);
    expect(await describePhotos(INSPECTION, [DEFECT, HOLE])).toEqual({ ok: true, photos: [{ id: DEFECT, description: RIG, describedAt: expect.any(String) }] });

    refusedWrites = new Set([DEFECT, HOLE]);
    expect(await describePhotos(INSPECTION, [DEFECT, HOLE])).toEqual({ ok: false, error: DESCRIBE_MESSAGES.gone });
  });
});
