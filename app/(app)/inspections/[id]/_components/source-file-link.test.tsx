// A module page's file slot as the server draws it, with the inspection's
// files and upload queue as the browser would have loaded them: the file
// Steri-AI linked in one line, a lab report from before the same way without
// Unlink, Unlink beside a kept file that is gone, else what Steri-AI found;
// never a picker or an upload.
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
import type { SlotFile } from "@/components/capture/photos/photo-model";
import { EMPTY_QUEUE_SNAPSHOT, INITIAL_QUEUE_STATE } from "@/components/capture/photos/queue-state";
import { EMPTY_TAG_OPTIONS, type MediaFile } from "@/lib/inspections/photos/view";
import { SOURCE_DOCUMENTS_KEY } from "@/lib/inspections/source-documents";
import type { FileSlotRequest } from "@/modules/_framework/file-slot";
import { shareSourceReading, shownFile, SourceFileLink, sourceReadingState, type SourceReading } from "./source-file-link";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const REPORT = "00000000-0000-4000-8000-000000000601";
const EARLIER = "00000000-0000-4000-8000-000000000602";
const FORM = "00000000-0000-4000-8000-000000000603";
const GONE = "00000000-0000-4000-8000-000000000604";

function file(id: string, moduleKey: string, name: string, kind: MediaFile["kind"] = "other"): MediaFile {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey,
    kind,
    name,
    createdBy: INSPECTOR,
    createdAt: "2026-10-12T01:15:00.000000+00:00",
    storagePath: `${INSPECTION}/${id}`,
    url: `https://storage.example/file/${id}`,
  };
}

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

/** This device's queue, read: nothing waiting. */
const QUEUE_READ = { ...INITIAL_QUEUE_STATE, phase: "ready" as const, queue: { ...EMPTY_QUEUE_SNAPSHOT, load: "ready" as const } };

function request(overrides: Partial<FileSlotRequest> = {}): FileSlotRequest {
  return {
    moduleKey: "tensile",
    kind: "lab_report",
    fileId: null,
    state: "none",
    countsModuleFiles: true,
    readOnly: false,
    onRemoved: () => {},
    ...overrides,
  };
}

const render = (slot: FileSlotRequest) =>
  renderToStaticMarkup(<SourceFileLink inspectionId={INSPECTION} slot={slot} readOnly={slot.readOnly} />);

/** What the page's Source Documents reader shares (useShareSourceReading). */
const reading = (statuses: SourceReading["statuses"], reads = true) => shareSourceReading(INSPECTION, { statuses, reads });

afterEach(() => {
  loaded.media = null;
  loaded.queue = null;
  shareSourceReading(INSPECTION, null);
});

