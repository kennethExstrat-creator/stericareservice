// Fill From a Document's reader (docs/AI.md, "Reading order documents"): what
// Claude is told and the schema it answers in. Kenneth, 27 October 2026: "the
// Steri AI should be able to read doc to use existing client and manufacturer
// or create new one": it still matches the lists first, and for a client or
// manufacturer no entry matches it gives what the document prints, for New
// Client and New Manufacturer. No real Claude call: fetch answers here.
import { afterEach, describe, expect, it, vi } from "vitest";
import { DocumentReadingSchema, type DocumentReading } from "@/lib/schemas/document-fill";
import { DOCUMENT_READER_SYSTEM_PROMPT, listsText, readingJsonSchema, readOrderDocument } from "./document-reader";

/** A JSON Schema node, as far as these tests read it. */
type Node = {
  type?: string | string[];
  anyOf?: Node[];
  description?: string;
  properties?: Record<string, Node>;
  items?: Node;
  required?: string[];
  additionalProperties?: unknown;
};

/** Every property in the schema, nested ones included, by its path. */
function properties(node: Node, path = ""): { path: string; node: Node; required: boolean }[] {
  const found: { path: string; node: Node; required: boolean }[] = [];
  for (const [name, child] of Object.entries(node.properties ?? {})) {
    found.push({ path: `${path}${name}`, node: child, required: node.required?.includes(name) ?? false });
    found.push(...properties(child, `${path}${name}.`));
    if (child.items) found.push(...properties(child.items, `${path}${name}[].`));
  }
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("what Claude is told", () => {
  it("matches the lists first, and gives what the document prints for an entry none matches, never inventing a detail", () => {
    const rules = DOCUMENT_READER_SYSTEM_PROMPT.split("\n");
    const match = rules.findIndex((line) => line.startsWith("- Client and manufacturer: you get lists with ids. Match a listed entry first"));
    const factory = rules.findIndex((line) => line.startsWith("- A manufacturer entry is one factory"));
    const unmatched = rules.findIndex((line) => line.startsWith("- When no entry matches, return null for the id"));
    expect(match).toBeGreaterThan(0);
    // In that order: match first, then when no entry matches.
    expect(factory).toBe(match + 1);
    expect(unmatched).toBe(factory + 1);
    expect(rules[match]).toContain('ignore case, punctuation, "Sdn Bhd", "Ltd", "Inc" and similar');
    expect(rules[factory]).toContain("No entry matches when the document names a factory that no entry lists, even under a listed brand or company");
    expect(rules[unmatched]).toContain("its brand (only one the document shows");
    expect(rules[unmatched]).toContain("its registered company name, its factory's name or number (such as TG-F40), and the factory's address and country");
    expect(rules[unmatched]).toContain("Never invent or complete a detail the document does not print: leave it empty.");
    expect(DOCUMENT_READER_SYSTEM_PROMPT).toContain("- Only report what the document states. Never guess or invent a value: leave it null.");
  });

  it("gives the lists after the document, each entry with its id", () => {
    const text = listsText({
      clients: [{ id: "c1", name: "Client A" }],
      manufacturers: [{ id: "m1", name: "Brand A · Company A Sdn. Bhd. · F-1" }],
    });
    expect(text).toBe(
      "<clients>\n- c1: Client A\n</clients>\n<manufacturers>\n- m1: Brand A · Company A Sdn. Bhd. · F-1\n</manufacturers>\n\nRead the document above and give its details.",
    );
  });
});

describe("the schema Claude answers in", () => {
  const schema = readingJsonSchema() as Node;
  const all = properties(schema);

  it("asks for the manufacturer's details after its name: brand, company, factory, address and country, as printed", () => {
    expect(Object.keys(schema.properties ?? {}).slice(0, 5)).toEqual([
      "clientId",
      "clientName",
      "manufacturerId",
      "manufacturerName",
      "manufacturerDetails",
    ]);
    const details = schema.properties?.manufacturerDetails;
    expect(details?.type).toBe("object");
    expect(details?.required).toEqual(["brand", "company", "factory", "address", "country"]);
    expect(details?.additionalProperties).toBe(false);
    expect(details?.description).toContain("so the inspector can add it when no listed entry matches. Never guessed or completed.");
    for (const part of ["brand", "company", "factory", "address", "country"]) {
      const node = details?.properties?.[part];
      expect(node?.type, part).toBe("string");
      expect(node?.description, part).toContain("An empty string when it is not printed.");
    }
    expect(details?.properties?.brand.description).toContain("Never made up from the company's name.");
    expect(details?.properties?.factory.description).toContain("such as TG-F40");
  });

  // Structured outputs compile at most 16 union-typed fields and 24 optional ones per request
  // (platform.claude.com, "Structured outputs", limits): more, and every reading fails with a 400.
  it("stays within what structured outputs compile", () => {
    const unions = all.filter(({ node }) => Array.isArray(node.anyOf) || Array.isArray(node.type));
    expect(unions.length).toBeLessThanOrEqual(16);
    expect(all.filter(({ required }) => !required).map(({ path }) => path)).toEqual([]);
    for (const { path, node } of all) {
      if (node.type === "object") expect(node.additionalProperties, path).toBe(false);
    }
  });
});

describe("a reading", () => {
  const answer: DocumentReading = {
    clientId: null,
    clientName: "Test Buyer Sdn. Bhd.",
    manufacturerId: null,
    manufacturerName: "Test Glove Factory Sdn. Bhd.",
    manufacturerDetails: { brand: "", company: "Test Glove Factory Sdn. Bhd.", factory: "F-40", address: "Lot 1, Placeholder Park", country: "Malaysia" },
    productType: "examination",
    productName: "Nitrile examination gloves",
    productCode: null,
    factoryGloveCode: null,
    poNo: "PO-0001",
    inspectionDate: null,
    mfgDate: null,
    expiryDate: null,
    sizes: [{ size: "M", qtyCases: 100, lotNumbers: ["LOT-TEST-01"] }],
    notes: null,
  };

  it("sends the prompt, the lists and the schema, and answers what Claude read", async () => {
    const requests: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: unknown, init?: { body?: unknown }) => {
        requests.push(JSON.parse(String(init?.body)));
        const message = {
          id: "msg_test",
          type: "message",
          role: "assistant",
          model: "claude-opus-5-5",
          stop_reason: "end_turn",
          stop_sequence: null,
          content: [{ type: "text", text: JSON.stringify(answer) }],
          usage: { input_tokens: 10, output_tokens: 10 },
        };
        return new Response(JSON.stringify(message), { status: 200, headers: { "content-type": "application/json" } });
      }),
    );

    const outcome = await readOrderDocument(
      { mediaType: "application/pdf", base64: "JVBERi0xLjQ=", name: "PO 0001.pdf" },
      { clients: [{ id: "c1", name: "Client A" }], manufacturers: [] },
      { ANTHROPIC_API_KEY: "sk-ant-test-key-0000000000" },
    );

    expect(outcome).toEqual({ ok: true, reading: DocumentReadingSchema.parse(answer), model: "claude-opus-5-5" });
    expect(requests).toHaveLength(1);
    const [request] = requests as { system: string; messages: { content: { type: string; text?: string }[] }[]; output_config: { format: { schema: unknown } } }[];
    expect(request.system).toBe(DOCUMENT_READER_SYSTEM_PROMPT);
    expect(request.messages[0].content.at(-1)?.text).toContain("<manufacturers>\n(none)\n</manufacturers>");
    expect(request.output_config.format.schema).toEqual(readingJsonSchema());
  });
});
