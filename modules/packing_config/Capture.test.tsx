// Server-rendered markup of the packing configuration: the three counts on
// the numeric keypad in the template's wording, the gloves per case worked
// out read-only with what it comes from, or typed while a count is missing,
// the warning on a stored one that is not the product, the onsite packing
// mode, read-only mode and issue links.
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
/** One count's input. */
const inputOf = (html: string, field: string): string | undefined =>
  tagsOf(html, "input").find((input) => new RegExp(`id="[^"]*-${field}"`).test(input));
/** The text a field's description points at (aria-describedby), id by id. */
const describedText = (html: string, input: string | undefined): string[] =>
  (/aria-describedby="([^"]*)"/.exec(input ?? "")?.[1].split(" ") ?? []).map(
    (described) => new RegExp(`<p id="${described}"[^>]*>([^<]*)</p>`).exec(html)?.[1] ?? "",
  );
const counts = (glovesPerInner: number | null, innersPerCase: number | null, glovesPerCase: number | null): PackingConfigData => ({
  glovesPerInner,
  innersPerCase,
  glovesPerCase,
  packingMode: null,
});

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

  it("shows the gloves per case worked out, read-only in its place with what it comes from (Kenneth, 27 October 2026)", () => {
    const html = render();
    const field = inputOf(html, "glovesPerCase");
    expect(field).toContain('readOnly=""');
    expect(field).toContain('value="2000"');
    expect(describedText(html, field)).toEqual(["200 × 10"]);
    for (const count of ["glovesPerInner", "innersPerCase"]) expect(inputOf(html, count)).not.toContain("readOnly");
    // The field is the worked-out value: no line of its own under the counts any more.
    expect(html).not.toContain("Gloves per Case (Inner × per Case)");
    expect(html).not.toContain('data-slot="figure"');
    expect(tagsOf(html, "input")).toHaveLength(3);
  });

  it("works it out in the template's wording for data saved before with none stored", () => {
    const html = render({ data: { ...packingData(SAFEDON_EG_EXAMPLE.packing), glovesPerCase: null }, labels: SAFEDON_LABELS });
    const field = inputOf(html, "glovesPerCase");
    expect(field).toContain('readOnly=""');
    expect(field).toContain('value="2000"');
    expect(describedText(html, field)).toEqual(["125 × 16"]);
  });

  it("keeps the gloves per case an input with its stored value while either count is missing", () => {
    for (const data of [counts(200, null, 2000), counts(null, 10, 2000)]) {
      const field = inputOf(render({ data }), "glovesPerCase");
      expect(field).not.toContain("readOnly");
      expect(field).toContain('value="2000"');
      expect(field).not.toContain("aria-describedby");
    }
    const empty = inputOf(render({ data: counts(null, null, null) }), "glovesPerCase");
    expect(empty).not.toContain("readOnly");
    expect(empty).toContain('value=""');
    // A count of 0 is no count: nothing is worked out from it.
    expect(inputOf(render({ data: counts(200, 0, 2000) }), "glovesPerCase")).not.toContain("readOnly");
  });

  it("warns on a stored gloves per case that is not the product, as data saved before may hold, shown as stored", () => {
    const html = render({ data: { ...packingData(STD_EG_EXAMPLE.packing), glovesPerCase: 2500 } });
    const message = "# Gloves per Case 2,500 is not # Glove per Inner Box × # Inners per Case: 200 × 10 = 2,000.";
    expect(html.split(message)).toHaveLength(2);
    // NumberField's amber warning, which describes the field it points at.
    const warning = /<div id="([^"]+-calc-warning)"[^>]*text-warn[^>]*>[\s\S]*?<\/div>/.exec(html);
    expect(warning?.[0]).toContain(message);
    const field = tagsOf(html, "input").find((input) => input.includes(`aria-describedby="${warning?.[1]}"`));
    expect(field).toMatch(/id="[^"]*-glovesPerCase"/);
    expect(tagsOf(html, "input").filter((input) => input.includes("calc-warning"))).toHaveLength(1);
    // Read-only as stored until either count is edited; no "200 × 10" under a value that is not it.
    expect(field).toContain('readOnly=""');
    expect(field).toContain('value="2500"');
    expect(html).not.toContain("-glovesPerCase-hint");
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
