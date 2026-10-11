// A module page's file slot as the server draws it, with the inspection's
// files as the browser would have loaded them: the linked file in one line,
// else Choose File, else a way to Source Documents; never an upload.
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
import { SOURCE_DOCUMENTS_KEY } from "@/lib/inspections/source-documents";
import type { FileSlotRequest } from "@/modules/_framework/file-slot";
import { linkChoices, SourceFileLink } from "./source-file-link";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const REPORT = "00000000-0000-4000-8000-000000000601";
const EARLIER = "00000000-0000-4000-8000-000000000602";
const ELSEWHERE = "00000000-0000-4000-8000-000000000603";

function file(id: string, moduleKey: string, name: string): MediaFile {
  return {
    id,
    inspectionId: INSPECTION,
    moduleKey,
    kind: "other",
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

function request(overrides: Partial<FileSlotRequest> = {}): FileSlotRequest {
  return {
    moduleKey: "tensile",
    kind: "lab_report",
    focus: null,
    fileId: null,
    readOnly: false,
    addable: true,
    onAdded: () => {},
    onRemoved: () => {},
    ...overrides,
  };
}

const render = (slot: FileSlotRequest) =>
  renderToStaticMarkup(
    <SourceFileLink inspectionId={INSPECTION} slot={slot} readOnly={slot.readOnly} onOpenSourceDocuments={() => {}} />,
  );

afterEach(() => {
  loaded.media = null;
});

describe("SourceFileLink", () => {
  it("shows the kept file in one line with Preview and Unlink, also one uploaded on the step before; read-only, Preview only", () => {
    loaded.media = ready([file(REPORT, SOURCE_DOCUMENTS_KEY, "Lab report.pdf"), file(EARLIER, "tensile", "Earlier report.pdf")]);
    const html = render(request({ fileId: EARLIER }));
    expect(html).toContain(">Earlier report.pdf</span>");
    expect(html).toContain("Preview Earlier report.pdf");
    expect(html).toContain("Unlink Earlier report.pdf");
    expect(html).not.toContain("Choose File");
    expect(html).not.toContain("Add Lab Report");
    const approved = render(request({ fileId: REPORT, readOnly: true, addable: false }));
    expect(approved).toContain("Preview Lab report.pdf");
    expect(approved).not.toContain("Unlink");
  });

  it("offers Choose File while nothing is linked, and Go to Source Documents while there is no file to choose", () => {
    loaded.media = ready([file(REPORT, SOURCE_DOCUMENTS_KEY, "Lab report.pdf")]);
    expect(render(request())).toContain("Choose File");
    // Documents before a row is chosen, and read-only: nothing to choose.
    expect(render(request({ addable: false }))).toBe("");
    expect(render(request({ readOnly: true, addable: false }))).toBe("");
    loaded.media = ready([file(ELSEWHERE, "force_at_break", "Other step.pdf")]);
    const none = render(request());
    expect(none).toContain("No source documents yet.");
    expect(none).toContain("Go to Source Documents");
    expect(none).not.toContain("Choose File");
  });

  it("lists the Source Documents' files, then the step's own from before, never one whose upload stopped", () => {
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
    const files = [
      slotFile(REPORT, SOURCE_DOCUMENTS_KEY),
      slotFile(EARLIER, "tensile"),
      slotFile(ELSEWHERE, "force_at_break"),
      slotFile("stopped", SOURCE_DOCUMENTS_KEY, "failed"),
      slotFile("video", "media_proof"),
    ];
    expect(linkChoices(files, "tensile")).toEqual({ sources: [files[0]], earlier: [files[1]] });
  });
});
