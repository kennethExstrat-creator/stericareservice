// The capture screen's writes (docs/CAPTURE_KIT.md, useDataUpdater): kit
// callbacks fire with the data of the last render, so each change must start
// from the latest data. Two changes made from one render both land, and a
// pasted column reaches onChange once. The kit's CounterTable and NumberField
// are wrapped to keep the callbacks this screen hands them.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CounterTable, NumberField } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { type InspectionContext } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { WATERTIGHT_DEFAULT_CONFIG, WATERTIGHT_LABELS, WATERTIGHT_TITLE, type WatertightConfig } from "./config";
import { WatertightDataSchema, type WatertightData } from "./schema";

const kit = vi.hoisted(() => ({
  tables: [] as ComponentProps<typeof CounterTable>[],
  fields: [] as ComponentProps<typeof NumberField>[],
}));

vi.mock("@/components/qc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/qc")>();
  return {
    ...actual,
    CounterTable: (props: ComponentProps<typeof CounterTable>) => {
      kit.tables.push(props);
      return createElement(actual.CounterTable, props);
    },
    NumberField: (props: ComponentProps<typeof NumberField>) => {
      kit.fields.push(props);
      return createElement(actual.NumberField, props);
    },
  };
});

beforeEach(() => {
  kit.tables.length = 0;
  kit.fields.length = 0;
});

/** Renders once and keeps every value handed to onChange, as the capture screen would save it. */
function render(sizes: Record<string, unknown>, context: InspectionContext, config: WatertightConfig = WATERTIGHT_DEFAULT_CONFIG) {
  const changes: WatertightData[] = [];
  renderToStaticMarkup(
    <Capture
      data={WatertightDataSchema.parse({ sizes })}
      config={config}
      title={WATERTIGHT_TITLE}
      labels={WATERTIGHT_LABELS}
      context={context}
      evaluation={null}
      focusPath={null}
      readOnly={false}
      onChange={(next) => changes.push(next)}
    />,
  );
  const table = kit.tables[0];
  if (!table) throw new Error("No CounterTable rendered");
  return { changes, table, fields: [...kit.fields] };
}

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });

describe("watertight capture writes", () => {
  it("keeps both of two taps made from one render", () => {
    const { changes, table } = render({ M: { tested: 500 } }, M_500());
    table.onCountChange({ row: "hole_finger", column: "M" }, 1);
    table.onCountChange({ row: "hole_palm", column: "M" }, 2);
    expect(changes.at(-1)?.sizes.M).toMatchObject({ tested: 500, holes: { hole_finger: 1, hole_palm: 2 } });
  });

  it("stores a column of gloves tested pasted over the sizes as one change with every value", () => {
    const context = makeTestContext({
      sizes: ["S", "M"],
      sampling: { S: makeSampling({ watertightVisual: 200 }), M: makeSampling({ watertightVisual: 500 }) },
    });
    const { changes, fields } = render({ XL: { tested: 80 } }, context);
    expect(fields).toHaveLength(2);
    // What NumberField does with a pasted column: each field stores its value inside one batch.
    batchDataChanges(() => {
      fields[0].onValueChange(200);
      fields[1].onValueChange(500);
    });
    expect(changes).toHaveLength(1);
    // A size no longer ordered keeps its data (6.2 rule 4).
    expect(changes[0].sizes).toMatchObject({ S: { tested: 200 }, M: { tested: 500 }, XL: { tested: 80 } });
  });

  it("adds a one-off label and counts it in the same event, per hand with a hand split", () => {
    const context = makeTestContext({
      sizes: ["7.0"],
      templateSizes: [{ value: "7.0", label: "7.0" }],
      sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
    });
    const { changes, table } = render({ "7.0": { tested: 125 } }, context, { ...WATERTIGHT_DEFAULT_CONFIG, handSplit: true });
    table.onAddRow?.("Near the thumb");
    table.onCountChange({ row: "hole_cuff", column: "7.0", hand: "L" }, 1);
    expect(changes.at(-1)?.sizes["7.0"]).toMatchObject({
      tested: 125,
      R: { unmapped: [{ label: "Near the thumb", count: 0 }] },
      L: { holes: { hole_cuff: 1 } },
    });
  });

  it("changes nothing for a one-off label the list already has", () => {
    const { changes, table } = render({ M: { tested: 500 } }, M_500());
    table.onAddRow?.("Palm");
    expect(changes).toEqual([]);
  });
});
