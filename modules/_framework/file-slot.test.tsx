import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileSlotProvider, ModuleFileSlot, type FileSlotRequest } from "./file-slot";

const REPORT = "00000000-0000-4000-8000-000000000402";

/** Renders the slot inside a screen's provider, collecting its requests. */
function requestsOf(slot: ReactNode): FileSlotRequest[] {
  const requests: FileSlotRequest[] = [];
  renderToStaticMarkup(
    <FileSlotProvider
      render={(request) => {
        requests.push(request);
        return <span data-test="screen-slot">{request.kind}</span>;
      }}
    >
      {slot}
    </FileSlotProvider>,
  );
  return requests;
}

describe("ModuleFileSlot", () => {
  it("says where files are attached when the screen gives no file slot (preview, review)", () => {
    const html = renderToStaticMarkup(
      <ModuleFileSlot moduleKey="tensile" kind="lab_report" fileId={null} state="none" readOnly={false} onRemoved={() => {}} />,
    );
    expect(html).toContain('data-slot="module-file-slot"');
    expect(html).toContain("data-unavailable");
    expect(html).toContain(">Attach files on the inspection screen.</p>");
  });

  it("renders the screen's slot with the module's request: the kept file, calc's state of it, and Unlink", () => {
    const removed: string[] = [];
    const html = renderToStaticMarkup(
      <FileSlotProvider render={(request) => <span data-test="screen-slot">{request.kind}</span>}>
        <ModuleFileSlot moduleKey="tensile" kind="lab_report" fileId={REPORT} state="attached" readOnly={false} onRemoved={() => {}} />
      </FileSlotProvider>,
    );
    expect(html).toContain('<span data-test="screen-slot">lab_report</span>');
    expect(html).not.toContain("data-unavailable");
    const [request] = requestsOf(
      <ModuleFileSlot
        moduleKey="tensile"
        kind="lab_report"
        fileId={REPORT}
        state="attached"
        countsModuleFiles
        readOnly={false}
        onRemoved={(id) => removed.push(id)}
      />,
    );
    expect(request).toEqual({
      moduleKey: "tensile",
      kind: "lab_report",
      fileId: REPORT,
      state: "attached",
      countsModuleFiles: true,
      readOnly: false,
      onRemoved: expect.any(Function),
    });
    request.onRemoved(REPORT);
    expect(removed).toEqual([REPORT]);
  });

  it("counts by the kept id only unless the module says otherwise, and passes its own words for nothing found", () => {
    const [row] = requestsOf(
      <ModuleFileSlot moduleKey="documents" kind="certificate" fileId={null} state="none" readOnly onRemoved={() => {}} />,
    );
    expect(row).toMatchObject({ countsModuleFiles: false, readOnly: true });
    expect(row).not.toHaveProperty("notFoundText");
    const [list] = requestsOf(
      <ModuleFileSlot
        moduleKey="documents"
        kind="certificate"
        fileId={null}
        state="none"
        notFoundText="No documents detected by Steri-AI."
        readOnly={false}
        onRemoved={() => {}}
      />,
    );
    expect(list.notFoundText).toBe("No documents detected by Steri-AI.");
  });

  it("passes a lab report's caption, its sizes, for the screen to show before the file's name", () => {
    const [report] = requestsOf(
      <ModuleFileSlot moduleKey="force_at_break" kind="lab_report" fileId={REPORT} caption="Size S" state="attached" readOnly={false} onRemoved={() => {}} />,
    );
    expect(report).toMatchObject({ fileId: REPORT, caption: "Size S", countsModuleFiles: false });
    const [plain] = requestsOf(
      <ModuleFileSlot moduleKey="force_at_break" kind="lab_report" fileId={REPORT} state="attached" readOnly={false} onRemoved={() => {}} />,
    );
    expect(plain).not.toHaveProperty("caption");
  });
});
