import { describe, expect, it } from "vitest";
import type { ModuleKey } from "@/lib/schemas/module-result";
import { lookupFrom, mergeConfig, resolveTemplateOrThrow, type JsonObject } from "@/lib/templates";
import { asVersions, baseEg, clientEg, clientFactoryEg } from "@/lib/templates/__fixtures__/definitions";
import { TEST_REGISTRY } from "@/modules/_framework/__fixtures__/test-registry";
import { finalOrder, inheritanceOf, NO_INHERITANCE } from "./inheritance";
import {
  addCustomModule,
  addModule,
  canRemoveConfigAt,
  customModuleViews,
  diffConfig,
  isConfigOverridden,
  listingFor,
  moduleOrder,
  moduleView,
  moveModule,
  overrideCustomModule,
  removeCustomModule,
  resetConfigAt,
  resetModule,
  setConfig,
  setInclude,
  setLabel,
  setTitle,
  unusedModules,
  type Draft,
  type EditorContext,
} from "./model";

const getBase = lookupFrom(asVersions([baseEg(), clientEg()]));
const registry = TEST_REGISTRY;

function contextOf(draft: Draft): EditorContext {
  return { inheritance: inheritanceOf(draft, getBase), registry };
}

/** What the real resolver makes of a draft: the arbiter for every edit below. */
function resolvedOrder(draft: Draft): ModuleKey[] {
  return resolveTemplateOrThrow(draft, { getBase, registry }).modules.map((entry) => entry.key);
}

function resolvedModule(draft: Draft, key: ModuleKey) {
  const found = resolveTemplateOrThrow(draft, { getBase, registry }).modules.find((entry) => entry.key === key);
  if (!found) throw new Error(`${key} is not in the template`);
  return found;
}

describe("inheritance", () => {
  it("reads what a child inherits from its bases, root first", () => {
    const inheritance = inheritanceOf(clientFactoryEg(), getBase);
    expect(inheritance.bases).toEqual([
      { code: "CLIENT_EG", version: 1 },
      { code: "BASE_EG", version: 1 },
    ]);
    expect(inheritance.modules.get("force_at_break")?.include).toBe(false);
    expect(inheritance.modules.get("header")?.labels).toEqual({ client: "Client Name", poNo: "PO Number" });
    expect(inheritance.modules.get("weight")).toMatchObject({ title: "Weight (g)", config: { n: 1 } });
    expect(inheritance.customModules.map((custom) => custom.key)).toEqual(["dispensing_spec"]);
    expect(inheritance.problems).toEqual([]);
  });

  it("matches the resolver: the child's own view equals the resolved module", () => {
    for (const draft of [baseEg(), clientEg(), clientFactoryEg()] as Draft[]) {
      const context = contextOf(draft);
      expect(moduleOrder(draft, context)).toEqual(resolvedOrder(draft));
      for (const key of moduleOrder(draft, context)) {
        const view = moduleView(draft, context, key);
        const resolved = resolvedModule(draft, key);
        expect(view.include, key).toBe(resolved.include);
        expect(view.title, key).toBe(resolved.title);
        expect(view.labels, key).toEqual(resolved.labels);
        expect(view.config, key).toEqual(resolved.config);
      }
    }
  });

  it("says when a base is missing", () => {
    const orphan = { ...clientEg(), extends: "NOWHERE" };
    expect(inheritanceOf(orphan, getBase).problems).toEqual(["Base template NOWHERE has no active version."]);
    expect(inheritanceOf(baseEg(), getBase)).toBe(NO_INHERITANCE);
  });
});

