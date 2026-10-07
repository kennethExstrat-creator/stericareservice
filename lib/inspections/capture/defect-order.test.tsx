// "Defect picker shows the most-used defects first" (BUILD_SPEC 8): the
// watertight and visual captures order their rows by the usage the capture
// screen passes (CaptureProps.defectUsage), ties in the template's order,
// and change no result for it. Server-rendered markup, as the modules' own
// capture tests read it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ResolvedModule } from "@/lib/schemas";
import { MODULE_REGISTRY } from "@/modules/registry";
import { evaluateInspection, type CaptureComponent, type ModuleEvaluation } from "@/modules/_framework";
import { makeSampling, makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import VisualCapture from "@/modules/visual/Capture";
import WatertightCapture from "@/modules/watertight/Capture";

const noop = () => {};
const context = makeTestContext({ sizes: ["M"], sampling: { M: makeSampling({ watertightVisual: 200 }) } });

function render(key: "watertight" | "visual", Capture: CaptureComponent, defectUsage?: Record<string, number>) {
  const definition = MODULE_REGISTRY[key];
  const data = definition.emptyData();
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key, config: definition.defaultConfig as ResolvedModule["config"] }]);
  const evaluation = evaluateInspection({ template, data: { modules: { [key]: data }, custom: {} }, context }, MODULE_REGISTRY).modules.find(
    (entry) => entry.key === key,
  ) as ModuleEvaluation | undefined;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={definition.defaultConfig}
      title={definition.title}
      labels={definition.labels}
      context={context}
      evaluation={evaluation ?? null}
      focusPath={null}
      readOnly={false}
      onChange={noop}
      onFocusChange={noop}
      defectUsage={defectUsage}
    />,
  );
}

/** The row headings of the counter tables, in the order they render. */
const rowLabels = (html: string) =>
  Array.from(html.matchAll(/<th[^>]*scope="row"[^>]*>([\s\S]*?)<\/th>/g), (match) => match[1].replace(/<[^>]+>/g, "").trim()).filter(
    (label) => label !== "",
  );

describe("most-used defects first", () => {
  it("orders watertight's hole locations by usage, ties in the template's order", () => {
    const locations = ["Between fingers (crotch)", "Palm", "Finger", "Cuff", "Other :"];
    const only = (labels: string[]) => labels.filter((label) => locations.includes(label));
    expect(only(rowLabels(render("watertight", WatertightCapture as CaptureComponent)))).toEqual(locations);
    const used = rowLabels(render("watertight", WatertightCapture as CaptureComponent, { hole_cuff: 7, hole_finger: 2, hole_other: 1 }));
    expect(only(used)).toEqual(["Cuff", "Finger", "Other :", "Between fingers (crotch)", "Palm"]);
  });

  it("orders visual's defects by usage within each class", () => {
    const plain = rowLabels(render("visual", VisualCapture as CaptureComponent));
    const used = rowLabels(render("visual", VisualCapture as CaptureComponent, { stain: 9, thin_spot: 3 }));
    // The same rows, in another order.
    expect([...used].sort()).toEqual([...plain].sort());
    expect(used).not.toEqual(plain);
    const stain = plain.find((label) => /stain/i.test(label));
    const thin = plain.find((label) => /thin spot/i.test(label));
    expect(stain && thin && used.indexOf(stain) < used.indexOf(thin)).toBe(true);
  });

  it("keeps the template's order without usage", () => {
    expect(rowLabels(render("visual", VisualCapture as CaptureComponent, {}))).toEqual(
      rowLabels(render("visual", VisualCapture as CaptureComponent)),
    );
  });
});
