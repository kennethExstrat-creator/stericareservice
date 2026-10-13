// The second opinion's view of the export (12 October 2026): the
// Inspection Summary goes to the reviewer as its plain text only.
import { describe, expect, it } from "vitest";
import type { InspectionExport, JsonValue } from "@/lib/schemas";
import { makeStdEgExport } from "../__fixtures__/std-eg-export";
import { toModelView } from "./claude-request";

const TEXT = "The inspection concluded PASSED.\n\n• Weight passed with a warning.";
const DOCUMENT: JsonValue = {
  type: "doc",
  content: [
    { type: "paragraph", content: [{ type: "text", text: "The inspection concluded " }, { type: "text", text: "PASSED", marks: [{ type: "bold" }] }, { type: "text", text: "." }] },
    { type: "bulletList", content: [{ type: "listItem", content: [{ type: "paragraph", content: [{ type: "text", text: "Weight passed with a warning." }] }] }] },
  ],
};

function withSummary(): InspectionExport {
  const doc = makeStdEgExport();
  return {
    ...doc,
    modules: doc.modules.map((module) => (module.key === "conclusion" ? { ...module, data: { ...module.data, inspectionSummary: DOCUMENT } } : module)),
    conclusion: { ...doc.conclusion, inspectionSummary: { html: "<p>The inspection concluded <strong>PASSED</strong>.</p>", text: TEXT } },
  };
}

describe("toModelView", () => {
  it("sends the Inspection Summary as plain text, without its document or HTML", () => {
    const view = toModelView(withSummary());
    expect(view.conclusion.inspectionSummary).toBe(TEXT);
    const conclusion = view.modules.find((module) => module.key === "conclusion");
    expect(conclusion?.data).not.toHaveProperty("inspectionSummary");
    expect(conclusion?.data).toHaveProperty("finalResult", "pass");
    const json = JSON.stringify(view);
    expect(json).not.toContain("<strong>");
    expect(json).not.toContain('"bulletList"');
  });

  it("passes on To Sign After Exported as the export states it, the signature then null (Kenneth, 13 October 2026)", () => {
    const doc = makeStdEgExport();
    expect(toModelView(doc).conclusion.signAfterExport).toBe(false);
    const later: InspectionExport = {
      ...doc,
      modules: doc.modules.map((module) =>
        module.key === "conclusion" ? { ...module, data: { ...module.data, signature: null, signAfterExport: true } } : module,
      ),
      conclusion: { ...doc.conclusion, signAfterExport: true },
    };
    const view = toModelView(later);
    expect(view.conclusion.signAfterExport).toBe(true);
    expect(view.modules.find((module) => module.key === "conclusion")?.data).toMatchObject({ signature: null, signAfterExport: true });
  });

  it("sends null while no summary is written, and leaves the other modules as they are", () => {
    const doc = makeStdEgExport();
    const view = toModelView(doc);
    expect(view.conclusion.inspectionSummary).toBeNull();
    expect(view.modules.filter((module) => module.key !== "conclusion")).toEqual(doc.modules.filter((module) => module.key !== "conclusion"));
  });
});