describe("listingFor", () => {
  /** A small deterministic shuffle (mulberry32), so the cases are the same on every run. */
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state + 0x6d2b79f5) | 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  it("lists what it takes for the resolver to give any order, starting from what must be listed", () => {
    const base = inheritanceOf(clientEg(), getBase).order;
    const middle = finalOrder(base, []).slice(1, -1);
    const next = random(42);
    for (let run = 0; run < 200; run += 1) {
      const shuffled = [...middle].sort(() => next() - 0.5);
      const desired: ModuleKey[] = ["header", ...shuffled, "conclusion"];
      const required = shuffled.filter(() => next() < 0.2);
      const listing = listingFor(base, desired, required);
      expect(finalOrder(base, listing)).toEqual(desired);
      for (const key of required) expect(listing).toContain(key);
    }
  });

  it("lists nothing more when nothing moves", () => {
    const base = inheritanceOf(clientEg(), getBase).order;
    const desired = finalOrder(base, []);
    expect(listingFor(base, desired, [])).toEqual([]);
    expect(listingFor(base, desired, ["weight"])).toEqual(["weight"]);
  });
});

describe("module edits", () => {
  it("switches a base's module off in a child by listing it, and nothing moves", () => {
    const child = clientFactoryEg();
    const context = contextOf(child);
    const before = resolvedOrder(child);
    const next = setInclude(child, context, "visual", false);
    expect(next.modules.find((entry) => entry.key === "visual")?.include).toBe(false);
    const off = setInclude(child, context, "weight", false);
    expect(off.modules.map((entry) => entry.key)).toContain("weight");
    expect(resolvedOrder(off)).toEqual(before);
    expect(resolvedModule(off, "weight").include).toBe(false);
    // Back on: the entry stays, switched on.
    const on = setInclude(off, contextOf(off), "weight", true);
    expect(resolvedModule(on, "weight").include).toBe(true);
    expect(resolvedOrder(on)).toEqual(before);
  });

  it("never switches header or conclusion off", () => {
    const draft = baseEg();
    expect(setInclude(draft, contextOf(draft), "header", false)).toBe(draft);
  });

  it("moves a module in a root template and in a child, header and conclusion pinned", () => {
    const root = baseEg();
    const rootContext = contextOf(root);
    const order = moduleOrder(root, rootContext);
    const moved = moveModule(root, rootContext, "weight", 2);
    expect(resolvedOrder(moved).slice(0, 4)).toEqual(["header", "glove_info", "weight", "order_lots"]);
    expect(moveModule(root, rootContext, "weight", 0)).toEqual(moveModule(root, rootContext, "weight", 1));
    expect(resolvedOrder(moveModule(root, rootContext, "weight", 99)).at(-2)).toBe("weight");
    expect(moveModule(root, rootContext, "conclusion", 3)).toBe(root);
    expect(moveModule(root, rootContext, "weight", order.indexOf("weight"))).toBe(root);

    const child = clientFactoryEg();
    const childContext = contextOf(child);
    const childOrder = moduleOrder(child, childContext);
    const target = childOrder.indexOf("order_lots");
    const next = moveModule(child, childContext, "visual", target);
    const expected = [...childOrder];
    expected.splice(childOrder.indexOf("visual"), 1);
    expected.splice(target, 0, "visual");
    expect(resolvedOrder(next)).toEqual(expected);
    // The child still lists only a few modules, not all of them.
    expect(next.modules.length).toBeLessThan(expected.length);
  });

  it("adds a module nobody mentions, on, just before the conclusion", () => {
    const draft = baseEg();
    const context = contextOf(draft);
    expect(unusedModules(draft, context)).toEqual(["tensile", "dispensing_safedon", "dye_leak", "documents", "loading"]);
    const next = addModule(draft, context, "dye_leak");
    expect(resolvedOrder(next).slice(-2)).toEqual(["dye_leak", "conclusion"]);
    expect(resolvedModule(next, "dye_leak").include).toBe(true);
  });

  it("sets and clears a heading and labels, leaving no empty overrides behind", () => {
    const draft = baseEg();
    const context = contextOf(draft);
    const titled = setTitle(draft, context, "glove_info", "Glove details");
    expect(resolvedModule(titled, "glove_info").title).toBe("Glove details");
    const cleared = setTitle(titled, contextOf(titled), "glove_info", "  ");
    expect(cleared.modules.find((entry) => entry.key === "glove_info")).toEqual({ key: "glove_info", include: true });

    const labelled = setLabel(draft, context, "glove_info", "colour", "Colour of glove");
    expect(resolvedModule(labelled, "glove_info").labels.colour).toBe("Colour of glove");
    const unlabelled = setLabel(labelled, contextOf(labelled), "glove_info", "colour", "");
    expect(unlabelled.modules.find((entry) => entry.key === "glove_info")).toEqual({ key: "glove_info", include: true });
    expect(setLabel(draft, context, "glove_info", "colour", undefined)).toBe(draft);
  });

  it("writes only the config that differs from what the template inherits", () => {
    const child = clientFactoryEg();
    const context = contextOf(child);
    const view = moduleView(child, context, "visual");
    const config = view.config as { classes: { major: { aql: number } } };
    const next = setConfig(child, context, "visual", {
      ...view.config,
      classes: { ...config.classes, major: { ...config.classes.major, aql: 1.5 } },
    });
    // handSplit was already set by this template: it stays set.
    expect(next.modules.find((entry) => entry.key === "visual")?.config).toEqual({
      handSplit: true,
      classes: { major: { aql: 1.5 } },
    });
    expect((resolvedModule(next, "visual").config as typeof config).classes.major.aql).toBe(1.5);

    // A module the child never listed gets an entry with only the change.
    const weight = moduleView(child, context, "weight");
    const heavier = setConfig(child, context, "weight", { ...weight.config, warnThresholdPct: 5 });
    expect(heavier.modules.find((entry) => entry.key === "weight")).toEqual({
      key: "weight",
      include: true,
      config: { warnThresholdPct: 5 },
    });
    expect(resolvedOrder(heavier)).toEqual(resolvedOrder(child));
    // Saving the same config changes nothing.
    expect(setConfig(child, context, "weight", weight.config)).toBe(child);
  });

  it("keeps an emptied required number empty, never the value it inherits (13 emptied, then 5, is 5)", () => {
    const child = clientFactoryEg();
    const context = contextOf(child);
    const weight = moduleView(child, context, "weight");
    expect(weight.config.n).toBe(1);
    // What the form hands over as the admin empties a required number: null, this template's own.
    const emptied = setConfig(child, context, "weight", { ...weight.config, n: null });
    expect(moduleView(emptied, contextOf(emptied), "weight").config.n).toBeNull();
    expect(isConfigOverridden(emptied, "weight", ["n"])).toBe(true);
    // The next key starts from nothing: 5, not 15.
    const typed = setConfig(emptied, contextOf(emptied), "weight", { ...weight.config, n: 5 });
    expect(moduleView(typed, contextOf(typed), "weight").config.n).toBe(5);
    // Text that is not a number is kept as typed, for the schema to name.
    const text = setConfig(typed, contextOf(typed), "weight", { ...weight.config, n: "2 40" });
    expect(moduleView(text, contextOf(text), "weight").config.n).toBe("2 40");
    // Left out (an optional setting emptied), or reset: the inherited value again.
    const left = setConfig(typed, contextOf(typed), "weight", { warnThresholdPct: weight.config.warnThresholdPct });
    expect(moduleView(left, contextOf(left), "weight").config.n).toBe(1);
    const reset = resetConfigAt(emptied, contextOf(emptied), "weight", ["n"]);
    expect(moduleView(reset, contextOf(reset), "weight").config.n).toBe(1);
  });

  it("resets one value back to the inherited one, and a whole module", () => {
    const child = clientFactoryEg();
    const context = contextOf(child);
    expect(isConfigOverridden(child, "visual", ["handSplit"])).toBe(true);
    const reset = resetConfigAt(child, context, "visual", ["handSplit"]);
    expect(reset.modules.find((entry) => entry.key === "visual")).toEqual({
      key: "visual",
      include: true,
      labels: { thin_spot: "Thin spot", "major.bead_defective": "Bead defect" },
    });
    expect(isConfigOverridden(reset, "visual", ["handSplit"])).toBe(false);
    expect(resetModule(child, "visual").modules.find((entry) => entry.key === "visual")).toEqual({
      key: "visual",
      include: true,
    });
  });

  it("knows which settings a template can take out: not inherited ones", () => {
    const inherited: JsonObject = { boxes: { default: 13, bySize: { XL: 5 } }, specs: [{ size: "M" }], spec: { kind: "min", min: 1 } };
    expect(canRemoveConfigAt(inherited, ["boxes", "bySize"])).toBe(false);
    expect(canRemoveConfigAt(inherited, ["boxes", "bySize", "XL"])).toBe(false);
    expect(canRemoveConfigAt(inherited, ["boxes", "bySize", "M"])).toBe(true);
    expect(canRemoveConfigAt(inherited, ["specs", 0, "size"])).toBe(true);
    expect(canRemoveConfigAt(inherited, ["spec", "min"])).toBe(true);
    expect(canRemoveConfigAt(inherited, ["other"])).toBe(true);
  });
});

