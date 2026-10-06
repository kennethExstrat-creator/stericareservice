import { describe, expect, it } from "vitest";
import { applyListedOrder, pinEnds } from "./module-order";

const BASE = ["header", "a", "b", "c", "d", "conclusion"];

describe("applyListedOrder", () => {
  it("gives a root template's list as it is", () => {
    expect(applyListedOrder([], ["header", "b", "a", "conclusion"])).toEqual(["header", "b", "a", "conclusion"]);
  });

  it("leaves modules a child does not list where they are", () => {
    expect(applyListedOrder(BASE, ["c"])).toEqual(BASE);
    expect(applyListedOrder(BASE, ["a", "c"])).toEqual(BASE);
  });

  it("puts a new module just after the module listed before it", () => {
    expect(applyListedOrder(BASE, ["b", "x"])).toEqual(["header", "a", "b", "x", "c", "d", "conclusion"]);
  });

  it("puts a new module listed first at the top", () => {
    expect(applyListedOrder(BASE, ["x"])).toEqual(["x", ...BASE]);
  });

  it("moves a module listed after one it used to precede", () => {
    expect(applyListedOrder(BASE, ["c", "a"])).toEqual(["header", "b", "c", "a", "d", "conclusion"]);
  });

  it("moves a module earlier only when the modules it must now precede are listed after it", () => {
    const base = ["header", "a", "b", "c", "m", "conclusion"];
    // m already comes after a, so listing a then m leaves it in place.
    expect(applyListedOrder(base, ["a", "m"])).toEqual(base);
    expect(applyListedOrder(base, ["m", "b", "c"])).toEqual(["header", "a", "m", "b", "c", "conclusion"]);
    expect(applyListedOrder(base, ["a", "m", "b", "c"])).toEqual(["header", "a", "m", "b", "c", "conclusion"]);
  });

  it("gives exactly the listed order when every module is listed", () => {
    const wanted = ["header", "d", "b", "a", "c", "conclusion"];
    expect(applyListedOrder(BASE, wanted)).toEqual(wanted);
  });

  it("orders like the SAFEDON_EG report when the child lists its changes in report order", () => {
    const std = [
      "header",
      "dimensions",
      "force_at_break",
      "weight",
      "watertight",
      "visual",
      "dispensing_packing",
      "labeling",
      "conclusion",
    ];
    const child = ["weight", "tensile", "force_at_break", "dispensing_safedon", "watertight", "visual"];
    expect(applyListedOrder(std, child)).toEqual([
      "header",
      "dimensions",
      "weight",
      "tensile",
      "force_at_break",
      "dispensing_safedon",
      "watertight",
      "visual",
      "dispensing_packing",
      "labeling",
      "conclusion",
    ]);
  });

  it("does not change its input", () => {
    const base = [...BASE];
    applyListedOrder(base, ["d", "a"]);
    expect(base).toEqual(BASE);
  });
});

describe("pinEnds", () => {
  it("puts header first and conclusion last, wherever they were", () => {
    expect(pinEnds(["a", "conclusion", "b", "header"], "header", "conclusion")).toEqual([
      "header",
      "a",
      "b",
      "conclusion",
    ]);
  });

  it("leaves out an end that is missing", () => {
    expect(pinEnds(["a", "header"], "header", "conclusion")).toEqual(["header", "a"]);
  });
});
