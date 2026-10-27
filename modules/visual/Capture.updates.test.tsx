// The capture screen's writes (docs/CAPTURE_KIT.md, useDataUpdater): kit
// callbacks fire with the data of the last render, so each change must start
// from the latest data. Taps made from one render in two class cards both
// land, the size's one gloves-inspected field writes every class, the
// sampling plan's n goes in with one tap, a pasted column of the cards' own
// fields reaches onChange once, and a one-off row comes off. The kit's
// Stepper and NumberField and the ui Button are wrapped to keep the callbacks
// this screen hands them; `handsOf` can show one hand, as the hand toggle does.
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HandView, NumberField, Stepper } from "@/components/qc";
import { batchDataChanges } from "@/components/qc/data-updater";
import type { Button } from "@/components/ui/button";
import { type CaptureFocus, type InspectionContext } from "@/modules/_framework";
import { makeSampling, makeTestContext } from "@/modules/_framework/testing";
import Capture from "./Capture";
import { VISUAL_DEFAULT_CONFIG, VISUAL_LABELS, VISUAL_TITLE, type VisualConfig } from "./config";
import { DEFECT_CLASSES, VisualDataSchema, type VisualData } from "./schema";

const kit = vi.hoisted(() => ({
  steppers: [] as ComponentProps<typeof Stepper>[],
  fields: [] as ComponentProps<typeof NumberField>[],
  buttons: [] as ComponentProps<typeof Button>[],
  /** The hands on screen instead of the toggle's view; null keeps the toggle's. */
  hands: null as ("R" | "L")[] | null,
}));

vi.mock("@/components/qc", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/qc")>();
  return {
    ...actual,
    Stepper: (props: ComponentProps<typeof Stepper>) => {
      kit.steppers.push(props);
      return createElement(actual.Stepper, props);
    },
    NumberField: (props: ComponentProps<typeof NumberField>) => {
      kit.fields.push(props);
      return createElement(actual.NumberField, props);
    },
    handsOf: (view: HandView) => kit.hands ?? actual.handsOf(view),
  };
});

vi.mock("@/components/ui/button", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/components/ui/button")>();
  return {
    ...actual,
    Button: (props: ComponentProps<typeof Button>) => {
      kit.buttons.push(props);
      return createElement(actual.Button, props);
    },
  };
});

beforeEach(() => {
  kit.hands = null;
});

/** Renders once and keeps every value handed to onChange, as the capture screen would save it, and every focus reported. */
function render(sizes: Record<string, unknown>, context: InspectionContext, config: VisualConfig = VISUAL_DEFAULT_CONFIG) {
  // This render's callbacks only.
  kit.steppers.length = 0;
  kit.fields.length = 0;
  kit.buttons.length = 0;
  const changes: VisualData[] = [];
  const reported: CaptureFocus[] = [];
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
      onFocusChange={(focus) => reported.push(focus)}
    />,
  );
  const stepper = (label: string) => {
    const found = kit.steppers.find((props) => props.label === label);
    if (!found) throw new Error(`No stepper named ${label}`);
    return found;
  };
  const button = (name: string) => {
    const found = kit.buttons.find((props) => props["aria-label"] === name);
    if (!found?.onClick) throw new Error(`No button named ${name}`);
    return () => found.onClick?.({} as Parameters<NonNullable<typeof found.onClick>>[0]);
  };
  return { changes, reported, fields: [...kit.fields], steppers: [...kit.steppers], stepper, button };
}

const M_500 = () => makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 500 }) } });
const SIZE_7 = () =>
  makeTestContext({
    sizes: ["7.0"],
    templateSizes: [{ value: "7.0", label: "7.0" }],
    sampling: { "7.0": makeSampling({ watertightVisual: 125 }) },
  });
const SPLIT: VisualConfig = { ...VISUAL_DEFAULT_CONFIG, handSplit: true };
const inspectedAll = (n: number) => Object.fromEntries(DEFECT_CLASSES.map((cls) => [cls, { inspected: n }]));
const inspectedOf = (data: VisualData | undefined, size: string) =>
  DEFECT_CLASSES.map((cls) => data?.sizes[size]?.[cls].inspected ?? null);

