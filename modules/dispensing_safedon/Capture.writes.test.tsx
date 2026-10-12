// How the screen writes its data (docs/CAPTURE_KIT.md, "Changed on 6 October
// 2026"): every change goes through useDataUpdater and starts from the latest
// data, so taps and picks made before the screen renders again all stay. The
// kit's counter table and box pickers are stand-ins here that keep the
// callbacks the screen hands them; the tests fire them as a quick inspector
// would.
import type { ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { BoxPicker, CounterTable } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { DISPENSING_SAFEDON_DEFAULT_CONFIG, DISPENSING_SAFEDON_LABELS } from "./config";
import type { DispensingSafedonData } from "./schema";

const kit = vi.hoisted(() => ({
  tables: [] as ComponentProps<typeof CounterTable>[],
  pickers: [] as ComponentProps<typeof BoxPicker>[],
}));

vi.mock("@/components/qc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/qc")>()),
  CounterTable: (props: ComponentProps<typeof CounterTable>) => {
    kit.tables.push(props);
    return null;
  },
  BoxPicker: (props: ComponentProps<typeof BoxPicker>) => {
    kit.pickers.push(props);
    return null;
  },
}));

const CONTEXT = makeTestContext({
  sizes: ["XS"],
  cartons: { XS: [3, 12, 59] },
  sampling: { XS: makeSampling({ packagingDispensing: 3 }) },
});

/** Renders the screen on `data` once, as the capture screen would, and returns the controls' callbacks. */
function renderScreen(data: DispensingSafedonData, onChange: (next: DispensingSafedonData) => void) {
  kit.tables.length = 0;
  kit.pickers.length = 0;
  renderToStaticMarkup(
    <Capture
      data={data}
      config={DISPENSING_SAFEDON_DEFAULT_CONFIG}
      title="Glove Dispensing Inspection"
      labels={DISPENSING_SAFEDON_LABELS}
      context={CONTEXT}
      evaluation={null}
      focusPath={null}
      readOnly={false}
      onChange={onChange}
      onFocusChange={() => {}}
    />,
  );
  expect(kit.tables).toHaveLength(1);
  return { table: kit.tables[0], pickers: [...kit.pickers] };
}

describe("dispensing_safedon capture writes", () => {
  it("counts every tap made before the screen renders again", () => {
    const changes: DispensingSafedonData[] = [];
    const saved: DispensingSafedonData = { sizes: { XL: { boxes: [{ boxNo: 1, counts: { sticky: 9 } }] } } };
    const { table } = renderScreen(saved, (next) => changes.push(next));

    table.onCountChange({ row: "no_cuff", column: "0" }, 1);
    table.onCountChange({ row: "sticky", column: "0" }, 1);
    table.onCountChange({ row: "sticky", column: "0" }, 2);

    expect(changes).toHaveLength(3);
    expect(changes[2].sizes.XS.boxes).toEqual([{ boxNo: null, counts: { no_cuff: 1, sticky: 2 } }]);
    // Size XL is no longer ordered: its data stays for when it comes back (6.2 rule 4).
    expect(changes[2].sizes.XL).toBe(saved.sizes.XL);
  });

  it("keeps a box picked and its first count together, in one change when they come together", () => {
    const changes: DispensingSafedonData[] = [];
    const { table, pickers } = renderScreen({ sizes: {} }, (next) => changes.push(next));
    expect(pickers).toHaveLength(3);

    pickers[1].onValueChange(12);
    table.onCountChange({ row: "stuck", column: "1" }, 1);
    expect(changes.at(-1)?.sizes.XS.boxes[1]).toEqual({ boxNo: 12, counts: { stuck: 1 } });

    batchDataChanges(() => {
      pickers[2].onValueChange(59);
      table.onCountChange({ row: "faulty_cuff", column: "2" }, 2);
    });
    expect(changes).toHaveLength(3);
    expect(changes[2].sizes.XS.boxes).toEqual([
      { boxNo: null, counts: {} },
      { boxNo: 12, counts: { stuck: 1 } },
      { boxNo: 59, counts: { faulty_cuff: 2 } },
    ]);
  });

  it("shows the box list's first page of 15, while the counts keep every box", () => {
    const changes: DispensingSafedonData[] = [];
    const boxes = Array.from({ length: 20 }, (_, index) => ({ boxNo: [3, 12, 59][index % 3], counts: {} }));
    const { table, pickers } = renderScreen({ sizes: { XS: { boxes } } }, (next) => changes.push(next));
    expect(pickers.map((picker) => picker.label)).toEqual(Array.from({ length: 15 }, (_, index) => `Box #, Column ${index + 1}`));
    expect(table.columns).toHaveLength(20);

    // A pick on the page writes its own column.
    pickers[14].onValueChange(12);
    expect(changes.at(-1)?.sizes.XS.boxes[14]).toEqual({ boxNo: 12, counts: {} });
    expect(changes.at(-1)?.sizes.XS.boxes).toHaveLength(20);
  });
});
