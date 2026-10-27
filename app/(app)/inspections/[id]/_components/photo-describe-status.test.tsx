// The Report page's one line about Steri-AI describing the report's photos
// (docs/AI.md, "Describing photos"): while it runs, nothing once done, a
// short failure with Try Again.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PhotoDescribeStatus } from "./photo-describe-status";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const draw = (state: Parameters<typeof PhotoDescribeStatus>[0]["state"]) => renderToStaticMarkup(<PhotoDescribeStatus state={state} retry={() => {}} />);

describe("PhotoDescribeStatus", () => {
  it("says how many photos Steri-AI is describing, in a live region there from the start", () => {
    const html = draw({ status: "describing", count: 4 });
    expect(html).toMatch(/^<div role="status"/);
    expect(text(html)).toBe("Steri-AI is describing 4 photos…");
  });

  it("is empty once done", () => {
    expect(text(draw({ status: "idle" }))).toBe("");
    expect(draw({ status: "idle" })).toContain('role="status"');
  });

  it("says a failure in its own words, with Try Again", () => {
    const html = draw({ status: "failed", message: "Steri-AI is busy. Wait a minute and try again." });
    expect(text(html)).toBe("Steri-AI is busy. Wait a minute and try again. Try Again");
    expect(html).toMatch(/<button[^>]*type="button"[^>]*>[\s\S]*Try Again<\/button>/);
  });
});
