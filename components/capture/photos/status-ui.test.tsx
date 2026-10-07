// The pending badge, the notices above the photos and a photo's card, as
// the server renders them for each upload state (the queue is a given state
// here; its rules are tested in photo-model and queue-store-state).
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./hooks", () => ({ usePhotoUploadStatus: vi.fn(), usePhotoQueue: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => "/inspections/0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e/photos" }));

import type { UploadItem } from "@/lib/photos/upload-queue";
import { usePhotoQueue, usePhotoUploadStatus } from "./hooks";
import { PhotoCard, tileState } from "./photo-card";
import type { PhotoUploadStatus, SlotPhoto } from "./photo-model";
import { EMPTY_QUEUE_SNAPSHOT, INITIAL_QUEUE_STATE, QUEUE_PROBLEMS, type PhotoQueueState } from "./queue-state";
import { UploadNotices } from "./upload-notices";
import { PhotoUploadBadge } from "./upload-badge";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const render = (element: ReactElement) => renderToStaticMarkup(element);

const NOTHING: PhotoUploadStatus = {
  ready: true,
  preparing: 0,
  photos: 0,
  files: 0,
  failed: 0,
  pending: 0,
  online: true,
  blocking: false,
  message: null,
};

const item = (id: string, patch: Partial<UploadItem> = {}): UploadItem => ({
  id,
  kind: "photo",
  inspectionId: INSPECTION,
  moduleKey: "dimensions",
  target: null,
  caption: null,
  name: null,
  flagged: false,
  takenAt: null,
  state: "waiting",
  progress: 0,
  error: null,
  createdAt: 1,
  ...patch,
});

function queueState(patch: Partial<PhotoQueueState> & { items?: UploadItem[]; online?: boolean; localCopy?: boolean; error?: PhotoQueueState["queue"]["error"]; retagFailures?: PhotoQueueState["queue"]["retagFailures"] } = {}): PhotoQueueState {
  const { items = [], online = true, localCopy = true, error = null, retagFailures = [], ...rest } = patch;
  return {
    ...INITIAL_QUEUE_STATE,
    phase: "ready",
    userId: "inspector",
    queue: { ...EMPTY_QUEUE_SNAPSHOT, load: "ready", items, pending: items.length, online, localCopy, error, retagFailures },
    ...rest,
  };
}

beforeEach(() => {
  vi.mocked(usePhotoUploadStatus).mockReset();
  vi.mocked(usePhotoQueue).mockReset();
});

describe("PhotoUploadBadge", () => {
  const badge = (status: Partial<PhotoUploadStatus>) => {
    vi.mocked(usePhotoUploadStatus).mockReturnValue({ ...NOTHING, ...status });
    return render(<PhotoUploadBadge inspectionId={INSPECTION} />);
  };

  it("is hidden when nothing waits, and where uploads cannot run at all", () => {
    expect(badge({})).toBe("");
    expect(badge({ ready: true, blocking: false })).toBe("");
  });

  it("never shows a reassuring 0 while the device is still being checked", () => {
    const html = badge({ ready: false, blocking: true, message: "Checking for photos waiting on this device." });
    expect(html).toContain('data-state="checking"');
    expect(html).toContain("Checking for photos waiting on this device");
    expect(html).not.toContain("data-count");
  });

  it("counts what waits, read as one phrase", () => {
    const html = badge({ photos: 2, files: 1, pending: 3, blocking: true, message: "Waiting for 2 photos and 1 file to upload." });
    expect(html).toContain('data-state="pending"');
    expect(html).toContain('data-count="3"');
    expect(html).toContain("2 photos and 1 file waiting to upload");
  });

  it("turns red and says what to do when an upload stopped", () => {
    const message = "1 photo could not upload. Try again, or remove it.";
    const html = badge({ photos: 1, failed: 1, pending: 1, blocking: true, message });
    expect(html).toContain('data-state="failed"');
    expect(html).toContain(`title="${message}"`);
    expect(html).toContain(`<span class="sr-only">${message}</span>`);
  });
});