describe("SourceFileLink", () => {
  it("shows the file Steri-AI linked in one line, with its mark, Preview and Unlink; read-only, no Unlink", () => {
    loaded.media = ready([file(REPORT, SOURCE_DOCUMENTS_KEY, "Lab report.pdf")]);
    loaded.queue = QUEUE_READ;
    const html = render(request({ fileId: REPORT, state: "attached" }));
    expect(html).toContain(">Lab report.pdf</span>");
    expect(html).toContain('title="Linked by Steri-AI"');
    expect(html).toContain("Preview Lab report.pdf");
    expect(html).toContain("Unlink Lab report.pdf");
    expect(html).not.toContain("Choose File");
    expect(html).not.toContain("detected");
    const approved = render(request({ fileId: REPORT, state: "attached", readOnly: true }));
    expect(approved).toContain("Preview Lab report.pdf");
    expect(approved).not.toContain("Unlink");
  });

  it("shows a lab report uploaded on the step before as linked, without Steri-AI's mark or Unlink: it counts by its step", () => {
    loaded.media = ready([file(EARLIER, "tensile", "Earlier report.pdf", "lab_report")]);
    loaded.queue = QUEUE_READ;
    // Kept or not, calc counts it (moduleFileState).
    for (const fileId of [null, EARLIER]) {
      const html = render(request({ fileId, state: "attached" }));
      expect(html).toContain(">Earlier report.pdf</span>");
      expect(html).toContain("Preview Earlier report.pdf");
      expect(html).not.toContain("Unlink");
      expect(html).not.toContain("Steri-AI");
    }
    // A documents row keeps its file by id only: that one unlinks.
    const row = render(request({ moduleKey: "documents", kind: "certificate", countsModuleFiles: false, fileId: EARLIER, state: "attached" }));
    expect(row).toContain("Unlink Earlier report.pdf");
  });

  it("offers Unlink beside a kept file that is gone, once the files and this device's queue are known", () => {
    loaded.media = ready([file(FORM, SOURCE_DOCUMENTS_KEY, "Inspection form.pdf")]);
    loaded.queue = QUEUE_READ;
    const removed: string[] = [];
    const missing = request({ fileId: GONE, state: "missing", onRemoved: (id) => removed.push(id) });
    const html = render(missing);
    expect(html).toContain('data-missing=""');
    expect(html).toContain("Unlink the missing file");
    expect(html).not.toContain("detected");
    expect(render({ ...missing, readOnly: true })).toBe("");
    loaded.queue = INITIAL_QUEUE_STATE;
    expect(render(missing)).toBe("");
  });

  it("says Steri-AI is reading while a Source Document is unread or being read, and what it found once none is", () => {
    loaded.media = ready([file(FORM, SOURCE_DOCUMENTS_KEY, "Inspection form.pdf")]);
    loaded.queue = QUEUE_READ;
    // The readings so far not known yet: nothing to say.
    expect(render(request())).toBe("");
    reading({});
    expect(render(request())).toContain("Steri-AI is reading the Source Documents…");
    reading({ [FORM]: { status: "reading", summary: null } });
    expect(render(request())).toContain("Steri-AI is reading the Source Documents…");
    reading({ [FORM]: { status: "read", summary: "Inspection form for PO 0000001." } });
    const none = render(request());
    expect(none).toContain(">No lab report detected by Steri-AI.<");
    expect(none).not.toContain("Steri-AI is reading");
    // One Steri-AI could not read counts as read: nothing more will come of it here.
    reading({ [FORM]: { status: "failed", summary: "Steri-AI is not connected yet." } });
    expect(render(request())).toContain("No lab report detected by Steri-AI.");
    // The module's own words, for a list of documents.
    expect(render(request({ notFoundText: "No documents detected by Steri-AI." }))).toContain(">No documents detected by Steri-AI.<");
  });

  it("says no lab report was detected where there are no Source Documents, and on a page that reads none", () => {
    loaded.media = ready([]);
    loaded.queue = QUEUE_READ;
    reading({});
    expect(render(request())).toContain("No lab report detected by Steri-AI.");
    loaded.media = ready([file(FORM, SOURCE_DOCUMENTS_KEY, "Inspection form.pdf")]);
    reading({}, false);
    expect(render(request({ readOnly: true }))).toContain("No lab report detected by Steri-AI.");
  });

  it("waits for a kept file's name rather than say anything about it", () => {
    loaded.media = ready([]);
    loaded.queue = QUEUE_READ;
    reading({});
    expect(render(request({ fileId: REPORT, state: "attached" }))).toBe("");
  });
});

const slotFile = (id: string, moduleKey: string, state: SlotFile["state"] = "uploaded"): SlotFile => ({
  id,
  queued: state !== "uploaded",
  moduleKey,
  kind: "other",
  name: id,
  state,
  progress: 1,
  error: null,
  url: null,
});

describe("sourceReadingState", () => {
  const read: SourceReading = { statuses: { [FORM]: { status: "read", summary: null } }, reads: true };

  it("is reading while a Source Document still uploads or waits its turn, never for one whose upload stopped or another step's file", () => {
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY)], read)).toBe("done");
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY), slotFile(REPORT, SOURCE_DOCUMENTS_KEY, "uploading")], read)).toBe("reading");
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY), slotFile(REPORT, SOURCE_DOCUMENTS_KEY)], read)).toBe("reading");
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY), slotFile(REPORT, SOURCE_DOCUMENTS_KEY, "failed")], read)).toBe("done");
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY), slotFile(EARLIER, "tensile"), slotFile("video", "media_proof")], read)).toBe(
      "done",
    );
  });

  it("is unknown until the readings so far are known, and done on a page that reads none", () => {
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY)], null)).toBe("unknown");
    expect(sourceReadingState([slotFile(FORM, SOURCE_DOCUMENTS_KEY)], { statuses: null, reads: true })).toBe("unknown");
    expect(sourceReadingState([slotFile(REPORT, SOURCE_DOCUMENTS_KEY)], { statuses: {}, reads: false })).toBe("done");
  });
});

describe("shownFile", () => {
  it("finds the kept file, else the step's own latest lab report, never one whose upload stopped", () => {
    const files = [
      { ...slotFile(EARLIER, "tensile"), kind: "lab_report" as const },
      { ...slotFile("later", "tensile"), kind: "lab_report" as const },
      { ...slotFile("stopped", "tensile", "failed"), kind: "lab_report" as const },
      slotFile(REPORT, SOURCE_DOCUMENTS_KEY),
    ];
    const slot = { moduleKey: "tensile" as const, kind: "lab_report" as const, countsModuleFiles: true };
    expect(shownFile(files, { ...slot, fileId: REPORT })?.id).toBe(REPORT);
    expect(shownFile(files, { ...slot, fileId: null })?.id).toBe("later");
    expect(shownFile(files, { ...slot, fileId: GONE })?.id).toBe("later");
    expect(shownFile(files, { ...slot, countsModuleFiles: false, fileId: GONE })).toBeNull();
  });
});
