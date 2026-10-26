// The mark beside a Source Document's name: what Steri-AI has done with the
// file, and Read Again, also for a file it has read (Kenneth, 26 October
// 2026: a reading whose fill was lost can be read once more).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SlotFile } from "@/components/capture/photos/photo-model";
import type { SourceFileStatus } from "@/lib/inspections/source-documents";
import { AiMark } from "./source-documents-page";
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

function mark(status: SourceFileStatus | undefined, readOnly = false): string {
  const documents: SourceDocuments = {
    statuses: status ? { [FILE.id]: status } : {},
    status: "not_done",
    progress: "in_progress",
    retry: () => {},
  };
  return renderToStaticMarkup(<AiMark file={FILE} documents={documents} readOnly={readOnly} />);
}

describe("a Source Document's Steri-AI mark", () => {
  it("offers Read Again beside Steri-AI Verified, as beside Not Read", () => {
    const read = mark({ status: "read", summary: "Sampling plan table." });
    expect(read).toContain('data-testid="ai-verified"');
    expect(read).toContain("Read Again<span class=\"sr-only\">: Sampling plan.jpg</span>");
    const failed = mark({ status: "failed", summary: "Not a document." });
    expect(failed).toContain('data-testid="ai-failed"');
    expect(failed).toContain("Read Again");
  });

  it("offers no Read Again where the inspection cannot change, nor while the file is being read", () => {
    expect(mark({ status: "read", summary: null }, true)).not.toContain("Read Again");
    expect(mark({ status: "failed", summary: null }, true)).not.toContain("Read Again");
    expect(mark({ status: "reading", summary: null })).not.toContain("Read Again");
  });
});
