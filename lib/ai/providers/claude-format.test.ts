import { describe, expect, it } from "vitest";
import { makeAiReview } from "@/lib/ai/__fixtures__/ai-review";
import { aiReviewJsonSchema, aiReviewOutputFormat, parseAiReviewText, toStructuredOutputSchema } from "./claude-format";

type Node = Record<string, unknown>;

/** Every schema node, depth first. */
function nodes(schema: unknown): Node[] {
  if (Array.isArray(schema)) return schema.flatMap(nodes);
  if (typeof schema !== "object" || schema === null) return [];
  const node = schema as Node;
  const children = [node.properties, node.$defs].flatMap((map) =>
    typeof map === "object" && map !== null ? Object.values(map) : [],
  );
  return [node, ...[...children, node.items, node.anyOf, node.allOf].flatMap(nodes)];
}

function at(schema: Node, path: string[]): Node {
  return path.reduce<Node>((node, key) => {
    const next = key === "items" ? node.items : (node.properties as Record<string, Node>)[key];
    return next as Node;
  }, schema);
}

describe("aiReviewJsonSchema", () => {
  const schema = aiReviewJsonSchema();

  it("closes every object, as structured outputs require", () => {
    const objects = nodes(schema).filter((node) => node.type === "object");
    expect(objects.length).toBeGreaterThan(4);
    for (const node of objects) expect(node.additionalProperties).toBe(false);
  });

  it("keeps enums, so the API holds Claude to them", () => {
    expect(at(schema, ["suggestedResult"]).enum).toEqual(["pass", "fail", "hold"]);
    expect(at(schema, ["findings", "items", "severity"]).enum).toEqual(["critical", "major", "minor", "info"]);
  });

  it("leaves out keywords outside the structured-output subset, as hints the model still reads", () => {
    for (const node of nodes(schema)) {
      for (const keyword of ["minimum", "maximum", "minLength", "maxLength", "default", "$schema", "pattern"]) {
        expect(node).not.toHaveProperty(keyword);
      }
    }
    expect(at(schema, ["confidence"]).description).toContain("minimum: 0");
    expect(at(schema, ["confidence"]).description).toContain("maximum: 1");
  });

  it("requires every field, including the defaulted unit, and allows null where the schema does", () => {
    expect(schema.required).toEqual(["suggestedResult", "confidence", "summary", "findings", "questions"]);
    const value = at(schema, ["findings", "items", "evidence", "values", "items"]);
    expect(value.required).toEqual(["label", "value", "unit"]);
    expect(JSON.stringify(at(schema, ["findings", "items", "size"]))).toContain("null");
  });

  it("carries the field descriptions the model reads", () => {
    expect(at(schema, ["findings", "items", "id"]).description).toContain("F1");
  });
});

describe("toStructuredOutputSchema", () => {
  it("maps oneOf to anyOf and moves unsupported formats and array bounds into hints", () => {
    expect(
      toStructuredOutputSchema({
        type: "object",
        properties: {
          code: { oneOf: [{ type: "string", format: "color" }, { type: "null" }] },
          tags: { type: "array", items: { type: "string" }, minItems: 2, maxItems: 5 },
          id: { type: "string", format: "uuid" },
        },
        required: ["code", "tags", "id"],
        additionalProperties: true,
      }),
    ).toEqual({
      type: "object",
      properties: {
        code: { anyOf: [{ type: "string", description: '{format: "color"}' }, { type: "null" }] },
        tags: { type: "array", items: { type: "string" }, description: "{minItems: 2, maxItems: 5}" },
        id: { type: "string", format: "uuid" },
      },
      required: ["code", "tags", "id"],
      additionalProperties: false,
    });
  });
});

describe("parsing Claude's answer", () => {
  const review = makeAiReview();

  it("returns the validated review", () => {
    expect(parseAiReviewText(JSON.stringify(review))).toEqual({ review, problem: null });
  });

  it("names the problem instead of throwing on a cut-off answer", () => {
    const truncated = JSON.stringify(review).slice(0, 80);
    expect(parseAiReviewText(truncated)).toEqual({ review: null, problem: "the answer is not complete JSON" });
  });

  it("names the field when the JSON does not match", () => {
    const result = parseAiReviewText(JSON.stringify({ ...review, confidence: 3 }));
    expect(result.review).toBeNull();
    expect(result.problem).toContain("confidence");
  });

  it("is a json_schema format carrying only the generated schema", () => {
    const format = aiReviewOutputFormat();
    expect(format).toEqual({ type: "json_schema", schema: aiReviewJsonSchema() });
    expect(format.schema).toBe(aiReviewJsonSchema());
    // No parser for the SDK to run: one that throws would fail the stream before stop_reason is read.
    expect(format).not.toHaveProperty("parse");
  });
});
