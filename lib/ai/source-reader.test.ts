import { describe, expect, it } from "vitest";
import { parseSourceAnswer } from "./source-reader";

const A = "aaaaaaaa-0000-4000-8000-000000000001";

describe("parseSourceAnswer", () => {
  it("reads the values per part and per new PO, fences and a stray sentence around them allowed", () => {
    const text = [
      "Here is the reading:",
      "```json",
      JSON.stringify({
        summary: "  Three inspection forms:\n PO 0001 size S and PO 0002 size M. ",
        parts: { [A]: { modules: { header: { productName: "Gloves" }, weight: "heavy" } }, broken: "nothing" },
        newParts: [
          { poNo: "  PO-0002   (SO-0002) ", modules: { order_lots: { sizes: { M: { qtyCases: 7 } } } } },
          { poNo: "", modules: { header: {} } },
          { poNo: "PO-0003" },
          { poNo: "9".repeat(201), modules: {} },
        ],
        mappings: [{ written: " SKV ", recordedAs: "Skin Void " }, { written: "x" }],
      }),
      "```",
    ].join("\n");
    expect(parseSourceAnswer(text)).toEqual({
      summary: "Three inspection forms: PO 0001 size S and PO 0002 size M.",
      parts: { [A]: { header: { productName: "Gloves" } } },
      newParts: [{ poNo: "PO-0002 (SO-0002)", proposals: { order_lots: { sizes: { M: { qtyCases: 7 } } } } }],
      mappings: ["SKV → Skin Void"],
    });
  });

  it("keeps the one-inspection answer for the part that asked", () => {
    expect(parseSourceAnswer('{"summary": "A PO.", "modules": {"header": {"poNo": "PO-0001"}}}')).toEqual({
      summary: "A PO.",
      parts: {},
      newParts: [],
      modules: { header: { poNo: "PO-0001" } },
      mappings: [],
    });
  });

  it("answers null for anything but a JSON object", () => {
    expect(parseSourceAnswer("I could not read the document.")).toBeNull();
    expect(parseSourceAnswer("{not json}")).toBeNull();
    expect(parseSourceAnswer("[1, 2]")).toBeNull();
  });
});
