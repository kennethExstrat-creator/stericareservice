import { describe, expect, it } from "vitest";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { SITE_NOTES, SIZE_TABLE } from "./__fixtures__/capture";
import {
  customFormField,
  dateValue,
  fallbackFields,
  gridColumnCount,
  isPerSizeCustom,
  isSwitchedOffField,
  mappedFieldValues,
  ownCustomFields,
  textValue,
  withGridCell,
  withGridColumn,
} from "./fields";

describe("fallbackFields", () => {
  const definition = TEST_REGISTRY.glove_info;

  it("turns a module's canonical paths into fields in the template's wording", () => {
    const fields = fallbackFields(definition, { fields: { indicativeWeight: true, colour: true } }, {
      indicativeWeight: "Indicative weight (size M)",
      colour: "Colour",
    });
    expect(fields).toEqual([
      { key: "indicativeWeight", segments: ["indicativeWeight"], label: "Indicative weight (size M)", type: "number", unit: "g" },
      { key: "colour", segments: ["colour"], label: "Colour", type: "text" },
    ]);
  });

  it("leaves out fields the template switches off, and labels missing wording by key", () => {
    const fields = fallbackFields(definition, { fields: { indicativeWeight: false, colour: true } }, {});
    expect(fields).toEqual([{ key: "colour", segments: ["colour"], label: "colour", type: "text" }]);
  });

  it("reads the fields-on-off convention only", () => {
    expect(isSwitchedOffField({ fields: { colour: false } }, "colour")).toBe(true);
    expect(isSwitchedOffField({ fields: { colour: true } }, "colour")).toBe(false);
    expect(isSwitchedOffField({}, "colour")).toBe(false);
    expect(isSwitchedOffField(null, "colour")).toBe(false);
  });
});

describe("custom fields", () => {
  it("copies what the form needs from a template field", () => {
    expect(customFormField(SITE_NOTES.fields[1])).toEqual({
      key: "sealIntact",
      segments: ["sealIntact"],
      label: "Seal intact",
      type: "yes_no",
      required: true,
    });
    expect(
      customFormField({ key: "n", label: "Count", type: "number", unit: "pcs", min: 0, max: 10, hint: "Per box" }),
    ).toEqual({ key: "n", segments: ["n"], label: "Count", type: "number", unit: "pcs", min: 0, max: 10, hint: "Per box" });
  });

  it("keeps mapped fields out of the custom module's own values", () => {
    expect(ownCustomFields(SITE_NOTES).map((field) => field.key)).toEqual(["weather", "sealIntact"]);
  });

  it("knows the per-size layouts", () => {
    expect(isPerSizeCustom(SIZE_TABLE)).toBe(true);
    expect(isPerSizeCustom(SITE_NOTES)).toBe(false);
    const grid = { ...SITE_NOTES, layout: "grid" as const, grid: { columns: { label: "Box", default: 3, addable: true } } };
    expect(isPerSizeCustom(grid)).toBe(false);
    expect(isPerSizeCustom({ ...grid, grid: { ...grid.grid, repeatPer: "size" as const } })).toBe(true);
  });

  it("counts a grid's columns: the default, or more once more were added", () => {
    const grid = {
      ...SITE_NOTES,
      layout: "grid" as const,
      fields: [SITE_NOTES.fields[0]],
      grid: { columns: { label: "Box", default: 3, addable: true } },
    };
    expect(gridColumnCount(grid, {})).toBe(3);
    expect(gridColumnCount(grid, { weather: ["a", "b", "c", "d", "e"] })).toBe(5);
    expect(gridColumnCount(grid, null)).toBe(3);
  });

  it("sets one grid cell, growing the row with blanks and keeping the rest", () => {
    const record = { weather: ["Dry"], other: "kept" };
    const next = withGridCell(record, "weather", 2, "Wet");
    expect(next).toEqual({ weather: ["Dry", null, "Wet"], other: "kept" });
    expect(record).toEqual({ weather: ["Dry"], other: "kept" });
    expect(withGridCell({}, "sealIntact", 0, true)).toEqual({ sealIntact: [true] });
    expect(withGridCell({ weather: ["a", "b"] }, "weather", 0, null)).toEqual({ weather: [null, "b"] });
  });

  it("adds an empty column to every row of the grid's own fields", () => {
    const grid = {
      ...SITE_NOTES,
      layout: "grid" as const,
      grid: { columns: { label: "Box", default: 2, addable: true } },
    };
    const record = { weather: ["Dry", "Wet"], sizes: "kept" };
    expect(withGridColumn(grid, record)).toEqual({
      weather: ["Dry", "Wet", null],
      sealIntact: [null, null, null],
      sizes: "kept",
    });
    expect(record).toEqual({ weather: ["Dry", "Wet"], sizes: "kept" });
    // The mapped field keeps no row of its own.
    expect(withGridColumn(grid, {})).not.toHaveProperty("colourAgain");
  });
});

describe("mappedFieldValues", () => {
  it("shows each mapped field's value from the module it maps to, comment aside", () => {
    const data = { modules: { glove_info: { colour: "Midnight blue", comment: "Checked." } }, custom: { site_notes: { weather: "Dry" } } };
    expect(mappedFieldValues(SITE_NOTES, data)).toEqual({ colourAgain: "Midnight blue" });
  });

  it("shows null while the module holds no value, and for a path that is not a module's", () => {
    expect(mappedFieldValues(SITE_NOTES, { modules: {}, custom: {} })).toEqual({ colourAgain: null });
    const broken = { ...SITE_NOTES, fields: [{ key: "elsewhere", label: "Elsewhere", type: "text" as const, mapsTo: "modules.nothing.colour" }] };
    expect(mappedFieldValues(broken, { modules: { glove_info: { colour: "Blue" } }, custom: {} })).toEqual({ elsewhere: null });
  });

  it("reads the data it is given, so a field shows each keystroke at once", () => {
    const before = { modules: { glove_info: { colour: "Mid" } }, custom: {} };
    const after = { modules: { glove_info: { colour: "Midn" } }, custom: {} };
    expect(mappedFieldValues(SITE_NOTES, before).colourAgain).toBe("Mid");
    expect(mappedFieldValues(SITE_NOTES, after).colourAgain).toBe("Midn");
  });
});

describe("stored values", () => {
  it("stores blank text as null and everything else as typed", () => {
    expect(textValue("")).toBeNull();
    expect(textValue("   ")).toBeNull();
    expect(textValue(" Blue ")).toBe(" Blue ");
  });

  it("stores a date picker's value or null", () => {
    expect(dateValue("2026-10-06")).toBe("2026-10-06");
    expect(dateValue("")).toBeNull();
    expect(dateValue("6/10/2026")).toBeNull();
  });
});
