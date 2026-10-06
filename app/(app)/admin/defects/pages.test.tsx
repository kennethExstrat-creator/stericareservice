// The three tabs as the server renders them: the role check before anything
// is named, and the states the shared live database cannot show on demand
// (nothing yet, a template that has not resolved, a draft waiting).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DefectsData, InspectionQueryRow, TemplateRecord } from "@/lib/admin/defects";

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/admin/defects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/defects")>()),
  loadDefectsData: vi.fn(),
}));
vi.mock("./actions", () => ({
  saveDefectCode: vi.fn(),
  setDefectCodeActive: vi.fn(),
  deleteDefectCode: vi.fn(),
  mapDefectLabel: vi.fn(),
}));

import { buildInspectionLabels, loadDefectsData, templateLabels } from "@/lib/admin/defects";
import { requireAdmin } from "@/lib/auth/session";
import LabelMappingPage, { generateMetadata as labelsMetadata } from "./labels/page";
import DefectCodesPage, { generateMetadata as codesMetadata } from "./page";
import UnmappedLabelsPage, { generateMetadata as unmappedMetadata } from "./unmapped/page";

const ADMIN = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };
const props = (searchParams: Record<string, string> = {}) =>
  ({ params: Promise.resolve({}), searchParams: Promise.resolve(searchParams) }) as never;

const code = (value: string, name: string, active = true) => ({
  code: value,
  name,
  description: null,
  active,
  updated_at: "2026-10-06T01:02:03.123456+00:00",
});

const resolved = {
  modules: [
    {
      key: "visual",
      include: true,
      labels: {},
      config: {
        classes: {
          critical: { include: true, aql: 0, defects: [{ code: "embedded_insect", label: "Embedded Insects" }] },
          // Left to the client, as the visual module's default config does.
          major: {
            include: true,
            aql: null,
            defects: [
              { code: "stain", label: "Oil stain" },
              { code: "torn_cuff", label: "Torn cuff" },
            ],
          },
          minor: { include: false, aql: 4, defects: [] },
        },
      },
    },
  ],
};

const template = (overrides: Partial<TemplateRecord> = {}): TemplateRecord => ({
  id: "template-1",
  code: "STD_EG",
  version: 2,
  status: "active",
  name: "Standard examination gloves",
  labels: templateLabels(resolved),
  definition: {},
  resolved,
  ...overrides,
});

const row = (id: string, status: InspectionQueryRow["status"]): InspectionQueryRow => ({
  id,
  ref_no: `INS-2026-${id.slice(-4)}`,
  status,
  inspection_date: "2026-10-06",
  template_id: "template-1",
  inspector: { full_name: "Ivy Inspector", email: "inspector@test.local" },
  visual: { sizes: { M: { major: { counts: {}, unmapped: [{ label: "Pinhole near thumb", count: 2 }] } } } },
  watertight: null,
});

function data(overrides: Partial<DefectsData> = {}): DefectsData {
  const codes = [code("embedded_insect", "Embedded insect"), code("stain", "Stain"), code("old_code", "Old code", false)];
  const templates = [template()];
  const inspections = buildInspectionLabels(
    [row("00000000-0000-4000-8000-000000000001", "submitted"), row("00000000-0000-4000-8000-000000000002", "draft")],
    { codes, templates },
  );
  return { codes, templates, inspections, ...overrides };
}

async function render(page: Promise<React.ReactElement>): Promise<string> {
  return renderToStaticMarkup(await page);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireAdmin).mockResolvedValue(ADMIN);
  vi.mocked(loadDefectsData).mockResolvedValue(data());
});

describe("the titles", () => {
  const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

  it.each([
    ["Defect codes", codesMetadata],
    ["Label mapping", labelsMetadata],
    ["Unmapped labels", unmappedMetadata],
  ])("names %s only for an admin", async (title, generate) => {
    expect(await generate()).toEqual({ title });
    expect(requireAdmin).toHaveBeenCalledOnce();

    // Next resolves metadata apart from the page: a static title would still name it on an inspector's 404.
    vi.mocked(requireAdmin).mockRejectedValue(notFound);
    await expect(generate()).rejects.toBe(notFound);
  });

  it.each([
    ["codes", () => DefectCodesPage(props())],
    ["labels", () => LabelMappingPage(props())],
    ["unmapped", () => UnmappedLabelsPage()],
  ])("the %s tab checks for an admin before loading anything", async (_tab, run) => {
    vi.mocked(requireAdmin).mockRejectedValue(notFound);
    await expect(run()).rejects.toBe(notFound);
    expect(loadDefectsData).not.toHaveBeenCalled();
  });
});

