// Try It on the Inspection Summary card: the row as it draws, with and
// without an inspection to try it on, and a sample as Steri-AI answers it
// (the draft read-only, its length, notes and figures) or why there is none.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SummaryPreviewTarget } from "@/lib/inspections/ai/summary-runner";
import { DEFAULT_SUMMARY_STYLE, SUMMARY_MESSAGES, type SummaryPreviewResult } from "@/lib/schemas/summary-style";

vi.mock("../summary-actions", () => ({ previewSummaryAction: vi.fn(), saveSummarySettingsAction: vi.fn() }));

import { modelName, sampleSettingsLine, SummarySample, SummaryTryIt, TRY_IT_COST } from "./summary-try-it";

const TARGETS: SummaryPreviewTarget[] = [
  { id: "00000000-0000-4000-8000-000000000001", refNo: "INS-2026-0001", status: "draft", result: "pass", label: "INS-2026-0001 · Draft · PASSED" },
  { id: "00000000-0000-4000-8000-000000000002", refNo: "INS-2026-0002", status: "submitted", result: "hold", label: "INS-2026-0002 · Submitted · HOLD" },
];

const SAMPLE: SummaryPreviewResult = {
  ok: true,
  doc: {
    type: "doc",
    content: [
      {
        type: "paragraph",
        content: [
          { type: "text", text: "The inspection concluded " },
          { type: "text", text: "PASSED", marks: [{ type: "bold" }] },
          { type: "text", text: "." },
        ],
      },
    ],
  },
  text: "The inspection concluded PASSED.",
  notes: ["No remark gives the reason for the conclusion."],
  figures: ["2,900", "17%"],
  words: 152,
  model: "claude-sonnet-5-5",
};

function drawRow(targets: SummaryPreviewTarget[], disabled = false): string {
  return renderToStaticMarkup(
    <SummaryTryIt targets={targets} model="claude-sonnet-5-5" style={DEFAULT_SUMMARY_STYLE} settings="{}" saved disabled={disabled} />,
  );
}

/** As React writes text into markup: an apostrophe is &#x27;. */
const escaped = (text: string) => text.replaceAll("'", "&#x27;");

const tryItButton = (html: string) => html.match(/<button[^>]*>(?:(?!<\/button>).)*Try It<\/button>/)?.[0];

describe("the row", () => {
  it("offers the most recent inspection first, with what a try costs", () => {
    const html = drawRow(TARGETS);
    expect(html).toContain(">Try It On</label>");
    expect(html).toContain("INS-2026-0001 · Draft · PASSED");
    expect(html).toContain(TRY_IT_COST);
    expect(tryItButton(html)).not.toContain('disabled=""');
    expect(html).not.toContain('data-testid="summary-sample"');
  });

  it("says when there is nothing to try it on", () => {
    const html = drawRow([]);
    expect(html).toContain("Try It needs an inspection with a conclusion: there is none yet.");
    expect(tryItButton(html)).toContain('disabled=""');
  });

  it("is greyed while the settings cannot be saved", () => {
    expect(tryItButton(drawRow(TARGETS, true))).toContain('disabled=""');
  });
});

describe("the sample", () => {
  it("shows the draft read-only with its length, notes and the figures to check", () => {
    const html = renderToStaticMarkup(
      <SummarySample result={SAMPLE} refNo="INS-2026-0001" unit="words" settingsLine={sampleSettingsLine({ sameAsTried: true, saved: false })} />,
    );
    expect(html).toContain(">Sample Summary</h3>");
    expect(html).toContain("The inspection concluded <strong>PASSED</strong>.");
    expect(html).toContain("INS-2026-0001 · 152 words · Claude Sonnet 5.5");
    expect(html).toContain("Before you sign:");
    expect(html).toContain("<li>No remark gives the reason for the conclusion.</li>");
    expect(html).toContain("Check these figures before you sign: 2,900, 17%. Steri-AI did not find them in the inspection.");
    expect(html).toContain("Written with the settings above, not saved yet.");
  });

  it("spaces the draft's paragraphs as the field gets them, a blank line between each two", () => {
    const paragraph = (text: string) => ({ type: "paragraph" as const, content: [{ type: "text" as const, text }] });
    const html = renderToStaticMarkup(
      <SummarySample
        result={{ ...SAMPLE, doc: { type: "doc", content: [paragraph("The inspection concluded PASSED."), paragraph("Size M was inspected.")] } }}
        refNo="INS-2026-0001"
        unit="words"
        settingsLine=""
      />,
    );
    expect(html).toContain("<p>The inspection concluded PASSED.</p><p><br/></p><p>Size M was inspected.</p>");
  });

  it("counts Chinese in characters and leaves out what is empty", () => {
    const html = renderToStaticMarkup(
      <SummarySample result={{ ...SAMPLE, notes: [], figures: [], words: 1, model: "claude-opus-4-8" }} refNo="INS-2026-0001" unit="characters" settingsLine="" />,
    );
    expect(html).toContain("INS-2026-0001 · 1 character · claude-opus-4-8");
    expect(html).not.toContain("Before you sign:");
    expect(html).not.toContain("Check these figures");
  });

  it("says why there is no sample, pointing an admin to the key rather than to an admin", () => {
    const failed = renderToStaticMarkup(
      <SummarySample result={{ ok: false, reason: "error", message: SUMMARY_MESSAGES.checksFailed }} refNo="INS-2026-0001" unit="words" settingsLine="" />,
    );
    expect(failed).toContain(escaped(SUMMARY_MESSAGES.checksFailed));
    const notConnected = renderToStaticMarkup(
      <SummarySample result={{ ok: false, reason: "not_connected", message: SUMMARY_MESSAGES.notConnected }} refNo="INS-2026-0001" unit="words" settingsLine="" />,
    );
    expect(notConnected).toContain("Steri-AI is not connected yet. Add the Anthropic API key under General, then try again.");
  });

  it("says which settings it was written with", () => {
    expect(sampleSettingsLine({ sameAsTried: true, saved: true })).toBe("Written with the settings above.");
    expect(sampleSettingsLine({ sameAsTried: false, saved: true })).toBe("Written with earlier settings: try again to see the change.");
    expect(modelName("claude-opus-5-5")).toBe("Claude Opus 5.5");
  });
});
