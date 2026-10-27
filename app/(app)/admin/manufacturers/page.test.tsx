// The page as the server renders it: the role check comes first, then the
// list, its search from the address, and the states the live database
// cannot show on demand (an empty list).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ManufacturerItem } from "@/lib/admin/reference";

vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/admin/reference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/reference")>()),
  loadManufacturers: vi.fn(),
}));
vi.mock("./actions", () => ({ saveManufacturer: vi.fn(), deleteManufacturer: vi.fn() }));

import { loadManufacturers } from "@/lib/admin/reference";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ManufacturersPage, { generateMetadata } from "./page";

const hartalega: ManufacturerItem = {
  id: "10000000-0000-4000-8000-000000000001",
  name: "Hartalega NGC",
  factoryName: null,
  address: "No. 1, Persiaran Tanjung\n43900 Sepang",
  country: "Malaysia",
  notes: null,
  updatedAt: "2026-10-06T10:45:02.066067+00:00",
  usage: { templates: 2, inspections: 14 },
};
const terang: ManufacturerItem = {
  ...hartalega,
  id: "10000000-0000-4000-8000-000000000002",
  name: "Terang Nusa Sdn. Bhd.",
  factoryName: "TG Factory 40",
  address: null,
  usage: { templates: 0, inspections: 0 },
};

async function render(rows: ManufacturerItem[], q?: string): Promise<string> {
  vi.mocked(loadManufacturers).mockResolvedValue(rows);
  const page = await ManufacturersPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(q === undefined ? {} : { q }),
  } as PageProps<"/admin/manufacturers">);
  return renderToStaticMarkup(page);
}

describe("/admin/manufacturers", () => {
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    vi.mocked(requirePermission).mockImplementation(async () => {
      order.push("requirePermission");
      return { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" };
    });
    vi.mocked(createClient).mockImplementation(async () => {
      order.push("createClient");
      return {} as never;
    });
  });

  it("checks for an admin before it reads anything", async () => {
    await render([hartalega]);
    expect(order).toEqual(["requirePermission", "createClient"]);
  });

  it("stops at the role check: inspectors get the 404 it throws", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(render([hartalega])).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(loadManufacturers).not.toHaveBeenCalled();
    await expect(generateMetadata()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("names the page only for admins", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Manufacturers" });
    expect(requirePermission).toHaveBeenCalled();
  });

  it("lists the manufacturers with their factory, country and usage", async () => {
    const html = await render([hartalega, terang]);
    expect(html).toContain("Hartalega NGC");
    expect(html).toContain("TG Factory 40");
    expect(html).toContain("2 templates and 14 inspections");
    expect(html).toContain("Not in use");
    expect(html).toContain('aria-label="Edit Terang Nusa Sdn. Bhd., TG Factory 40"');
    expect(html).toContain("2 manufacturers");
  });

  it("starts with the search from the address", async () => {
    const html = await render([hartalega, terang], "tg 40");
    expect(html).toContain('value="tg 40"');
    expect(html).toContain("1 of 2 manufacturers");
    expect(html).not.toContain("Hartalega NGC");
  });

  it("invites the first manufacturer when there are none", async () => {
    const html = await render([]);
    expect(html).toContain("No Manufacturers Yet");
    expect(html).toContain("Add Your First Manufacturer");
    expect(html).not.toContain("<table");
  });
});
