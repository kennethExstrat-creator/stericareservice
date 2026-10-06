import { describe, expect, it } from "vitest";
import { configDiff, configEqual, diffPaths, droppedKeys, isConfigObject, mergeConfig } from "./merge";

describe("mergeConfig: the framework's merge (phase2/framework lib/templates/merge.ts)", () => {
  it("merges objects key by key and keeps what the override leaves out", () => {
    expect(mergeConfig({ a: 1, b: { c: 2, d: 3 } }, { b: { d: 4 } })).toEqual({ a: 1, b: { c: 2, d: 4 } });
  });

  it("replaces lists, values and null whole", () => {
    expect(mergeConfig({ list: [1, 2, 3], n: 1, s: "a", flag: true }, { list: [4], n: 2, s: "b", flag: false })).toEqual({
      list: [4],
      n: 2,
      s: "b",
      flag: false,
    });
    expect(mergeConfig({ specs: { XS: 1 } }, { specs: null })).toEqual({ specs: null });
    expect(mergeConfig({ specs: null }, { specs: { XS: 1 } })).toEqual({ specs: { XS: 1 } });
  });

  it("skips undefined and leaves its inputs alone", () => {
    const base = { a: { b: 1 } };
    const override = { a: { c: 2 }, d: undefined };
    expect(mergeConfig(base, override)).toEqual({ a: { b: 1, c: 2 } });
    expect(base).toEqual({ a: { b: 1 } });
  });
});

describe("configDiff and its companions", () => {
  const base = { fields: { a: true, b: true }, list: [1, 2], n: 1, nested: { deep: { x: 1, y: 2 } } };

  it("keeps only what differs: objects down to the changed keys, lists and values whole", () => {
    const target = { fields: { a: true, b: false }, list: [1, 2, 3], n: 1, nested: { deep: { x: 1, y: 3 } } };
    const diff = configDiff(base, target);
    expect(diff).toEqual({ fields: { b: false }, list: [1, 2, 3], nested: { deep: { y: 3 } } });
    expect(diffPaths(diff)).toEqual(["fields.b", "list", "nested.deep.y"]);
    expect(mergeConfig(base, diff)).toEqual(target);
    expect(configDiff(base, base)).toEqual({});
  });

  it("adds keys the base lacks", () => {
    expect(configDiff({ a: 1 }, { a: 1, b: { c: 2 } })).toEqual({ b: { c: 2 } });
  });

  it("names the keys a merge could not remove", () => {
    expect(droppedKeys(base, { fields: { a: true }, list: [], n: 2, nested: { deep: { x: 1, y: 2 } } })).toEqual(["fields.b"]);
    expect(droppedKeys({ a: { b: 1 } }, { a: null })).toEqual([]);
    expect(droppedKeys({ a: 1, b: 2 }, { a: 1 })).toEqual(["b"]);
  });

  it("compares JSON values structurally, key order aside", () => {
    expect(configEqual({ a: [1, { b: 2 }], c: null }, { c: null, a: [1, { b: 2 }] })).toBe(true);
    expect(configEqual({ a: 1 }, { a: 1, b: undefined })).toBe(false);
    expect(configEqual([1, 2], [2, 1])).toBe(false);
    expect(configEqual(null, {})).toBe(false);
    expect(isConfigObject([])).toBe(false);
    expect(isConfigObject(null)).toBe(false);
    expect(isConfigObject({})).toBe(true);
  });
});
