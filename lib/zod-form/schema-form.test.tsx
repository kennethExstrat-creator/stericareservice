// Server-rendered markup of generated forms: labels, controls, units,
// messages and their wiring (aria-invalid, aria-describedby), read-only, and
// the Changed / Reset marks. Interaction is the controls' and the page's
// (values.ts, the editor's model tests, e2e/editor).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { stubModule } from "@/modules/_framework";
import { MODULE_REGISTRY } from "@/modules/registry";
import { describeSchema } from "./describe";
import { issuesByPath, parseWithMessages, pathKey } from "./issues";
import { SchemaForm, fieldId, type SchemaFormHooks } from "./schema-form";
import { DimensionsLikeSchema, DispensingLikeSchema, MARKERS, WatertightLikeSchema } from "./__fixtures__/schemas";

const noop = () => {};

/** The opening tag of the element with this id. */
function tagWithId(html: string, id: string): string {
  return html.match(new RegExp(`<[a-z]+[^>]*\\sid="${id}"[^>]*>`))?.[0] ?? "";
}

function render(
  schema: Parameters<typeof describeSchema>[0],
  value: unknown,
  options: { hooks?: SchemaFormHooks; readOnly?: boolean; validate?: boolean } = {},
) {
  const node = describeSchema(schema, { markers: MARKERS });
  const result = options.validate ? parseWithMessages(schema, value) : null;
  const issues = issuesByPath(result && !result.success ? result.error : null);
  return renderToStaticMarkup(
    <SchemaForm
      node={node}
      value={value}
      onChange={noop}
      idPrefix="form"
      issues={issues}
      readOnly={options.readOnly}
      hooks={options.hooks}
    />,
  );
}

const DISPENSING = {
  minLayeringPct: 70,
  stickinessCodes: [
    { code: "A", label: "Non sticky", pass: true },
    { code: "D", label: "Too sticky", pass: false },
  ],
  boxesPerSize: { default: 13, bySize: { XL: 5 } },
};

