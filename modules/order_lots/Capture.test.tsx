// Server-rendered markup of the order table: one row per template size in
// the template's wording, quantities on the numeric keypad, lot chips, the
// computed lot sizes and totals, read-only mode and issue links.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { buildInspectionContext, evaluateInspection, type CaptureProps } from "@/modules/_framework";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { packingConfig, packingData } from "@/modules/packing_config/__fixtures__/examples";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { orderData } from "./__fixtures__/examples";
import Capture, { rowFocus } from "./Capture";
import type { OrderLotsComputed } from "./calc";
import { ORDER_LOTS_LABELS, type OrderLotsConfig } from "./config";
import { definition } from "./index";
import { LOT_NUMBER_MAX_LENGTH, TEXT_MAX_LENGTH, type OrderLotsData } from "./schema";

const noop = () => {};

type Props = CaptureProps<OrderLotsData, OrderLotsConfig, OrderLotsComputed>;
type Example = typeof STD_EG_EXAMPLE | typeof SAFEDON_EG_EXAMPLE;

/** Props as the capture screen builds them: the module's evaluation from the engine. */
function props(example: Example, overrides: Partial<Props> & { data?: OrderLotsData } = {}): Props {
  const config: OrderLotsConfig = overrides.config ?? { fields: { packingSite: example === SAFEDON_EG_EXAMPLE } };
  const data = overrides.data ?? orderData(example.order);
  const template = makeTestTemplate(MODULE_REGISTRY, [
    { key: "order_lots", config, labels: { ...ORDER_LOTS_LABELS, ...overrides.labels } },
    { key: "packing_config", config: packingConfig(example.packing) },
  ]);
  const inspection = { modules: { order_lots: data, packing_config: packingData(example.packing) }, custom: {} };
  const context = buildInspectionContext({ template, data: inspection }, MODULE_REGISTRY);
  const evaluation = evaluateInspection({ template, data: inspection, context }, MODULE_REGISTRY).modules.find(
    (entry) => entry.key === "order_lots",
  );
  return {
    data,
    config,
    title: "Order",
    labels: { ...ORDER_LOTS_LABELS, ...overrides.labels },
    context,
    evaluation: (evaluation ?? null) as Props["evaluation"],
    focusPath: null,
    readOnly: false,
    onChange: noop,
    ...overrides,
  };
}

const render = (example: Example, overrides: Partial<Props> = {}) =>
  renderToStaticMarkup(<Capture {...props(example, overrides)} />);

