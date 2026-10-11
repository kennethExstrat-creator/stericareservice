// Server-rendered markup of the glove information's capture body: a card
// per variant with its sizes and the template's fields, the weight on the
// decimal keypad with the size it is compared with, Add Variant, read-only
// mode. Typing and Enter are the kit's and the browser's; the edits are pure
// (edit.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { evaluateInspection, type CaptureProps, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import type { GloveInfoComputed } from "./calc";
import Capture from "./Capture";
import { GLOVE_INFO_DEFAULT_CONFIG, GLOVE_INFO_LABELS, GLOVE_INFO_TITLE, type GloveInfoConfig } from "./config";
import { definition } from "./index";
import { emptyGloveInfo, type GloveInfoData } from "./schema";

type Props = CaptureProps<GloveInfoData, GloveInfoConfig, GloveInfoComputed>;

const TWO: GloveInfoData = {
  variants: [
    { sizes: ["S"], gloveType: null, surfaceTexture: "Finger-textured", indicativeWeight: 3.1, colour: "Blue", length: "240 mm minimum" },
    { sizes: ["M", "L"], gloveType: null, surfaceTexture: "Smooth", indicativeWeight: 4.2, colour: "White", length: "300 mm minimum" },
  ],
};

function evaluationOf(data: GloveInfoData, config: GloveInfoConfig) {
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "glove_info", config }]);
  const found = evaluateInspection(
    { template, data: { modules: { glove_info: data }, custom: {} }, context: makeTestContext() },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "glove_info");
  return (found ?? null) as ModuleEvaluation<GloveInfoComputed> | null;
}

function render(overrides: Partial<Props> = {}): string {
  const data = overrides.data ?? TWO;
  const config = overrides.config ?? GLOVE_INFO_DEFAULT_CONFIG;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={GLOVE_INFO_TITLE}
      labels={GLOVE_INFO_LABELS}
      context={makeTestContext()}
      evaluation={evaluationOf(data, config)}
      focusPath={null}
      readOnly={false}
      onChange={() => {}}
      {...overrides}
    />,
  );
}

describe("glove_info capture", () => {
  it("is the module's capture screen, loaded on demand", async () => {
    expect((await definition.loadCapture?.())?.default).toBe(Capture);
  });

  it("shows a card per variant with its sizes picked and the fields in the template's wording", () => {
    const html = render();
    expect((html.match(/>Variant \d</g) ?? []).length).toBe(2);
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(3);
    expect(html).toContain(">Glove Surface Texture</label>");
    expect(html).toContain("Indicative Weight");
    expect(html).not.toContain("Indicative Weight (Size M)");
    expect(html).toContain("Compared with size S&#x27;s weighed gloves.");
    expect(html).toContain("Compared with size M&#x27;s weighed gloves.");
    expect(html).toContain("Add Variant");
  });

  it("shows one blank variant while none is saved, covering every size", () => {
    const html = render({ data: emptyGloveInfo() });
    expect((html.match(/>Variant \d</g) ?? []).length).toBe(1);
    expect(html).toContain("(None Picked: Every Size)");
    expect(html).not.toContain("Remove Variant 1");
  });

  it("offers no adding or removing when read-only", () => {
    const html = render({ readOnly: true });
    expect(html).not.toContain("Add Variant");
    expect(html).not.toContain("Remove Variant");
  });
});
