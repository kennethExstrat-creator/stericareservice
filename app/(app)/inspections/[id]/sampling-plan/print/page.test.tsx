// The sampling plan's print route as the server renders it (Kenneth, 27
// October 2026): the session is checked first, the export is read through
// the user's own client with the export's rule on top (the inspector or an
// admin), an inspection the user may not read is the same 404 as one that
// does not exist, and the page prints at A4 landscape under its bar.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn(), authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/export")>()),
  buildInspectionExport: vi.fn(),
}));

import { requireUser } from "@/lib/auth/session";
import { buildInspectionExport, type ExportResult } from "@/lib/export";
import { makePlanExport, planData } from "@/lib/sampling-plan/__fixtures__/export";
import type { InspectionExport } from "@/lib/schemas/export";
import { createClient } from "@/lib/supabase/server";
import { PLAN_HAS_WARNINGS, PLAN_NOT_COMPLETE, planNotice } from "./_components/print-bar";
import SamplingPlanPrintPage, { generateMetadata } from "./page";

const INSPECTION = "0b5c7d1e-2f3a-4b5c-8d9e-0f1a2b3c4d5e";
const INSPECTOR = "4f5a6b7c-8d9e-4f0a-9b1c-2d3e4f5a6b7c";
const CLIENT = { from: () => null };

const paramsFor = (id: string) => ({ params: Promise.resolve({ id }) }) as PageProps<"/inspections/[id]/sampling-plan/print">;
const params = paramsFor(INSPECTION);

function exported(doc: InspectionExport = makePlanExport()): ExportResult {
  return { ok: true, export: doc, skipped: [] };
}

async function render(result: ExportResult = exported()): Promise<string> {
  vi.mocked(buildInspectionExport).mockResolvedValue(result);
  return renderToStaticMarkup(await SamplingPlanPrintPage(params));
}

beforeEach(() => {
  vi.mocked(requireUser).mockReset();
  vi.mocked(buildInspectionExport).mockReset();
  vi.mocked(requireUser).mockResolvedValue({ id: INSPECTOR, email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" });
  vi.mocked(createClient).mockResolvedValue(CLIENT as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("/inspections/[id]/sampling-plan/print", () => {
  it("checks the session before it reads the inspection, for the title too", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(generateMetadata(params)).rejects.toThrow("NEXT_REDIRECT");
    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(buildInspectionExport).not.toHaveBeenCalled();
  });

  it("reads the export through the user's own client, which only the inspection's inspector or an admin gets", async () => {
    await render();
    expect(buildInspectionExport).toHaveBeenCalledWith(CLIENT, INSPECTION, { viewer: { id: INSPECTOR, role: "inspector" } });
    vi.mocked(requireUser).mockResolvedValue({ id: "a-admin", email: "admin@test.local", fullName: "Admin", role: "admin" });
    await render();
    expect(vi.mocked(buildInspectionExport).mock.calls.at(-1)?.[2]).toEqual({ viewer: { id: "a-admin", role: "admin" } });
  });

  it("is a 404 for an inspection the user may not read, one that does not exist, or an address that is no inspection", async () => {
    vi.mocked(buildInspectionExport).mockResolvedValue({ ok: false, reason: "not_found", message: "Inspection not found." });
    await expect(generateMetadata(params)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    await expect(render({ ok: false, reason: "not_found", message: "Inspection not found." })).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    vi.mocked(buildInspectionExport).mockClear();
    await expect(SamplingPlanPrintPage(paramsFor("not-an-inspection"))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(buildInspectionExport).not.toHaveBeenCalled();
  });

  it("is a 404 for an inspection with no Sampling Plan step: there is no plan to send", async () => {
    const doc = makePlanExport();
    doc.modules = doc.modules.filter((module) => module.key !== "sampling_plan");
    await expect(render(exported(doc))).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("hands a failed export to the error screen, which offers to try again", async () => {
    await expect(render({ ok: false, reason: "database_error", message: "The inspection could not be loaded." })).rejects.toThrow(
      "The inspection could not be loaded.",
    );
  });

  it("names the PDF after the day in Malaysia and the PO", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    // 20:00 UTC on 26 October is already 27 October in Kuala Lumpur.
    vi.setSystemTime(new Date("2026-10-26T20:00:00Z"));
    vi.mocked(buildInspectionExport).mockResolvedValue(exported());
    expect(await generateMetadata(params)).toEqual({ title: { absolute: "2026-10-27_sampling-plan_PO-0001" } });
  });

  it("prints the plan at A4 landscape under a bar that offers Back and Print / Save as PDF", async () => {
    const html = await render();
    expect(html).toContain("@page { size: A4 landscape; margin: 0; }");
    expect(html).toContain("[data-sampling-plan-page] {");
    const bar = /<div data-slot="sampling-plan-print-bar" class="([^"]*)">([\s\S]*?)<\/div><div class="overflow-x-auto/.exec(html);
    expect(bar?.[1]).toContain("print:hidden");
    expect(bar?.[2]).toContain("<h1");
    expect(bar?.[2]).toContain("INS-2025-0001 Sampling Plan");
    expect(bar?.[2]).toContain(`href="/inspections/${INSPECTION}?module=sampling_plan"`);
    expect(bar?.[2]).toContain("Print / Save as PDF");
    expect(bar?.[2]).not.toContain(PLAN_NOT_COMPLETE);
    // The page itself, one sheet: its band, its table, its footer.
    expect(html.match(/<section data-sampling-plan-page/g)).toHaveLength(1);
    expect(html).toContain("PO-0001 · Inspection 11 April 2025");
    expect(html).toContain("Sampling Plan by Size");
    expect(html).toContain("Computer-generated document. No signature required.");
  });

  it("says so over a plan opened before the step is Done: counts missing, or warnings", async () => {
    const data = planData();
    const missing = makePlanExport({ sampling_plan: { ...data, sizes: { ...data.sizes, M: { ...data.sizes.M, gloves: null } } } });
    const html = await render(exported(missing));
    expect(html).toContain(PLAN_NOT_COMPLETE);
    expect(PLAN_NOT_COMPLETE).toBe("The Sampling Plan is not complete yet: counts not entered print as dashes.");
    // 210 gloves where M's code letter L takes 200: a warning on the step.
    const warned = makePlanExport({ sampling_plan: { ...data, sizes: { ...data.sizes, M: { ...data.sizes.M, gloves: 210 } } } });
    expect(warned.modules.find((module) => module.key === "sampling_plan")?.result.status).toBe("warn");
    const warnedHtml = await render(exported(warned));
    expect(warnedHtml).toContain(PLAN_HAS_WARNINGS);
    expect(warnedHtml).not.toContain(PLAN_NOT_COMPLETE);
    expect(planNotice("info")).toBeNull();
    expect(planNotice("pass")).toBeNull();
    expect(planNotice("fail")).toBe(PLAN_HAS_WARNINGS);
  });
});
