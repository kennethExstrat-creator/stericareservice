// The page as the server renders it: the role check comes first, then the
// list with its logos, and the states the live database cannot show on
// demand (no clients, a logo whose file has gone, Storage not answering).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientItem } from "@/lib/admin/reference";

vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/admin/reference", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/admin/reference")>()),
  loadClients: vi.fn(),
}));
vi.mock("./actions", () => ({
  saveClient: vi.fn(),
  deleteClient: vi.fn(),
  prepareLogoUpload: vi.fn(),
  confirmLogoUpload: vi.fn(),
  removeClientLogo: vi.fn(),
}));

import { loadClients } from "@/lib/admin/reference";
import { requirePermission } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import ClientsPage, { generateMetadata } from "./page";

const LOGO_URL = "https://example.supabase.co/storage/v1/object/sign/client-logos/a/b.png?token=abc";

const polyco: ClientItem = {
  id: "20000000-0000-4000-8000-000000000001",
  name: "Polyco Healthline",
  notes: "Client to confirm",
  updatedAt: "2026-10-06T10:45:02.066067+00:00",
  usage: { templates: 1, inspections: 0 },
  logo: { url: LOGO_URL },
};
const zeta: ClientItem = {
  ...polyco,
  id: "20000000-0000-4000-8000-000000000002",
  name: "Zeta Medical",
  notes: null,
  usage: { templates: 0, inspections: 0 },
  logo: null,
};

async function render(rows: ClientItem[], q?: string): Promise<string> {
  vi.mocked(loadClients).mockResolvedValue(rows);
  const page = await ClientsPage({
    params: Promise.resolve({}),
    searchParams: Promise.resolve(q === undefined ? {} : { q }),
  } as PageProps<"/admin/clients">);
  return renderToStaticMarkup(page);
}

describe("/admin/clients", () => {
  beforeEach(() => {
    vi.mocked(requirePermission).mockResolvedValue({
      id: "admin-id",
      email: "admin@test.local",
      fullName: "Test Admin",
      role: "admin",
    });
    vi.mocked(createClient).mockResolvedValue({} as never);
  });

  it("stops at the role check: inspectors get the 404 it throws", async () => {
    vi.mocked(requirePermission).mockRejectedValue(new Error("NEXT_HTTP_ERROR_FALLBACK;404"));
    await expect(render([polyco])).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
    expect(createClient).not.toHaveBeenCalled();
    expect(loadClients).not.toHaveBeenCalled();
    await expect(generateMetadata()).rejects.toThrow("NEXT_HTTP_ERROR_FALLBACK;404");
  });

  it("names the page only for admins", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Clients" });
  });

  it("lists the clients with their logos through signed URLs", async () => {
    const html = await render([polyco, zeta]);
    expect(html).toContain("Polyco Healthline");
    expect(html).toContain(`src="${LOGO_URL.replaceAll("&", "&amp;")}"`);
    expect(html).toContain("No Logo");
    expect(html).toContain("1 template");
    expect(html).toContain("2 clients");
  });

  it("says when a stored logo's file is missing", async () => {
    const html = await render([{ ...polyco, logo: { url: null, problem: "missing" } }]);
    expect(html).toContain("Missing");
    expect(html).not.toContain("Unavailable");
    expect(html).not.toContain("<img");
  });

  it("does not call logos missing when Storage could not be asked for previews", async () => {
    const html = await render([{ ...polyco, logo: { url: null, problem: "unavailable" } }]);
    expect(html).toContain("Unavailable");
    expect(html).toContain('title="Logo preview unavailable. Reload to try again."');
    expect(html).not.toContain("Missing");
    expect(html).not.toContain("<img");
  });

  it("starts with the search from the address", async () => {
    const html = await render([polyco, zeta], "zeta");
    expect(html).toContain('value="zeta"');
    expect(html).toContain("1 of 2 clients");
    expect(html).not.toContain("Polyco Healthline");
  });

  it("invites the first client when there are none", async () => {
    const html = await render([]);
    expect(html).toContain("No Clients Yet");
    expect(html).toContain("Add Your First Client");
  });
});
