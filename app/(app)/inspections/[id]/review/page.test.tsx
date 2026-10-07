// The page's own decisions, rendered on the server: who gets which actions,
// the title, the AI panel in its place, and the 404 for anything the user
// may not see.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/inspections/review/load", () => ({ loadReview: vi.fn() }));
vi.mock("@/lib/inspections/review/actions", () => ({ approveInspection: vi.fn(), reopenInspection: vi.fn() }));
vi.mock("@/lib/inspections/ai", () => ({ loadAiPanel: vi.fn() }));
vi.mock("@/lib/inspections/ai/actions", () => ({
  requestAiSecondOpinion: vi.fn(),
  recordAiFindingDecision: vi.fn(),
  sendToAiReport: vi.fn(),
  getAiReviewProgress: vi.fn(),
}));

import { requireUser } from "@/lib/auth/session";
import { CLAUDE_MAX_TOKENS } from "@/lib/ai/providers/claude-request";
import { claudeTimeoutMs } from "@/lib/ai/providers/claude";
import { REPORT_WEBHOOK_TIMEOUT_MS } from "@/lib/ai/report";
import { loadAiPanel, type AiPanelLoad } from "@/lib/inspections/ai";
import { loadFixture, MOCK_STATUS, NOW, reviewHistory } from "@/lib/inspections/ai/__fixtures__/panel";
import { buildAiPanelModel } from "@/lib/inspections/ai/panel-model";
import { ADMIN_ID, INSPECTION_ID, INSPECTOR_ID, reviewData, reviewInspection } from "@/lib/inspections/review/__fixtures__/review";
import { loadReview, type ReviewData } from "@/lib/inspections/review/load";
import { createClient } from "@/lib/supabase/server";
import InspectionReviewPage, { generateMetadata, maxDuration } from "./page";

let panel: AiPanelLoad;

beforeAll(async () => {
  const { record, evaluated } = await loadFixture();
  panel = {
    ok: true,
    model: buildAiPanelModel({
      record,
      evaluated,
      reviews: reviewHistory(),
      decisions: [],
      photoLinks: { thumbs: new Map(), full: new Map() },
      aiStatus: MOCK_STATUS,
      viewerId: ADMIN_ID,
      isAdmin: true,
      now: NOW,
    }),
  };
});

const ADMIN_USER = { id: ADMIN_ID, email: "admin@test.local", fullName: "Admin A", role: "admin" as const };
const INSPECTOR_USER = { id: INSPECTOR_ID, email: "inspector@test.local", fullName: "Inspector A", role: "inspector" as const };

const props = (id = INSPECTION_ID) => ({ params: Promise.resolve({ id }), searchParams: Promise.resolve({}) });

async function render(review: ReviewData): Promise<string> {
  vi.mocked(loadReview).mockResolvedValue({ kind: "ok", review });
  return renderToStaticMarkup(await InspectionReviewPage(props()));
}

/** Buttons and links by their visible name. */
const button = (html: string, name: string) => new RegExp(`<button[^>]*>(?:(?!</button>).)*${name}</button>`).test(html);
const link = (html: string, name: string) => new RegExp(`<a[^>]*>(?:(?!</a>).)*${name}</a>`).test(html);

function isNotFound(error: unknown): boolean {
  return (error as { digest?: string })?.digest?.startsWith("NEXT_HTTP_ERROR_FALLBACK;404") ?? false;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireUser).mockResolvedValue(ADMIN_USER);
  vi.mocked(createClient).mockResolvedValue({} as never);
  vi.mocked(loadAiPanel).mockResolvedValue(panel);
});

