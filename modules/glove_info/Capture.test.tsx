// Server-rendered markup of the glove information's capture body: the
// template's wording and fields, the weight on the decimal keypad with
// calc's error, read-only mode and issue links. Typing and Enter are the
// kit's and the browser's; the edits are pure (edit.test.ts).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides, moduleConfig } from "@/lib/coverage";
import { evaluateInspection, type CaptureProps, type ModuleEvaluation } from "@/modules/_framework";
import { makeTestContext, makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE } from "@/tests/fixtures/examples";
import type { GloveInfoComputed } from "./calc";
import Capture from "./Capture";
import { GLOVE_INFO_DEFAULT_CONFIG, GLOVE_INFO_LABELS, GLOVE_INFO_TITLE, type GloveInfoConfig } from "./config";
import { definition } from "./index";
import { emptyGloveInfo, type GloveInfoData } from "./schema";

type Props = CaptureProps<GloveInfoData, GloveInfoConfig, GloveInfoComputed>;

const EXAMPLE: GloveInfoData = {
  surfaceTexture: SAFEDON_EG_EXAMPLE.gloveInfo.surfaceTexture,
  indicativeWeight: SAFEDON_EG_EXAMPLE.gloveInfo.indicativeWeightG,
  colour: SAFEDON_EG_EXAMPLE.gloveInfo.colour,
  length: SAFEDON_EG_EXAMPLE.gloveInfo.length,
};

function evaluationOf(data: GloveInfoData, config: GloveInfoConfig, labels: Readonly<Record<string, string>>) {
  const template = makeTestTemplate(MODULE_REGISTRY, [{ key: "glove_info", config, labels }]);
  const found = evaluateInspection(
    { template, data: { modules: { glove_info: data }, custom: {} }, context: makeTestContext() },
    MODULE_REGISTRY,
  ).modules.find((entry) => entry.key === "glove_info");
  return (found ?? null) as ModuleEvaluation<GloveInfoComputed> | null;
}

function render(overrides: Partial<Props> = {}): string {
  const data = overrides.data ?? EXAMPLE;
  const config = overrides.config ?? GLOVE_INFO_DEFAULT_CONFIG;
  const labels = overrides.labels ?? GLOVE_INFO_LABELS;
  return renderToStaticMarkup(
    <Capture
      data={data}
      config={config}
      title={GLOVE_INFO_TITLE}
      labels={labels}
      context={makeTestContext()}
      evaluation={evaluationOf(data, config, labels)}
      focusPath={null}
      readOnly={false}
      onChange={() => {}}
      {...overrides}
    />,
  );
}

const tags = (html: string, pattern: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${pattern}[^>]*>`, "g")), (match) => match[0]);

const inputsOf = (html: string): string[] => Array.from(html.matchAll(/<input[^>]*>/g), (match) => match[0]);

describe("glove_info capture", () => {
  it("is the module's capture screen, loaded on demand", async () => {
    expect(definition.loadCapture).toBeDefined();
    expect((await definition.loadCapture?.())?.default).toBe(Capture);
  });

  it("asks for the four values in the reports' order and wording, the weight in g on the decimal keypad", () => {
    const html = render();
    const labels = Array.from(html.matchAll(/<label[^>]*>([^<]*)</g), (match) => match[1]);
    expect(labels).toEqual(["Glove Surface Texture", "Indicative Weight (Size M)", "Glove Colour", "Glove Length"]);
    expect(html).toContain('value="Finger-textured"');
    expect(html).toContain('value="Purple blue"');
    expect(html).toContain('value="240 mm minimum"');
    const [weight] = tags(html, 'inputMode="decimal"');
    expect(weight).toContain('value="3.2"');
    expect(html).toContain(">g<");
  });

  it("reads the template's wording and shows only the fields it switches on (6.2 rule 11)", () => {
    const labels = { ...GLOVE_INFO_LABELS, colour: "Colour", indicativeWeight: "Indicative weight (size L)" };
    const config = { fields: { ...GLOVE_INFO_DEFAULT_CONFIG.fields, length: false }, indicativeWeightSize: "L" };
    const html = render({ labels, config });
    expect(html).toContain(">Colour</label>");
    expect(html).toContain("Indicative weight (size L)");
    expect(html).not.toContain("Glove Length");
    // The seed templates word it as the dictionary does.
    expect(moduleConfig("STD_EG", "glove_info")?.fields).toEqual(GLOVE_INFO_DEFAULT_CONFIG.fields);
    expect(labelOverrides("SAFEDON_EG", "glove_info")).toEqual({});
  });

  it("says so when the template switches every field off", () => {
    const off = { fields: { surfaceTexture: false, indicativeWeight: false, colour: false, length: false }, indicativeWeightSize: "M" };
    expect(render({ config: off })).toContain("No fields are switched on for this template.");
  });

  it("shows calc's error under the weight, in red", () => {
    const html = render({ data: { ...EXAMPLE, indicativeWeight: -1 } });
    expect(html).toContain("Indicative Weight (Size M): must be more than 0 g.");
    // The module's not-done warning speaks of the whole module: never under a field.
    expect(render({ data: emptyGloveInfo() })).not.toContain("is not done");
  });

  it("keeps every field readable but unchangeable when read-only", () => {
    const html = render({ readOnly: true });
    const inputs = inputsOf(html);
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input).toContain('readOnly=""');
  });

  it("marks each field for issue links and puts all four in one Enter run", () => {
    const html = render();
    for (const field of ["surfaceTexture", "indicativeWeight", "colour", "length"]) {
      expect(html).toContain(`data-issue-path="[&quot;${field}&quot;]"`);
    }
    expect(tags(html, 'data-enter-scope=""')).toHaveLength(1);
    expect(tags(html, "data-enter-field")).toHaveLength(4);
    const inputs = inputsOf(html);
    expect(inputs).toHaveLength(4);
    for (const input of inputs) expect(input).toContain('enterKeyHint="next"');
  });
});
