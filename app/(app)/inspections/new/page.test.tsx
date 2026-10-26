// The page as the server renders it: the session check comes first, then the
// lists, then the form; and the state the live database cannot show on
// demand (the lists failing to load).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

// The form opens the new inspection itself; no App Router here.
vi.mock("next/navigation", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/navigation")>()),
  useRouter: () => ({ push: vi.fn() }),
}));
vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./_lib/options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/options")>()),
  loadNewInspectionOptions: vi.fn(),
}));
vi.mock("./actions", () => ({ createInspection: vi.fn() }));

import { requireUser } from "@/lib/auth/session";
import { PRODUCT_TYPE_LABEL } from "@/lib/inspections/create";
import { createClient } from "@/lib/supabase/server";
import { loadNewInspectionOptions } from "./_lib/options";
import type { NewInspectionOptions } from "./_lib/types";
import NewInspectionPage, { metadata } from "./page";

const OPTIONS: NewInspectionOptions = {
  clients: [{ id: "20000000-0000-4000-8000-000000000001", label: "Polyco Healthline" }],
  manufacturers: [{ id: "10000000-0000-4000-8000-000000000001", label: "Hartalega NGC" }],
  templates: [],
  previous: [],
};

async function render(): Promise<string> {
  return renderToStaticMarkup(await NewInspectionPage());
}

describe("/inspections/new", () => {
  const order: string[] = [];

  beforeEach(() => {
    order.length = 0;
    vi.mocked(requireUser).mockImplementation(async () => {
      order.push("requireUser");
      return { id: "inspector-id", email: "inspector@test.local", fullName: "Test Inspector", role: "inspector" };
    });
    vi.mocked(createClient).mockImplementation(async () => {
      order.push("createClient");
      return {} as never;
    });
    vi.mocked(loadNewInspectionOptions).mockImplementation(async (_client, role) => {
      order.push(`load as ${role}`);
      return OPTIONS;
    });
  });

  it("checks the session before it reads anything, and reads as the user's role", async () => {
    await render();
    expect(order).toEqual(["requireUser", "createClient", "load as inspector"]);
  });

  it("stops at the session check when signed out", async () => {
    vi.mocked(requireUser).mockRejectedValue(new Error("NEXT_REDIRECT"));
    await expect(render()).rejects.toThrow("NEXT_REDIRECT");
    expect(loadNewInspectionOptions).not.toHaveBeenCalled();
  });

  it("is titled for every signed-in user", () => {
    expect(metadata).toEqual({ title: "New Inspection" });
  });

  it("shows the form: Source Documents first, then the template and the picks", async () => {
    const html = await render();
    // Where a new inspection starts (Kenneth, 26 October 2026): above the picks, across the page.
    expect(html.indexOf('data-testid="source-documents"')).toBeLessThan(html.indexOf("What You Are Inspecting"));
    expect(html).toContain('data-slot="read-drop" data-roomy="true"');
    expect(html).toContain("Start Here");
    expect(html).toContain("<h1");
    expect(html).toContain("New Inspection");
    expect(html).toContain('data-testid="new-inspection-form"');
    expect(html).toContain("What You Are Inspecting");
    expect(html).toContain("Choose the client");
    expect(html).toContain("Choose the manufacturer");
    expect(html).toContain(">Product Type</legend>");
    expect(html).toContain(PRODUCT_TYPE_LABEL.examination);
    expect(html).toContain(PRODUCT_TYPE_LABEL.surgical);
    expect(html).toContain('Product Name <span class="font-normal text-muted-foreground">(Optional)</span>');
    // No Start From Previous (Kenneth, 26 October 2026: "remove this").
    expect(html).not.toContain("Start From Previous");
    // Source Documents as on the capture screen: its title and the Files / Media switch.
    expect(html).toContain('data-testid="source-documents"');
    expect(html).toContain(">Source Documents</h2>");
    expect(html).toContain('data-testid="source-tabs"');
    expect(html).toContain("Add Document");
    // The template lists the picks it still needs.
    expect(html).toContain('data-testid="template-panel"');
    expect(html).toContain("The template follows from the client, manufacturer and product type.");
    // Cards have their title and no line under it (Kenneth, 12 October 2026).
    expect(html).not.toContain("as on the order, and the type of glove");
    expect(html).not.toContain("Copies the product's details");
    expect(html).toContain("Create Inspection");
    // Inspectors never post a template of their own choosing.
    expect(html).not.toContain('name="templateId"');
  });

  it("puts the product type cards as far below their legend as the pickers below their labels", async () => {
    const html = await render();
    // A fieldset's legend is no flex item: the FieldSet's gap never reaches it, so its own margin is the gap.
    const legend = /<legend data-slot="field-legend"[^>]*class="([^"]*)"/.exec(html)?.[1].split(" ");
    expect(legend).toContain("mb-3");
    expect(legend).not.toContain("mb-0");
    // The FieldLabel's line height, so the text sits where a label's does.
    expect(legend).toContain("leading-snug");
    // Each Field above keeps 12 px (gap-3) between its label and its picker.
    expect(html).toMatch(/<div role="group" data-slot="field"[^>]*class="[^"]*\bgap-3\b[^"]*"[^>]*><label data-slot="field-label"[^>]*for="[^"]*-client"/);
  });

  it("leaves a draft kept in the tab out of the server's HTML, so hydration starts from the same empty form", async () => {
    const draft = {
      v: 1,
      clientId: OPTIONS.clients[0].id,
      manufacturerId: OPTIONS.manufacturers[0].id,
      productType: "examination",
      productName: "Typed before a reload",
      previous: "",
      nameFromPrevious: false,
      templateId: "",
    };
    const sessionStorage = { getItem: vi.fn(() => JSON.stringify(draft)), setItem: vi.fn(), removeItem: vi.fn() };
    vi.stubGlobal("window", { sessionStorage });
    try {
      const html = await render();
      expect(html).toContain('name="clientId" value=""');
      expect(html).toContain('name="manufacturerId" value=""');
      expect(html).toContain("Choose the client");
      expect(html).not.toContain(draft.productName);
      // The browser brings the draft back once the page has hydrated.
      expect(sessionStorage.getItem).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("lets an admin's form carry a template choice", async () => {
    vi.mocked(requireUser).mockResolvedValue({ id: "admin-id", email: "admin@test.local", fullName: null, role: "admin" });
    const html = await render();
    expect(html).toContain('name="templateId"');
    expect(loadNewInspectionOptions).toHaveBeenCalledWith(expect.anything(), "admin");
  });

  it("says when the lists cannot be loaded, with a way to try again", async () => {
    vi.mocked(loadNewInspectionOptions).mockResolvedValue(null);
    const html = await render();
    expect(html).toContain('data-testid="load-failed"');
    expect(html).toContain("The Lists Could Not Be Loaded");
    expect(html).toContain(">Try Again</a>");
    expect(html).toContain('href="/inspections/new"');
    expect(html).not.toContain('data-testid="new-inspection-form"');
  });

  it("tells an inspector without manufacturers who adds them", async () => {
    vi.mocked(loadNewInspectionOptions).mockResolvedValue({ ...OPTIONS, manufacturers: [] });
    const html = await render();
    expect(html).toContain("No manufacturers yet");
    expect(html).toContain("Ask an admin to add the manufacturer.");
  });
});