describe("diffConfig", () => {
  const inherited: JsonObject = {
    statistic: "median",
    specs: { M: { width: { kind: "max", max: 80 }, length: { kind: "min", min: 240 } } },
    measures: ["length", "width"],
    fields: { a: true, b: true },
  };

  it("keeps lists and tagged values whole, objects down to the changed key", () => {
    const next = {
      ...inherited,
      specs: { M: { width: { kind: "tolerance", nominal: 76, tolerance: 4 }, length: { kind: "min", min: 240 } } },
      measures: ["length"],
      fields: { a: true, b: false },
    };
    const own = diffConfig(inherited, next);
    expect(own).toEqual({
      specs: { M: { width: { kind: "tolerance", nominal: 76, tolerance: 4 } } },
      measures: ["length"],
      fields: { b: false },
    });
    expect(mergeConfig(inherited, own)).toEqual(next);
  });

  it("keeps a value the template set before, even when it now matches", () => {
    expect(diffConfig(inherited, inherited, { statistic: "median" })).toEqual({ statistic: "median" });
    expect(diffConfig(inherited, inherited)).toEqual({});
  });

  it("round-trips any change back through the merge", () => {
    const changes: JsonObject[] = [
      { ...inherited, statistic: "average" },
      { ...inherited, extra: { deep: [1, 2] } },
      { ...inherited, specs: { ...(inherited.specs as JsonObject), L: { width: { kind: "na" } } } },
    ];
    for (const next of changes) expect(mergeConfig(inherited, diffConfig(inherited, next))).toEqual(next);
  });
});

