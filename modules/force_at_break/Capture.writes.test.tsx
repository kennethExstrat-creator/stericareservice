// How the capture body writes its data (docs/CAPTURE_KIT.md, useDataUpdater):
// MeasurementGrid is replaced by a stand-in that keeps the props it was given,
// so the test calls onCellsChange the way the grid does, with only the cells
// a change touched, before the screen renders again.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Measure, MeasurementCell, MeasurementChange, MeasurementValues } from "@/components/qc";
import { batchDataChanges } from "@/components/qc";
import { FileSlotProvider, type FileSlotRequest } from "@/modules/_framework/file-slot";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { FORCE_AT_BREAK_DEFAULT_CONFIG, FORCE_AT_BREAK_LABELS, FORCE_AT_BREAK_TITLE } from "./config";
import type { ForceAtBreakData } from "./schema";

type GridProps = {
  rows?: number;
  measures: readonly Measure[];
  values: MeasurementValues;
  onCellsChange: (changes: readonly MeasurementChange[]) => void;
  onCellFocus: (cell: MeasurementCell) => void;
  cellIssuePath: (cell: MeasurementCell) => readonly (string | number)[];
  readOnly?: boolean;
};

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
function renderGrid(data: ForceAtBreakData, readOnly = false) {
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
        readOnly={readOnly}
        onChange={(next) => changes.push(next)}
      />
    </FileSlotProvider>,
  );
  const grid = kit.grids.at(-1);
  if (!grid) throw new Error("no grid rendered");
  return { grid, slots, changes };
}

/** The grid's onCellsChange for some cells of the readings. */
function cells(values: Record<number, number | null>): MeasurementChange[] {
  return Object.entries(values).map(([row, value]) => ({ row: Number(row), measure: "values", value }));
}

const SAVED: ForceAtBreakData = {
  sizes: { M: { values: [6.47, 6.884, 6.301] }, XL: { values: [6.9] } },
  labReport: null,
};

describe("force_at_break capture writes", () => {
  it("drops the lab report Steri-AI linked when it is unlinked, over the latest readings", () => {
    const REPORT = "00000000-0000-4000-8000-000000000409";
    const { grid, slots, changes } = renderGrid({ ...SAVED, labReport: REPORT });
    expect(slots).toEqual([
      expect.objectContaining({ moduleKey: "force_at_break", kind: "lab_report", fileId: REPORT, countsModuleFiles: true }),
    ]);
    grid.onCellsChange(cells({ 3: 6.537 }));
    slots[0].onRemoved(REPORT);
    expect(changes.at(-1)).toEqual({
      sizes: { M: { values: [6.47, 6.884, 6.301, 6.537] }, XL: { values: [6.9] } },
      labReport: null,
    });
  });

  it("builds each grid edit on the latest data: two edits before the screen renders again both land", () => {
    const { grid, changes } = renderGrid(SAVED);
    expect(grid.rows).toBe(13);
    expect(grid.values).toEqual({ values: [6.47, 6.884, 6.301] });
    grid.onCellsChange(cells({ 3: 6.537 }));
    grid.onCellsChange(cells({ 4: 6.65 }));
    expect(changes.at(-1)).toEqual({
      // XL is not ordered: its readings stay saved for when it is again (6.2 rule 4).
      sizes: { M: { values: [6.47, 6.884, 6.301, 6.537, 6.65] }, XL: { values: [6.9] } },
      labReport: null,
    });
  });

  it("hands a pasted column to the screen in one change", () => {
    const { grid, changes } = renderGrid({ sizes: {}, labReport: null });
    const pasted = [6.47, 6.884, 6.301, 6.537, 6.65, 6.214, 6.79, 6.512, 6.611, 6.42, 6.702, 6.388, 6.58];
    batchDataChanges(() => grid.onCellsChange(pasted.map((value, row) => ({ row, measure: "values", value }))));
    expect(changes).toEqual([{ sizes: { M: { values: pasted } }, labReport: null }]);
  });

  it("saves nothing when a commit changes no reading", () => {
    const { grid, changes } = renderGrid(SAVED);
    grid.onCellsChange(cells({ 1: 6.884 }));
    grid.onCellsChange([]);
    expect(changes).toEqual([]);
  });

  it("marks each cell with its reading's path, for issue links, and passes read-only through", () => {
    const { grid } = renderGrid(SAVED, true);
    expect(grid.cellIssuePath({ row: 4, measure: "values" })).toEqual(["sizes", "M", "values", 4]);
    expect(grid.readOnly).toBe(true);
  });

  it("refuses 0 N at the cell, as calc does: more than 0 ('Must be more than 0.')", () => {
    const { grid } = renderGrid(SAVED);
    expect(grid.measures[0]).toMatchObject({ key: "values", min: 0, minExclusive: true, decimals: 3 });
  });
});
