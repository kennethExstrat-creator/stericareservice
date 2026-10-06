// How the screen writes its data (docs/CAPTURE_KIT.md, "Changed on 6 October
// 2026"): every change goes through useDataUpdater and starts from the latest
// data, so a pasted column reaches onChange once with every value, and two
// changes made before the screen renders again both stay. The kit's cells are
// stand-ins here that keep the callbacks the screen hands them; the tests fire
// them the way the kit does (a paste inside batchDataChanges).
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BoxPicker, PercentField } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { DISPENSING_PACKING_DEFAULT_CONFIG, DISPENSING_PACKING_LABELS } from "./config";
import { emptyPackingBox, type DispensingPackingData } from "./schema";

const kit = vi.hoisted(() => ({
  percent: [] as ComponentProps<typeof PercentField>[],
  pickers: [] as ComponentProps<typeof BoxPicker>[],
}));

vi.mock("@/components/qc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/qc")>()),
  PercentField: (props: ComponentProps<typeof PercentField>) => {
    kit.percent.push(props);
    return null;
  },
  BoxPicker: (props: ComponentProps<typeof BoxPicker>) => {
    kit.pickers.push(props);
    return null;
  },
}));

const CONTEXT = makeTestContext({
  sizes: ["M"],
  cartons: { M: [11, 12, 13, 14, 15] },
  sampling: { M: makeSampling({ packagingDispensing: 5 }) },
});

/** Renders the screen on `data` once, as the capture screen would, and returns the cells' callbacks. */
function renderScreen(data: DispensingPackingData, onChange: (next: DispensingPackingData) => void) {
  kit.percent.length = 0;
  kit.pickers.length = 0;
  renderToStaticMarkup(
    <Capture
      data={data}
      config={DISPENSING_PACKING_DEFAULT_CONFIG}
      title="Glove Packing Check"
      labels={DISPENSING_PACKING_LABELS}
      context={CONTEXT}
      evaluation={null}
      focusPath={null}
      readOnly={false}
      onChange={onChange}
      onFocusChange={() => {}}
    />,
  );
  return {
    layering: kit.percent.filter((field) => field.group === "layeringPct"),
    dispensing: kit.percent.filter((field) => field.group === "dispensingPct"),
    pickers: [...kit.pickers],
  };
}

describe("dispensing_packing capture writes", () => {
  it("hands a pasted layering column to onChange once, every value in its own row", () => {
    const changes: DispensingPackingData[] = [];
    const saved: DispensingPackingData = { sizes: { XL: { boxes: [{ ...emptyPackingBox(), layeringPct: 75 }] } } };
    const { layering } = renderScreen(saved, (next) => changes.push(next));
    expect(layering).toHaveLength(5);

    batchDataChanges(() => [88, 90, 87, 85, 91].forEach((value, row) => layering[row].onValueChange(value)));

    expect(changes).toHaveLength(1);
    expect(changes[0].sizes.M.boxes.map((box) => box.layeringPct)).toEqual([88, 90, 87, 85, 91]);
    // Size XL is no longer ordered: its data stays for when it comes back (6.2 rule 4).
    expect(changes[0].sizes.XL).toBe(saved.sizes.XL);
    expect(saved.sizes.M).toBeUndefined();
  });

  it("keeps both of two changes made before the screen renders again", () => {
    const changes: DispensingPackingData[] = [];
    const { pickers, dispensing } = renderScreen({ sizes: {} }, (next) => changes.push(next));

    pickers[0].onValueChange(12);
    dispensing[0].onValueChange(91);

    expect(changes).toHaveLength(2);
    expect(changes[1].sizes.M.boxes).toEqual([{ ...emptyPackingBox(), boxNo: 12, dispensingPct: 91 }]);
  });
});
