// The page's own decisions, rendered on the server: who gets which actions,
// the title, the AI panel in its place, and the 404 for anything the user
// may not see.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The session's own userCan decides the role's switches from the user requireUser answers.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  requireUser: vi.fn(),
}));
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
      allows: { secondOpinion: true, exportReports: true },
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

  it("gives an admin Approve and Reopen on a submitted inspection, and the report to download", async () => {
    const html = await render(reviewData());
    expect(button(html, "Approve")).toBe(true);
    expect(button(html, "Reopen")).toBe(true);
    expect(link(html, "Open Inspection")).toBe(true);
    expect(html).toMatch(new RegExp(`<a[^>]*href="/inspections/${INSPECTION_ID}/report/print\\?print=1"[^>]*>(?:(?!</a>).)*Download PDF</a>`));
    // Once, on the Client Report card: the header has none.
    expect(html.match(/Download PDF<\/a>/g)).toHaveLength(1);
    expect(html).toContain('id="client-report"');
    // The buttons say it waits for them: no notice.
    expect(html).not.toContain("Waiting for Your Review");
    expect(html).not.toContain('id="review-status"');
  });

  it.each(["approved", "reopened", "draft"] as const)("gives an admin no decision on a %s inspection", async (status) => {
    const html = await render(reviewData({ inspection: reviewInspection({ status }) }));
    expect(button(html, "Approve")).toBe(false);
    expect(button(html, "Reopen")).toBe(false);
    expect(link(html, "Open Inspection")).toBe(true);
  });

  // Roles and permissions (migration 20261027150000): a role that sees every inspection but does not approve.
  it("gives no decision to a role without Approve and Reopen, and tells them who decides", async () => {
    vi.mocked(requireUser).mockResolvedValue({
      ...ADMIN_USER,
      grant: { id: "r1", name: "Office Desk", builtIn: null, access: "all", permissions: ["create_inspections"] },
    });
    const html = await render(reviewData());
    expect(button(html, "Approve")).toBe(false);
    expect(button(html, "Reopen")).toBe(false);
    expect(link(html, "Open Inspection")).toBe(true);
    expect(html).toContain("Waiting for Review");
    expect(html).not.toContain("Waiting for Your Review");
  });

  it("shows the inspector their submitted inspection read-only", async () => {
    vi.mocked(requireUser).mockResolvedValue(INSPECTOR_USER);
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
      vi.mocked(requireUser).mockResolvedValue({ ...lead, email: "lead@test.local", fullName: lead.name, isLead: true });
      // The AI panel follows the export's rule (owner or admin): a lead gets nothing.
      vi.mocked(loadAiPanel).mockResolvedValue({ ok: false, reason: "not_found", message: "Inspection not found." });
      const html = await render(
        reviewData({
          viewer: lead,
          inspection: reviewInspection({ status, inspector: { id: INSPECTOR_ID, name: "Inspector A", leadId: lead.id } }),
        }),
      );
      expect(button(html, "Approve")).toBe(false);
      expect(button(html, "Reopen")).toBe(false);
      expect(link(html, "Open Inspection")).toBe(true);
      expect(link(html, "Continue Inspection")).toBe(false);
      expect(link(html, "Make Changes")).toBe(false);
      expect(html).not.toContain('data-testid="ai-panel"');
      // The export's rule: a lead downloads the team's reports (Kenneth, 27 October 2026).
      expect(link(html, "Download PDF")).toBe(true);
      expect(html).toContain('id="client-report"');
      if (status === "submitted") expect(html).toContain("An admin checks it next, and only an admin can reopen it for changes.");
    },
  );

  it("gives no download to a lead inspector on an inspection outside their team", async () => {
    const lead = { id: "00000000-0000-4000-8000-000000000103", name: "Lina Lead", role: "inspector" as const };
    vi.mocked(requireUser).mockResolvedValue({ ...lead, email: "lead@test.local", fullName: lead.name, isLead: true });
    vi.mocked(loadAiPanel).mockResolvedValue({ ok: false, reason: "not_found", message: "Inspection not found." });
    const html = await render(
      reviewData({
        viewer: lead,
        inspection: reviewInspection({ inspector: { id: INSPECTOR_ID, name: "Inspector A", leadId: "00000000-0000-4000-8000-000000000199" } }),
      }),
    );
    expect(link(html, "Download PDF")).toBe(false);
    expect(html).not.toContain('id="client-report"');
  });

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

  it("keeps the status, when it was submitted, and the client and product apart when read out", async () => {
    const html = await render(reviewData());
    // As textContent reads it: tags dropped without adding spaces.
    const plain = html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ");
    expect(plain).toContain("INS-2026-0001 Submitted 5 Oct 2026, 14:30 Client A · Product A");
  });

  it("lays out every part of the review in order (layout A), with an index of them", async () => {
    const html = await render(reviewData());
    const order = [
      'aria-label="On This Page"',
      'id="result"',
      'id="attention"',
      'id="client-report"',
      "inspection-facts",
      'data-testid="ai-panel"',
      'id="modules"',
      'id="photos"',
      'id="history"',
    ].map((marker) => html.indexOf(marker));
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    const index = /<nav aria-label="On This Page"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect([...index.matchAll(/href="#([a-z-]+)"/g)].map((match) => match[1])).toEqual([
      "result",
      "attention",
      "client-report",
      "details",
      "summary",
      "steri-ai",
      "modules",
      "photos",
      "history",
    ]);
    // Inside the shell: no <main> of its own.
    expect(html).not.toContain("<main");
  });

  it("reads the AI panel as the signed-in user, and shows the three columns with the AI report", async () => {
    const html = await render(reviewData());
    expect(loadAiPanel).toHaveBeenCalledWith(ADMIN_USER, INSPECTION_ID);
    expect(html).toContain('data-testid="ai-comparison"');
    for (const column of ["System (Computed)", "Inspector", "Steri-AI Second Opinion"]) expect(html).toContain(column);
    expect(html).toContain('data-testid="ai-report"');
    expect(link(html, "Download JSON")).toBe(true);
  });

  it("says when the AI panel could not be loaded, and leaves the rest of the review in place", async () => {
    vi.mocked(loadAiPanel).mockResolvedValue({ ok: false, reason: "unavailable", message: "Could not read Steri-AI's reviews. Try again." });
    const html = await render(reviewData());
    expect(html).toContain('data-testid="ai-panel-unavailable"');
    expect(html).toContain("Steri-AI Panel Could Not Be Loaded");
    expect(html).toContain("Could not read Steri-AI&#x27;s reviews. Try again.");
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
    expect(ai).toContain("Steri-AI Second Opinion");
    expect(ai).toContain("Not Available");
    expect(ai).toContain("Steri-AI&#x27;s second opinion and report need this inspection&#x27;s results, which could not be worked out.");
    // Not-done slate, not fail red: the review's checks and module results give the cause, and only they do.
    expect(ai).not.toMatch(/fail/);
    expect(html).not.toContain("Steri-AI Panel Could Not Be Loaded");
    expect(html).not.toContain("which could not be read.");
    expect(html.split(cause)).toHaveLength(3);
    // Nothing to request or download: the export needs the results too.
    expect(link(html, "Download JSON")).toBe(false);
    expect(button(html, "Request Steri-AI Second Opinion")).toBe(false);
  });

  it("runs its Server Actions longer than the AI hand-offs may take at the default effort", () => {
    // Claude at high effort (the default) and the report webhook, with a minute to spare for the rest.
    expect(maxDuration * 1000).toBeGreaterThanOrEqual(claudeTimeoutMs(CLAUDE_MAX_TOKENS.high) + 60_000);
    expect(maxDuration * 1000).toBeGreaterThan(REPORT_WEBHOOK_TIMEOUT_MS);
    // The most Vercel allows a function on Pro: a higher value would fail the deployment.
    expect(maxDuration).toBeLessThanOrEqual(800);
  });
});
