import { describe, expect, it } from "vitest";
import { emptyData, filledData, TEST_REGISTRY, testTemplate } from "./__fixtures__/capture";
import { changedEntryProblems, COMMENT_MAX, describeProblems } from "./changes";

const template = testTemplate();
const check = (previous: Parameters<typeof changedEntryProblems>[0], next: Parameters<typeof changedEntryProblems>[1]) =>
  changedEntryProblems(previous, next, template, TEST_REGISTRY);

describe("changedEntryProblems", () => {
  it("accepts a draft: valid entries, missing values and comments", () => {
    expect(check(emptyData(), filledData())).toEqual([]);
    expect(check(emptyData(), { modules: { glove_info: { colour: null, indicativeWeight: null } }, custom: {} })).toEqual([]);
  });

  it("refuses text in a numeric cell, naming the section and the field", () => {
    const next = { modules: { glove_info: { indicativeWeight: "2 42", colour: "Blue" } }, custom: {} };
    expect(check(emptyData(), next)).toEqual([
      expect.objectContaining({ namespace: "modules", key: "glove_info", title: "Glove Information" }),
    ]);
    expect(check(emptyData(), next)[0].message).toMatch(/^indicativeWeight: /);
  });

  it("names the section by its short name, as the screen's menus do (docs/DESIGN.md, Step Names)", () => {
    // The template's "Manufacturer Information".
    const next = { modules: { header: { poNo: 42, productName: null, client: null } }, custom: {} };
    expect(check(emptyData(), next)).toEqual([expect.objectContaining({ key: "header", title: "Manufacturer" })]);
    expect(describeProblems(check(emptyData(), next))).toMatch(/^Manufacturer: poNo: /);
    // A custom module by its own title, without a trailing note in brackets.
    const noted = { ...template, customModules: template.customModules.map((custom) => ({ ...custom, title: `${custom.title} (Optional)` })) };
    const wrong = changedEntryProblems(emptyData(), { modules: {}, custom: { site_notes: { sealIntact: "yes" } } }, noted, TEST_REGISTRY);
    expect(wrong).toEqual([expect.objectContaining({ key: "site_notes", title: "Site notes" })]);
  });

  it("refuses a key the module does not have (strict schemas)", () => {
    const next = { modules: { glove_info: { colour: "Blue", colur: "Blue" } }, custom: {} };
    expect(check(emptyData(), next)).toHaveLength(1);
  });

  it("checks only what the save changes, so old unreadable data never blocks the rest", () => {
    const broken = { modules: { glove_info: { indicativeWeight: "old text" } }, custom: {} };
    const next = { ...broken, modules: { ...broken.modules, header: { poNo: "PO-0002", productName: null, client: null } } };
    expect(check(broken, next)).toEqual([]);
  });

  it("refuses sections that are not in the template", () => {
    expect(check(emptyData(), { modules: { visual: { sizes: {} } }, custom: {} })[0]).toMatchObject({
      key: "visual",
      message: "is not a section of this inspection's template.",
    });
    expect(check(emptyData(), { modules: { not_a_module: {} }, custom: {} })).toHaveLength(1);
    expect(check(emptyData(), { modules: {}, custom: { unknown: { a: 1 } } })).toHaveLength(1);
  });

  it("checks custom modules with their field schemas", () => {
    expect(check(emptyData(), { modules: {}, custom: { site_notes: { weather: "Dry", sealIntact: true } } })).toEqual([]);
    const wrong = check(emptyData(), { modules: {}, custom: { site_notes: { sealIntact: "yes" } } });
    expect(wrong).toEqual([expect.objectContaining({ namespace: "custom", key: "site_notes", title: "Site notes" })]);
  });

  it("checks the comment: text, and not too long", () => {
    expect(check(emptyData(), { modules: { glove_info: { comment: 3 } }, custom: {} })[0].message).toBe(
      "the comment must be text.",
    );
    const long = "x".repeat(COMMENT_MAX + 1);
    expect(check(emptyData(), { modules: { glove_info: { comment: long } }, custom: {} })[0].message).toMatch(/comment/);
  });

  it("allows clearing a section (null) and refuses an entry that is not an object", () => {
    expect(check(filledData(), { modules: { ...filledData().modules, glove_info: null }, custom: {} })).toEqual([]);
    expect(check(emptyData(), { modules: { glove_info: [1, 2] }, custom: {} })[0].message).toBe(
      "the saved entry is not an object.",
    );
  });

  it("treats the same data with keys in another order as unchanged", () => {
    const previous = { modules: { glove_info: { indicativeWeight: "old", colour: "Blue" } }, custom: {} };
    const next = { modules: { glove_info: { colour: "Blue", indicativeWeight: "old" } }, custom: {} };
    expect(check(previous, next)).toEqual([]);
  });
});

describe("describeProblems", () => {
  it("names the first problem and counts the rest", () => {
    expect(describeProblems([])).toBe("");
    const one = { namespace: "modules" as const, key: "a", title: "Order", message: "lots: Invalid input." };
    expect(describeProblems([one])).toBe("Order: lots: Invalid input.");
    expect(describeProblems([one, one, one])).toBe("Order: lots: Invalid input. (and 2 more problems)");
  });
});
