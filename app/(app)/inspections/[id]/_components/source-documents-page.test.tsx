// A Source Document's row: the mark beside its name, what Steri-AI has done
// with the file, and Read Again among the row's icons, also for a file it has
// read (Kenneth, 26 October 2026: a reading whose fill was lost can be read
// once more; "an icon of reload with a tick in the centre ... beside the eye
// icon").
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import type { SourceFileStatus } from "@/lib/inspections/source-documents";
import { AiMark, ReadAgainButton } from "./source-documents-page";
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
