// How the capture body writes its data (docs/CAPTURE_KIT.md, useDataUpdater):
// MeasurementGrid is replaced by a stand-in that keeps the props it was given,
// so the test calls onValuesChange the way the grid does, with the column
// built from the readings it rendered, before the screen renders again.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { MeasurementValues } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { FORCE_AT_BREAK_DEFAULT_CONFIG, FORCE_AT_BREAK_LABELS, FORCE_AT_BREAK_TITLE } from "./config";
import type { ForceAtBreakData } from "./schema";

type GridProps = { rows?: number; values: MeasurementValues; onValuesChange: (values: MeasurementValues) => void };

const kit = vi.hoisted(() => ({ grids: [] as GridProps[] }));

vi.mock("@/components/qc", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/components/qc")>()),
  MeasurementGrid: (props: GridProps) => {
    kit.grids.push(props);
    return null;
  },
}));

const CONTEXT = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ physical: 13 }) } });

/**
 * Renders the body once, inside a screen's file slot, and returns the grid's
 * props, the file slot's request and every onChange the screen received.
 */
function renderGrid(data: ForceAtBreakData) {
  kit.grids.length = 0;
  const changes: ForceAtBreakData[] = [];
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
        config={FORCE_AT_BREAK_DEFAULT_CONFIG}
        title={FORCE_AT_BREAK_TITLE}
        labels={FORCE_AT_BREAK_LABELS}
        context={CONTEXT}
        evaluation={null}
        focusPath={null}
        readOnly={false}
        onChange={(next) => changes.push(next)}
      />
    </FileSlotProvider>,
  );
  const grid = kit.grids.at(-1);
  if (!grid) throw new Error("no grid rendered");
  return { grid, slots, changes };
}

/** The grid's column after editing `cells`, built from what it rendered, as MeasurementGrid builds it. */
function edited(grid: GridProps, cells: Record<number, number | null>): MeasurementValues {
  const rows = grid.rows ?? 13;
  const column = Array.from({ length: rows }, (_, row) => (row in cells ? cells[row] : (grid.values.values?.[row] ?? null)));
  return { ...grid.values, values: column };
}

const SAVED: ForceAtBreakData = {
  sizes: { M: { values: [6.47, 6.884, 6.301] }, XL: { values: [6.9] } },
  labReport: null,
};

describe("force_at_break capture writes", () => {
  it("keeps the lab report the file slot attaches, over the latest readings, and drops it when that file goes", () => {
    const REPORT = "00000000-0000-4000-8000-000000000409";
    const { grid, slots, changes } = renderGrid(SAVED);
    grid.onValuesChange(edited(grid, { 3: 6.537 }));
    slots[0].onAdded({ id: REPORT, name: "FAB report.pdf", kind: "lab_report" });
    expect(changes.at(-1)).toEqual({
      sizes: { M: { values: [6.47, 6.884, 6.301, 6.537] }, XL: { values: [6.9] } },
      labReport: REPORT,
    });
    slots[0].onRemoved(REPORT);
    expect(changes.at(-1)?.labReport).toBeNull();
    expect(changes.at(-1)?.sizes.M?.values).toEqual([6.47, 6.884, 6.301, 6.537]);
  });

  it("builds each grid edit on the latest data: two edits before the screen renders again both land", () => {
    const { grid, changes } = renderGrid(SAVED);
    expect(grid.rows).toBe(13);
    grid.onValuesChange(edited(grid, { 3: 6.537 }));
    grid.onValuesChange(edited(grid, { 4: 6.65 }));
    expect(changes.at(-1)).toEqual({
      // XL is not ordered: its readings stay saved for when it is again (6.2 rule 4).
      sizes: { M: { values: [6.47, 6.884, 6.301, 6.537, 6.65] }, XL: { values: [6.9] } },
      labReport: null,
    });
  });

  it("hands a pasted column to the screen in one change", () => {
    const { grid, changes } = renderGrid({ sizes: {}, labReport: null });
    const pasted = [6.47, 6.884, 6.301, 6.537, 6.65, 6.214, 6.79, 6.512, 6.611, 6.42, 6.702, 6.388, 6.58];
    batchDataChanges(() => grid.onValuesChange({ values: pasted }));
    expect(changes).toEqual([{ sizes: { M: { values: pasted } }, labReport: null }]);
  });

  it("saves nothing when a commit changes no reading", () => {
    const { grid, changes } = renderGrid(SAVED);
    grid.onValuesChange(edited(grid, {}));
    expect(changes).toEqual([]);
  });
});
