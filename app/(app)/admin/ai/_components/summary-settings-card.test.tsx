// The Inspection Summary card on Steri-AI Settings > Inspection Settings:
// the essentials as it opens (More Writing Options folded), the folded
// options as they draw, the foot, and the rules behind the form (refusals by
// path, saved or not, the languages offered). e2e opens it in the browser.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { SummarySettingsView } from "@/lib/ai/settings";
import { lowerCaseWords } from "@/lib/design/capitalisation";
import type { SummaryPreviewTarget } from "@/lib/inspections/ai/summary-runner";
import { DEFAULT_AI_PRICES } from "@/lib/schemas/ai-prices";
import { DEFAULT_SUMMARY_MODEL, DEFAULT_SUMMARY_STYLE, type SummaryStyle } from "@/lib/schemas/summary-style";

vi.mock("../summary-actions", () => ({ saveSummarySettingsAction: vi.fn(), previewSummaryAction: vi.fn() }));

import {
  errorAt,
  foldedErrors,
  lastSavedLine,
  MoreWritingOptions,
  offerLanguage,
  settingsKey,
  switchHouseLanguage,
  SUMMARY_CARD_INTRO,
  SummarySettingsCard,
} from "./summary-settings-card";

const VIEW: SummarySettingsView = {
  model: DEFAULT_SUMMARY_MODEL,
  style: DEFAULT_SUMMARY_STYLE,
  storage: "ready",
  updatedAt: "2026-10-13T06:05:00Z",
  updatedBy: "Kenneth",
};

const TARGETS: SummaryPreviewTarget[] = [
  { id: "00000000-0000-4000-8000-000000000001", refNo: "INS-2026-0001", status: "draft", result: "pass", label: "INS-2026-0001 · Draft · PASSED" },
];

function draw(view: Partial<SummarySettingsView> = {}, targets = TARGETS): string {
  return renderToStaticMarkup(<SummarySettingsCard view={{ ...VIEW, ...view }} targets={targets} prices={DEFAULT_AI_PRICES} />);
}

function drawMore(style: Partial<SummaryStyle> = {}, errors: Record<string, string> = {}): string {
  return renderToStaticMarkup(
    <MoreWritingOptions id="more" style={{ ...DEFAULT_SUMMARY_STYLE, ...style }} update={() => {}} errors={errors} disabled={false} />,
  );
}

/** A picker's trigger and the words on it. */
function picker(html: string, label: string): string | undefined {
  const id = html.match(new RegExp(`<label[^>]*for="([^"]+)"[^>]*>${label}</label>`))?.[1];
  return id ? html.match(new RegExp(`<button[^>]*id="${id}"[^>]*>(?:(?!</button>).)*</button>`))?.[0] : undefined;
}

