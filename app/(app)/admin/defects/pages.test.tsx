// The four tabs as the server renders them: the role check before anything
// is named, and the states the shared live database cannot show on demand
// (nothing yet, a template that has not resolved, a draft waiting, no
// secret key for the shortforms).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DefectsData, InspectionQueryRow, TemplateRecord } from "@/lib/admin/defects";
import type { GlossaryState } from "@/lib/ai/settings";
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";

vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn().mockResolvedValue({}) }));
vi.mock("@/lib/admin/defects", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/defects")>()),
  loadDefectsData: vi.fn(),
}));
vi.mock("@/lib/ai/settings", () => ({ loadGlossaryState: vi.fn() }));
vi.mock("./actions", () => ({
  saveDefectCode: vi.fn(),
  setDefectCodeActive: vi.fn(),
  deleteDefectCode: vi.fn(),
  mapDefectLabel: vi.fn(),
  saveShortform: vi.fn(),
  deleteShortform: vi.fn(),
}));

import { z } from "zod";
import { buildInspectionLabels, loadDefectsData, templateLabels } from "@/lib/admin/defects";
import { loadGlossaryState } from "@/lib/ai/settings";
import { requirePermission } from "@/lib/auth/session";
import type { ModuleRegistry } from "@/modules/_framework/contract";
import { MODULE_REGISTRY } from "@/modules/registry";
import LabelMappingPage, { generateMetadata as labelsMetadata } from "./labels/page";
import DefectCodesPage, { generateMetadata as codesMetadata } from "./page";
import ShortformsPage, { generateMetadata as shortformsMetadata } from "./shortforms/page";
import UnmappedLabelsPage, { generateMetadata as unmappedMetadata } from "./unmapped/page";

/** The registry with a stand-in order module that orders each size with a quantity, as order_lots does. */
const registry: ModuleRegistry = {
  ...MODULE_REGISTRY,
  order_lots: {
    ...MODULE_REGISTRY.order_lots,
    dataSchema: z.unknown(),
    configSchema: z.unknown(),
    contribute: ({ data }) => ({
      sizes: Object.entries((data as { sizes?: Record<string, { qtyCases?: number }> } | undefined)?.sizes ?? {})
        .filter(([, line]) => (line.qtyCases ?? 0) > 0)
        .map(([size]) => size),
    }),
  },
};

/** Sizes M and L ordered. */
const ORDER = { sizes: { M: { qtyCases: 10, lotNumbers: [], packingSite: null }, L: { qtyCases: 5, lotNumbers: [], packingSite: null } } };

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

