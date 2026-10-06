// The capture screen's writes (docs/CAPTURE_KIT.md, useDataUpdater): kit
// callbacks fire with the data of the last render, so each change must start
// from the latest data. Changes made from one render in two class tables
// both land, and a pasted column of gloves inspected reaches onChange once.
// The kit's CounterTable and NumberField are wrapped to keep the callbacks
// this screen hands them.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CounterTable, NumberField } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import { type InspectionContext } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { VISUAL_DEFAULT_CONFIG, VISUAL_LABELS, VISUAL_TITLE, type VisualConfig } from "./config";
import { DEFECT_CLASSES, VisualDataSchema, type VisualData } from "./schema";

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
function render(sizes: Record<string, unknown>, context: InspectionContext, config: VisualConfig = VISUAL_DEFAULT_CONFIG) {
  const changes: VisualData[] = [];
  renderToStaticMarkup(
    <Capture
      data={VisualDataSchema.parse({ sizes })}
      config={config}
      title={VISUAL_TITLE}
      labels={VISUAL_LABELS}
      context={context}
      evaluation={null}
      focusPath={null}
      readOnly={false}
      onChange={(next) => changes.push(next)}
    />,
  );
  return { changes, tables: [...kit.tables], fields: [...kit.fields] };
}

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });
const inspectedAll = (n: number) => Object.fromEntries(DEFECT_CLASSES.map((cls) => [cls, { inspected: n }]));

describe("visual capture writes", () => {
  it("keeps taps made from one render in two class tables", () => {
    const { changes, tables } = render({ M: inspectedAll(500) }, M_500());
    expect(tables).toHaveLength(3);
    const [, major, minor] = tables;
    major.onCountChange({ row: "thin_spot", column: "M" }, 5);
    minor.onCountChange({ row: "dirt_small", column: "M" }, 1);
    major.onCountChange({ row: "thin_crotch_area", column: "M" }, 2);
    expect(changes.at(-1)?.sizes.M).toMatchObject({
      major: { inspected: 500, counts: { thin_spot: 5, thin_crotch_area: 2 } },
      minor: { inspected: 500, counts: { dirt_small: 1 } },
    });
  });

  it("stores a column of gloves inspected pasted down the classes as one change with every value", () => {
    const { changes, fields } = render({ XL: inspectedAll(200) }, M_500());
    // One run over the classes: critical, major, minor.
    expect(fields).toHaveLength(3);
    batchDataChanges(() => {
      for (const field of fields) field.onValueChange(500);
    });
    expect(changes).toHaveLength(1);
    expect(changes[0].sizes.M).toMatchObject({ critical: { inspected: 500 }, major: { inspected: 500 }, minor: { inspected: 500 } });
    // A size no longer ordered keeps its data (6.2 rule 4).
    expect(changes[0].sizes.XL).toMatchObject(inspectedAll(200));
  });

  it("adds a one-off label to its class and counts it per hand in the same event", () => {
    const context = makeTestContext({
      sizes: ["7.0"],
      templateSizes: [{ value: "7.0", label: "7.0" }],
      sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
    });
    const { changes, tables } = render({ "7.0": inspectedAll(125) }, context, { ...VISUAL_DEFAULT_CONFIG, handSplit: true });
    const [critical, , minor] = tables;
    minor.onAddRow?.("Faint print");
    critical.onCountChange({ row: "embedded_insect", column: "7.0", hand: "L" }, 1);
    expect(changes.at(-1)?.sizes["7.0"]).toMatchObject({
      R: { minor: { unmapped: [{ label: "Faint print", count: 0 }] } },
      L: { critical: { counts: { embedded_insect: 1 } } },
    });
  });
});
