import { describe, expect, it } from "vitest";
import { contentHash, hashText, stableStringify } from "./stable-json";

describe("stableStringify", () => {
  it("sorts object keys at every depth, as jsonb would return them in any order", () => {
    const a = { modules: { weight: { n: 13, values: [5.1, 5.2] }, header: { po: "PO-0001" } }, custom: {} };
    const b = { custom: {}, modules: { header: { po: "PO-0001" }, weight: { values: [5.1, 5.2], n: 13 } } };
    expect(stableStringify(a)).toBe(stableStringify(b));
    expect(stableStringify(a)).toBe(
      '{"custom":{},"modules":{"header":{"po":"PO-0001"},"weight":{"n":13,"values":[5.1,5.2]}}}',
    );
  });

  it("follows JSON.stringify for values JSON cannot hold", () => {
    expect(stableStringify({ a: undefined, b: () => 1, c: Symbol("x"), d: null })).toBe('{"d":null}');
    expect(stableStringify([undefined, NaN, Infinity, 1])).toBe("[null,null,null,1]");
    expect(stableStringify(new Date(Date.UTC(2026, 9, 6)))).toBe('"2026-10-06T00:00:00.000Z"');
    expect(stableStringify(undefined)).toBe("null");
    expect(stableStringify("quote \" and \\")).toBe(JSON.stringify("quote \" and \\"));
    expect(() => stableStringify({ big: BigInt(1) })).toThrow(TypeError);
  });

  it("keeps array order, which is meaningful", () => {
    expect(stableStringify([2, 1])).not.toBe(stableStringify([1, 2]));
  });
});

describe("contentHash", () => {
  it("is equal for equal content in any key order and differs when a value changes", () => {
    const base = { modules: { visual: { major: { thin_spot: 2 } } } };
    expect(contentHash(base)).toBe(contentHash(JSON.parse(JSON.stringify(base))));
    expect(contentHash({ b: 1, a: 2 })).toBe(contentHash({ a: 2, b: 1 }));
    expect(contentHash(base)).not.toBe(contentHash({ modules: { visual: { major: { thin_spot: 3 } } } }));
  });

  it("is 16 hex digits and stable across runs", () => {
    expect(hashText("")).toMatch(/^[0-9a-f]{16}$/);
    expect(hashText("SteriCare")).toBe(hashText("SteriCare"));
    expect(hashText("SteriCare")).not.toBe(hashText("Stericare"));
  });
});
