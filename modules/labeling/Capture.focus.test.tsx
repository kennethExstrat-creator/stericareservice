// What the labelling body reports as in focus, so a photo taken now is tagged
// with the size, the packaging level and the check or box (BUILD_SPEC 8.1),
// and the size it opens on. CounterTable and BoxPicker are replaced by
// stand-ins that keep their props, so the test calls their focus handlers as
// the kit does; SizeTabs is the kit's own.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { CounterCell } from "@/components/qc";
import type { CaptureFocus } from "@/modules/_framework";
import { makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { LABELING_DEFAULT_CONFIG, LABELING_LABELS } from "./config";
import type { LabelingData } from "./schema";

type TableProps = { caption: string; onCellFocus?: (cell: CounterCell) => void };
type PickerProps = { label: string; onFocus?: () => void };

const kit = vi.hoisted(() => ({ tables: [] as TableProps[], pickers: [] as PickerProps[] }));

vi.mock("@/components/qc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/qc")>()),
  CounterTable: (props: TableProps) => {
    kit.tables.push(props);
    return null;
  },
  BoxPicker: (props: PickerProps) => {
    kit.pickers.push(props);
    return null;
  },
}));

const CONTEXT = makeTestContext({ sizes: ["M", "L"], cartons: { M: [13, 299], L: [40] } });

const DATA: LabelingData = {
  sizes: {
    M: { inner: { inspected: 3, boxNos: [13], defects: {} }, carton: { inspected: 1, boxNos: [], defects: {} } },
  },
};

/** Renders the body once and returns the stand-ins' props, the markup and every focus it reported. */
function render(focus?: CaptureFocus) {
  kit.tables.length = 0;
  kit.pickers.length = 0;
  const reported: CaptureFocus[] = [];
  const html = renderToStaticMarkup(
    <Capture
      data={DATA}
      config={LABELING_DEFAULT_CONFIG}
      title="Packaging Labeling Inspection"
      labels={LABELING_LABELS}
      context={CONTEXT}
      evaluation={null}
      focusPath={null}
      readOnly={false}
      focus={focus}
      onChange={() => {}}
      onFocusChange={(next) => reported.push(next)}
    />,
  );
  return { html, tables: [...kit.tables], pickers: [...kit.pickers], reported };
}

const selectedTab = (html: string) =>
  /<[^>]*role="tab"[^>]*aria-selected="true"[^>]*>/.exec(html)?.[0].match(/data-size="([^"]+)"/)?.[1];

describe("labeling capture: focus", () => {
  it("reports the packaging level with the size and the check counted", () => {
    const { tables, reported } = render();
    const inner = tables.find((table) => table.caption.endsWith("Dispenser Box, size M"));
    const carton = tables.find((table) => table.caption.endsWith("Carton Box, size M"));
    inner?.onCellFocus?.({ row: "lot_no", column: "M" });
    carton?.onCellFocus?.({ row: "carton_no", column: "M" });
    expect(reported).toEqual([
      { size: "M", level: "inner", defect: "lot_no" },
      { size: "M", level: "carton", defect: "carton_no" },
    ]);
  });

  it("reports the level, and the box once one is picked, from the box pickers", () => {
    const { pickers, reported } = render();
    const picked = pickers.find((picker) => picker.label === "Box # 1, Dispenser Box, size M");
    const next = pickers.find((picker) => picker.label === "Box # 2, Dispenser Box, size M");
    picked?.onFocus?.();
    next?.onFocus?.();
    expect(reported).toEqual([
      { size: "M", level: "inner", box: 13 },
      { size: "M", level: "inner" },
    ]);
  });

  it("opens on the size the screen has in focus when it is ordered, else on the first one ordered", () => {
    const onL = render({ size: "L", level: "carton" });
    expect(selectedTab(onL.html)).toBe("L");
    expect(onL.tables.map((table) => table.caption.split(": ")[1])).toEqual(["Dispenser Box, size L", "Carton Box, size L"]);
    expect(selectedTab(render({ size: "XL" }).html)).toBe("M");
    expect(selectedTab(render().html)).toBe("M");
  });
});