/** As `templates.resolved` holds a version. */
const resolved = {
  format: 2,
  code: "STD_EG",
  name: "Standard examination gloves",
  chain: ["STD_EG"],
  bases: [],
  scope: { productType: "examination", standard: "EN455" },
  unit: "pcs",
  sizes: [
    { value: "M", label: "M" },
    { value: "L", label: "L" },
  ],
  customModules: [],
  report: { title: "Report", showClientLogo: false },
  sourceFile: null,
  modules: [
    { key: "header", include: true, title: "Header", labels: {}, config: {} },
    { key: "order_lots", include: true, title: "Order", labels: {}, config: {} },
    {
      key: "visual",
      include: true,
      title: "Visual Inspection",
      labels: {},
      config: {
        handSplit: false,
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
    { key: "conclusion", include: true, title: "Conclusion", labels: {}, config: {} },
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
  module_overrides: {},
  inspector: { full_name: "Ivy Inspector", email: "inspector@test.local" },
  order_lots: ORDER,
  visual: { sizes: { M: { major: { counts: {}, unmapped: [{ label: "Pinhole near thumb", count: 2 }] } } } },
  watertight: null,
});

function data(overrides: Partial<DefectsData> = {}): DefectsData {
  const codes = [code("embedded_insect", "Embedded insect"), code("stain", "Stain"), code("old_code", "Old code", false)];
  const templates = [template()];
  const inspections = buildInspectionLabels(
    [row("00000000-0000-4000-8000-000000000001", "submitted"), row("00000000-0000-4000-8000-000000000002", "draft")],
    { codes, templates, registry },
  );
  return { codes, templates, inspections, ...overrides };
}

const defect = (short: string, codes: string[], meaning = `${short} meaning`, confirmed = true): GlossaryEntry => ({
  short,
  meaning,
  confirmed,
  kind: "defect",
  codes,
});

/** Linked to an active code, to an active and an inactive one, to none, to a code that is no defect code; and a term. */
const GLOSSARY: GlossaryEntry[] = [
  defect("OS", ["stain"], "Oil Stain when major"),
  defect("EI", ["embedded_insect", "old_code"], "Embedded Insects", false),
  defect("SKV", [], "Skin Visual: a visual defect of the glove skin"),
  defect("ZZ", ["not_a_code"]),
  { short: "WTT", meaning: "Watertight test", confirmed: true, kind: "term", codes: [] },
];

function glossary(overrides: Partial<GlossaryState> = {}): GlossaryState {
  return { entries: GLOSSARY, legacy: false, storage: "ready", ...overrides };
}

async function render(page: Promise<React.ReactElement>): Promise<string> {
  return renderToStaticMarkup(await page);
}

/** The markup of one table row, found by an attribute such as data-short="OS". */
function rowOf(html: string, attribute: string): string {
  const start = html.indexOf(attribute);
  expect(start, attribute).toBeGreaterThan(-1);
  return html.slice(start, html.indexOf("</tr>", start));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(ADMIN);
  vi.mocked(loadDefectsData).mockResolvedValue(data());
  vi.mocked(loadGlossaryState).mockResolvedValue(glossary());
});

describe("the titles", () => {
  const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

  it.each([
    ["Defect Codes", codesMetadata],
    ["Label Mapping", labelsMetadata],
    ["Unmapped Labels", unmappedMetadata],
    ["Shortforms", shortformsMetadata],
  ])("names %s only for an admin", async (title, generate) => {
    expect(await generate()).toEqual({ title });
    expect(requirePermission).toHaveBeenCalledOnce();

    // Next resolves metadata apart from the page: a static title would still name it on an inspector's 404.
    vi.mocked(requirePermission).mockRejectedValue(notFound);
    await expect(generate()).rejects.toBe(notFound);
  });

  it.each([
    ["codes", () => DefectCodesPage(props())],
    ["labels", () => LabelMappingPage(props())],
    ["unmapped", () => UnmappedLabelsPage()],
    ["shortforms", () => ShortformsPage(props())],
  ])("the %s tab checks for an admin before loading anything", async (_tab, run) => {
    vi.mocked(requirePermission).mockRejectedValue(notFound);
    await expect(run()).rejects.toBe(notFound);
    expect(loadDefectsData).not.toHaveBeenCalled();
    expect(loadGlossaryState).not.toHaveBeenCalled();
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
    // The shortforms, a neutral count like the codes.
    expect(html).toMatch(/<a [^>]*data-tab="shortforms" href="\/admin\/defects\/shortforms"/);
    expect(html).toContain("<span class=\"sr-only\">, 5 shortforms</span>");
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

  it("shows the shortforms that count under each code, and finds a code by them", async () => {
    const html = await render(DefectCodesPage(props()));
    expect(rowOf(html, 'data-code="stain"')).toContain("Shortforms: OS");
    expect(rowOf(html, 'data-code="old_code"')).toContain("Shortforms: EI");
    expect(rowOf(html, 'data-code="embedded_insect"')).toContain("Shortforms: EI");
    const searched = await render(DefectCodesPage(props({ q: "os" })));
    expect(searched).toContain("1 of 3 codes");
    expect(searched).toContain('data-code="stain"');
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
    expect(html).toContain("No Defect Codes Yet");
    expect(html).toContain("Add Your First Code");
  });
});

describe("/admin/defects/labels", () => {
  it("shows each label with its code and class, and flags a label without a code", async () => {
    const html = await render(LabelMappingPage(props()));
    expect(html).toContain("STD_EG <span");
    expect(html).toContain("Critical Defects");
    expect(html).toContain("AQL 0.0");
    expect(html).toContain("AQL from the client, else 2.5");
    expect(html).toContain("Oil stain");
    expect(html).toContain("Not a Defect Code");
    expect(html).toContain('href="/admin/defects?add=torn_cuff&amp;name=Torn+cuff"');
    // Read only: Admin > Templates is gone (Kenneth, 26 October 2026), so no template editor to open.
    expect(html).not.toContain("/admin/templates");
    expect(html).toContain("Switched off in this template: minor defects.");
    expect(html).toContain("1 label needs attention");
  });

  it("says when a version has not resolved", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ templates: [template({ labels: null, resolved: null, status: "draft" })] }));
    const html = await render(LabelMappingPage(props()));
    expect(html).toContain("This version has not resolved yet");
  });

  it("says when there are no templates, with nowhere to go for them", async () => {
    vi.mocked(loadDefectsData).mockResolvedValue(data({ templates: [] }));
    const html = await render(LabelMappingPage(props()));
    expect(html).toContain("No Templates Yet");
    expect(html).not.toContain("/admin/templates");
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
      data({ codes, inspections: buildInspectionLabels([twoSizes], { codes, templates: [template()], registry }) }),
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
    expect(await render(UnmappedLabelsPage())).toContain("No Unmapped Labels");
  });
});