describe("the card as it opens", () => {
  it("says what it is for, then the model and the essentials with their lines", () => {
    const html = draw();
    expect(html).toContain('data-testid="ai-summary-settings"');
    expect(html).toContain(">Inspection Summary</h2>");
    expect(html).toContain(SUMMARY_CARD_INTRO);
    expect(html).toContain("Model<span class=\"sr-only\"> for Inspection Summary</span>");
    expect(html).toContain("For the Steri-AI Summary button on the Conclusion. Fast and capable, lower cost.");
    expect(picker(html, "Length")).toContain("Standard (About 150 Words)");
    expect(picker(html, "Paragraphs")).toContain("Auto (Follows Length)");
    expect(picker(html, "Format")).toContain("Paragraphs");
    expect(picker(html, "Numbers")).toContain("Key Numbers");
    expect(html).toContain("A guide: Steri-AI aims within a quarter either side");
    expect(html).toContain("Brief 1, Standard 2, Detailed 4. Not used for Bullet Points.");
    expect(html).toContain("Prose only.");
    expect(html).toContain("Exact figures for failures, warnings and gaps; one figure, or words, for what passed.");
    // Two per row on iPad portrait, four from 1024 px.
    expect(html).toContain("grid gap-5 sm:grid-cols-2 lg:grid-cols-4");
  });

  it("then the parts, the inspectors' switch, More Writing Options folded, Try It and the foot", () => {
    const html = draw();
    expect(html).toContain('data-testid="summary-sections"');
    expect(html).toMatch(/role="switch" aria-checked="true"[^>]*id="[^"]+-adjust"/);
    expect(html).toContain(">Inspectors Can Adjust Length, Paragraphs and Format</label>");
    expect(html).toMatch(/aria-expanded="false"[^>]*data-testid="summary-more-toggle"/);
    expect(html).toContain("More Writing Options");
    // Nothing inside shows until it is opened.
    expect(html).not.toContain("Group Results");
    expect(html).not.toContain('data-testid="summary-more"');
    expect(html).toContain('data-testid="summary-try-it"');
    expect(html).toContain("Settings last saved 13 October 2026, 14:05 by Kenneth.");
    expect(html).toContain("Reset to Defaults");
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*>(?:(?!<\/button>).)*Save Summary Settings<\/button>/);
    expect(html.indexOf("summary-sections")).toBeLessThan(html.indexOf("summary-more-toggle"));
    expect(html.indexOf("summary-more-toggle")).toBeLessThan(html.indexOf("summary-try-it"));
    expect(html.indexOf("summary-try-it")).toBeLessThan(html.indexOf("Save Summary Settings"));
  });

  it("greys everything while the settings cannot be saved", () => {
    const html = draw({ storage: "no_secret_key" });
    expect(html).toMatch(/<button[^>]*type="submit"[^>]*disabled=""/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Reset to Defaults<\/button>/);
    expect(picker(html, "Length")).toContain("disabled");
  });

  it("says when the chosen model has no price yet", () => {
    expect(draw({ model: "claude-sonnet-4-9" })).toContain("No price for this model yet");
    expect(draw()).not.toContain("No price for this model yet");
  });

  it("leaves the saved line out before the first save", () => {
    expect(draw({ updatedAt: null, updatedBy: null })).not.toContain("Settings last saved");
  });
});

describe("More Writing Options", () => {
  it("groups Content, Voice, Formatting and House Wording, with the defaults chosen", () => {
    const html = drawMore();
    for (const legend of ["Content", "Voice", "Formatting", "House Wording"]) expect(html).toContain(`>${legend}</legend>`);
    expect(picker(html, "Group Results")).toContain("By Test");
    expect(picker(html, "Sizes")).toContain("Only Where Results Differ");
    expect(picker(html, "Point of View")).toContain("Third Person");
    expect(html).toContain("“The watertight test found 1 hole in 500 gloves.”");
    expect(picker(html, "Tone")).toContain("Professional");
    expect(picker(html, "Terminology")).toContain("Template&#x27;s Wording");
    expect(picker(html, "Bold")).toContain("Conclusion and Problem Sections");
    expect(picker(html, "Dates")).toContain("13 October 2026");
    expect(picker(html, "Language")).toContain("English (UK Spelling)");
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*id="more-suggestion"/);
    expect(html).toMatch(/role="switch" aria-checked="false"[^>]*id="more-colour"/);
  });

  it("keeps the house language ticked and fixed among the languages inspectors can choose", () => {
    const html = drawMore();
    expect(html).toMatch(/role="checkbox" aria-checked="true"[^>]*disabled=""[^>]*id="more-offered-en-GB"/);
    expect(html).toMatch(/role="checkbox" aria-checked="false"[^>]*id="more-offered-ms"/);
    expect(html).not.toMatch(/id="more-offered-ms"[^>]*disabled/);
  });

  it("offers house wording blank, a placeholder only where one helps, and room for two examples", () => {
    const html = drawMore();
    for (const label of ["Verdict Sentence for PASSED", "Verdict Sentence for FAILED", "Verdict Sentence for HOLD"]) {
      expect(html).toContain(`>${label}</label>`);
    }
    expect(html).not.toMatch(/id="more-verdict-pass"[^>]*placeholder/);
    expect(html).toContain('placeholder="This summary reflects the goods sampled at the time and place of inspection."');
    expect(html).toContain('placeholder="Call the manufacturer the supplier."');
    expect(html).toContain("Add Example");
    const full = drawMore({ examples: ["[PO]: one.", "[PO]: two."] });
    expect(full).not.toContain("Add Example");
    expect(full.match(/Remove<span class="sr-only"> Example \d<\/span>/g)).toHaveLength(2);
    expect(full).toContain("10 / 1,500");
  });

  it("says what a save refused under the field", () => {
    const html = drawMore({}, { "style.closingSentence": "Keep a sentence to 300 characters.", "style.examples": "Add up to 2 examples." });
    expect(html).toContain("Keep a sentence to 300 characters.");
    expect(html).toContain("Add up to 2 examples.");
  });
});

