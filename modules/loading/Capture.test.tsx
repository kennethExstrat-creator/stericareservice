// Server-rendered markup of the loading capture: the fields the template
// switches on, the order's total cartons shown and never typed, calc's
// warnings beside their field, the loading stages for photo tags, read-only.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CaptureProps, InspectionContext, ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext } from "@/modules/_framework/testing";
import { STD_EG_EXAMPLE, STD_EG_EXPECTED } from "@/tests/fixtures/examples";
import { calcLoading, type LoadingComputed } from "./calc";
import Capture, { stageTagLine } from "./Capture";
import { LOADING_DEFAULT_CONFIG, LOADING_LABELS, LOADING_STAGES, LOADING_TITLE, type LoadingConfig } from "./config";
import { emptyLoading, type LoadingData } from "./schema";

const noop = () => {};
const ORDERED_M = STD_EG_EXAMPLE.order.lines.M?.qtyCases ?? null;

const CONTEXT: InspectionContext = makeTestContext({
  sizes: ["M"],
  order: { M: { qtyCases: ORDERED_M, lotNumbers: ["LOT-A01"] } },
});

function render(
  data: Partial<LoadingData>,
  {
    readOnly = false,
    labels = LOADING_LABELS,
    config = LOADING_DEFAULT_CONFIG,
    broken = false,
  }: { readOnly?: boolean; labels?: Record<string, string>; config?: LoadingConfig; broken?: boolean } = {},
): string {
  const full = { ...emptyLoading(), ...data };
  const output = calcLoading({ data: full, config, title: LOADING_TITLE, labels, context: CONTEXT, results: {}, hasData: true });
  const evaluation: ModuleEvaluation<LoadingComputed> = {
    key: "loading",
    title: LOADING_TITLE,
    labels,
    config,
    data: full,
    hasData: true,
    comment: null,
    // What the engine hands over when the module cannot be evaluated: nothing computed.
    computed: broken ? ({} as LoadingComputed) : output.computed,
    result: output.result,
    issues: output.issues.map((issue) => ({ ...issue, moduleKey: "loading" })),
    stub: false,
  };
  const props: CaptureProps<LoadingData, LoadingConfig, LoadingComputed> = {
    data: full,
    config,
    title: LOADING_TITLE,
    labels,
    context: CONTEXT,
    evaluation,
    focusPath: null,
    readOnly,
    onChange: noop,
  };
  return renderToStaticMarkup(<Capture {...props} />);
}

describe("loading capture", () => {
  it("shows every field in the template's wording, with the order's cartons computed", () => {
    const labels = { ...LOADING_LABELS, sealNo: "Bolt seal", cartonsOrdered: "PO cartons" };
    const html = render({}, { labels });
    for (const label of ["Container no.", "Bolt seal", "Cartons loaded", "Carton condition"]) expect(html).toContain(label);
    expect(STD_EG_EXPECTED.totals.cartons).toBe(2900);
    expect(html).toMatch(/PO cartons:<span[^>]*>2,900<\/span>/);
    expect(html).toContain("All 2,900 Loaded");
  });

  it("hides the fields the template switches off", () => {
    const config = { fields: { ...LOADING_DEFAULT_CONFIG.fields, sealNo: false, cartonCondition: false } };
    const html = render({}, { config });
    expect(html).not.toContain("Seal no.");
    expect(html).not.toContain("Carton condition");
    expect(html).toContain("Container no.");
  });

  it("shows calc's warnings beside the container number and the cartons, as their fields' descriptions", () => {
    const html = render({ containerNo: "CSQU3054384", cartonsLoaded: 2850 });
    expect(html).toMatch(
      /<input[^>]*aria-describedby="[^"]+-container-issue"[^>]*>.*?<p id="[^"]+-container-issue" class="[^"]*text-warn[^"]*">Container no\. CSQU3054384: the ISO 6346 check digit should be 3\./,
    );
    // NumberField's warning, which describes the field with the count, in amber.
    expect(html).toMatch(/<input[^>]*aria-describedby="[^"]+-hint [^"]+-calc-warning"/);
    expect(html).toMatch(
      /<div id="[^"]+-calc-warning"[^>]*text-warn[^>]*>.*?<span>Cartons loaded \(2,850\) does not match Cartons ordered \(2,900\): 50 short\.<\/span>/,
    );
    expect(html).not.toContain("All 2,900 Loaded");
  });

  it("offers the loading stages, and says the photos taken at a stage are tagged with it", () => {
    const html = render({});
    const stages = Array.from(html.matchAll(/data-slot="toggle-group-item"[^>]*>([^<]*)<\/button>/g), (match) => match[1]);
    expect(stages).toEqual(LOADING_STAGES.map((stage) => LOADING_LABELS[stage]));
    expect(html).toContain(LOADING_LABELS.loadingStage);
    // No stage picked yet: what to do first.
    expect(html).toContain("Pick the stage before taking its photos, so each photo is tagged with it.");
  });

  it("words the stage in a photo's tag line as the template does", () => {
    const labels = { ...LOADING_LABELS, doorsClosed: "Doors shut" };
    expect(stageTagLine("doorsClosed", labels)).toBe("Photos taken now are tagged “Doors shut”.");
    expect(stageTagLine(null, labels)).toBe("Pick the stage before taking its photos, so each photo is tagged with it.");
  });

  it("shows the container number as stored, in capitals", () => {
    const html = render({ containerNo: "CSQU3054383" });
    expect(html).toMatch(/<input[^>]*id="[^"]+-container"[^>]*value="CSQU3054383"/);
  });

  it("still shows the order's cartons from the context when calc could not run", () => {
    expect(render({}, { broken: true })).toContain("All 2,900 Loaded");
  });

  it("is read-only on an approved inspection: no quick fill, no stage picker", () => {
    const html = render({ containerNo: "CSQU3054383", sealNo: "SL-0001" }, { readOnly: true });
    const inputs = Array.from(html.matchAll(/<input[^>]*>/g), (match) => match[0]);
    expect(inputs).toHaveLength(3);
    expect(inputs.every((tag) => /readonly=""/i.test(tag))).toBe(true);
    expect(html).not.toContain("All 2,900 Loaded");
    expect(html).not.toContain(LOADING_LABELS.loadingStage);
  });
});
