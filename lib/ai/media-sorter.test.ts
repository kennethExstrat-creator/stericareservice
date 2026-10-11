import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./document-reader", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./document-reader")>()),
  createMessage: vi.fn(),
}));

import { createMessage } from "./document-reader";
import { parseSortAnswer, sortMedia, type SortPreview } from "./media-sorter";

const answer = (items: unknown[]) => JSON.stringify({ items });

afterEach(() => {
  vi.resetAllMocks();
});

describe("parseSortAnswer", () => {
  it("reads one category per item, unsure as null", () => {
    const text = answer([
      { item: 1, category: "warehouse" },
      { item: 2, category: "samples" },
      { item: 3, category: "proof" },
      { item: 4, category: "defects" },
      { item: 5, category: "unsure" },
    ]);
    expect(parseSortAnswer(text, 5)).toEqual(["media_warehouse", "media_samples", "media_proof", "media_defects", null]);
  });

  it("reads the JSON inside a code fence and a stray sentence", () => {
    const text = `Here is the sorting:\n\`\`\`json\n${answer([{ item: 2, category: "Defects " }, { item: 1, category: "proof" }])}\n\`\`\``;
    expect(parseSortAnswer(text, 2)).toEqual(["media_proof", "media_defects"]);
  });

  it("leaves an item null when it is missing, not a category, or answered two ways; ignores unknown items", () => {
    const text = answer([
      { item: 1, category: "packaging" },
      { item: 3, category: "warehouse" },
      { item: 3, category: "samples" },
      { item: 4, category: "defects" },
      { item: 9, category: "proof" },
      { item: "2", category: "proof" },
    ]);
    expect(parseSortAnswer(text, 4)).toEqual([null, null, null, "media_defects"]);
  });

  it("is null for an answer that is not the JSON object", () => {
    expect(parseSortAnswer("I cannot tell what these show.", 2)).toBeNull();
    expect(parseSortAnswer('{"items": "warehouse"}', 2)).toBeNull();
    expect(parseSortAnswer('{"items": [{"item": 1,', 2)).toBeNull();
  });
});

describe("sortMedia", () => {
  const previews: SortPreview[] = [
    { kind: "photo", mediaType: "image/jpeg", base64: "/9j/AAAA" },
    { kind: "video", mediaType: "image/png", base64: "iVBORw0K" },
  ];

  it("points to an admin and AI Settings when no key is set, without a request", async () => {
    const outcome = await sortMedia(previews, {});
    expect(outcome).toEqual({ ok: false, reason: "not_connected", message: expect.stringContaining("Admin > AI Settings") });
    expect(createMessage).not.toHaveBeenCalled();
  });

  it("sends each preview after its label, with the document model at low effort", async () => {
    vi.mocked(createMessage).mockResolvedValue({
      model: "claude-sonnet-5-5",
      stop_reason: "end_turn",
      content: [{ type: "text", text: answer([{ item: 1, category: "samples" }, { item: 2, category: "unsure" }]) }],
    } as never);

    const outcome = await sortMedia(previews, { ANTHROPIC_API_KEY: "sk-ant-test-key-0000000000", AI_DOCUMENT_MODEL: "claude-sonnet-5-5" });

    expect(outcome).toEqual({ ok: true, categories: ["media_samples", null], model: "claude-sonnet-5-5" });
    const params = vi.mocked(createMessage).mock.calls[0][1];
    expect(params).toMatchObject({ model: "claude-sonnet-5-5", output_config: { effort: "low" } });
    expect(params.system).toEqual(expect.stringContaining("Product and Package Samples"));
    expect(params.messages[0].content).toEqual([
      { type: "text", text: "Item 1 (photo)" },
      { type: "image", source: { type: "base64", media_type: "image/jpeg", data: "/9j/AAAA" } },
      { type: "text", text: "Item 2 (video frame)" },
      { type: "image", source: { type: "base64", media_type: "image/png", data: "iVBORw0K" } },
      { type: "text", text: "Sort the 2 items above and answer with the JSON object." },
    ]);
  });
});