describe("/admin/defects/shortforms", () => {
  it("lists the defects with their codes, then the other terms, each with its status", async () => {
    const html = await render(ShortformsPage(props()));
    expect(html).toMatch(/aria-current="page"[^>]*data-tab="shortforms"/);
    expect(html).toContain("Steri-AI reads every form with this list and counts each defect under its linked code.");
    expect(html).toContain("5 shortforms");

    const defects = html.slice(html.indexOf('data-section="Defects"'), html.indexOf('data-section="Other Terms"'));
    const terms = html.slice(html.indexOf('data-section="Other Terms"'));
    // By shortform; the term in its own section.
    const order = ["EI", "OS", "SKV", "ZZ"].map((short) => defects.indexOf(`data-short="${short}"`));
    expect(order.every((at) => at > -1)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(defects).not.toContain('data-short="WTT"');
    expect(terms).toContain('data-short="WTT"');
    expect(terms).toContain("Not defects: tests, product words and factory codes.");

    // Each code with its name; no code yet; an inactive code; a code that is no defect code.
    expect(rowOf(html, 'data-short="OS"')).toMatch(/Stain .*>stain</);
    expect(rowOf(html, 'data-short="SKV"')).toContain("No Code Yet");
    expect(rowOf(html, 'data-short="EI"')).toContain("Inactive Code");
    expect(rowOf(html, 'data-short="ZZ"')).toContain("Not a Defect Code");
    expect(rowOf(html, 'data-short="OS"')).toContain(">Confirmed<");
    expect(rowOf(html, 'data-short="EI"')).toContain(">Not Confirmed<");
    // Named by the words it shows first (WCAG 2.5.3).
    expect(rowOf(html, 'data-short="OS"')).toContain('aria-label="Edit OS"');
    expect(html).toContain("Add Shortform");
  });

  it("keeps a search from the address", async () => {
    const html = await render(ShortformsPage(props({ q: "embedded" })));
    expect(html).toContain('value="embedded"');
    expect(html).toContain("1 of 5 shortforms");
    expect(html).not.toContain('data-short="OS"');
    expect(html).not.toContain('data-section="Other Terms"');
  });

  it("invites the first shortform when there is none", async () => {
    vi.mocked(loadGlossaryState).mockResolvedValue(glossary({ entries: [] }));
    const html = await render(ShortformsPage(props()));
    expect(html).toContain("No Shortforms Yet");
    expect(html).toContain("Add Your First Shortform");
  });

  it("says the server needs the secret key, and offers no change", async () => {
    vi.mocked(loadGlossaryState).mockResolvedValue(glossary({ storage: "no_secret_key" }));
    const html = await render(ShortformsPage(props()));
    expect(html).toContain("The server needs SUPABASE_SECRET_KEY before shortforms can be saved.");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>(?:(?!<\/button>).)*Add Shortform/);
    expect(rowOf(html, 'data-short="OS"')).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Edit OS"|<button[^>]*aria-label="Edit OS"[^>]*disabled=""/);
  });
});
