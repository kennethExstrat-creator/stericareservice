// Naming a field the way its form does, also from outside the form: a list
// of problems points into a form by path, and each step reads as the form
// shows it (pathLabels), not as the schema spells it.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { describeSchema } from "./describe";
import { fieldLabel, itemLabel, pathLabels, singularLabel, type NamingHooks } from "./labels";
import { SchemaForm } from "./schema-form";
import { DimensionsLikeSchema, DispensingLikeSchema, MARKERS, WatertightLikeSchema } from "./__fixtures__/schemas";

const SIZES = [
  { value: "M", label: "Medium (M)" },
  { value: "XL", label: "XL" },
];

const HOOKS: NamingHooks = {
  labelForKey: (key) => ({ length: "Length", n: "Gloves weighed" })[key],
  markerOptions: (marker) => (marker === "size" ? SIZES : undefined),
  variantLabel: (marker, value) => (marker === "spec" ? { min: "Minimum (≥)" }[value] : undefined),
};

describe("fieldLabel", () => {
  it("takes the schema's title, then the caller's words, then the key in words", () => {
    const node = describeSchema(DimensionsLikeSchema, { markers: MARKERS });
    if (node.kind !== "object") throw new Error("not an object");
    const rows = node.properties.find((entry) => entry.key === "rows")!;
    const statistic = node.properties.find((entry) => entry.key === "statistic")!;
    expect(fieldLabel(rows.node, "rows", ["rows"], HOOKS)).toBe("Gloves per size");
    expect(fieldLabel(statistic.node, "n", ["n"], HOOKS)).toBe("Gloves weighed");
    expect(fieldLabel(statistic.node, "statistic", ["statistic"], HOOKS)).toBe("Statistic");
    expect(fieldLabel(statistic.node, 2, [2])).toBe("3");
  });

  it("names a list's items by its label, one by one", () => {
    expect(singularLabel("Hole locations")).toBe("Hole location");
    expect(singularLabel("Boxes per size")).toBe("Boxes per size");
    expect(singularLabel("Classes")).toBe("Class");
    expect(singularLabel("Boxes")).toBe("Box");
    expect(singularLabel("Sizes")).toBe("Size");
    expect(singularLabel("Inner units")).toBe("Inner unit");
    expect(singularLabel("Stickiness codes")).toBe("Stickiness code");
    expect(itemLabel("Defects", 0)).toBe("Defect 1");
    expect(itemLabel("Specs", 1)).toBe("Spec 2");
  });
});

describe("pathLabels", () => {
  it("names each step of a path as the form shows it", () => {
    const watertight = describeSchema(WatertightLikeSchema, { markers: MARKERS });
    expect(pathLabels(watertight, ["locations", 1, "label"])).toEqual(["Locations", "Location 2", "Label"]);
    // A nullable value is the value: the AQL is named once.
    expect(pathLabels(watertight, ["aql"])).toEqual(["AQL"]);

    const dimensions = describeSchema(DimensionsLikeSchema, { markers: MARKERS });
    // A record keyed by a measure takes the caller's word for it; a spec's tag is its Type.
    expect(pathLabels(dimensions, ["specs", 0, "specs", "length", "min"], HOOKS)).toEqual([
      "Specs",
      "Spec 1",
      "Specs",
      "Length",
      "Min",
    ]);
    expect(pathLabels(dimensions, ["specs", 0, "specs", "length", "kind"], HOOKS)).toEqual([
      "Specs",
      "Spec 1",
      "Specs",
      "Length",
      "Type",
    ]);
    expect(pathLabels(dimensions, ["rows"], HOOKS)).toEqual(["Gloves per size"]);

    // A record keyed by size: the size as the template names it.
    const dispensing = describeSchema(DispensingLikeSchema, { markers: MARKERS });
    expect(pathLabels(dispensing, ["boxesPerSize", "bySize", "M"], HOOKS)).toEqual([
      "Boxes per Size",
      "By Size",
      "Medium (M)",
    ]);
    expect(pathLabels(dispensing, ["stickinessCodes", 2, "pass"])).toEqual([
      "Stickiness Codes",
      "Stickiness Code 3",
      "Pass",
    ]);
  });

  it("names steps past what the schema describes by their keys, in words", () => {
    const watertight = describeSchema(WatertightLikeSchema, { markers: MARKERS });
    expect(pathLabels(watertight, ["locations", 0, "extraKey"])).toEqual(["Locations", "Location 1", "Extra Key"]);
    expect(pathLabels(describeSchema(z.strictObject({ data: z.unknown() })), ["data", "rows", 3])).toEqual([
      "Data",
      "Rows",
      "4",
    ]);
    expect(pathLabels(watertight, [])).toEqual([]);
  });

  it("agrees with the form: each named step is a label the form draws", () => {
    const node = describeSchema(DispensingLikeSchema, { markers: MARKERS });
    const html = renderToStaticMarkup(
      <SchemaForm
        node={node}
        value={{ minLayeringPct: 70, stickinessCodes: [{ code: "A", label: "Non sticky", pass: true }], boxesPerSize: { default: 3, bySize: { M: 2 } } }}
        onChange={() => {}}
        idPrefix="form"
        hooks={HOOKS}
      />,
    );
    for (const path of [["minLayeringPct"], ["stickinessCodes", 0, "label"], ["boxesPerSize", "bySize", "M"]]) {
      for (const name of pathLabels(node, path, HOOKS)) expect(html).toContain(name);
    }
  });
});