describe("SchemaForm", () => {
  it("draws glove_info's settings: one switch per field, labelled by the module's own words", () => {
    const html = render(
      MODULE_REGISTRY.glove_info.configSchema,
      { fields: { surfaceTexture: true, indicativeWeight: true, colour: false, length: true }, indicativeWeightSize: "M" },
      {
        hooks: {
          labelForKey: (key) => MODULE_REGISTRY.glove_info.labels[key],
          markerOptions: (marker) => (marker === "size" ? [{ value: "S", label: "S" }, { value: "M", label: "M" }] : undefined),
        },
      },
    );
    expect(html.match(/role="switch"/g)).toHaveLength(4);
    expect(html).toMatch(/for="form-fields-colour"[^>]*>Glove Colour</);
    expect(tagWithId(html, "form-fields-colour")).toContain('aria-checked="false"');
    // A size from the template, picked from a list.
    expect(html).toContain('id="form-indicativeWeightSize"');
    expect(html).toContain('role="combobox"');
    expect(html).toContain("Fields shown on this template");
  });

  it("shows numbers with their unit, lists with their actions, and records by key", () => {
    const html = render(DispensingLikeSchema, DISPENSING, {
      hooks: { markerOptions: (marker) => (marker === "size" ? [{ value: "XL", label: "XL" }, { value: "L", label: "L" }] : undefined) },
    });
    expect(html).toContain('inputMode="decimal"');
    expect(html).toContain(">%</div>");
    // Its limits in words, read with the field.
    expect(html).toContain('<p id="form-minLayeringPct-range" class="text-sm text-muted-foreground">0 to 100.</p>');
    expect(tagWithId(html, "form-minLayeringPct")).toContain(
      'aria-describedby="form-minLayeringPct-range form-minLayeringPct-description"',
    );
    expect(html).toContain("Whole number, 1 to 500.");
    expect(html).toContain('aria-label="Move Stickiness Code 1 Down"');
    expect(html).toContain('aria-label="Remove Stickiness Code 2"');
    expect(html).toContain("Add Stickiness Code");
    // The record's entry, and the sizes still free to add.
    expect(html).toContain('data-record-key="XL"');
    expect(html).toContain('Add a Size<span class="sr-only"> to By Size</span>');
  });

  it("puts each message on its field and wires it for screen readers", () => {
    const html = render(
      WatertightLikeSchema,
      { aql: 3, locations: [{ code: "Hole", label: "" }], handSplit: false },
      { validate: true },
    );
    const label = fieldId("form", ["locations", 0, "label"]);
    const input = tagWithId(html, label);
    expect(input).toContain('aria-invalid="true"');
    // A compact row: the column header carries the description, the field its message.
    expect(input).toContain(`aria-describedby="${label}-errors"`);
    expect(html).toContain(`<div id="${label}-errors" class="grid gap-1"><p class="text-sm text-destructive">Enter a value.</p></div>`);
    expect(html).toContain("Lower case letters, digits and _.");
    expect(html).toContain("Choose one of the options.");
  });

  it("shows text typed where a number belongs as it is, with one message on what is wrong", () => {
    const html = render(
      DispensingLikeSchema,
      { ...DISPENSING, minLayeringPct: "2 40", boxesPerSize: { default: null } },
      { validate: true },
    );
    const typed = tagWithId(html, "form-minLayeringPct");
    expect(typed).toContain('value="2 40"');
    expect(typed).toContain('aria-invalid="true"');
    expect(typed).toContain("form-minLayeringPct-errors");
    expect(html.match(/is not a number/g)).toHaveLength(1);
    expect(html).toContain("“2 40” is not a number: remove the space (240).");
    // A required number emptied: empty on screen, and asked for.
    expect(tagWithId(html, "form-boxesPerSize-default")).toContain('value=""');
    expect(html).toContain(
      '<div id="form-boxesPerSize-default-errors" class="grid gap-1"><p class="text-sm text-destructive">Enter a number.</p></div>',
    );
  });

  it("draws a list of small objects as compact rows under one header", () => {
    const html = render(DispensingLikeSchema, DISPENSING);
    // One header names each column once, with its description.
    expect(html.match(/data-slot="row-header"/g)).toHaveLength(1);
    // Each row is a group named by its item; its labels give way to the header from 640 px.
    expect(html).toContain('<legend class="sr-only">Stickiness Code 2</legend>');
    expect(html).toMatch(/<label[^>]*class="[^"]*sm:sr-only[^"]*"[^>]*for="form-stickinessCodes-1-code"/);
    expect(tagWithId(html, "form-stickinessCodes-1-pass")).toContain('role="switch"');
    expect(html).toContain('aria-label="Remove Stickiness Code 2"');
  });

  it("offers a tagged union's variants by name, and keeps the values of the one chosen", () => {
    const html = render(
      DimensionsLikeSchema,
      {
        measures: ["length", "width"],
        statistic: "median",
        specs: [{ size: "M", specs: { length: { kind: "min", min: 240 } } }],
        decimals: { length: 0, width: 0, fingerThickness: 2, palmThickness: 2, cuffThickness: 2 },
        rows: null,
      },
      { hooks: { variantLabel: (marker, value) => (marker === "spec" && value === "min" ? "Minimum (≥)" : undefined) } },
    );
    expect(tagWithId(html, "form-specs-0-specs-length-type")).toContain('role="combobox"');
    // No border to seat its legend in, and a rendered legend is not a grid item: the legend's own margin keeps it
    // off the Type row.
    expect(html).toMatch(/<fieldset class="[^"]*\[&amp;&gt;legend\]:mb-3[^"]*" data-slot="form-group" data-kind="union">/);
    expect(html).toContain('value="240"');
    // Optional measures without a spec can be added.
    expect(html).toContain('aria-label="Add Width"');
    // An array of options is a set of checkboxes.
    expect(html.match(/role="checkbox"/g)).toHaveLength(5);
    // A nullable number: empty is none.
    expect(html).toContain('placeholder="None"');
  });

  it("marks what the template sets, with a reset, and nothing else", () => {
    const html = render(DispensingLikeSchema, DISPENSING, {
      hooks: {
        isOverridden: (path) => pathKey(path) === pathKey(["minLayeringPct"]),
        onReset: noop,
        resetLabel: "Use STD_EG's",
      },
    });
    expect(html.match(/>Changed</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Use STD_EG&#x27;s: Min Layering %"');
  });

  it("reads only: no add, move or remove, inputs read-only, switches disabled", () => {
    const html = render(DispensingLikeSchema, DISPENSING, { readOnly: true });
    expect(html).not.toContain("Add Stickiness Code");
    expect(html).not.toContain("Remove");
    expect(html).toMatch(/readOnly=""|readonly=""/);
    expect(html).toContain('disabled=""');
  });

  it("keeps a stub's settings as JSON text", () => {
    // A placeholder of its own: every registry module is built now.
    const stub = stubModule({ key: "loading", title: "Loading" });
    const html = render(stub.configSchema, { anything: [1, 2] });
    expect(html).toContain('data-record-key="anything"');
    expect(html).toContain("font-mono");
  });
});
