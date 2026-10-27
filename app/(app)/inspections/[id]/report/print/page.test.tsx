// The print route as the server renders it: the session first, the export's
// access rule (the inspection's inspector, their lead inspector or an admin;
// anyone else the same 404 as for no inspection), the report at true size
// with its print rules, the bar over it, and the PDF's name (docs/REPORT.md).
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The session's own userCan decides the role's switches from the user requireUser answers.
vi.mock("@/lib/auth/session", async (importOriginal) => ({
  requireUser: vi.fn(),
  userCan: (await importOriginal<typeof import("@/lib/auth/session")>()).userCan,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

import { requireUser } from "@/lib/auth/session";
import { createFakeSupabase, type FakeSupabaseOptions } from "@/lib/export/__fixtures__/fake-supabase";
import { STD_EG_IDS, stdEgObjects, stdEgRecord, stdEgTables } from "@/lib/export/__fixtures__/std-eg";
import type { InspectionRecord } from "@/lib/export/record";
import { createClient } from "@/lib/supabase/server";
import ReportPrintPage, { generateMetadata } from "./page";
import { printCss } from "./_components/print-styles";

type User = Awaited<ReturnType<typeof requireUser>>;

const INSPECTOR: User = { id: STD_EG_IDS.inspector, email: "inspector@test.local", fullName: "Inspector A", role: "inspector" };
const ADMIN: User = { id: "00000000-0000-4000-8000-000000000102", email: "admin@test.local", fullName: "Admin A", role: "admin" };
const OTHER: User = { id: "00000000-0000-4000-8000-000000000103", email: "other@test.local", fullName: "Inspector B", role: "inspector" };
const LEAD: User = { id: "00000000-0000-4000-8000-000000000104", email: "lead@test.local", fullName: "Lead A", role: "inspector", isLead: true };
const OTHER_LEAD: User = { id: "00000000-0000-4000-8000-000000000105", email: "lead2@test.local", fullName: "Lead B", role: "inspector", isLead: true };

/** The STD_EG inspection, its inspector in the team of the lead inspector `leadId`. */
function inTeamOf(leadId: string): InspectionRecord {
  const record = stdEgRecord();
  return { ...record, inspector: record.inspector && { ...record.inspector, leadId } };
}

function signedInAs(user: User, record: InspectionRecord = stdEgRecord(), options: FakeSupabaseOptions = {}) {
  vi.mocked(requireUser).mockResolvedValue(user);
  const fake = createFakeSupabase({ tables: stdEgTables(record), objects: stdEgObjects(record), ...options });
  vi.mocked(createClient).mockResolvedValue(fake.client as Awaited<ReturnType<typeof createClient>>);
  return fake;
}

function props(id: string = STD_EG_IDS.inspection, query: Record<string, string> = {}) {
  return { params: Promise.resolve({ id }), searchParams: Promise.resolve(query) } as PageProps<"/inspections/[id]/report/print">;
}

async function render(id?: string, query?: Record<string, string>): Promise<string> {
  return renderToStaticMarkup(await ReportPrintPage(props(id, query)));
}

beforeEach(() => {
  vi.spyOn(console, "warn").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(requireUser).mockReset();
  vi.mocked(createClient).mockReset();
});

describe("/inspections/[id]/report/print", () => {
  it("checks the session before it reads the inspection, for the title too", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(generateMetadata(props())).rejects.toThrow("NEXT_REDIRECT");
    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("gives the inspector their own inspection's report: every page at true size, numbered", async () => {
    signedInAs(INSPECTOR);
    const html = await render();
    const pages = html.split("<section data-report-page").length - 1;
    expect(pages).toBeGreaterThan(1);
    expect(html).toContain(`data-report-document="true" data-page-size="a4" data-orientation="portrait" data-pages="${pages}"`);
    expect(html).toContain(`Page 1 of ${pages}</p>`);
    expect(html).toContain("w-[210mm] h-[297mm]");
    expect(html).toContain('data-slot="report-conclusion" data-status="pass"');
  });

  it("gives an admin any inspection's report", async () => {
    signedInAs(ADMIN);
    expect(await render()).toContain("data-report-document");
  });

  it("gives the inspector's lead inspector the report, as the export does, and another team's lead the same 404", async () => {
    signedInAs(LEAD, inTeamOf(LEAD.id));
    expect(await render()).toContain("data-report-document");
    expect(await generateMetadata(props())).toEqual({ title: { absolute: "INS-2025-0001 Pre-Shipment Inspection Report" } });
    signedInAs(OTHER_LEAD, inTeamOf(LEAD.id));
    await expect(render()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("answers another inspector with the same 404 as for no inspection, as the export does", async () => {
    signedInAs(OTHER);
    await expect(render()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    await expect(generateMetadata(props())).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    signedInAs(INSPECTOR);
    await expect(render("INS-2025-0001")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    await expect(render("00000000-0000-4000-8000-000000000999")).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  // Roles and permissions (migration 20261027150000): printing is exporting, the role's Export Reports.
  it("answers a role without Export Reports with a 404, before it reads the inspection", async () => {
    signedInAs({ ...ADMIN, grant: { id: "r1", name: "Office Desk", builtIn: null, access: "all", permissions: [] } });
    await expect(render()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(createClient).not.toHaveBeenCalled();
  });

  it("hands an export that cannot be made to the error screen", async () => {
    signedInAs(INSPECTOR, stdEgRecord(), { failQuery: (query) => (query.table === "inspection_photos" ? { message: "timeout" } : null) });
    await expect(render()).rejects.toThrow("Could not read the photos. Try again.");
  });

  it("puts nothing but the pages on paper, one sheet each, at the paper the options choose", async () => {
    signedInAs(INSPECTOR);
    expect(await render()).toContain(`<style data-slot="report-print-styles">${printCss({ width: 210, height: 297 })}</style>`);
    const css = printCss({ width: 210, height: 297 });
    expect(css).toContain("@page { size: 210mm 297mm; margin: 0; }");
    expect(css).toContain("body *:not([data-report-document]):not([data-report-document] *):not(:has([data-report-document])) { display: none !important; }");
    const record = stdEgRecord();
    signedInAs(INSPECTOR, { ...record, data: { ...(record.data as object), report: { pageSize: "letter" } } });
    expect(await render()).toContain("@page { size: 215.9mm 279.4mm; margin: 0; }");
  });

  it("offers Print / Save as PDF and Back over the pages, never printed, opening the dialog itself when asked", async () => {
    signedInAs(INSPECTOR);
    const html = await render();
    expect(html).toMatch(/data-slot="report-print-bar" class="[^"]*print:hidden/);
    expect(html).toMatch(/<h1[^>]*>INS-2025-0001 Report<\/h1>/);
    expect(html).toContain("Print / Save as PDF");
    expect(html).toContain(`href="/inspections/${STD_EG_IDS.inspection}?module=report"`);
    expect(html).not.toContain("data-auto-print");
    expect(await render(STD_EG_IDS.inspection, { print: "1" })).toContain('data-auto-print="true"');
  });

  it("names the page, and so the PDF, by the reference and the report's title", async () => {
    signedInAs(INSPECTOR);
    expect(await generateMetadata(props())).toEqual({ title: { absolute: "INS-2025-0001 Pre-Shipment Inspection Report" } });
  });
});