describe("the tab row", () => {
  it("marks the current tab and counts what waits for an admin", async () => {
    const html = await render(DefectCodesPage(props()));
    expect(html).toMatch(/<a [^>]*aria-current="page"[^>]*data-tab="codes"/);
    expect(html).not.toMatch(/aria-current="page"[^>]*data-tab="labels"/);
    // 3 codes; 1 template label without a code (torn_cuff); 1 one-off label on the submitted
    // inspection (the draft's is still the inspector's).
    expect(html).toContain("<span class=\"sr-only\">, 3 codes</span>");
    expect(html).toContain("<span class=\"sr-only\">, 1 label needs attention</span>");
    expect(html).toContain("<span class=\"sr-only\">, 1 waiting for a code</span>");
  });

  it("shows no warning count when nothing waits", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ templates: [], inspections: [] }));
    const html = await render(LabelMappingPage(props()));
    expect(html).toMatch(/aria-current="page"[^>]*data-tab="labels"/);
    expect(html).not.toContain("attention");
    expect(html).not.toContain("waiting for a code");
  });
});

describe("/admin/defects", () => {
  it("lists active codes first, each with the templates that use it", async () => {
    const html = await render(DefectCodesPage(props()));
    const order = ["embedded_insect", "stain", "old_code"].map((value) => html.indexOf(`data-code="${value}"`));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(html).toContain("STD_EG");
    expect(html).toContain("3 codes, 1 inactive");
  });

  it("keeps a search from the address", async () => {
    const html = await render(DefectCodesPage(props({ q: "stain" })));
    expect(html).toContain('value="stain"');
    expect(html).toContain("1 of 3 codes");
    expect(html).not.toContain('data-code="old_code"');
  });

  it("invites the first code when there is none", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ codes: [], templates: [], inspections: [] }));
    const html = await render(DefectCodesPage(props()));
    expect(html).toContain("No defect codes yet");
    expect(html).toContain("Add your first code");
  });
});

describe("/admin/defects/labels", () => {
  it("shows each label with its code and class, and flags a label without a code", async () => {
    const html = await render(LabelMappingPage(props()));
    expect(html).toContain("STD_EG <span");
    expect(html).toContain("Critical defects");
    expect(html).toContain("AQL 0.0");
    expect(html).toContain("AQL from the client, else 2.5");
    expect(html).toContain("Oil stain");
    expect(html).toContain("Not a defect code");
    expect(html).toContain('href="/admin/defects?add=torn_cuff&amp;name=Torn+cuff"');
    expect(html).toContain('href="/admin/templates/template-1/edit"');
    expect(html).toContain("Switched off in this template: minor defects.");
    expect(html).toContain("1 label needs attention");
  });

  it("says when a version has not resolved", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ templates: [template({ labels: null, resolved: null, status: "draft" })] }));
    const html = await render(LabelMappingPage(props()));
    expect(html).toContain("This version has not resolved yet");
  });

  it("points to the template editor when there are no templates", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ templates: [] }));
    const html = await render(LabelMappingPage(props()));
    expect(html).toContain("No templates yet");
    expect(html).toContain('href="/admin/templates"');
  });
});

describe("/admin/defects/unmapped", () => {
  it("lists the submitted inspection first, with Map, and the draft waiting", async () => {
    const html = await render(UnmappedLabelsPage());
    const submitted = html.indexOf('data-ref="INS-2026-0001"');
    const draft = html.indexOf('data-ref="INS-2026-0002"');
    expect(submitted).toBeGreaterThan(-1);
    expect(draft).toBeGreaterThan(submitted);
    expect(html.slice(submitted, draft)).toContain("Map “Pinhole near thumb” on INS-2026-0001");
    expect(html.slice(draft)).not.toContain("Map “");
    expect(html.slice(draft)).toContain("A draft: the inspector may still change these labels.");
    expect(html).toContain('href="/inspections/00000000-0000-4000-8000-000000000001/review"');
    expect(html).toContain("STD_EG v2 · 6 Oct 2026 · Ivy Inspector");
  });

  it("shows a label counted in several sizes once, with each size's count and the total", async () => {
    const twoSizes: InspectionQueryRow = {
      ...row("00000000-0000-4000-8000-000000000003", "submitted"),
      visual: {
        sizes: {
          L: { major: { counts: {}, unmapped: [{ label: "pinhole  near thumb", count: 2 }] } },
          M: { major: { counts: {}, unmapped: [{ label: "Pinhole near thumb", count: 1 }] } },
        },
      },
    };
    const codes = [code("stain", "Stain")];
    vi.mocked(loadDefectsData).mockResolvedValue(
      data({ codes, inspections: buildInspectionLabels([twoSizes], { codes, templates: [template()] }) }),
    );
    const html = await render(UnmappedLabelsPage());
    const text = html.replace(/<!-- -->/g, "").replace(/<[^>]+>/g, "|");
    expect(html.match(/Map “Pinhole near thumb”/g)).toHaveLength(1);
    expect(text).toContain("|Size M: |1|");
    expect(text).toContain("|Size L: |2|");
    expect(text).toContain("|3 found in all|");
    expect(text.indexOf("Size M")).toBeLessThan(text.indexOf("Size L"));
  });

  it("says when nothing waits", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ inspections: [] }));
    expect(await render(UnmappedLabelsPage())).toContain("No unmapped labels");
  });
});
