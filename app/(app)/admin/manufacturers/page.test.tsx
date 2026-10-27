// The page as the server renders it: the role check comes first, then the
// brands with their companies and factories in one table, its search from the
// address, and the states the live database cannot show on demand (an empty
// list, a brand with no company, a company with no factory).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BrandItem, FactoryItem } from "@/lib/admin/manufacturers";

vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/admin/manufacturers", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/manufacturers")>()),
  loadManufacturerTree: vi.fn(),
}));
vi.mock("./actions", () => ({
  saveBrand: vi.fn(),
  deleteBrand: vi.fn(),
  saveCompany: vi.fn(),
  deleteCompany: vi.fn(),
  saveFactory: vi.fn(),
  deleteFactory: vi.fn(),
}));

import { loadManufacturerTree } from "@/lib/admin/manufacturers";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ManufacturersPage, { generateMetadata } from "./page";

const VERSION = "2026-10-27T07:41:32.592604+00:00";

const factory = (id: string, companyId: string, factoryName: string | null, extra: Partial<FactoryItem> = {}): FactoryItem => ({
  id,
  companyId,
  factoryName,
  address: null,
  country: "Malaysia",
  notes: null,
  updatedAt: VERSION,
  usage: { templates: 0, inspections: 0 },
  ...extra,
});

const HARTALEGA: BrandItem = {
  id: "b-hart",
  name: "Hartalega",
  updatedAt: VERSION,
  companies: [
    {
      id: "c-ngc",
      brandId: "b-hart",
      name: "Hartalega NGC",
      updatedAt: VERSION,
      factories: [factory("f-ngc", "c-ngc", null, { address: "No. 1, Persiaran Tanjung\n43900 Sepang, Selangor" })],
    },
  ],
};
const SRI_TRANG: BrandItem = { id: "b-sri", name: "Sri Trang", updatedAt: VERSION, companies: [] };
const TOP_GLOVE: BrandItem = {
  id: "b-top",
  name: "Top Glove",
  updatedAt: VERSION,
  companies: [
    {
      id: "c-terang",
      brandId: "b-top",
      name: "Terang Nusa Sdn. Bhd.",
      updatedAt: VERSION,
      factories: [
        factory("f-40", "c-terang", "TG-F40", {
          address: "Lot 67330, Lorong Bougainvillae/KU8\n41050 Klang, Selangor",
          usage: { templates: 0, inspections: 11 },
        }),
        factory("f-41", "c-terang", "TG-F41", { country: null }),
      ],
    },
    { id: "c-med", brandId: "b-top", name: "TG Medical Sdn. Bhd.", updatedAt: VERSION, factories: [] },
  ],
};
const BRANDS = [HARTALEGA, SRI_TRANG, TOP_GLOVE];

async function render(brands: BrandItem[], q?: string): Promise<string> {
  vi.mocked(loadManufacturerTree).mockResolvedValue(brands);
  const page = await ManufacturersPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(q === undefined ? {} : { q }),
  } as PageProps<"/admin/manufacturers">);
  return renderToStaticMarkup(page);
}

/** The table's body rows, each as the text of its cells with their row spans. */
function rows(html: string): string[][] {
  const body = html.slice(html.indexOf("<tbody"), html.indexOf("</tbody>"));
  return [...body.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)].map(([, row]) =>
    [...row.matchAll(/<td([^>]*)>([\s\S]*?)<\/td>/g)].map(([, attributes, cell]) => {
      const span = /rowSpan="(\d+)"|rowspan="(\d+)"/.exec(attributes);
      const text = cell
        .replace(/<span class="sr-only">([^<]*)<\/span>/g, "[$1]")
        .replace(/<[^>]+>/g, "")
        .replace(/&#x27;/g, "'")
        .replace(/—/g, "-")
        .trim();
      return span ? `${text} (rows ${span[1] ?? span[2]})` : text;
    }),
  );
}