describe("visual capture writes", () => {
  it("keeps taps made from one render in two class cards", () => {
    const { changes, stepper } = render({ M: inspectedAll(500) }, M_500());
    stepper("Thin Spot on Glove Body, Size M").onValueChange(5);
    stepper("Small Dirt / Stain, Size M").onValueChange(1);
    stepper("Thin Area Between Fingers (Crotch), Size M").onValueChange(2);
    expect(changes.at(-1)?.sizes.M).toMatchObject({
      major: { inspected: 500, counts: { thin_spot: 5, thin_crotch_area: 2 } },
      minor: { inspected: 500, counts: { dirt_small: 1 } },
    });
  });

  it("writes the size's one gloves-inspected field to every class the template switches on", () => {
    const { changes, fields } = render({ XL: inspectedAll(200) }, M_500());
    expect(fields).toHaveLength(1);
    fields[0].onValueChange(500);
    expect(changes).toHaveLength(1);
    expect(inspectedOf(changes[0], "M")).toEqual([500, 500, 500]);
    // A size no longer ordered keeps its data (6.2 rule 4).
    expect(changes[0].sizes.XL).toMatchObject(inspectedAll(200));
    // Emptied, every class is not inspected again.
    fields[0].onValueChange(null);
    expect(inspectedOf(changes.at(-1), "M")).toEqual([null, null, null]);

    // A class switched off is left as it was.
    const config: VisualConfig = {
      ...VISUAL_DEFAULT_CONFIG,
      classes: { ...VISUAL_DEFAULT_CONFIG.classes, critical: { ...VISUAL_DEFAULT_CONFIG.classes.critical, include: false } },
    };
    const off = render({}, M_500(), config);
    off.fields[0].onValueChange(315);
    expect(inspectedOf(off.changes[0], "M")).toEqual([null, 315, 315]);
  });

  it("puts the sampling plan's n into every class with one tap", () => {
    const { changes, button } = render({}, M_500());
    button("Use 500 from the Sampling Plan for size M")();
    expect(changes).toHaveLength(1);
    expect(inspectedOf(changes[0], "M")).toEqual([500, 500, 500]);
  });

  it("stores a column pasted down the cards' own fields (a number per class saved before) as one change", () => {
    const { changes, fields, button } = render({ M: { critical: { inspected: 500 } } }, M_500());
    // One run over the cards: critical, major, minor.
    expect(fields).toHaveLength(3);
    batchDataChanges(() => {
      for (const field of fields) field.onValueChange(315);
    });
    expect(changes).toHaveLength(1);
    expect(inspectedOf(changes[0], "M")).toEqual([315, 315, 315]);
    // Use never writes over a number entered since the render, and a card's enters its own class only.
    button("Use 500 from the Sampling Plan for Major Defects, size M")();
    expect(changes).toHaveLength(1);
    const fresh = render({ M: { critical: { inspected: 500 } } }, M_500());
    fresh.button("Use 500 from the Sampling Plan for Minor Defects, size M")();
    expect(inspectedOf(fresh.changes[0], "M")).toEqual([500, null, 500]);
  });

  it("counts per hand and takes a one-off row added by mistake off, in the same event", () => {
    const { changes, stepper, button } = render(
      { "7.0": { ...inspectedAll(125), R: { minor: { unmapped: [{ label: "Faint print", count: 0 }] } } } },
      SIZE_7(),
      SPLIT,
    );
    stepper("Embedded Insects, Size 7.0, Left Hand").onValueChange(1);
    button("Remove Faint print")();
    expect(changes.at(-1)?.sizes["7.0"]).toMatchObject({
      R: { minor: { unmapped: [] } },
      L: { critical: { counts: { embedded_insect: 1 } } },
    });
  });

  it("counts a one-off on either hand, the left hand's own entry added as it is first counted", () => {
    const { changes, stepper } = render(
      { "7.0": { ...inspectedAll(125), R: { minor: { unmapped: [{ label: "Faint print", count: 0 }] } } } },
      SIZE_7(),
      SPLIT,
    );
    stepper("Faint print, Size 7.0, Left Hand").onValueChange(1);
    expect(changes.at(-1)?.sizes["7.0"].L?.minor.unmapped).toEqual([{ label: "Faint print", count: 1 }]);
  });

  it("with one hand on screen, gives each row that hand's stepper only", () => {
    kit.hands = ["L"];
    const { steppers } = render({ "7.0": inspectedAll(125) }, SIZE_7(), SPLIT);
    // Critical's 2 rows, major's 12 and minor's 6.
    expect(steppers).toHaveLength(20);
    expect(steppers.every((props) => props.label.endsWith(", Size 7.0, Left Hand"))).toBe(true);
  });

  it("reports the size, the hand and the defect counted, so the next photo is tagged with them", () => {
    const { reported, stepper } = render(
      { "7.0": { ...inspectedAll(125), R: { minor: { unmapped: [{ label: "Faint print", count: 0 }] } } } },
      SIZE_7(),
      SPLIT,
    );
    reported.length = 0;
    stepper("Thin Spot on Glove Body, Size 7.0, Right Hand").onValueChange(1);
    // A one-off label has no code to tag.
    stepper("Faint print, Size 7.0, Left Hand").onValueChange(1);
    expect(reported).toEqual([
      { size: "7.0", hand: "R", defect: "thin_spot" },
      { size: "7.0", hand: "L" },
    ]);
  });
});
