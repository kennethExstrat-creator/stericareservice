import { describe, expect, it } from "vitest";
import { z } from "zod";
import { MODULE_REGISTRY } from "@/modules/registry";
import { countIssuesUnder, issuesAt, issuesByPath, notANumber, parseWithMessages, pathFromKey, pathKey } from "./issues";
import { DimensionsLikeSchema, DispensingLikeSchema, WatertightLikeSchema } from "./__fixtures__/schemas";

function messages(schema: z.ZodType, value: unknown) {
  const result = parseWithMessages(schema, value);
  return issuesByPath(result.success ? null : result.error);
}

describe("parseWithMessages", () => {
  it("words zod's generic issues plainly, field by field", () => {
    const issues = messages(DispensingLikeSchema, {
      minLayeringPct: 120,
      stickinessCodes: [],
      boxesPerSize: { default: 0.5, bySize: { m: 3 } },
      extra: true,
    });
    expect(issuesAt(issues, ["minLayeringPct"])).toEqual(["Must be 100 or less."]);
    expect(issuesAt(issues, ["stickinessCodes"])).toEqual(["Add at least one."]);
    expect(issuesAt(issues, ["boxesPerSize", "default"])).toEqual(["Enter a whole number."]);
    // A record key: the key schema's own words.
    expect(issuesAt(issues, ["boxesPerSize", "bySize", "m"])[0]).toMatch(/^Not a canonical size/);
    expect(issuesAt(issues, [])).toEqual(["Unknown setting: extra."]);
  });

  it("keeps the messages a schema writes itself", () => {
    const issues = messages(WatertightLikeSchema, {
      aql: 3,
      locations: [
        { code: "Hole", label: "" },
        { code: "hole_palm", label: "Palm" },
        { code: "hole_palm", label: "Palm again" },
      ],
      handSplit: "no",
    });
    expect(issuesAt(issues, ["aql"])).toEqual(["Choose one of the options."]);
    expect(issuesAt(issues, ["locations", 0, "code"])).toEqual(["Lower case letters, digits and _."]);
    expect(issuesAt(issues, ["locations", 0, "label"])).toEqual(["Enter a value."]);
    expect(issuesAt(issues, ["handSplit"])).toEqual(["Choose on or off."]);
  });

  it("runs a list's own check once its items are right", () => {
    const issues = messages(WatertightLikeSchema, {
      aql: null,
      locations: [
        { code: "hole_palm", label: "Palm" },
        { code: "hole_palm", label: "Palm again" },
      ],
      handSplit: false,
    });
    expect(issuesAt(issues, ["locations"])).toEqual(["Each hole location code may be listed once."]);
  });

  it("asks for what is missing, and for a type when a tag is wrong", () => {
    const issues = messages(DimensionsLikeSchema, {
      measures: ["length"],
      statistic: "mode",
      specs: [{ size: "M", specs: { length: { kind: "range", min: 5 }, width: { kind: "weird" } } }],
      decimals: { length: 0, width: 0, fingerThickness: 2, palmThickness: 2, cuffThickness: 2 },
      rows: 0,
    });
    expect(issuesAt(issues, ["statistic"])).toEqual(["Choose one of: median, average."]);
    expect(issuesAt(issues, ["specs", 0, "specs", "length", "max"])).toEqual(["Enter a number."]);
    expect(issuesAt(issues, ["specs", 0, "specs", "width", "kind"])).toEqual(["Choose a type."]);
    expect(issuesAt(issues, ["rows"])).toEqual(["Must be more than 0."]);
  });

  it("says what is wrong with text typed where a number belongs, and asks for an emptied one", () => {
    const issues = messages(DispensingLikeSchema, {
      minLayeringPct: "2 40",
      stickinessCodes: [{ code: "A", label: "Non sticky", pass: true }],
      boxesPerSize: { default: null, bySize: { M: "1,234" } },
    });
    expect(issuesAt(issues, ["minLayeringPct"])).toEqual(["“2 40” is not a number. Remove the space: one number only, e.g. 2.42."]);
    // Emptied, a required number is null: asked for, never inherited in its place.
    expect(issuesAt(issues, ["boxesPerSize", "default"])).toEqual(["Enter a number."]);
    expect(issuesAt(issues, ["boxesPerSize", "bySize", "M"])).toEqual([
      "“1,234” is not a number. Use a point for decimals, e.g. 1.234.",
    ]);
    // A number in quotes, from the JSON tab.
    expect(issuesAt(messages(DimensionsLikeSchema.pick({ width: true }), { width: "12" }), ["width"])).toEqual([
      "Write 12 as a number, without quotes.",
    ]);
    expect(notANumber(" ")).toBe("Enter a number.");
    expect(notANumber("abc")).toBe("“abc” is not a number. Numbers only, e.g. 2.42.");
  });

  it("reads a module's real config schema the same way", () => {
    const config = MODULE_REGISTRY.glove_info.configSchema;
    const issues = messages(config, { fields: { surfaceTexture: true }, indicativeWeightSize: "m" });
    expect(issuesAt(issues, ["fields", "colour"])).toEqual(["Required."]);
    expect(issuesAt(issues, ["indicativeWeightSize"])[0]).toMatch(/^Not a canonical size/);
  });
});

describe("paths", () => {
  it("keys sizes with dots and list positions apart", () => {
    expect(pathKey(["specs", "7.0", 2])).toBe('["specs","7.0",2]');
    expect(pathFromKey(pathKey(["specs", "7.0", 2]))).toEqual(["specs", "7.0", 2]);
    expect(pathKey([])).toBe("[]");
  });

  it("counts the messages under a group", () => {
    const issues = new Map([
      [pathKey(["a"]), ["one"]],
      [pathKey(["a", "b"]), ["two", "three"]],
      [pathKey(["ab"]), ["not under a"]],
    ]);
    expect(countIssuesUnder(issues, ["a"])).toBe(3);
    expect(countIssuesUnder(issues, [])).toBe(4);
    expect(countIssuesUnder(issues, ["c"])).toBe(0);
  });
});