describe("the rules behind the form", () => {
  it("finds a refusal by its path and the folded part it is in", () => {
    const errors = { "style.examples.1": "Keep an example to 1,500 characters.", "style.sections.2.key": "List each part once." };
    expect(errorAt(errors, "style.examples")).toBe("Keep an example to 1,500 characters.");
    expect(errorAt(errors, "style.example")).toBeUndefined();
    expect(foldedErrors(errors)).toEqual({ sections: true, more: true });
    expect(foldedErrors({ model: "Enter a Claude model id, for example claude-opus-5-5." })).toEqual({ sections: false, more: false });
  });

  it("compares settings as they are stored: trimmed, blank examples dropped", () => {
    const saved = settingsKey(DEFAULT_SUMMARY_MODEL, DEFAULT_SUMMARY_STYLE);
    expect(settingsKey(` ${DEFAULT_SUMMARY_MODEL} `, { ...DEFAULT_SUMMARY_STYLE, examples: [""], closingSentence: "  " })).toBe(saved);
    expect(settingsKey(DEFAULT_SUMMARY_MODEL, { ...DEFAULT_SUMMARY_STYLE, tone: "formal" })).not.toBe(saved);
    expect(settingsKey(DEFAULT_SUMMARY_MODEL, { ...DEFAULT_SUMMARY_STYLE, examples: ["x".repeat(1501)] })).toBeNull();
  });

  it("writes the saved line in Malaysian time", () => {
    expect(lastSavedLine("2026-10-13T06:05:00Z", "Kenneth")).toBe("Settings last saved 13 October 2026, 14:05 by Kenneth.");
    expect(lastSavedLine("2026-10-12T16:30:00Z", null)).toBe("Settings last saved 13 October 2026, 00:30.");
    expect(lastSavedLine(null, "Kenneth")).toBeNull();
  });

  it("always offers the house language, in the list's order", () => {
    expect(offerLanguage({ language: "en-GB", languagesOffered: ["en-GB"] }, "zh-Hans", true)).toEqual(["en-GB", "zh-Hans"]);
    expect(offerLanguage({ language: "ms", languagesOffered: ["en-GB", "ms"] }, "ms", false)).toEqual(["en-GB", "ms"]);
    expect(offerLanguage({ language: "ms", languagesOffered: ["en-GB", "ms"] }, "en-GB", false)).toEqual(["ms"]);
  });

  it("offers a new house language in place of the old one, keeping the others ticked", () => {
    // The default offer (the house language alone) stays one language: no Language menu appears.
    expect(switchHouseLanguage({ language: "en-GB", languagesOffered: ["en-GB"] }, "en-US")).toEqual({ language: "en-US", languagesOffered: ["en-US"] });
    expect(switchHouseLanguage({ language: "en-GB", languagesOffered: ["en-GB", "zh-Hans"] }, "ms")).toEqual({
      language: "ms",
      languagesOffered: ["ms", "zh-Hans"],
    });
    expect(switchHouseLanguage({ language: "en-GB", languagesOffered: ["en-GB", "ms"] }, "ms")).toEqual({ language: "ms", languagesOffered: ["ms"] });
    expect(switchHouseLanguage({ language: "ms", languagesOffered: ["en-GB", "ms"] }, "ms")).toEqual({ language: "ms", languagesOffered: ["en-GB", "ms"] });
  });

  it("words its own labels in Title Case", () => {
    const labels = [
      "Inspection Summary",
      "More Writing Options",
      "Content",
      "Voice",
      "Formatting",
      "House Wording",
      "Example 1",
      "Add Example",
      "Remove Example 1",
      "Try It On",
      "Try It",
      "Sample Summary",
      "Reset to Defaults",
      "Save Summary Settings",
    ];
    expect(labels.filter((label) => lowerCaseWords(label).length > 0)).toEqual([]);
  });
});