describe("/inspections/[id]/review", () => {
  it("is titled with the ref, read as the signed-in user", async () => {
    vi.mocked(loadReview).mockResolvedValue({ kind: "ok", review: reviewData() });
    expect(await generateMetadata(props())).toEqual({ title: "Review INS-2026-0001" });
    expect(requireUser).toHaveBeenCalled();
    expect(loadReview).toHaveBeenCalledWith({}, INSPECTION_ID, { id: ADMIN_ID, name: "Admin A", role: "admin" });
  });

  it("is a 404, title included, for an inspection the user cannot see", async () => {
    vi.mocked(requireUser).mockResolvedValue(INSPECTOR_USER);
    vi.mocked(loadReview).mockResolvedValue({ kind: "not_found" });
    await expect(generateMetadata(props())).rejects.toSatisfy(isNotFound);
    await expect(InspectionReviewPage(props())).rejects.toSatisfy(isNotFound);
  });

  it("is a 404 for an id that is not an inspection id, without asking the database", async () => {
    await expect(InspectionReviewPage(props("not-an-id"))).rejects.toSatisfy(isNotFound);
    expect(loadReview).not.toHaveBeenCalled();
  });

  it("gives an admin Approve and Reopen on a submitted inspection", async () => {
    const html = await render(reviewData());
    expect(button(html, "Approve")).toBe(true);
    expect(button(html, "Reopen")).toBe(true);
    expect(link(html, "Open Inspection")).toBe(true);
    expect(html).toContain("Waiting for Your Review");
  });

  it.each(["approved", "reopened", "draft"] as const)("gives an admin no decision on a %s inspection", async (status) => {
    const html = await render(reviewData({ inspection: reviewInspection({ status }) }));
    expect(button(html, "Approve")).toBe(false);
    expect(button(html, "Reopen")).toBe(false);
    expect(link(html, "Open Inspection")).toBe(true);
  });

  it("shows the inspector their submitted inspection read-only", async () => {
    const html = await render(reviewData({ viewer: { id: INSPECTOR_ID, name: "Inspector A", role: "inspector" } }));
    expect(button(html, "Approve")).toBe(false);
    expect(button(html, "Reopen")).toBe(false);
    expect(link(html, "Open Inspection")).toBe(true);
    expect(html).toContain("Waiting for Review");
  });

  // Lead inspectors read their team's inspections (migration 20261007170000), read-only.
  it.each(["submitted", "draft", "reopened", "approved"] as const)(
    "shows a lead inspector their team's %s inspection read-only: no approve, reopen or editing, and no AI panel",
    async (status) => {
      const lead = { id: "00000000-0000-4000-8000-000000000103", name: "Lina Lead", role: "inspector" as const };
      // The AI panel follows the export's rule (owner or admin): a lead gets nothing.
      vi.mocked(loadAiPanel).mockResolvedValue({ ok: false, reason: "not_found", message: "Inspection not found." });
      const html = await render(reviewData({ viewer: lead, inspection: reviewInspection({ status }) }));
      expect(button(html, "Approve")).toBe(false);
      expect(button(html, "Reopen")).toBe(false);
      expect(link(html, "Open Inspection")).toBe(true);
      expect(link(html, "Continue Inspection")).toBe(false);
      expect(link(html, "Make Changes")).toBe(false);
      expect(html).not.toContain('data-testid="ai-panel"');
      if (status === "submitted") expect(html).toContain("An admin checks it next, and only an admin can reopen it for changes.");
    },
  );

  it.each([
    ["reopened", "Make Changes"],
    ["draft", "Continue Inspection"],
  ] as const)("sends the inspector on with their %s inspection", async (status, action) => {
    const html = await render(
      reviewData({
        viewer: { id: INSPECTOR_ID, name: "Inspector A", role: "inspector" },
        inspection: reviewInspection({ status }),
      }),
    );
    expect(html).toMatch(new RegExp(`<a[^>]*href="/inspections/${INSPECTION_ID}"[^>]*>(?:(?!</a>).)*${action}</a>`));
    expect(link(html, "Open Inspection")).toBe(false);
  });

  it("keeps the status apart from the client and product when read out", async () => {
    const html = await render(reviewData());
    // As textContent reads it: tags dropped without adding spaces.
    const plain = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(plain).toContain("Submitted Client A · Product A");
  });

  it("lays out every part of the review in order, the AI second opinion after the result", async () => {
    const html = await render(reviewData());
    const order = ["review-status", "inspection-facts", 'id="result"', 'data-testid="ai-panel"', 'id="modules"', 'id="photos"', 'id="history"'].map(
      (marker) => html.indexOf(marker),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Inside the shell: no <main> of its own.
    expect(html).not.toContain("<main");
  });

  it("reads the AI panel as the signed-in user, and shows the three columns with the AI report", async () => {
    const html = await render(reviewData());
    expect(loadAiPanel).toHaveBeenCalledWith(ADMIN_USER, INSPECTION_ID);
    expect(html).toContain('data-testid="ai-comparison"');
    for (const column of ["System (Computed)", "Inspector", "AI Second Opinion"]) expect(html).toContain(column);
    expect(html).toContain('data-testid="ai-report"');
    expect(link(html, "Download JSON")).toBe(true);
  });

  it("says when the AI panel could not be loaded, and leaves the rest of the review in place", async () => {
    vi.mocked(loadAiPanel).mockResolvedValue({ ok: false, reason: "unavailable", message: "Could not read the AI reviews. Try again." });
    const html = await render(reviewData());
    expect(html).toContain('data-testid="ai-panel-unavailable"');
    expect(html).toContain("The AI panel could not be loaded");
    expect(html).toContain("Could not read the AI reviews. Try again.");
    expect(html).toContain('id="modules"');
  });

  it("says quietly that the AI hand-offs need the results when they cannot be worked out, and leaves the cause to the review", async () => {
    const cause =
      "The template version this inspection uses could not be read, so its results cannot be worked out. Ask a developer to check the template.";
    vi.mocked(loadAiPanel).mockResolvedValue({
      ok: false,
      reason: "unreadable",
      message: "Inspection INS-2026-0001 uses TEST_EG version 2, which could not be read.",
    });
    const html = await render(reviewData({ evaluation: { ok: false, problem: "template", message: cause } }));

    // In the AI panel's place, under its heading.
    const start = html.indexOf('data-testid="ai-panel-no-results"');
    expect(start).toBeGreaterThan(html.indexOf('id="result"'));
    expect(start).toBeLessThan(html.indexOf('id="modules"'));
    const ai = html.slice(start, html.indexOf("</section>", start));
    expect(ai).toContain("AI Second Opinion");
    expect(ai).toContain("Not Available");
    expect(ai).toContain("The second opinion and the AI report need this inspection&#x27;s results, which could not be worked out.");
    // Not-done slate, not fail red: the review's checks and module results give the cause, and only they do.
    expect(ai).not.toMatch(/fail/);
    expect(html).not.toContain("The AI panel could not be loaded");
    expect(html).not.toContain("which could not be read.");
    expect(html.split(cause)).toHaveLength(3);
    // Nothing to request or download: the export needs the results too.
    expect(link(html, "Download JSON")).toBe(false);
    expect(button(html, "Request AI Second Opinion")).toBe(false);
  });

  it("runs its Server Actions longer than the AI hand-offs may take at the default effort", () => {
    // Claude at high effort (the default) and the report webhook, with a minute to spare for the rest.
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(claudeTimeoutMs(CLAUDE_MAX_TOKENS.high) + 60_000);
    expect(maxDuration * 1000).toBeGreaterThan(REPORT_WEBHOOK_TIMEOUT_MS);
    // The most Vercel allows a function on Pro: a higher value would fail the deployment.
    expect(maxDuration).toBeLessThanOrEqual(800);
  });
});