describe("/admin/manufacturers", () => {
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    vi.mocked(requirePermission).mockImplementation(async () => {
      order.push("requirePermission");
      return { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" } as never;
    });
    vi.mocked(createClient).mockImplementation(async () => {
      order.push("createClient");
      return {} as never;
    });
  });

  it("checks the role's Manufacturers switch before it reads anything", async () => {
    await render(BRANDS);
    expect(requirePermission).toHaveBeenCalledWith("manufacturers");
    expect(order).toEqual(["requirePermission", "createClient"]);
  });

  it("stops at the role check: a role without the switch gets the 404 it throws", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(render(BRANDS)).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(loadManufacturerTree).not.toHaveBeenCalled();
    await expect(generateMetadata()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("names the page only for a role that may see it", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Manufacturers" });
    expect(requirePermission).toHaveBeenCalledWith("manufacturers");
  });

  it("puts each factory on a row under its company and brand, whose cells span their rows", async () => {
    const html = await render(BRANDS);

    expect(html).toContain("Add Brand");
    expect([...html.matchAll(/<th[^>]*>([^<]*)<\/th>/g)].map(([, text]) => text)).toEqual([
      "Brand",
      "Company",
      "Factory",
      "Address",
      "In Use",
    ]);
    expect(rows(html)).toEqual([
      [
        "Hartalega (rows 1)",
        "Hartalega NGC (rows 1)",
        "-[None]",
        "No. 1, Persiaran Tanjung 43900 Sepang, Selangor, Malaysia",
        "Not in use",
      ],
      ["Sri Trang (rows 1)", "Add Company[ to Sri Trang]", "", "", ""],
      [
        "Top Glove (rows 3)",
        "Terang Nusa Sdn. Bhd. (rows 2)",
        "TG-F40",
        "Lot 67330, Lorong Bougainvillae/KU8 41050 Klang, Selangor, Malaysia",
        "11 inspections",
      ],
      ["TG-F41", "-[None]", "Not in use"],
      ["TG Medical Sdn. Bhd. (rows 1)", "Add Factory[ to TG Medical Sdn. Bhd.]", "", ""],
    ]);
    expect(html).toContain("3 factories");
  });

  it("puts each pencil and plus in the cell it acts on, named for what it does", async () => {
    const html = await render(BRANDS);
    const labels = [...html.matchAll(/aria-label="([^"]+)"/g)].map(([, label]) => label.replace(/&#x27;/g, "'"));

    expect(labels).toEqual([
      "Search manufacturers",
      "Edit Hartalega",
      "Add Company to Hartalega",
      "Edit Hartalega NGC",
      "Add Factory to Hartalega NGC",
      "Edit Hartalega NGC's Factory",
      // Sri Trang has no company: its Add Company is the button in the company's cell.
      "Edit Sri Trang",
      "Edit Top Glove",
      "Add Company to Top Glove",
      "Edit Terang Nusa Sdn. Bhd.",
      "Add Factory to Terang Nusa Sdn. Bhd.",
      "Edit TG-F40",
      "Edit TG-F41",
      // TG Medical has no factory: its Add Factory is the button in the factory's cell.
      "Edit TG Medical Sdn. Bhd.",
    ]);
    // No row opens on a click, and no Edit pill sits outside the cells.
    expect(html).not.toContain("cursor-pointer");
    expect(html).not.toContain(">Edit<");
  });

  it("keeps the address to one line, the whole of it on hover, and hides it on touch screens and narrow windows", async () => {
    const html = await render([TOP_GLOVE]);
    expect(html).toContain(
      'title="Lot 67330, Lorong Bougainvillae/KU8 41050 Klang, Selangor, Malaysia"',
    );
    expect(html).toMatch(/<th[^>]*class="[^"]*hidden xl:table-cell[^"]*"[^>]*>Address<\/th>/);
  });

  it("starts with the search from the address: a factory's match keeps just that factory", async () => {
    const html = await render(BRANDS, "tg-f40");
    expect(html).toContain('value="tg-f40"');
    expect(html).toContain("1 of 3 factories");
    expect(rows(html).map((row) => row[0])).toEqual(["Top Glove (rows 1)"]);
    expect(html).not.toContain("Hartalega");
    expect(html).not.toContain("TG-F41");
  });

  it("keeps a brand's whole branch when the search matches the brand", async () => {
    const html = await render(BRANDS, "top glove");
    expect(html).toContain("2 of 3 factories");
    expect(html).toContain("TG-F41");
    expect(html).toContain("TG Medical Sdn. Bhd.");
  });

  it("says when nothing matches", async () => {
    const html = await render(BRANDS, "nitrile");
    expect(html).toContain("No Manufacturers Match “nitrile”");
    expect(html).not.toContain("<table");
  });

  it("invites the first brand when there are none", async () => {
    const html = await render([]);
    expect(html).toContain("No Manufacturers Yet");
    expect(html).toContain("Add Your First Brand");
    expect(html).not.toContain("<table");
  });
});
