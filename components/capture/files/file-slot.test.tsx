// Source Documents' Files as the server draws them, with the inspection's
// files and upload queue as the browser would have loaded them (Kenneth, 27
// October 2026: "pagination with 10 files per page, the uplaod section should
// be pin at the top"): the upload above the rows, pinned under the screen's
// bars; the newest file first, ten a page, the pages under them; read-only,
// the pages without the upload. Without pageSize the slot is as it was.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({
  media: null as import("@/components/capture/photos/media-store").MediaState | null,
  queue: null as import("@/components/capture/photos/queue-state").PhotoQueueState | null,
}));
vi.mock("@/components/capture/photos/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/capture/photos/hooks")>();
  return {
    ...actual,
    useInspectionMedia: (inspectionId: string) => {
      const media = actual.useInspectionMedia(inspectionId);
      return loaded.media ?? media;
    },
    usePhotoQueue: () => {
      const queue = actual.usePhotoQueue();
      return loaded.queue ?? queue;
    },
  };
});

import type { MediaState } from "@/components/capture/photos/media-store";
import { EMPTY_QUEUE_SNAPSHOT, INITIAL_QUEUE_STATE } from "@/components/capture/photos/queue-state";
import { EMPTY_TAG_OPTIONS, type MediaFile } from "@/lib/inspections/photos/view";
import type { UploadItem } from "@/lib/photos/upload-queue";
import { SOURCE_DOCUMENTS_KEY } from "@/lib/inspections/source-documents";
import { FILES_PER_PAGE } from "./file-pages";
import { FileSlot, type FileSlotProps } from "./file-slot";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** File n, uploaded n minutes after the first. */
function file(n: number): MediaFile {
  return {
    id: id(n),
    inspectionId: INSPECTION,
    moduleKey: SOURCE_DOCUMENTS_KEY,
    kind: "other",
    name: `Document ${n}.pdf`,
    createdBy: INSPECTOR,
    createdAt: `2026-10-27T02:${String(n).padStart(2, "0")}:00+00:00`,
    storagePath: `${INSPECTION}/${id(n)}`,
    url: `https://storage.example/file/${n}`,
  };
}

/** n files, the oldest first, as the page loads them. */
const filesOf = (count: number) => Array.from({ length: count }, (_, index) => file(index + 1));

function ready(files: MediaFile[]): MediaState {
  return {
    status: "ready",
    error: null,
    media: {
      inspection: { id: INSPECTION, refNo: "INS-2026-0042", status: "draft", inspectorId: INSPECTOR },
      access: { canEdit: true, isAdmin: false },
      photos: [],
      files,
      options: EMPTY_TAG_OPTIONS,
      signedAt: 0,
      problems: [],
    },
  };
}

/** This device's queue, read, holding these uploads. */
function queueWith(items: UploadItem[]) {
  return { ...INITIAL_QUEUE_STATE, phase: "ready" as const, queue: { ...EMPTY_QUEUE_SNAPSHOT, load: "ready" as const, items } };
}

const render = (props: Partial<FileSlotProps> = {}) =>
  renderToStaticMarkup(
    <FileSlot
      inspectionId={INSPECTION}
      moduleKey={SOURCE_DOCUMENTS_KEY}
      kind="other"
      title="Files"
      compactRows
      pageSize={FILES_PER_PAGE}
      {...props}
    />,
  );

/** The rows' file names, in order. */
const rowNames = (html: string) =>
  html
    .split('data-slot="file-row"')
    .slice(1)
    .map((row) => /title="([^"]+)"/.exec(row)?.[1]);

/** The opening tag of the element with this data-slot. */
const tagOf = (html: string, slot: string) => new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(html)?.[0] ?? "";

afterEach(() => {
  loaded.media = null;
  loaded.queue = null;
});

