// How the screen writes its data (docs/CAPTURE_KIT.md, "Changed on 6 October
// 2026"): every change goes through useDataUpdater and starts from the latest
// data, so a pasted column reaches onChange once with every value, and two
// changes made before the screen renders again both stay. The kit's cells are
// stand-ins here that keep the callbacks the screen hands them; the tests fire
// them the way the kit does (a paste inside batchDataChanges).
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BoxNumberField, PercentField } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { DISPENSING_PACKING_DEFAULT_CONFIG, DISPENSING_PACKING_LABELS } from "./config";
import { emptyPackingBox, type DispensingPackingData } from "./schema";

/** What the screen hands a toggle group: "Aged Sample?" is one. */
type ToggleProps = { "aria-label"?: string; value?: string; onValueChange?: (value: string) => void };

const kit = vi.hoisted(() => ({
  percent: [] as ComponentProps<typeof PercentField>[],
  boxNumbers: [] as ComponentProps<typeof BoxNumberField>[],
  toggles: [] as ToggleProps[],
}));

vi.mock("@/components/ui/toggle-group", () => ({
  ToggleGroup: (props: ToggleProps) => {
    kit.toggles.push(props);
    return null;
  },
  ToggleGroupItem: () => null,
}));

vi.mock("@/components/qc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/qc")>()),
  PercentField: (props: ComponentProps<typeof PercentField>) => {
    kit.percent.push(props);
    return null;
  },
  BoxNumberField: (props: ComponentProps<typeof BoxNumberField>) => {
    kit.boxNumbers.push(props);
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
  kit.boxNumbers.length = 0;
  kit.toggles.length = 0;
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
    boxNumbers: [...kit.boxNumbers],
    // The aged sample's cells: their own run, in no box column.
    aged: kit.percent.filter((field) => field.issuePath?.[2] === "agedSample"),
    question: kit.toggles.find((toggle) => toggle["aria-label"] === "Aged Sample?"),
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

  it("hands a pasted column of box/carton numbers to onChange once, each as typed, sampled for the size or not", () => {
    const changes: DispensingPackingData[] = [];
    const { boxNumbers } = renderScreen({ sizes: {} }, (next) => changes.push(next));
    expect(boxNumbers.map((field) => field.group)).toEqual(Array.from({ length: 5 }, () => "boxNo"));
    // Every field suggests the size's sampled numbers (BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026).
    expect(boxNumbers.map((field) => field.cartons)).toEqual(Array.from({ length: 5 }, () => [11, 12, 13, 14, 15]));

    batchDataChanges(() => [313, 2336, 11, 7, 999].forEach((value, row) => boxNumbers[row].onValueChange(value)));

    expect(changes).toHaveLength(1);
    expect(changes[0].sizes.M.boxes.map((box) => box.boxNo)).toEqual([313, 2336, 11, 7, 999]);
  });

  it("keeps both of two changes made before the screen renders again", () => {
    const changes: DispensingPackingData[] = [];
    const { boxNumbers, dispensing } = renderScreen({ sizes: {} }, (next) => changes.push(next));

    boxNumbers[0].onValueChange(12);
    dispensing[0].onValueChange(91);

    expect(changes).toHaveLength(2);
    expect(changes[1].sizes.M.boxes).toEqual([{ ...emptyPackingBox(), boxNo: 12, dispensingPct: 91 }]);
  });

  it("writes the aged sample's values into the size's aged sample, never into a box (Kenneth, 26 October 2026)", () => {
    const changes: DispensingPackingData[] = [];
    const saved: DispensingPackingData = { sizes: { M: { boxes: [{ ...emptyPackingBox(), boxNo: 12, layeringPct: 90 }] } } };
    const { aged, layering } = renderScreen(saved, (next) => changes.push(next));
    expect(aged.map((field) => field.label)).toEqual(["Layering %, Aged Sample", "Dispensing %, Aged Sample"]);
    expect(aged.map((field) => field.group)).toEqual([undefined, undefined]);
    expect(layering).toHaveLength(5);

    // A pasted pair fills the row's two percentages as one change.
    batchDataChanges(() => [88, 86].forEach((value, cell) => aged[cell].onValueChange(value)));

    expect(changes).toHaveLength(1);
    expect(changes[0].sizes.M).toEqual({
      boxes: saved.sizes.M.boxes,
      agedSample: { layeringPct: 88, dispensingPct: 86, stickiness: null, note: null },
    });
    // The first value answers "Aged Sample?" Yes (Kenneth, 30 October 2026).
    expect(changes[0].hasAgedSample).toBe("yes");
  });

  it('answers "Aged Sample?" for the whole step, every size\'s aged sample kept, and clears it chosen again (Kenneth, 30 October 2026)', () => {
    const changes: DispensingPackingData[] = [];
    const aged = { layeringPct: 88, dispensingPct: null, stickiness: null, note: null };
    const saved: DispensingPackingData = { sizes: { M: { boxes: [], agedSample: aged }, XL: { boxes: [], agedSample: aged } } };
    const unanswered = renderScreen(saved, (next) => changes.push(next));
    expect(unanswered.question?.value).toBe("");
    expect(unanswered.aged).toHaveLength(2);

    unanswered.question?.onValueChange?.("no");
    expect(changes).toEqual([{ hasAgedSample: "no", sizes: saved.sizes }]);

    // Answered No: the aged sample's cells are gone, its values kept.
    const no = renderScreen(changes[0], (next) => changes.push(next));
    expect(no.question?.value).toBe("no");
    expect(no.aged).toEqual([]);
    no.question?.onValueChange?.("");
    expect(changes[1]).toEqual(saved);
  });
});
