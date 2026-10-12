// /admin/ai as the server renders it: the role check before anything, the
// view the address names (?view=, unknown → General), and each view's cards.
// Steri-AI Cost loads its own data (an async server component), so it is
// rendered with prerender, which waits for it.
import { renderToStaticMarkup } from "react-dom/server";
import { prerender } from "react-dom/static";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_AI_PRICES } from "@/lib/schemas/ai-prices";
import type { AiSettingsView } from "@/lib/schemas/ai-settings";

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/ai/settings", () => ({ readAiSettingsView: vi.fn(), loadAiPrices: vi.fn() }));
vi.mock("@/lib/ai/cost-report", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/ai/cost-report")>()),
  loadAiCostReport: vi.fn(),
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn(async () => ({})) }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminClientConfigured: () => true }));
vi.mock("./actions", () => ({
  saveApiKeyAction: vi.fn(),
  removeAiKeyAction: vi.fn(),
  testAiConnectionAction: vi.fn(),
  saveInspectionSettingsAction: vi.fn(),
  saveAiPricesAction: vi.fn(),
}));
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

import { buildAiCostReport, loadAiCostReport } from "@/lib/ai/cost-report";
import { loadAiPrices, readAiSettingsView } from "@/lib/ai/settings";
import { requireAdmin } from "@/lib/auth/session";
import { aiViewHref, parseAiViewState } from "./_components/view-state";
import AiSettingsPage, { generateMetadata } from "./page";

const ADMIN = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };

const VIEW = {
  key: { source: "saved", hint: "AbCd" },
  documentModel: "claude-opus-5-5",
  reviewModel: "claude-sonnet-5-5",
  reviewEffort: "medium",
  reviewMaxPhotos: 4,
  reviewProvider: "claude",
  updatedAt: "2026-10-12T06:05:00Z",
  updatedBy: "Test Admin",
  storage: "ready",
} as AiSettingsView;

const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

const props = (searchParams: Record<string, string | string[]> = {}) =>
  ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }) as never;

async function render(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  return renderToStaticMarkup(await AiSettingsPage(props(searchParams)));
}

/** The page with its async parts (Steri-AI Cost) rendered too. */
async function renderAll(searchParams: Record<string, string | string[]> = {}): Promise<string> {
  const { prelude } = await prerender(await AiSettingsPage(props(searchParams)));
  return new Response(prelude).text();
}

/** A month of Steri-AI use: one second opinion on one inspection. */
const REPORT = buildAiCostReport({
  period: "90",
  now: new Date("2026-10-13T05:00:00Z"),
  trackingSince: "2026-10-01T02:00:00Z",
  summary: [
    {
      feature: "second_opinion",
      model: "claude-opus-5-5",
      calls: 1,
      failed: 0,
      unpriced: 0,
      units: 1,
      input_tokens: 20_000,
      output_tokens: 4_000,
      cache_write_tokens: 0,
      cache_read_tokens: 3_000,
      cost_usd: 0.1606,
      unlinked_cost_usd: 0,
    },
  ],
  trend: [{ bucket_start: "2026-10-12", feature: "second_opinion", calls: 1, cost_usd: 0.1606 }],
  inspections: [
    {
      inspection_id: "00000000-0000-4000-8000-000000000001",
      ref_no: "INS-2026-0001",
      po_no: "PO-1",
      inspection_date: "2026-10-12",
      status: "submitted",
      documents: 0,
      media_items: 0,
      reviews: 1,
      calls: 1,
      cost_usd: 0.1606,
      inspection_count: 1,
    },
  ],
});

const MYR_PRICES = { ...DEFAULT_AI_PRICES, myrPerUsd: 4.72, myrRateOn: "2026-10-01" };

/** The words on the pill the switch has chosen. */
function chosenView(html: string): string | undefined {
  return html.match(/<button[^>]*aria-checked="true"[^>]*>[\s\S]*?<\/button>/)?.[0].replace(/<[^>]+>/g, "");
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(readAiSettingsView).mockResolvedValue(VIEW);
  vi.mocked(loadAiPrices).mockResolvedValue(DEFAULT_AI_PRICES);
  vi.mocked(loadAiCostReport).mockResolvedValue({ ok: true, report: REPORT });
});