describe("UploadNotices", () => {
  const notices = (state: PhotoQueueState) => {
    vi.mocked(usePhotoQueue).mockReturnValue(state);
    return render(<UploadNotices inspectionId={INSPECTION} />);
  };

  it("says nothing while uploads simply run", () => {
    expect(notices(queueState({ items: [item("a")] }))).toBe("");
  });

  it("says when photos cannot be added on this device at all", () => {
    const html = notices(queueState({ phase: "unavailable", problem: QUEUE_PROBLEMS.failedToStart }));
    expect(html).toContain("Photos cannot be added on this device");
    expect(html).toContain(QUEUE_PROBLEMS.failedToStart);
  });

  it("says photos wait on the device while offline, and asks to sign in again when the session ended", () => {
    expect(notices(queueState({ items: [item("a"), item("b")], online: false }))).toContain("2 photos wait on this device and upload when the connection is back");
    const signedOut = notices(queueState({ items: [item("a")], error: { reason: "unauthorized", message: "Your session has ended." } }));
    expect(signedOut).toContain("Sign in again to upload");
    expect(signedOut).toContain(`href="/login?next=${encodeURIComponent(`/inspections/${INSPECTION}/photos`)}"`);
  });

  it("asks to keep the page open when the browser cannot keep the photos", () => {
    expect(notices(queueState({ items: [item("a")], localCopy: false }))).toContain("Keep this page open");
  });

  it("words a refused retag plainly, never with the database's text", () => {
    const html = notices(
      queueState({
        retagFailures: [
          {
            id: "a",
            inspectionId: INSPECTION,
            moduleKey: "visual",
            target: null,
            caption: "Stain",
            error: { reason: "forbidden", message: "new row violates row-level security policy" },
          },
        ],
      }),
    );
    expect(html).toContain("A new tag was not saved");
    expect(html).toContain("This inspection can no longer be changed from this account.");
    expect(html).not.toContain("row-level security");
  });
});

describe("PhotoCard", () => {
  const base: SlotPhoto = {
    id: "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f",
    queued: false,
    moduleKey: "dimensions",
    target: null,
    caption: null,
    takenAt: null,
    flagged: false,
    includeInReport: false,
    state: "uploaded",
    progress: 1,
    error: null,
    thumbUrl: "https://signed/thumb",
    fullUrl: "https://signed/full",
    pendingRow: false,
  };
  const card = (photo: Partial<SlotPhoto>, rights: { canEdit?: boolean; canChooseReport?: boolean } = {}) =>
    render(
      <PhotoCard
        inspectionId={INSPECTION}
        photo={{ ...base, ...photo }}
        tags={{ module: "Dimensions" }}
        alt="Dimensions"
        canEdit={rights.canEdit ?? true}
        canChooseReport={rights.canChooseReport ?? false}
        onOpen={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onRetry={() => undefined}
      />,
    );

  it("keeps every tile's image 4:3, portrait photos included (the kit tile's own box)", () => {
    const html = card({});
    expect(html).toMatch(/data-slot="photo-image" class="[^"]*aspect-\[4\/3\][^"]*overflow-hidden/);
    // No workaround of the card's own any more.
    expect(html).not.toContain("[&amp;&gt;div:first-child]");
  });

  it("shows a stopped upload as the tile's stopped state, with what to do, instead of 'Waiting to upload'", () => {
    const reason = "This inspection can no longer be changed from this account. Ask an admin to reopen it, then try again.";
    const html = card({ queued: true, state: "failed", progress: 0, error: reason, thumbUrl: "blob:local" });
    expect(html).toContain('data-state="failed"');
    // The tile's own words (components/qc/photo-tile.tsx), in whatever case the kit writes them.
    expect(html).toMatch(/data-slot="upload-stopped"[^>]*>.*Upload stopped/i);
    expect(html).toContain(reason);
    // Never waiting, never a progress bar: the tile says stopped and nothing else.
    expect(html).not.toMatch(/Waiting to upload/i);
    expect(html).not.toContain('role="progressbar"');
    expect(html.match(/Upload stopped/gi)).toHaveLength(1);
    expect(html).toContain(">Try Again</button>");
    expect(html).toContain('aria-label="Try Again: Dimensions"');
    expect(html).toContain("Remove");
  });

  it("maps each upload state to the tile's", () => {
    expect(tileState({ state: "waiting", flagged: false })).toBe("pending");
    expect(tileState({ state: "uploading", flagged: false })).toBe("pending");
    expect(tileState({ state: "failed", flagged: true })).toBe("failed");
    expect(tileState({ state: "uploaded", flagged: true })).toBe("flagged");
    expect(tileState({ state: "uploaded", flagged: false })).toBe("uploaded");
  });

  it("offers the report choice only once the photo's row is read", () => {
    expect(card({}, { canChooseReport: true })).toContain('role="switch"');
    const reading = card({ pendingRow: true }, { canChooseReport: true });
    expect(reading).not.toContain('role="switch"');
    expect(reading).toContain("data-pending-row");
    expect(card({ state: "uploading", queued: true }, { canChooseReport: true })).not.toContain('role="switch"');
  });
});
