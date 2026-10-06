// The page's own decisions, rendered on the server: who gets which actions,
// the title, and the 404 for anything the user may not see.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/inspections/review/load", () => ({ loadReview: vi.fn() }));
vi.mock("@/lib/inspections/review/actions", () => ({ approveInspection: vi.fn(), reopenInspection: vi.fn() }));

import { requireUser } from "@/lib/auth/session";
import { ADMIN_ID, INSPECTION_ID, INSPECTOR_ID, reviewData, reviewInspection } from "@/lib/inspections/review/__fixtures__/review";
import { loadReview, type ReviewData } from "@/lib/inspections/review/load";
import { createClient } from "@/lib/supabase/server";
import InspectionReviewPage, { generateMetadata } from "./page";

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

  it("lays out every part of the review in order, the AI's slot after the result", async () => {
    const html = await render(reviewData());
    const order = ["review-status", "inspection-facts", 'id="result"', 'data-slot="ai-panel"', 'id="modules"', 'id="photos"', 'id="history"'].map(
      (marker) => html.indexOf(marker),
    );
    expect(order.every((position) => position >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Inside the shell: no <main> of its own.
    expect(html).not.toContain("<main");
  });
});