describe("the role check", () => {
  it("names the page only for an admin", async () => {
    expect(await generateMetadata()).toEqual({ title: "Steri-AI Settings" });
    vi.mocked(requireAdmin).mockRejectedValue(notFound);
    await expect(generateMetadata()).rejects.toBe(notFound);
  });

  it.each<Record<string, string>>([{}, { view: "inspection" }, { view: "cost" }])("checks for an admin before reading anything (%o)", async (searchParams) => {
    vi.mocked(requireAdmin).mockRejectedValue(notFound);
    await expect(render(searchParams)).rejects.toBe(notFound);
    expect(readAiSettingsView).not.toHaveBeenCalled();
    expect(loadAiPrices).not.toHaveBeenCalled();
    expect(loadAiCostReport).not.toHaveBeenCalled();
  });

  it("reads the settings only after the check", async () => {
    await render();
    expect(vi.mocked(requireAdmin).mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(readAiSettingsView).mock.invocationCallOrder[0]);
  });
});

describe("the address", () => {
  it.each([
    [{}, { view: "general" }],
    [{ view: "general" }, { view: "general" }],
    [{ view: "inspection" }, { view: "inspection" }],
    [{ view: "Settings" }, { view: "general" }],
    [{ view: ["inspection", "cost"] }, { view: "inspection" }],
    [{ view: "cost" }, { view: "cost", period: "30", currency: "usd" }],
    [{ view: "cost", period: "7", currency: "myr" }, { view: "cost", period: "7", currency: "myr" }],
    [{ view: "cost", period: "365", currency: "eur" }, { view: "cost", period: "30", currency: "usd" }],
    [{ view: "inspection", period: "7" }, { view: "inspection" }],
  ])("reads %o as %o", (params, state) => {
    expect(parseAiViewState(params)).toEqual(state);
  });

  it("writes each view's address, leaving the defaults out", () => {
    expect(aiViewHref({ view: "general" })).toBe("/admin/ai");
    expect(aiViewHref({ view: "inspection" })).toBe("/admin/ai?view=inspection");
    expect(aiViewHref({ view: "cost", period: "30", currency: "usd" })).toBe("/admin/ai?view=cost");
    expect(aiViewHref({ view: "cost", period: "all", currency: "myr" })).toBe("/admin/ai?view=cost&period=all&currency=myr");
  });
});