/** Every opening tag that carries `attribute`. */
const tagsWith = (html: string, attribute: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<[^>]*${attribute}[^>]*>`, "g")), (match) => match[0]);
/** Every opening tag of one element. */
const tagsOf = (html: string, element: string): string[] =>
  Array.from(html.matchAll(new RegExp(`<${element}\\b[^>]*>`, "g")), (match) => match[0]);

describe("order_lots capture", () => {
  it("is what the module definition loads", async () => {
    expect((await definition.loadCapture?.())?.default).toBe(Capture);
  });

  it("has one row per size the template offers, ordered or not", () => {
    const html = render(STD_EG_EXAMPLE);
    expect(tagsWith(html, 'scope="row"')).toHaveLength(5);
    for (const size of ["XS", "S", "M", "L", "XL"]) expect(html).toContain(`>${size}</th>`);
  });

  it("heads the columns in the template's wording (6.2 rule 11)", () => {
    const html = render(STD_EG_EXAMPLE, { labels: { ...ORDER_LOTS_LABELS, qtyCases: "Qty (Case)" } });
    expect(html).toContain(">Qty (Case)</th>");
    expect(html).toContain(">Lot Number</th>");
    expect(html).not.toContain(">Packing Site</th>");
    expect(render(SAFEDON_EG_EXAMPLE)).toContain(">Packing Site</th>");
  });

  it("takes quantities on the numeric keypad, one Enter run down the column", () => {
    const html = render(STD_EG_EXAMPLE);
    const cells = tagsWith(html, 'data-enter-group="qty"');
    expect(cells).toHaveLength(5);
    for (const cell of cells) expect(cell).toContain('inputMode="decimal"');
    expect(html).toContain('aria-label="Qty (Cases), Size M"');
    expect(cells.find((cell) => cell.includes("Size M"))).toContain('value="2900"');
  });

  it("lists each size's lots as chips, with a field to add more", () => {
    const html = render(SAFEDON_EG_EXAMPLE);
    expect(html).toContain("LOT-B03");
    expect(html).toContain('aria-label="Remove Lot Number LOT-B03, Size M"');
    expect(html).toContain('aria-label="Lot Number, Size M: add"');
    expect(html).toContain('value="Manufacturer B"');
  });

  it("types lot numbers in capitals on the iPad, without corrections, and keeps them as typed", () => {
    const lotFields = tagsWith(render(SAFEDON_EG_EXAMPLE), 'aria-label="Lot Number, Size [^"]*: add"');
    expect(lotFields).toHaveLength(5);
    for (const field of lotFields) {
      expect(field).toContain('autoCapitalize="characters"');
      expect(field).toContain('autoCorrect="off"');
      expect(field).toContain('spellCheck="false"');
      expect(field).toContain('autoComplete="off"');
    }
    // Only the keyboard: a lot in small letters (pasted, or typed on a keyboard) shows as it is kept.
    const data = orderData(SAFEDON_EG_EXAMPLE.order);
    const lower = { sizes: { ...data.sizes, M: { ...data.sizes.M!, lotNumbers: ["lot-b03"] } } };
    expect(render(SAFEDON_EG_EXAMPLE, { data: lower })).toContain(">lot-b03</span>");
  });

  it("takes no more in a lot or a packing site than the schema keeps, so the order always loads", () => {
    const html = render(SAFEDON_EG_EXAMPLE);
    const lotFields = tagsWith(html, 'aria-label="Lot Number, Size [^"]*: add"');
    expect(lotFields).toHaveLength(5);
    for (const field of lotFields) expect(field).toContain(`maxLength="${LOT_NUMBER_MAX_LENGTH}"`);
    for (const site of tagsWith(html, "data-site-cell")) expect(site).toContain(`maxLength="${TEXT_MAX_LENGTH}"`);
  });

  it("takes a packing site per size where the template shows it, Enter going down the column", () => {
    const sites = tagsWith(render(SAFEDON_EG_EXAMPLE), "data-site-cell");
    expect(sites).toHaveLength(5);
    for (const site of sites) expect(site).toContain('enterKeyHint="next"');
    expect(sites.find((site) => site.includes("Size XS"))).toContain('value="Packer C"');
    expect(tagsWith(render(STD_EG_EXAMPLE), "data-site-cell")).toEqual([]);
  });

  it("shows the computed lot sizes and totals read-only (6.2 rule 2)", () => {
    const html = render(SAFEDON_EG_EXAMPLE);
    expect(html).toContain("1,530");
    expect(html).toContain("3,060,000");
    expect(html).toContain("1,700,000");
    expect(html).toContain(">Total # Carton<");
    expect(html).toContain(">Total # Gloves<");
    expect(tagsOf(html, "input").some((input) => input.includes("1,530") || input.includes("1530"))).toBe(false);
  });

  it("marks each cell for issue links", () => {
    const html = render(STD_EG_EXAMPLE);
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;qtyCases&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;M&quot;,&quot;lotNumbers&quot;,0]"');
  });

  it("links issues on a line saved under another spelling of its size to that line's key", () => {
    // Older data: size M saved as "m". Calc's paths name the saved key; the row shows it as M.
    const data: OrderLotsData = { sizes: { m: { qtyCases: 2900, lotNumbers: ["LOT-A01", "LOT-A01"], packingSite: null } } };
    const issue = props(STD_EG_EXAMPLE, { data }).evaluation?.issues.find((entry) => entry.code === "lot_number_duplicate");
    expect(issue?.path).toEqual(["sizes", "m", "lotNumbers", 1]);
    const html = render(STD_EG_EXAMPLE, { data });
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;m&quot;,&quot;lotNumbers&quot;,1]"');
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;m&quot;,&quot;qtyCases&quot;]"');
    expect(html).not.toContain("Remove “m”");
    expect(tagsWith(html, 'data-enter-group="qty"').find((cell) => cell.includes("Size M"))).toContain('value="2900"');
  });

  it("is read-only: no lot field, no remove buttons, quantities not editable", () => {
    const html = render(SAFEDON_EG_EXAMPLE, { readOnly: true });
    expect(html).not.toContain(": add");
    expect(html).not.toContain("Remove Lot Number");
    for (const cell of tagsWith(html, 'data-enter-group="qty"')) expect(cell).toContain('readOnly=""');
    expect(html).toContain("LOT-B03");
  });

  it("puts a switch at the left of each size; off, the row is greyed, takes no typing and the size is not ordered (Kenneth, 26 October 2026)", () => {
    const html = render(SAFEDON_EG_EXAMPLE);
    const switches = tagsWith(html, 'role="switch"');
    expect(switches.map((tag) => /aria-label="([^"]+)"/.exec(tag)?.[1])).toEqual(
      ["XS", "S", "M", "L", "XL"].map((size) => `Size ${size} ordered`),
    );
    for (const tag of switches) expect(tag).toContain('aria-checked="true"');

    // Size M switched off: still a row, greyed, read-only, and no longer ordered.
    const base = orderData(SAFEDON_EG_EXAMPLE.order);
    const data: OrderLotsData = { ...base, sizesOff: ["M"] };
    const off = props(SAFEDON_EG_EXAMPLE, { data });
    expect(off.context.sizes).toEqual(["XS", "S", "L"]);
    const offHtml = renderToStaticMarkup(<Capture {...off} />);
    expect(tagsWith(offHtml, 'role="switch"').find((tag) => tag.includes("Size M ordered"))).toContain('aria-checked="false"');
    expect(tagsWith(offHtml, 'data-size-off="true"')).toHaveLength(1);
    expect(tagsWith(offHtml, 'data-enter-group="qty"').find((cell) => cell.includes("Size M"))).toContain('readOnly=""');
    expect(offHtml).not.toContain("Lot Number, Size M: add");
    expect(offHtml).toContain("Lot Number, Size S: add");
    // Read-only: every switch is disabled.
    for (const tag of tagsWith(render(SAFEDON_EG_EXAMPLE, { readOnly: true }), 'role="switch"')) expect(tag).toContain("disabled");
  });

  it("lists lines saved under keys the table does not show, so they can be removed", () => {
    const data: OrderLotsData = {
      sizes: { ...orderData(STD_EG_EXAMPLE.order).sizes, m: { qtyCases: 5, lotNumbers: [], packingSite: null } },
    };
    const html = render(STD_EG_EXAMPLE, { data });
    expect(html).toContain("Remove “m”");
    expect(html).toContain('data-issue-path="[&quot;sizes&quot;,&quot;m&quot;]"');
    expect(render(STD_EG_EXAMPLE)).not.toContain("Remove “");
    // 16 px on touch, as the rest of the module.
    const remove = tagsOf(html, "button").find((button) => button.includes('data-slot="button"'));
    expect(remove).toContain("touch:text-base");
  });

  it("tags a photo with the size of the row in focus only once the size is ordered (6.2 rule 4)", () => {
    const { context } = props(STD_EG_EXAMPLE);
    expect(context.sizes).toEqual(["M"]);
    expect(rowFocus("M", context.sizes)).toEqual({ size: "M" });
    expect(rowFocus("XL", context.sizes)).toEqual({});
  });
});