describe("custom modules", () => {
  it("shows inherited ones, and copies one in to change it", () => {
    const child = clientFactoryEg();
    const context = contextOf(child);
    const views = customModuleViews(child, context);
    expect(views).toEqual([expect.objectContaining({ own: false, custom: expect.objectContaining({ key: "dispensing_spec" }) })]);
    const { draft, index } = overrideCustomModule(child, views[0].custom);
    expect(index).toBe(0);
    expect(customModuleViews(draft, context)).toEqual([expect.objectContaining({ own: true, overrides: true, index: 0 })]);
    expect(resolveTemplateOrThrow(draft, { getBase, registry }).customModules).toHaveLength(1);
  });

  it("adds one with a free key after the last module, and removes it", () => {
    const draft = baseEg();
    const context = contextOf(draft);
    const added = addCustomModule(draft, context);
    expect(added.draft.customModules).toEqual([
      {
        key: "custom_1",
        title: "New section",
        after: "labeling",
        layout: "fields",
        fields: [{ key: "field1", label: "New field", type: "text" }],
      },
    ]);
    expect(resolveTemplateOrThrow(added.draft, { getBase, registry }).customModules).toHaveLength(1);
    const again = addCustomModule(added.draft, context);
    expect(again.draft.customModules?.map((custom) => custom.key)).toEqual(["custom_1", "custom_2"]);
    expect(removeCustomModule(added.draft, 0)).toEqual(draft);
  });
});
