// Server-rendered markup of the packing configuration: the three counts on
// the numeric keypad in the template's wording, the computed check with its
// warning, the onsite packing mode, read-only mode and issue links.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides } from "@/lib/coverage";
import type { CaptureProps } from "@/modules/_framework";
import { makeTestContext } from "@/modules/_framework/testing";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { packingData } from "./__fixtures__/examples";
import Capture from "./Capture";
import { calcPackingConfig, type PackingConfigComputed } from "./calc";
import {
  PACKING_CONFIG_DEFAULT_CONFIG,
  PACKING_CONFIG_LABELS,
  PACKING_CONFIG_TITLE,
  type PackingConfigConfig,
} from "./config";
import { definition } from "./index";
import { TEXT_MAX_LENGTH, type PackingConfigData } from "./schema";

const noop = () => {};
const SAFEDON_LABELS = { ...PACKING_CONFIG_LABELS, ...labelOverrides("SAFEDON_EG", "packing_config") };

type Props = CaptureProps<PackingConfigData, PackingConfigConfig, PackingConfigComputed>;

function props(overrides: Partial<Props> = {}): Props {
  const data = overrides.data ?? packingData(STD_EG_EXAMPLE.packing);
  const config = overrides.config ?? PACKING_CONFIG_DEFAULT_CONFIG;
  const labels = overrides.labels ?? PACKING_CONFIG_LABELS;
  const context = makeTestContext();
  const output = calcPackingConfig({ data, config, labels, context, title: PACKING_CONFIG_TITLE, results: {}, hasData: true });
  return {
    data,
    config,
    title: PACKING_CONFIG_TITLE,
    labels,
    context,
    evaluation: {
      key: "packing_config",
      title: PACKING_CONFIG_TITLE,
      labels,
      config,
      data,
      hasData: true,
      comment: null,
      computed: output.computed,
      result: output.result,
      issues: output.issues.map((issue) => ({ ...issue, moduleKey: "packing_config" })),
      stub: false,
    },
    focusPath: null,
    readOnly: false,
    onChange: noop,
    ...overrides,
  };
}

const render = (overrides: Partial<Props> = {}) => renderToStaticMarkup(<Capture {...props(overrides)} />);

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);
/** Every opening tag of one element. */
const tagsOf = (html: string, element: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<${element}\\b[^>]*>`, "g")), (match) => match[0]);

describe("packing_config capture", () => {
  it("is what the module definition loads", async () => {
    expect((await definition.loadCapture?.())?.default).toBe(Capture);
  });

  it("takes the three counts on the numeric keypad in the template's wording (6.2 rule 11)", () => {
    const html = render({ data: packingData(SAFEDON_EG_EXAMPLE.packing), labels: SAFEDON_LABELS });
    expect(html).toContain("># Glove per Plastic Pack<");
    expect(html).toContain("># Packs per Case<");
    const inputs = tagsWith(html, 'inputMode="decimal"');
    expect(inputs.map((input) => /value="([^"]*)"/.exec(input)?.[1])).toEqual(["125", "16", "2000"]);
  });

  it("shows the computed check read-only (6.2 rule 2)", () => {
    const html = render();
    expect(html).toContain(">Gloves per Case (Inner × per Case)<");
    expect(html).toContain("2,000");
    expect(tagsOf(html, "input")).toHaveLength(3);
  });

  it("warns on the gloves per case when it does not match the computed check", () => {
    const html = render({ data: { ...packingData(STD_EG_EXAMPLE.packing), glovesPerCase: 2500 } });
    const message = "# Gloves per Case 2,500 is not # Glove per Inner Box × # Inners per Case: 200 × 10 = 2,000.";
    expect(html.split(message)).toHaveLength(2);
    // NumberField's amber warning, which describes the field it points at.
    const warning = /<div id="([^"]+-calc-warning)"[^>]*text-warn[^>]*>[\s\S]*?<\/div>/.exec(html);
    expect(warning?.[0]).toContain(message);
    const field = tagsOf(html, "input").find((input) => input.includes(`aria-describedby="${warning?.[1]}"`));
    expect(field).toMatch(/id="[^"]*-glovesPerCase"/);
    expect(tagsOf(html, "input").filter((input) => input.includes("calc-warning"))).toHaveLength(1);
  });

  it("shows the packing mode only where the template does", () => {
    expect(render()).not.toContain(">Packing Mode<");
    const shown = render({ config: { ...PACKING_CONFIG_DEFAULT_CONFIG, fields: { packingMode: true } } });
    expect(shown).toContain(">Packing Mode<");
    expect(tagsOf(shown, "input")).toHaveLength(4);
    // No more text than the schema keeps, so the data always loads.
    expect(tagsOf(shown, "input").filter((input) => input.includes(`maxLength="${TEXT_MAX_LENGTH}"`))).toHaveLength(1);
  });

  it("marks each count for issue links and is read-only when asked", () => {
    expect(render()).toContain('data-issue-path="[&quot;glovesPerCase&quot;]"');
    for (const input of tagsOf(render({ readOnly: true }), "input")) expect(input).toContain('readOnly=""');
  });
});
