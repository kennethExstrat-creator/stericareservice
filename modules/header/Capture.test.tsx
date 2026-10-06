// Server-rendered markup of the header's capture body: the template's
// wording, read-only values from the inspection, date pickers, read-only
// mode and issue links. Typing and picking are the kit's and the browser's.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides } from "@/lib/coverage";
import { baseContext, type CaptureProps } from "@/modules/_framework";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { headerData, headerMeta } from "./__fixtures__/examples";
import Capture from "./Capture";
import { calcHeader, type HeaderComputed } from "./calc";
import { HEADER_DEFAULT_CONFIG, HEADER_LABELS, HEADER_TITLE, type HeaderConfig } from "./config";
import { definition } from "./index";
import type { HeaderData } from "./schema";

const noop = () => {};
const TEMPLATE = makeTestTemplate(MODULE_REGISTRY, []);

const SAFEDON_CONFIG: HeaderConfig = {
  fields: { ...HEADER_DEFAULT_CONFIG.fields, client: false, factoryGloveCode: false },
  mfgExpiryPrecision: "month",
};

type Props = CaptureProps<HeaderData, HeaderConfig, HeaderComputed>;

function props(overrides: Partial<Props> = {}): Props {
  const data = overrides.data ?? headerData(STD_EG_EXAMPLE.header);
  const config = overrides.config ?? HEADER_DEFAULT_CONFIG;
  const labels = overrides.labels ?? HEADER_LABELS;
  const context = overrides.context ?? baseContext({ template: TEMPLATE, meta: headerMeta(STD_EG_EXAMPLE.header) });
  const output = calcHeader({ data, config, labels, context, title: HEADER_TITLE, results: {}, hasData: true });
  return {
    data,
    config,
    title: HEADER_TITLE,
    labels,
    context,
    evaluation: {
      key: "header",
      title: HEADER_TITLE,
      labels,
      config,
      data,
      hasData: true,
      comment: null,
      computed: output.computed,
      result: output.result,
      issues: output.issues.map((issue) => ({ ...issue, moduleKey: "header" })),
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

describe("header capture", () => {
  it("is what the module definition loads", async () => {
    expect((await definition.loadCapture?.())?.default).toBe(Capture);
  });

  it("labels every row in the template's wording (6.2 rule 11)", () => {
    const html = render({ labels: { ...HEADER_LABELS, ...labelOverrides("SAFEDON_EG", "header") } });
    expect(html).toContain(">PO Number<");
    expect(html).toContain(">Product Name (Brand &amp; code)<");
    expect(html).not.toContain("PO / SO Number");
  });

  it("shows the manufacturer, the client and the inspector from the inspection, with nothing to type", () => {
    const html = render();
    expect(html).toContain("<dd");
    expect(html).toContain("Manufacturer A (Factory A1)");
    expect(html).toContain("Inspector A");
    expect(html).toContain("Not set");
    expect(tagsOf(html, "input").some((input) => input.includes("Manufacturer A"))).toBe(false);
  });

  it("offers a field for every typed row, with its saved value", () => {
    const html = render();
    for (const value of ["PO-0001 (SO-0001)", "PC-A01"]) expect(html).toContain(`value="${value}"`);
    expect(html).toContain(">Address A</textarea>");
    expect(html).toContain(">Brand A PC-A01 Blue Nitrile</textarea>");
    expect(tagsWith(html, 'enterKeyHint="next"')).toHaveLength(3);
  });

  it("leaves out the rows the template switches off", () => {
    const html = render({ config: SAFEDON_CONFIG });
    expect(html).not.toContain(HEADER_LABELS.client);
    expect(html).not.toContain(HEADER_LABELS.factoryGloveCode);
    expect(html).toContain(HEADER_LABELS.productCode);
  });

  it("takes dates from a date picker, the inspection row's date while the header has none (6.2 rule 3)", () => {
    const html = render({ data: { ...headerData(STD_EG_EXAMPLE.header), inspectionDate: null } });
    const dates = tagsWith(html, 'type="date"');
    expect(dates).toHaveLength(3);
    expect(dates.map((input) => /value="([^"]*)"/.exec(input)?.[1])).toEqual(["2025-04-11", "2025-04-01", "2030-03-01"]);
    // A year of four digits at most: the schema keeps no other date.
    for (const input of dates) expect(input).toContain('max="9999-12-31"');
  });

  it("picks month and year where the template prints only those (SAFEDON_EG)", () => {
    const html = render({
      data: headerData(SAFEDON_EG_EXAMPLE.header),
      config: SAFEDON_CONFIG,
      context: baseContext({ template: TEMPLATE, meta: headerMeta(SAFEDON_EG_EXAMPLE.header) }),
    });
    expect(tagsWith(html, 'type="date"')).toHaveLength(1);
    expect(html).toContain('aria-label="Manufacturing date: month"');
    expect(html).toContain('aria-label="Manufacturing date: year"');
    expect(html).toContain('aria-label="Expiry date: month"');
    expect(html).toContain("<legend");
  });

  it("shows the expiry warning under its date and marks each field for issue links", () => {
    const html = render({ data: { ...headerData(STD_EG_EXAMPLE.header), expiryDate: "2025-03-01" } });
    expect(html).toContain("Expiry date 2025-03-01 is not after Manufacturing date 2025-04-01.");
    expect(html).toContain('data-issue-path="[&quot;expiryDate&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;poNo&quot;]"');
  });

  it("is read-only when the inspection is not the user's to edit", () => {
    const html = render({ readOnly: true });
    const fields = [...tagsOf(html, "input"), ...tagsOf(html, "textarea")];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(field).toContain('readOnly=""');
    const month = render({ readOnly: true, config: SAFEDON_CONFIG, data: headerData(SAFEDON_EG_EXAMPLE.header) });
    for (const trigger of tagsWith(month, 'aria-label="[^"]*: (month|year)"')) expect(trigger).toContain("disabled");
  });
});
