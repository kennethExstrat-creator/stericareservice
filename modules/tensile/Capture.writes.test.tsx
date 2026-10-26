// How the capture body writes its data (docs/CAPTURE_KIT.md, useDataUpdater):
// NumberField is replaced by a stand-in that keeps the props it was given, so
// the test calls each field's onValueChange the way a paste does (every field
// of the run in turn, inside batchDataChanges) before the screen renders again.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { IssuePath } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
import { makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { TENSILE_DEFAULT_CONFIG, TENSILE_LABELS, TENSILE_TITLE } from "./config";
import type { TensileData } from "./schema";

type FieldProps = { issuePath?: IssuePath; onValueChange: (value: number | null) => void };

const kit = vi.hoisted(() => ({ fields: [] as FieldProps[] }));

vi.mock("@/components/qc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/qc")>()),
  NumberField: (props: FieldProps) => {
    kit.fields.push(props);
    return null;
  },
}));

const CONTEXT = makeTestContext({ sizes: ["XS", "S", "M", "L"] });
const LAB_REPORT_ID = "00000000-0000-4000-8000-000000000402";

/**
 * Renders the body once, inside a screen's file slot, and returns its fields
 * in screen order, the file slot's request and every onChange the screen
 * received.
 */
function renderFields(data: TensileData) {
  kit.fields.length = 0;
  const changes: TensileData[] = [];
  const slots: FileSlotRequest[] = [];
  renderToStaticMarkup(
    <FileSlotProvider
      render={(request) => {
        slots.push(request);
        return null;
      }}
    >
      <Capture
        data={data}
        config={TENSILE_DEFAULT_CONFIG}
        title={TENSILE_TITLE}
        labels={TENSILE_LABELS}
        context={CONTEXT}
        evaluation={null}
        focusPath={null}
        readOnly={false}
        onChange={(next) => changes.push(next)}
      />
    </FileSlotProvider>,
  );
  return { fields: [...kit.fields], slots, changes };
}

describe("tensile capture writes", () => {
  it("lands a pasted block of every size's averages whole, in one change", () => {
    const { fields, changes } = renderFields({ sizes: {}, labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }] });
    // Every size side by side, in reading order (the desktop run a block fills).
    expect(fields.map((field) => field.issuePath?.slice(1).join(" "))).toEqual([
      "XS tensileStrength",
      "XS elongationAtBreak",
      "S tensileStrength",
      "S elongationAtBreak",
      "M tensileStrength",
      "M elongationAtBreak",
      "L tensileStrength",
      "L elongationAtBreak",
    ]);
    const block = [34.18, 536, 32.99, 547, 34.03, 555, 33.17, 543];
    batchDataChanges(() => fields.forEach((field, index) => field.onValueChange(block[index])));
    expect(changes).toEqual([
      {
        sizes: {
          XS: { tensileStrength: 34.18, elongationAtBreak: 536 },
          S: { tensileStrength: 32.99, elongationAtBreak: 547 },
          M: { tensileStrength: 34.03, elongationAtBreak: 555 },
          L: { tensileStrength: 33.17, elongationAtBreak: 543 },
        },
        labReports: [{ fileId: LAB_REPORT_ID, sizes: [] }],
      },
    ]);
  });

  it("drops the lab report Steri-AI linked when it is unlinked, and only that one", () => {
    const OTHER = "00000000-0000-4000-8000-000000000409";
    const XS_REPORT = "00000000-0000-4000-8000-00000000040a";
    const sizes = { XS: { tensileStrength: 34.18, elongationAtBreak: null } };
    // A report linked before 26 October 2026, its sizes not known, and one for size XS.
    const reports = [
      { fileId: LAB_REPORT_ID, sizes: [] },
      { fileId: XS_REPORT, sizes: ["XS"] },
    ];
    const { slots, changes } = renderFields({ sizes, labReports: reports });
    expect(slots).toEqual([
      expect.objectContaining({ moduleKey: "tensile", kind: "lab_report", fileId: XS_REPORT, caption: "Size XS", countsModuleFiles: false }),
      expect.objectContaining({ moduleKey: "tensile", kind: "lab_report", fileId: LAB_REPORT_ID, countsModuleFiles: false }),
    ]);
    expect(slots[1]).not.toHaveProperty("caption");
    // Another file's id: the lab reports stay.
    slots[0].onRemoved(OTHER);
    expect(changes).toEqual([]);
    slots[1].onRemoved(LAB_REPORT_ID);
    expect(changes).toEqual([{ sizes, labReports: [{ fileId: XS_REPORT, sizes: ["XS"] }] }]);
  });

  it("keeps two fields' changes made before the screen renders again, and every saved size", () => {
    const saved: TensileData = {
      sizes: { XS: { tensileStrength: 34.18, elongationAtBreak: null }, XL: { tensileStrength: 31.5, elongationAtBreak: 540 } },
      labReports: [],
    };
    const { fields, changes } = renderFields(saved);
    fields[1].onValueChange(536);
    fields[2].onValueChange(32.99);
    expect(changes.at(-1)).toEqual({
      sizes: {
        XS: { tensileStrength: 34.18, elongationAtBreak: 536 },
        // XL is not ordered: its averages stay saved for when it is again (6.2 rule 4).
        XL: { tensileStrength: 31.5, elongationAtBreak: 540 },
        S: { tensileStrength: 32.99, elongationAtBreak: null },
      },
      labReports: [],
    });
  });
});
