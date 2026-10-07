// Server-rendered markup of the AI panel for each state it can be in: the
// three columns, decisions for admins only, the not-connected states, a
// review being written, and screen-reader text kept inside its component.
// The element tree for the keys that keep decision forms with their review.
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }), unstable_rethrow: vi.fn() }));

import type { EvaluatedInspection } from "@/lib/export/evaluate";
import type { InspectionRecord } from "@/lib/export/record";
import {
  decisions,
  IDS,
  loadFixture,
  MOCK_STATUS,
  NOW,
  OFF_STATUS,
  PHOTO_LINKS,
  REVIEW_IDS,
  reviewHistory,
  storedReview,
} from "@/lib/inspections/ai/__fixtures__/panel";
import { inspectionFingerprint } from "@/lib/inspections/ai/fingerprint";
import { buildAiPanelModel, type PanelModelInput } from "@/lib/inspections/ai/panel-model";
import { Comparison } from "./comparison";
import { FindingCard, findingKey } from "./finding";
import { AiReviewPanelView } from "./review-panel-view";

let record: InspectionRecord;
let evaluated: EvaluatedInspection;

beforeAll(async () => {
  ({ record, evaluated } = await loadFixture());
});

function model(overrides: Partial<PanelModelInput> = {}) {
  return buildAiPanelModel({
    record,
    evaluated,
    reviews: reviewHistory(),
    decisions: decisions(),
    photoLinks: PHOTO_LINKS,
    aiStatus: MOCK_STATUS,
    isAdmin: true,
    now: NOW,
    ...overrides,
  });
}

function render(overrides: Partial<PanelModelInput> = {}): string {
  return renderToStaticMarkup(<AiReviewPanelView model={model(overrides)} />);
}

/** Every element in a tree as returned (components are not called). */
function elementsOf(node: ReactNode): ReactElement[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  return [node, ...elementsOf((node.props as { children?: ReactNode }).children)];
}

/** Text content, tags dropped, entities decoded enough for the checks below. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;|&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, " ");
}

const VOID_ELEMENTS = new Set(["area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track", "wbr"]);
const POSITIONING = ["relative", "absolute", "fixed", "sticky", "sr-only"];

/** sr-only elements without a positioned ancestor in the markup (docs/DESIGN.md, Do / Don't). */
function unanchoredSrOnly(html: string): string[] {
  const open: { tag: string; positioned: boolean }[] = [];
  const found: string[] = [];
  for (const [, closing, tag, attributes, selfClosing] of html.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*?)(\/?)>/g)) {
    if (closing) {
      const index = open.map((element) => element.tag).lastIndexOf(tag);
      if (index !== -1) open.length = index;
      continue;
    }
    const classes = (/\sclass="([^"]*)"/.exec(attributes)?.[1] ?? "").split(/\s+/);
    if (classes.includes("sr-only") && !open.some((element) => element.positioned)) found.push(`<${tag}${attributes}>`);
    if (VOID_ELEMENTS.has(tag) || selfClosing) continue;
    open.push({ tag, positioned: classes.some((name) => POSITIONING.includes(name)) });
  }
  return found;
}

