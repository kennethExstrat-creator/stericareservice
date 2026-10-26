// Server-rendered markup of the glove information's capture body: one glove
// per inspection (Kenneth, 26 October 2026), its fields in the template's
// wording, the weight on the decimal keypad; an inspection saved with
// several variants, each in a card with Remove; read-only mode. Typing and
// Enter are the kit's and the browser's; the edits are pure (edit.test.ts).
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

const GLOVE: GloveInfoData = {
  gloveType: "Nitrile, powder free",
  variants: [{ sizes: [], surfaceTexture: "Finger-textured", indicativeWeight: 3.5, colour: "Blue", length: 240 }],
};

/** Saved before one glove per inspection: two variants, each for its sizes. */
const TWO: GloveInfoData = {
  gloveType: "Nitrile, powder free",
  variants: [
    { sizes: ["S"], surfaceTexture: "Finger-textured", indicativeWeight: 3.1, colour: "Blue", length: 240 },
    { sizes: ["M", "L"], surfaceTexture: "Smooth", indicativeWeight: 4.2, colour: "White", length: 300 },
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
  const data = overrides.data ?? GLOVE;
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

  it("asks the Glove Type once, before the glove's fields", () => {
    const html = render();
    expect(html.match(/>Glove Type</g)).toHaveLength(1);
    expect(html.indexOf(">Glove Type<")).toBeLessThan(html.indexOf("Glove Surface Texture"));
    expect(html).toContain('value="Nitrile, powder free"');
    expect(html).not.toContain("(Optional)");
    const off = { ...GLOVE_INFO_DEFAULT_CONFIG, fields: { ...GLOVE_INFO_DEFAULT_CONFIG.fields, gloveType: false } };
    expect(render({ config: off })).not.toContain(">Glove Type<");
  });

  it("shows one glove: its fields in the template's wording, no variants, sizes to pick or Add Variant", () => {
    for (const data of [GLOVE, emptyGloveInfo()]) {
      const html = render({ data });
      expect(html).toContain(">Glove Surface Texture</label>");
      expect(html).toContain("Indicative Weight");
      expect(html).not.toContain("Indicative Weight (Size M)");
      expect(html).not.toMatch(/>Variant \d</);
      expect(html).not.toContain("aria-pressed");
      expect(html).not.toContain("Add Variant");
      expect(html).not.toContain("Remove");
    }
    // It lays out by its own width: it sits beside packing configuration on the order's page.
    expect(render()).toMatch(/data-slot="glove-info" class="@container /);
  });

  it("asks the Glove Colour from a dropdown, not a text box (Kenneth, 26 October 2026)", () => {
    const html = render();
    const trigger = /<button[^>]*role="combobox"[^>]*id="[^"]*-0-colour"[^>]*>|<button[^>]*id="[^"]*-0-colour"[^>]*role="combobox"[^>]*>/.exec(html)?.[0] ?? "";
    expect(trigger).not.toBe("");
    expect(html).not.toMatch(/<input[^>]*id="[^"]*-0-colour"/);
    expect(html).toContain(">Glove Colour</label>");
  });

  it("keeps a glove saved for some sizes as it is, and offers to cover every size", () => {
    const some: GloveInfoData = { ...GLOVE, variants: [{ ...GLOVE.variants[0], sizes: ["S", "M"] }] };
    expect(render({ data: some })).toContain("Saved for size S, M only.");
    expect(render({ data: some })).toContain("Cover Every Size");
    expect(render({ data: some, readOnly: true })).not.toContain("Cover Every Size");
    expect(render()).not.toContain("Cover Every Size");
  });

  it("keeps an inspection saved with several variants: a card each, with its sizes and Remove, never Add", () => {
    const html = render({ data: TWO });
    expect((html.match(/>Variant \d</g) ?? []).length).toBe(2);
    expect(html).toContain("this one was saved with 2 variants");
    expect(html).toContain(">Size S<");
    expect(html).toContain(">Size M, L<");
    expect(html).toContain("Remove Variant 1");
    expect(html).toContain("Remove Variant 2");
    expect(html).not.toContain("aria-pressed");
    expect(html).not.toContain("Add Variant");
  });

  it("offers no removing or covering when read-only", () => {
    const html = render({ data: TWO, readOnly: true });
    expect(html).not.toContain("Remove Variant");
    expect(html).not.toContain("Add Variant");
  });
});
