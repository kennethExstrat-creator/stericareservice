// A Source Document's row: the mark beside its name, what Steri-AI has done
// with the file, and Read Again among the row's icons, also for a file it has
// read (Kenneth, 26 October 2026: a reading whose fill was lost can be read
// once more; "an icon of reload with a tick in the centre ... beside the eye
// icon"). The page's Files: the newest ten first under Add Document, pinned
// on top (Kenneth, 27 October 2026), drawn as the server draws them with the
// inspection's files as the browser would have loaded them.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";

const loaded = vi.hoisted(() => ({ media: null as import("@/components/capture/photos/media-store").MediaState | null }));
vi.mock("@/components/capture/photos/hooks", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/capture/photos/hooks")>();
  return {
    ...actual,
    useInspectionMedia: (inspectionId: string) => {
      const media = actual.useInspectionMedia(inspectionId);
      return loaded.media ?? media;
    },
  };
});

import type { MediaState } from "@/components/capture/photos/media-store";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import { EMPTY_TAG_OPTIONS, type MediaFile } from "@/lib/inspections/photos/view";
import type { SourceFileStatus } from "@/lib/inspections/source-documents";
import { AiMark, ReadAgainButton, SourceDocumentsPage } from "./source-documents-page";
import type { SourceDocuments } from "./use-source-documents";

const FILE: SlotFile = {
  id: "00000000-0000-4000-8000-0000000000f1",
  queued: false,
  moduleKey: "source_documents",
  kind: "other",
  name: "Sampling plan.jpg",
  state: "uploaded",
  progress: 1,
  error: null,
  url: null,
};

function documentsWith(status: SourceFileStatus | undefined): SourceDocuments {
  return { statuses: status ? { [FILE.id]: status } : {}, status: "not_done", progress: "in_progress", retry: () => {} };
}

const mark = (status: SourceFileStatus | undefined, readOnly = false) =>
  renderToStaticMarkup(<AiMark file={FILE} documents={documentsWith(status)} readOnly={readOnly} />);

const again = (status: SourceFileStatus | undefined, readOnly = false) =>
  renderToStaticMarkup(<ReadAgainButton file={FILE} documents={documentsWith(status)} readOnly={readOnly} />);

describe("a Source Document's Steri-AI mark", () => {
  it("says Steri-AI Verified or Not Read beside the name, with no words of Read Again there", () => {
    const read = mark({ status: "read", summary: "Sampling plan table." });
    expect(read).toContain('data-testid="ai-verified"');
    expect(read).not.toContain("Read Again");
    expect(mark({ status: "failed", summary: "Not a document." })).toContain('data-testid="ai-failed"');
  });

  it("offers Read Again as an icon button for a file read or not read", () => {
    for (const status of [{ status: "read", summary: "Sampling plan table." }, { status: "failed", summary: "Not a document." }] as const) {
      const html = again(status);
      expect(html).toMatch(/^<button[^>]*title="Read Again"/);
      expect(html).toContain('<span class="sr-only">Read Again Sampling plan.jpg</span>');
      // The reload arrow with its tick, drawn inline.
      expect(html).toContain('<path d="m8.5 12.5 2.5 2.5 4.5-5">');
    }
  });

  it("offers no Read Again where the inspection cannot change, nor before or while the file is read", () => {
    expect(again({ status: "read", summary: null }, true)).toBe("");
    expect(again({ status: "failed", summary: null }, true)).toBe("");
    expect(again({ status: "reading", summary: null })).toBe("");
    expect(again(undefined)).toBe("");
  });
});

describe("the page's Files", () => {
  const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
  const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
  const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

  /** 23 files, uploaded a minute apart, the oldest first as the page loads them. */
  const files: MediaFile[] = Array.from({ length: 23 }, (_, index) => ({
    id: id(index + 1),
    inspectionId: INSPECTION,
    moduleKey: "source_documents",
    kind: "other",
    name: `Packing list ${index + 1}.pdf`,
    createdBy: INSPECTOR,
    createdAt: `2026-10-27T02:${String(index + 1).padStart(2, "0")}:00+00:00`,
    storagePath: `${INSPECTION}/${id(index + 1)}`,
    url: `https://storage.example/file/${index + 1}`,
  }));

  const media: MediaState = {
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

  afterEach(() => {
    loaded.media = null;
  });

  const page = (readOnly: boolean, statuses: SourceDocuments["statuses"] = {}) =>
    renderToStaticMarkup(
      <SourceDocumentsPage
        id="capture-panel"
        titleRef={() => null}
        inspectionId={INSPECTION}
        readOnly={readOnly}
        documents={{ statuses, status: "not_done", progress: "in_progress", retry: () => {} }}
      />,
    );

  it("shows the newest ten under Add Document, pinned on top, with Steri-AI's marks and the pages under them", () => {
    loaded.media = media;
    const html = page(false, {
      [id(23)]: { status: "reading", summary: null },
      [id(22)]: { status: "read", summary: "Packing list." },
    });
    const rows = html.split('data-slot="file-row"').slice(1);
    expect(rows).toHaveLength(10);
    expect(html.indexOf('data-slot="file-add-bar"')).toBeLessThan(html.indexOf('data-slot="file-row"'));
    expect(rows[0]).toContain('title="Packing list 23.pdf"');
    expect(rows[0]).toContain('data-testid="ai-reading"');
    expect(rows[1]).toContain('data-testid="ai-verified"');
    expect(html).toContain("Showing 1–10 of 23");
  });

  it("read-only: the same pages, with no upload", () => {
    loaded.media = media;
    const html = page(true);
    expect(html).not.toContain('data-slot="file-add-bar"');
    expect(html.split('data-slot="file-row"')).toHaveLength(11);
    expect(html).toContain("Showing 1–10 of 23");
  });
});
