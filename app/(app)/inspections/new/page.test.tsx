// The page as the server renders it: the session check comes first, then the
// lists, then the form; and the state the live database cannot show on
// demand (the lists failing to load).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireUser: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./_lib/options", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./_lib/options")>()),
  loadNewInspectionOptions: vi.fn(),
}));
vi.mock("./actions", () => ({ createInspection: vi.fn() }));

import { requireUser } from "@/lib/auth/session";
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
    expect(metadata).toEqual({ title: "New inspection" });
  });

  it("shows the form: the picks, start from previous and the template", async () => {
    const html = await render();
    expect(html).toContain("<h1");
    expect(html).toContain("New inspection");
    expect(html).toContain('data-testid="new-inspection-form"');
    expect(html).toContain("What you are inspecting");
    expect(html).toContain("Choose the client");
    expect(html).toContain("Choose the manufacturer");
    expect(html).toContain("Examination gloves");
    expect(html).toContain("Surgical gloves");
    expect(html).toContain("Start from previous");
    expect(html).toContain("The template follows from the client, manufacturer and product type.");
    expect(html).toContain("Create inspection");
    // Inspectors never post a template of their own choosing.
    expect(html).not.toContain('name="templateId"');
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
    expect(html).toContain("The lists could not be loaded");
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