describe("the views", () => {
  it("opens on General: the key and the connection test, over the shell's full width", async () => {
    const html = await render();
    expect(chosenView(html)).toBe("General");
    expect(html).toContain('data-testid="ai-general"');
    expect(html).toContain("Anthropic API Key");
    expect(html).toContain("In use: sk-ant-…AbCd. Last changed 12 Oct 2026, 14:05 by Test Admin.");
    expect(html).toContain("Replace the Key");
    expect(html).toContain("Remove Saved Key");
    expect(html).toContain("Save Key");
    expect(html).toContain("Checks the key with the models in Inspection Settings. Nothing is billed.");
    expect(html).toContain("Test Connection");
    // The models are Inspection Settings' and the shortforms Admin > Defects'; Save Key sends the key alone.
    expect(html).not.toContain("Reading Documents");
    expect(html).not.toContain("Shortforms");
    expect(html).not.toContain('name="documentModel"');
    expect(html).not.toContain('name="reviewModel"');
    expect(html).not.toContain("max-w-3xl");
    expect(loadAiPrices).not.toHaveBeenCalled();
  });

  it("opens General for a view it does not know", async () => {
    const html = await render({ view: "glossary" });
    expect(chosenView(html)).toBe("General");
    expect(html).toContain('data-testid="ai-general"');
  });

  it("offers no removal while the key comes from the server", async () => {
    vi.mocked(readAiSettingsView).mockResolvedValue({ ...VIEW, key: { source: "environment" } });
    const html = await render();
    expect(html).toContain("In use: the ANTHROPIC_API_KEY set on the server.");
    expect(html).toContain(">API Key</label>");
    expect(html).not.toContain("Remove Saved Key");
  });

  it("shows Inspection Settings: a model per job, the second opinion's effort and photos, and where the shortforms went", async () => {
    const html = await render({ view: "inspection" });
    expect(chosenView(html)).toBe("Inspection Settings");
    expect(html).toContain('data-testid="ai-inspection-settings"');
    expect(html).toContain("Reading Documents");
    expect(html).toContain("For New Inspection, Source Documents and Auto-Sort. Most capable. Slower, highest cost.");
    expect(html).toContain("Second Opinion");
    expect(html).toContain("For Steri-AI&#x27;s review of an inspection. Fast and capable, lower cost.");
    expect(html).toContain(">Effort</label>");
    expect(html).toContain('name="reviewEffort" value="medium"');
    expect(html).toContain("Higher effort thinks longer and costs more.");
    expect(html).toContain(">Photos per Review</label>");
    expect(html).toMatch(/name="reviewMaxPhotos"[^>]*value="4"/);
    expect(html).toContain("Each photo adds to the cost.");
    expect(html).toMatch(/Shortforms moved to <a [^>]*href="\/admin\/defects\/shortforms"[^>]*>Defects &gt; Shortforms<\/a>\./);
    expect(html).not.toContain("Anthropic API Key");
    // Claude reviews, and both models have a price.
    expect(html).not.toContain('data-testid="ai-review-provider"');
    expect(html).not.toContain("No price for this model yet");
  });

  it("says which chosen model has no price, linking to the price list", async () => {
    vi.mocked(readAiSettingsView).mockResolvedValue({ ...VIEW, reviewModel: "claude-opus-4-8" });
    const html = await render({ view: "inspection" });
    expect(html.match(/No price for this model yet/g)).toHaveLength(1);
    expect(html).toMatch(/add it under <a [^>]*href="\/admin\/ai\?view=cost#price-list"[^>]*>Steri-AI Cost<\/a>\./);
  });

  it("tells the truth about the server's settings: another reviewer, or an effort only the server sets", async () => {
    vi.mocked(readAiSettingsView).mockResolvedValue({ ...VIEW, reviewProvider: "webhook", reviewEffort: "xhigh" });
    const html = await render({ view: "inspection" });
    expect(html).toContain("Second opinions come from the review webhook (a server setting), so these are not used.");
    // Kept, never saved over: the picker posts "server".
    expect(html).toContain('name="reviewEffort" value="server"');
    vi.mocked(readAiSettingsView).mockResolvedValue({ ...VIEW, reviewProvider: "off" });
    expect(await render({ view: "inspection" })).toContain("Second opinions are switched off on the server.");
    // No key yet is General's to say.
    vi.mocked(readAiSettingsView).mockResolvedValue({ ...VIEW, reviewProvider: "none" });
    expect(await render({ view: "inspection" })).not.toContain('data-testid="ai-review-provider"');
  });

  it("says why nothing can be saved without the server's secret key", async () => {
    vi.mocked(readAiSettingsView).mockResolvedValue({ ...VIEW, storage: "no_secret_key" });
    const html = await render({ view: "inspection" });
    expect(html).toContain("The server needs SUPABASE_SECRET_KEY before Steri-AI settings can be saved here.");
    expect(html).toContain('type="submit" disabled=""');
  });

  it("shows Steri-AI Cost with the address's filters, reading none of the settings", async () => {
    vi.mocked(loadAiPrices).mockResolvedValue(MYR_PRICES);
    const html = await renderAll({ view: "cost", period: "90", currency: "myr" });
    expect(chosenView(html)).toBe("Steri-AI Cost");
    expect(html).toMatch(/data-testid="ai-cost" data-period="90" data-currency="myr"/);
    expect(vi.mocked(loadAiCostReport).mock.calls[0]?.[1]).toBe("90");
    expect(readAiSettingsView).not.toHaveBeenCalled();
    for (const part of ["cost-filters", "cost-kpis", "cost-trend", "cost-by-job", "cost-by-model", "cost-by-inspection", "price-list"]) {
      expect(html).toContain(`data-testid="${part}"`);
    }
    expect(html).toContain('aria-label="Currency"');
    expect(html).toContain("RM 0.76"); // 0.1606 USD at 4.72
    expect(html).toContain("Estimated from token use; Anthropic&#x27;s bill is final. Counted since 1 Oct 2026.");
  });

  it("shows dollars while the price list has no MYR rate, whatever the address says", async () => {
    const html = await renderAll({ view: "cost", period: "90", currency: "myr" });
    expect(html).toMatch(/data-testid="ai-cost" data-period="90" data-currency="usd"/);
    expect(html).not.toContain('aria-label="Currency"');
    expect(html).toContain("$0.16");
    expect(html).not.toContain("RM ");
  });

  it("says when nothing is recorded yet, the price list still below", async () => {
    vi.mocked(loadAiCostReport).mockResolvedValue({ ok: true, report: { ...REPORT, trackingSince: null } });
    const html = await renderAll({ view: "cost" });
    expect(html).toContain("No Steri-AI Costs Yet");
    expect(html).not.toContain('data-testid="cost-kpis"');
    expect(html).toContain('data-testid="price-list"');
  });

  it("says when the costs could not be loaded", async () => {
    vi.mocked(loadAiCostReport).mockResolvedValue({ ok: false, message: "The costs could not be loaded. Reload the page to try again." });
    const html = await renderAll({ view: "cost" });
    expect(html).toContain("The costs could not be loaded. Reload the page to try again.");
    expect(html).toContain('data-testid="price-list"');
  });
});
