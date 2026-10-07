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
    expect(link(html, "Open inspection")).toBe(true);
    expect(html).toContain("Waiting for your review");
  });

  it.each(["approved", "reopened", "draft"] as const)("gives an admin no decision on a %s inspection", async (status) => {
    const html = await render(reviewData({ inspection: reviewInspection({ status }) }));
    expect(button(html, "Approve")).toBe(false);
    expect(button(html, "Reopen")).toBe(false);
    expect(link(html, "Open inspection")).toBe(true);
  });

  it("shows the inspector their submitted inspection read-only", async () => {
    const html = await render(reviewData({ viewer: { id: INSPECTOR_ID, name: "Inspector A", role: "inspector" } }));
    expect(button(html, "Approve")).toBe(false);
    expect(button(html, "Reopen")).toBe(false);
    expect(link(html, "Open inspection")).toBe(true);
    expect(html).toContain("Waiting for review");
  });

  it.each([
    ["reopened", "Make changes"],
    ["draft", "Continue inspection"],
  ] as const)("sends the inspector on with their %s inspection", async (status, action) => {
    const html = await render(
      reviewData({
        viewer: { id: INSPECTOR_ID, name: "Inspector A", role: "inspector" },
        inspection: reviewInspection({ status }),
      }),
    );
    expect(html).toMatch(new RegExp(`<a[^>]*href="/inspections/${INSPECTION_ID}"[^>]*>(?:(?!</a>).)*${action}</a>`));
    expect(link(html, "Open inspection")).toBe(false);
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
    for (const column of ["System (computed)", "Inspector", "AI second opinion"]) expect(html).toContain(column);
    expect(html).toContain('data-testid="ai-report"');
    expect(link(html, "Download JSON")).toBe(true);
  });

  it("says when the AI panel could not be loaded, and leaves the rest of the review in place", async () => {
    vi.mocked(loadAiPanel).mockResolvedValue({ ok: false, reason: "unavailable", message: "Could not read the AI reviews. Try again." });
    const html = await render(reviewData());
    expect(html).toContain("The AI panel could not be loaded");
    expect(html).toContain("Could not read the AI reviews. Try again.");
    expect(html).toContain('id="modules"');
  });

  it("runs its Server Actions longer than the AI hand-offs may take at the default effort", () => {
    // Claude at high effort (the default) and the report webhook, with a minute to spare for the rest.
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(claudeTimeoutMs(CLAUDE_MAX_TOKENS.high) + 60_000);
    expect(maxDuration * 1000).toBeGreaterThan(REPORT_WEBHOOK_TIMEOUT_MS);
    // The most Vercel allows a function on Pro: a higher value would fail the deployment.
    expect(maxDuration).toBeLessThanOrEqual(800);
  });
});
