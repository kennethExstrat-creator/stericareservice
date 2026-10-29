// Server-rendered markup of the header's capture body: the template's
// wording, values from the inspection (pickers for the manufacturer and the
// client where the screen gives them), date pickers, read-only mode and issue
// links. Typing and picking are the kit's and the browser's.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { labelOverrides } from "@/lib/coverage";
import { baseContext, type CaptureProps } from "@/modules/_framework";
import { InspectionPartiesProvider, type InspectionParties } from "@/modules/_framework/inspection-parties";
import { makeTestTemplate } from "@/modules/_framework/testing";
import { MODULE_REGISTRY } from "@/modules/registry";
import { SAFEDON_EG_EXAMPLE, STD_EG_EXAMPLE } from "@/tests/fixtures/examples";
import { headerData, headerMeta, TEST_CLIENT_ID, TEST_MANUFACTURER_ID } from "./__fixtures__/examples";
import Capture from "./Capture";
import { calcHeader, type HeaderComputed } from "./calc";
import { HEADER_DEFAULT_CONFIG, HEADER_LABELS, HEADER_TITLE, type HeaderConfig } from "./config";
import { definition } from "./index";
import { TEXT_MAX_LENGTH, type HeaderData } from "./schema";

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
    expect(html).toContain(">Product Name (Brand &amp; Code)<");
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
    // Enter moves on from each single-line field and each date: three text rows, three dates.
    expect(tagsWith(html, 'enterKeyHint="next"')).toHaveLength(6);
  });

  it("takes no more text in a field than the schema keeps, so the header always loads", () => {
    const html = render();
    const fields = [...tagsOf(html, "input"), ...tagsOf(html, "textarea")].filter((field) => !field.includes('type="date"'));
    expect(fields).toHaveLength(5);
    for (const field of fields) expect(field).toContain(`maxLength="${TEXT_MAX_LENGTH}"`);
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
    expect(html).toContain('aria-label="Manufacturing Date: month"');
    expect(html).toContain('aria-label="Manufacturing Date: year"');
    expect(html).toContain('aria-label="Expiry Date: month"');
    expect(html).toContain("<legend");
  });

  it("shows the expiry warning under its date and marks each field for issue links", () => {
    const html = render({ data: { ...headerData(STD_EG_EXAMPLE.header), expiryDate: "2025-03-01" } });
    // The dates in the words the app shows them in elsewhere; the fields keep ISO.
    expect(html).toContain("Expiry Date 1 Mar 2025 is not after Manufacturing Date 1 Apr 2025.");
    expect(html).toContain('data-issue-path="[&quot;expiryDate&quot;]"');
    expect(html).toContain('data-issue-path="[&quot;poNo&quot;]"');
  });

  it("is read-only when the inspection is not the user's to edit", () => {
    const html = render({ readOnly: true });
    const fields = [...tagsOf(html, "input"), ...tagsOf(html, "textarea")];
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) expect(field).toContain('readOnly=""');
  });

  it("shows a read-only month and year as text, at full contrast like the other read-only fields", () => {
    const html = render({
      readOnly: true,
      data: headerData(SAFEDON_EG_EXAMPLE.header),
      config: SAFEDON_CONFIG,
      context: baseContext({ template: TEMPLATE, meta: headerMeta(SAFEDON_EG_EXAMPLE.header) }),
    });
    // No disabled select, which would fade the date to half opacity.
    expect(html).not.toContain(": month");
    expect(tagsWith(html, ' disabled=""')).toEqual([]);
    const dates = ["Feb 2025", "Jan 2030"].map((text) => tagsOf(html, "input").find((input) => input.includes(`value="${text}"`)));
    for (const input of dates) expect(input).toContain('readOnly=""');
    expect(html).toContain(">Manufacturing Date</label>");
    expect(html).toContain(">Expiry Date</label>");
  });

  describe("the manufacturer and the client (Kenneth, 30 October 2026: \"manufacturer and client should be editable\")", () => {
    const SLOT: InspectionParties = {
      clients: [
        { id: TEST_CLIENT_ID, label: "Client A" },
        { id: "00000000-0000-4000-8000-000000000302", label: "Client B" },
      ],
      manufacturers: [
        { id: TEST_MANUFACTURER_ID, label: "Manufacturer A · Factory A1" },
        { id: "00000000-0000-4000-8000-000000000202", label: "Manufacturer B" },
      ],
      change: async () => ({ ok: true, address: null, warning: null }),
    };
    const withPickers = (overrides: Partial<Props> = {}, slot: InspectionParties | null = SLOT) =>
      renderToStaticMarkup(
        <InspectionPartiesProvider value={slot}>
          <Capture {...props(overrides)} />
        </InspectionPartiesProvider>,
      );
    const pickers = (html: string) => tagsWith(html, "data-party-picker=");

    it("offers both as pickers, each labelled by its row and 44 px on touch, while the inspection can be changed", () => {
      const html = withPickers();
      const [manufacturer, client] = pickers(html);
      expect(manufacturer).toContain('data-party-picker="manufacturer"');
      expect(client).toContain('data-party-picker="client"');
      for (const [picker, field] of [
        [manufacturer, "manufacturer"],
        [client, "client"],
      ] as const) {
        expect(picker).toContain('role="combobox"');
        expect(picker).toContain("touch:data-[size=default]:h-11");
        const labelledBy = /aria-labelledby="([^"]+)"/.exec(picker)?.[1];
        expect(html).toContain(`<dt id="${labelledBy}"`);
        expect(html).toContain(`id="${labelledBy}" class="text-sm text-muted-foreground touch:text-base">${HEADER_LABELS[field]}</dt>`);
      }
      // Their names are the pickers' now; the inspector stays text, as the app records it.
      expect(html).not.toContain("Manufacturer A (Factory A1)");
      expect(html).toContain("Inspector A");
      expect(pickers(html)).toHaveLength(2);
    });

    it("says only that the inspector is recorded automatically", () => {
      for (const html of [withPickers(), render(), render({ readOnly: true })]) {
        expect(html).toContain(">The inspector is recorded automatically.</p>");
        expect(html).not.toContain("Chosen when the inspection was created");
      }
      // No inspector row, no note.
      const config: HeaderConfig = { ...HEADER_DEFAULT_CONFIG, fields: { ...HEADER_DEFAULT_CONFIG.fields, inspector: false } };
      expect(withPickers({ config })).not.toContain("recorded automatically");
      expect(pickers(withPickers({ config }))).toHaveLength(2);
    });

    it("shows them as text, exactly as before, when the inspection is read-only or the screen gives no pickers", () => {
      for (const html of [withPickers({ readOnly: true }), withPickers({}, null), render()]) {
        expect(pickers(html)).toEqual([]);
        expect(tagsOf(html, "button")).toEqual([]);
        expect(html).toContain('<dd class="font-medium break-words text-foreground">Manufacturer A (Factory A1)</dd>');
        expect(html).toContain("Not set");
        expect(html).toContain('<dd class="font-medium break-words text-foreground">Inspector A</dd>');
      }
    });

    it("offers a picker only for a row the template shows", () => {
      const html = withPickers({
        data: headerData(SAFEDON_EG_EXAMPLE.header),
        config: SAFEDON_CONFIG,
        context: baseContext({ template: TEMPLATE, meta: headerMeta(SAFEDON_EG_EXAMPLE.header) }),
      });
      expect(pickers(html).map((picker) => /data-party-picker="(\w+)"/.exec(picker)?.[1])).toEqual(["manufacturer"]);
      expect(html).not.toContain(HEADER_LABELS.client);
    });
  });
});