describe("AiReviewPanelView for an admin", () => {
  it("puts the system, the inspector and the AI side by side, overall result first", () => {
    const html = render();
    const content = text(html);
    expect(content).toContain("AI second opinion");
    for (const column of ["System (computed)", "Inspector", "AI second opinion"]) expect(content).toContain(column);
    expect(content).toMatch(/Overall result .*Suggested result .*Failed.* Final result .*On hold.*Inspector A/);
    expect(content).toContain("Weight below the indicative value; waiting for the spec sheet.");
    expect(content).toContain("Confidence 85%");
    expect(content).toContain("Weighed on the factory scale.");
    expect(content).toContain("Calipers out for calibration.");
    expect(content).toContain("4 more sections passed or for information");
    // Rows follow the template order, the overall result first.
    const rows = [...html.matchAll(/data-section="[^"]*?-(overall|[a-z_]+)"/g)].map((match) => match[1]);
    expect(rows).toEqual([
      "overall",
      "glove_type",
      "glove_info",
      "packing_config",
      "carton_sampling",
      "dimensions",
      "weight",
      "tensile",
    ]);
  });

  it("shows each finding with its severity and the evidence it points to", () => {
    const content = text(render());
    expect(content).toMatch(/Major Finding F1 · Size M/);
    expect(content).toContain("Average weight, size M 2.9 g");
    expect(content).toMatch(/Critical Finding F2/);
    expect(content).toContain("Box: 578");
    expect(content).toContain("Photo no longer in this inspection");
    expect(content).toContain("Original file (HEIC)");
    const html = render();
    expect(html).toContain('href="https://storage.test/weight.jpg"');
    expect(html).toContain('src="https://storage.test/thumb-weight.jpg"');
    expect(html).toContain('aria-label="Scale reading, Weight (g) · Size M (opens in a new tab)"');
  });

  it("lists the AI's questions for the inspector where they belong", () => {
    const content = text(render());
    expect(content).toContain("Is the spec sheet on its way?");
    expect(content).toContain("Was the whole lot on site?");
    expect(content).toContain("Which scale was used?");
  });

  it("lets the admin record agree, disagree or fixed, and shows who decided", () => {
    const html = render();
    const content = text(html);
    expect(content).toMatch(/Disagreed Admin B · 6 Oct 2026, 09:20/);
    expect(content).toContain("The indicative weight on the sheet is for size L.");
    expect(content).toContain("Earlier decisions (1)");
    expect(html).toContain('aria-label="Change your decision on finding F1"');
    // F2 has no decision yet: the three choices and a save button.
    expect(html).toContain('aria-label="Your decision on finding F2"');
    expect(content).toMatch(/Agree Disagree Fixed Save decision/);
    expect(html).toMatch(/name="action" value=""/);
  });

  it("offers a new request, keeps the failed attempt visible, and the history per version", () => {
    const content = text(render());
    expect(content).toContain("Request a new second opinion");
    expect(content).toContain("Test data only");
    expect(content).toContain("The last request failed The webhook did not answer in time.");
    expect(content).toContain("Earlier second opinions (2)");
    expect(content).toContain("Stopped without an answer: the server stopped before the reviewer replied.");
    expect(content).toContain("reviewed the version saved 5 Oct 2026, 17:30 (current)");
  });

  it("offers the JSON download and says the report service is not connected", () => {
    const html = render();
    const content = text(html);
    expect(content).toContain("AI report");
    expect(content).toContain("AI not connected");
    expect(html).toContain(`href="/api/inspections/${IDS.inspection}/export"`);
    expect(html).toMatch(/<a[^>]*download=""[^>]*>|<a[^>]*download[^>]*>/);
    expect(content).not.toContain("Send to AI report");
  });

  it("sends to the AI report when a report service is connected", () => {
    const content = text(
      render({ aiStatus: { ...MOCK_STATUS, report: { connected: true, provider: "webhook", label: "AI report connected (webhook)" } } }),
    );
    expect(content).toContain("Send to AI report");
    expect(content).not.toContain("AI not connected");
  });

  it("keeps screen-reader text inside its component", () => {
    expect(unanchoredSrOnly(render())).toEqual([]);
    expect(unanchoredSrOnly(render({ isAdmin: false, decisions: [] }))).toEqual([]);
  });

  it("keys the opinion and its finding cards by the review, so a newer opinion starts with empty decision forms", () => {
    const panel = model();
    const current = panel.current!;
    // The opinion's block remounts when another review becomes the current one ...
    const opinion = elementsOf(AiReviewPanelView({ model: panel })).find((element) => element.key === current.id);
    expect(opinion).toBeDefined();
    // ... and each finding card names its review: F1 of one review is never F1 of another.
    const comparison = elementsOf(opinion).find((element) => element.type === Comparison);
    expect(comparison).toBeDefined();
    const findingLists = elementsOf(Comparison(comparison!.props as Parameters<typeof Comparison>[0])).filter(
      (element) => typeof element.type === "function" && "findings" in (element.props as object),
    );
    const cards = findingLists.flatMap((list) =>
      elementsOf((list.type as (props: unknown) => ReactNode)(list.props)).filter((element) => element.type === FindingCard),
    );
    expect(cards.map((card) => card.key).sort()).toEqual(current.findings.map((finding) => findingKey(current.id, finding.id)).sort());
    expect(findingKey(current.id, "F1")).not.toBe(findingKey(REVIEW_IDS.older, "F1"));
  });

  it("gives keyboard focus somewhere to go when a request turns into a notice, and the notice into an opinion", () => {
    const running = storedReview({
      id: REVIEW_IDS.running,
      status: "pending",
      findings: [],
      questions: [],
      createdAt: new Date(NOW - 30_000).toISOString(),
    });
    const html = render({ reviews: [running, storedReview()] });
    expect(html).toMatch(/<div tabindex="-1" class="[^"]*focus-ring[^"]*" data-testid="ai-review-pending">/);
    expect(html).toMatch(/<div tabindex="-1" class="[^"]*focus-ring[^"]*" data-testid="ai-review-meta">/);
  });
});

describe("AiReviewPanelView for the inspector", () => {
  it("shows the opinions read-only: no decisions, no requests, no report button", () => {
    const html = render({ isAdmin: false, decisions: [] });
    const content = text(html);
    expect(content).toContain("Finding F1");
    expect(content).toContain("An admin decides on each finding.");
    expect(content).not.toContain("Save decision");
    expect(content).not.toMatch(/Request (AI|a new) second opinion/);
    expect(content).not.toContain("Send to AI report");
    expect(html).not.toContain("Change your decision");
    expect(html).toContain(`href="/api/inspections/${IDS.inspection}/export"`);
  });
});

describe("AiReviewPanelView states", () => {
  it("says the second opinion is not connected, and what to set up", () => {
    const content = text(render({ aiStatus: OFF_STATUS, reviews: [], decisions: [] }));
    expect(content).toContain("AI second opinion not connected");
    expect(content).toContain("To connect it, set ANTHROPIC_API_KEY or AI_REVIEW_WEBHOOK_URL on the server.");
    // Nothing is switched off: the hint does not send the admin looking for AI_REVIEW_PROVIDER.
    expect(content).not.toContain("AI_REVIEW_PROVIDER");
    expect(content).not.toContain("System (computed)");
    expect(content).not.toMatch(/Request (AI|a new) second opinion/);
  });

  it("says when the second opinion is switched off on purpose, and how to switch it on", () => {
    const switchedOff = { ...OFF_STATUS, review: { ...OFF_STATUS.review, switchedOff: true as const } };
    const content = text(render({ aiStatus: switchedOff, reviews: [], decisions: [] }));
    expect(content).toContain("AI second opinion not connected");
    expect(content).toContain("It is switched off on the server: AI_REVIEW_PROVIDER is set to off. To connect it, set it to auto");
    // Inspectors are told who can change it, not how.
    const inspector = text(render({ aiStatus: switchedOff, reviews: [], decisions: [], isAdmin: false }));
    expect(inspector).toContain("An admin can connect it.");
    expect(inspector).not.toContain("AI_REVIEW_PROVIDER");
  });

  it("keeps earlier opinions readable after the reviewer is disconnected", () => {
    const content = text(render({ aiStatus: OFF_STATUS }));
    expect(content).toContain("AI second opinion not connected");
    expect(content).toContain("Earlier second opinions are kept below.");
    expect(content).toContain("Finding F1");
  });

  it("invites the first request", () => {
    const content = text(render({ reviews: [], decisions: [] }));
    expect(content).toContain("No second opinion yet");
    expect(content).toContain("Request AI second opinion");
  });

  it("shows a review being written, and no second request for the same version", () => {
    const running = storedReview({
      id: REVIEW_IDS.running,
      status: "pending",
      findings: [],
      questions: [],
      createdAt: new Date(NOW - 30_000).toISOString(),
    });
    const content = text(render({ reviews: [running], decisions: [] }));
    expect(content).toContain("Writing the second opinion");
    expect(content).toContain("this panel updates by itself");
    expect(content).not.toMatch(/Request (AI|a new) second opinion/);
  });

  it("warns when the inspection was saved after an opinion stored without a fingerprint", () => {
    const content = text(render({ record: { ...record, updatedAt: "2026-10-06T01:45:00.000001+00:00" } }));
    expect(content).toContain("The inspection has changed since this opinion");
    expect(content).toContain("It was saved again at 6 Oct 2026, 09:45");
  });

  it("warns when what the opinion reviewed has changed, and not for a save that changed nothing it reviewed", () => {
    const reviews = [storedReview({ inspectionFingerprint: inspectionFingerprint(record) })];
    const approved = text(render({ reviews, record: { ...record, status: "approved", updatedAt: "2026-10-06T01:45:00.000001+00:00" } }));
    expect(approved).not.toContain("The inspection has changed since this opinion");
    expect(approved).toContain("(current)");

    const edited = text(render({ reviews, record: { ...record, remarks: "Spec sheet received." } }));
    expect(edited).toContain("The inspection has changed since this opinion");
    expect(edited).toContain("What it reviewed has changed: the entries, the modules switched off, or the lab reports and certificates.");
    expect(edited).toContain("Request a new second opinion to review the current version.");
  });
});