describe("Source Documents' Files, ten a page", () => {
  it("puts the upload above the rows, pinned under the screen's bars on the card's white", () => {
    loaded.media = ready(filesOf(23));
    const html = render();
    const bar = tagOf(html, "file-add-bar");
    expect(bar).not.toBe("");
    expect(html.indexOf('data-slot="file-add-bar"')).toBeLessThan(html.indexOf('data-slot="file-row"'));
    for (const name of ["sticky", "top-[var(--capture-sticky-top,0px)]", "z-10", "bg-card"]) {
      expect(bar.match(/class="([^"]*)"/)?.[1].split(/\s+/)).toContain(name);
    }
    // In it: the drop area and Add Document, 44 px on a touchscreen.
    const inBar = html.slice(html.indexOf('data-slot="file-add-bar"'), html.indexOf('data-slot="file-row"'));
    expect(inBar).toContain('data-slot="file-add"');
    expect(inBar).toContain("data-file-input");
    expect(inBar).toMatch(/<button[^>]*class="[^"]*touch:h-11[^"]*"[^>]*>.*?Add Document/);
  });

  it("shows the newest ten first, the pages under them", () => {
    loaded.media = ready(filesOf(23));
    const html = render();
    const names = rowNames(html);
    expect(names).toHaveLength(10);
    expect(names[0]).toBe("Document 23.pdf");
    expect(names[9]).toBe("Document 14.pdf");
    expect(html).toContain("Showing 1–10 of 23");
    expect(html.indexOf('data-slot="file-pagination"')).toBeGreaterThan(html.lastIndexOf('data-slot="file-row"'));
    // The count beside the title still counts them all.
    expect(html).toContain("23 files");
  });

  it("offers no pages for ten files or fewer, the upload still on top", () => {
    loaded.media = ready(filesOf(10));
    const html = render();
    expect(rowNames(html)).toHaveLength(10);
    expect(html).not.toContain('data-slot="file-pagination"');
    expect(html).not.toContain("Showing");
    expect(html.indexOf('data-slot="file-add-bar"')).toBeLessThan(html.indexOf('data-slot="file-row"'));

    loaded.media = ready([]);
    const empty = render();
    expect(empty.indexOf('data-slot="file-add-bar"')).toBeLessThan(empty.indexOf("No documents yet."));
  });

  it("lands a new upload at the top of page 1", () => {
    loaded.media = ready(filesOf(23));
    const upload: UploadItem = {
      id: id(24),
      kind: "file",
      inspectionId: INSPECTION,
      moduleKey: SOURCE_DOCUMENTS_KEY,
      target: null,
      caption: null,
      name: "Packing list.pdf",
      fileKind: "other",
      flagged: false,
      takenAt: null,
      state: "waiting",
      progress: 0,
      error: null,
      createdAt: Date.parse("2026-10-27T03:00:00Z"),
    };
    loaded.queue = queueWith([upload]);
    const html = render();
    expect(rowNames(html)[0]).toBe("Packing list.pdf");
    expect(html).toMatch(/data-slot="file-row" data-file-id="[^"]+" data-upload-state="waiting"/);
    expect(html).toContain("Showing 1–10 of 24");
  });

  it("opens the page holding a file asked for: 11–20, or the last page's 3", () => {
    loaded.media = ready(filesOf(23));
    // Document 5 is the 19th newest.
    const second = render({ focusFileId: id(5) });
    expect(second).toContain("Showing 11–20 of 23");
    expect(rowNames(second)).toContain("Document 5.pdf");
    expect(rowNames(second)[0]).toBe("Document 13.pdf");
    // Its row can take the focus.
    expect(second).toMatch(new RegExp(`data-file-id="${id(5)}" data-upload-state="uploaded" tabindex="-1"`));

    const last = render({ focusFileId: id(1) });
    expect(last).toContain("Showing 21–23 of 23");
    expect(rowNames(last)).toEqual(["Document 3.pdf", "Document 2.pdf", "Document 1.pdf"]);
  });

  it("read-only: the pages work, with no upload", () => {
    loaded.media = ready(filesOf(23));
    const html = render({ readOnly: true });
    expect(html).not.toContain('data-slot="file-add-bar"');
    expect(html).not.toContain('data-slot="file-add"');
    expect(html).not.toContain("data-file-input");
    expect(rowNames(html)).toHaveLength(10);
    expect(html).toContain("Showing 1–10 of 23");
    expect(render({ readOnly: true, focusFileId: id(2) })).toContain("Showing 21–23 of 23");
  });
});

describe("FileSlot without pages", () => {
  it("lists every file oldest first, the add controls under them, nothing pinned", () => {
    loaded.media = ready(filesOf(12));
    const html = render({ pageSize: undefined });
    const names = rowNames(html);
    expect(names).toHaveLength(12);
    expect(names[0]).toBe("Document 1.pdf");
    expect(html).not.toContain('data-slot="file-add-bar"');
    expect(html).not.toContain('data-slot="file-pagination"');
    expect(html).not.toContain('tabindex="-1" class="relative');
    expect(html.indexOf('data-slot="file-add"')).toBeGreaterThan(html.lastIndexOf('data-slot="file-row"'));
  });
});
