// The problem list names each place by the labels the admin sees on the way
// there (BUILD_SPEC 6.2: each problem with a link), never by schema keys:
// a weight setting is "Gloves weighed", not "n"; a custom field's lowest
// value is "Lowest value", not "Min". Real modules, real seed template.
import { describe, expect, it } from "vitest";
import type { CustomModule } from "@/lib/schemas/template";
import { lookupFrom } from "@/lib/templates";
import { STD_EG_SEED } from "@/lib/templates/definitions";
import { MODULE_REGISTRY } from "@/modules/registry";
import { inheritanceOf } from "./inheritance";
import { setConfig, setLabel, type Draft, type EditorContext } from "./model";
import { customFieldName, customPathLabels, placeLabels, type NamingScope } from "./names";
import { collectProblems, type ProblemPlace } from "./problems";

const SIZES = [
  { value: "S", label: "S" },
  { value: "M", label: "Medium (M)" },
];

const getBase = lookupFrom([]);

function scopeOf(draft: Draft): NamingScope {
  const context: EditorContext = { inheritance: inheritanceOf(draft, getBase), registry: MODULE_REGISTRY };
  return { draft, context, sizes: SIZES, shapeOk: true };
}

/** Every problem of a draft, named as the problem list names it. */
function named(draft: Draft): string[] {
  const scope = scopeOf(draft);
  const { problems } = collectProblems(draft, scope.context, { code: draft.code, getBase });
  return problems.map((problem) => placeLabels(problem.place, scope).join(" › "));
}

const stdEg = () => STD_EG_SEED.definition() as Draft;

describe("placeLabels", () => {
  it("names a module's settings by the labels of its form, not by schema keys", () => {
    const draft = stdEg();
    const { context } = scopeOf(draft);
    const broken = setConfig(draft, context, "weight", { n: 0, warnThresholdPct: -1 });
    expect(named(broken)).toEqual([
      "Weight (g) - average of 13 gloves per size › Settings › Gloves weighed",
      "Weight (g) - average of 13 gloves per size › Settings › Warn threshold %",
    ]);
  });

  it("names list items by position and nested settings by their labels", () => {
    const draft = stdEg();
    const scope = scopeOf(draft);
    const title = (key: "watertight" | "labeling") =>
      placeLabels({ area: "module", moduleKey: key, part: "title", path: [] }, scope)[0];
    const at = (place: ProblemPlace) => placeLabels(place, scope);
    expect(at({ area: "module", moduleKey: "watertight", part: "config", path: ["locations", 1, "label"] })).toEqual([
      title("watertight"),
      "Settings",
      "Locations",
      "Location 2",
      "Label",
    ]);
    // labelling's boxes per level: "n" in the schema, named for the admin.
    expect(at({ area: "module", moduleKey: "labeling", part: "config", path: ["levels", "inner", "n"] })).toEqual([
      title("labeling"),
      "Settings",
      "Levels",
      "Inner",
      "Boxes to inspect",
    ]);
    expect(at({ area: "module", moduleKey: "dye_leak", part: "config", path: ["n"] }).at(-1)).toBe("Pouches to test");
    expect(at({ area: "module", moduleKey: "force_at_break", part: "config", path: ["n"] }).at(-1)).toBe("Gloves tested");
  });

  it("names a label by the wording it replaces, and the module's switch and heading by their fields", () => {
    const draft = stdEg();
    const { context } = scopeOf(draft);
    const relabelled = setLabel(draft, context, "header", "poNo", "");
    const scope = scopeOf(relabelled);
    const header = placeLabels({ area: "module", moduleKey: "header", part: "title", path: [] }, scope)[0];
    expect(placeLabels({ area: "module", moduleKey: "header", part: "labels", path: ["poNo"] }, scope)).toEqual([
      header,
      "Labels",
      MODULE_REGISTRY.header.labels.poNo,
    ]);
    expect(placeLabels({ area: "module", moduleKey: "order_lots", part: "include", path: [] }, scope).slice(1)).toEqual([
      "Include this module",
    ]);
    expect(placeLabels({ area: "module", moduleKey: "header", part: "title", path: [] }, scope).slice(1)).toEqual(["Heading"]);
  });

  it("names a custom module's parts as its form does", () => {
    const custom: CustomModule = {
      key: "glove_type",
      title: "Glove type",
      after: "header",
      layout: "grid",
      fields: [
        { key: "gloveType", label: "Glove type", type: "text" },
        { key: "cuffLength", label: "Cuff length", type: "number", min: 5, max: 2 },
      ],
      grid: { columns: { label: "Box #", default: 13, addable: true } },
    };
    const draft: Draft = { ...stdEg(), customModules: [custom] };
    const scope = scopeOf(draft);
    const where = (path: (string | number)[]) =>
      placeLabels({ area: "custom", index: 0, customKey: "glove_type", path }, scope).join(" › ");
    expect(where(["fields", 1, "min"])).toBe("Custom module Glove type › Fields › 2. Cuff length › Lowest value");
    expect(where(["fields", 0, "mapsTo"])).toBe("Custom module Glove type › Fields › 1. Glove type › Shows a module's value");
    expect(where(["grid", "columns", "default"])).toBe("Custom module Glove type › Repeated columns › Columns to start with");
    expect(where(["grid", "repeatPer"])).toBe("Custom module Glove type › Repeated columns › One grid for each ordered size");
    expect(where(["after"])).toBe("Custom module Glove type › Comes after");
    expect(where([])).toBe("Custom module Glove type");
    // A field without a label yet is named by its place, as its form heads it.
    expect(customFieldName({ label: " " }, 2)).toBe("3. Field 3");
    expect(customPathLabels(undefined, ["fields", 4, "label"])).toEqual(["Fields", "5. Field 5", "Label"]);
  });

  it("names the template's own fields as the Details tab does, and the rest by tab", () => {
    const scope = scopeOf(stdEg());
    const where = (path: (string | number)[]) => placeLabels({ area: "template", path }, scope).join(" › ");
    expect(where(["scope", "clientId"])).toBe("Details › Where it applies › Client");
    expect(where(["ai", "reviewOnSubmit"])).toBe("Details › AI second opinion on submit");
    expect(where(["sizes", 1, "label"])).toBe("Details › Sizes › Size 2 › Shown as");
    expect(where(["report", "showClientLogo"])).toBe("Details › AI report › Show the client's logo");
    expect(where(["unit"])).toBe("Details › Counted in");
    expect(where(["extends"])).toBe("Details › Base template");
    expect(where(["json"])).toBe("JSON tab");
    expect(where(["sourceFile"])).toBe("Template › Source file");
  });

  it("names every problem of a broken draft without a bare schema key", () => {
    const draft = stdEg();
    const { context } = scopeOf(draft);
    let broken = setConfig(draft, context, "weight", { n: 0 });
    broken = setConfig(broken, scopeOf(broken).context, "force_at_break", { n: -2 });
    broken = { ...broken, name: " ", customModules: [{ key: "x", title: "X", after: "header", layout: "fields", fields: [{ key: "a", label: "A", type: "number", min: 3, max: 1 }] }] };
    const names = named(broken);
    expect(names.length).toBeGreaterThanOrEqual(3);
    for (const name of names) expect(name.split(" › ")).not.toContain("n");
    expect(names).toEqual(expect.arrayContaining([expect.stringMatching(/› Gloves weighed$/), expect.stringMatching(/› Gloves tested$/), "Details › Name"]));
  });
});
