// Server-rendered markup of generated forms: labels, controls, units,
// messages and their wiring (aria-invalid, aria-describedby), read-only, and
// the Changed / Reset marks. Interaction is the controls' and the page's
// (values.ts, the editor's model tests, e2e/editor).
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
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
    expect(html).toMatch(/for="form-fields-colour"[^>]*>Glove colour</);
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
    expect(html).toContain('aria-label="Move Stickiness code 1 down"');
    expect(html).toContain('aria-label="Remove Stickiness code 2"');
    expect(html).toContain("Add stickiness code");
    // The record's entry, and the sizes still free to add.
    expect(html).toContain('data-record-key="XL"');
    expect(html).toContain("Add to by size");
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
    expect(input).toContain(`aria-describedby="${label}-description ${label}-errors"`);
    expect(html).toContain(`<div id="${label}-errors" class="grid gap-1"><p class="text-sm text-destructive">Enter a value.</p></div>`);
    expect(html).toContain("Lower case letters, digits and _.");
    expect(html).toContain("Choose one of the options.");
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
    expect(html).toContain('aria-label="Use STD_EG&#x27;s: Min layering %"');
  });

  it("reads only: no add, move or remove, inputs read-only, switches disabled", () => {
    const html = render(DispensingLikeSchema, DISPENSING, { readOnly: true });
    expect(html).not.toContain("Add stickiness code");
    expect(html).not.toContain("Remove");
    expect(html).toMatch(/readOnly=""|readonly=""/);
    expect(html).toContain('disabled=""');
  });

  it("keeps a stub's settings as JSON text", () => {
    const html = render(MODULE_REGISTRY.loading.configSchema, { anything: [1, 2] });
    expect(html).toContain('data-record-key="anything"');
    expect(html).toContain("font-mono");
  });
});
