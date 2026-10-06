import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { FileSlotProvider, ModuleFileSlot, type FileSlotRequest } from "./file-slot";

const REPORT = "00000000-0000-4000-8000-000000000402";

describe("ModuleFileSlot", () => {
  it("says where files are attached when the screen gives no file slot (preview, review)", () => {
    const html = renderToStaticMarkup(
      <ModuleFileSlot moduleKey="tensile" kind="lab_report" title="Lab report" readOnly={false} onAdded={() => {}} />,
    );
    expect(html).toContain('data-slot="module-file-slot"');
    expect(html).toContain("data-unavailable");
    expect(html).toContain("Lab report: </span>Attach files on the inspection screen.");
  });

  it("renders the screen's slot with the module's request, and passes files back", () => {
    const requests: FileSlotRequest[] = [];
    const added: string[] = [];
    const removed: string[] = [];
    const html = renderToStaticMarkup(
      <FileSlotProvider
        render={(request) => {
          requests.push(request);
          return <span data-test="screen-slot">{request.kind}</span>;
        }}
      >
        <ModuleFileSlot
          moduleKey="tensile"
          kind="lab_report"
          title="Lab report"
          focus={{ size: "M" }}
          readOnly={false}
          onAdded={(file) => added.push(file.id)}
          onRemoved={(id) => removed.push(id)}
        />
      </FileSlotProvider>,
    );
    expect(html).toContain('<span data-test="screen-slot">lab_report</span>');
    expect(html).not.toContain("data-unavailable");
    expect(requests).toHaveLength(1);
    const [request] = requests;
    expect(request).toMatchObject({
      moduleKey: "tensile",
      kind: "lab_report",
      title: "Lab report",
      focus: { size: "M" },
      readOnly: false,
      addable: true,
    });
    request.onAdded({ id: REPORT, name: "report.pdf", kind: "lab_report" });
    request.onRemoved(REPORT);
    expect(added).toEqual([REPORT]);
    expect(removed).toEqual([REPORT]);
  });

  it("asks for no title and no focus when the module gives none, and ignores a removal it cannot handle", () => {
    const requests: FileSlotRequest[] = [];
    renderToStaticMarkup(
      <FileSlotProvider
        render={(request) => {
          requests.push(request);
          return null;
        }}
      >
        <ModuleFileSlot moduleKey="force_at_break" kind="lab_report" readOnly onAdded={() => {}} />
      </FileSlotProvider>,
    );
    expect(requests[0]).not.toHaveProperty("title");
    expect(requests[0]).toMatchObject({ focus: null, readOnly: true, addable: false });
    expect(() => requests[0].onRemoved(REPORT)).not.toThrow();
  });

  it("asks for a slot that deletes but does not add while the module has nothing to file a new file under", () => {
    const requests: FileSlotRequest[] = [];
    renderToStaticMarkup(
      <FileSlotProvider
        render={(request) => {
          requests.push(request);
          return null;
        }}
      >
        <ModuleFileSlot moduleKey="documents" kind="certificate" readOnly={false} addable={false} onAdded={() => {}} />
      </FileSlotProvider>,
    );
    expect(requests[0]).toMatchObject({ readOnly: false, addable: false });
  });
});
