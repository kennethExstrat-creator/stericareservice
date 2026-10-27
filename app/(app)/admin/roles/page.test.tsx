// The page as the server renders it: the admin check, then the Admin role
// check (is_full_admin, on the admin's own client), then the list. A custom
// role that sees every inspection passes requireAdmin() and still gets the
// 404. The panel is the browser's: role-panel.test.tsx draws it.
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requireAdmin: vi.fn(), authorizeAction: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("./actions", () => ({ createRole: vi.fn(), updateRole: vi.fn(), deleteRole: vi.fn() }));

import { requireAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import RolesPage, { generateMetadata } from "./page";

const NOT_FOUND = "NEXT_HTTP_ERROR_FALLBACK;404";

const row = (overrides: Record<string, unknown>) => ({
  id: "10000000-0000-4000-8000-000000000000",
  built_in: null,
  name: "Role",
  description: null,
  access: "own",
  permissions: [],
  updated_at: "2026-10-27T08:00:00.066067+00:00",
  profiles: [{ count: 0 }],
  ...overrides,
});

// As the database returns them: in no particular order.
const ROWS = [
  row({
    id: "10000000-0000-4000-8000-000000000004",
    name: "Clients Desk",
    description: "Keeps the client list.",
    access: "own",
    permissions: ["clients", "create_inspections"],
  }),
  row({
    id: "10000000-0000-4000-8000-000000000003",
    built_in: "inspector",
    name: "Inspector",
    description: "Inspects, and sees their own inspections.",
    permissions: ["ai_reading", "ai_summary", "create_inspections", "delete_drafts", "export_reports"],
    profiles: [{ count: 3 }],
  }),
  row({
    id: "10000000-0000-4000-8000-000000000001",
    built_in: "admin",
    name: "Admin",
    description: "Everything, including users and roles.",
    access: "all",
    permissions: [],
    profiles: [{ count: 1 }],
  }),
  row({
    id: "10000000-0000-4000-8000-000000000002",
    built_in: "lead",
    name: "Lead Inspector",
    access: "team",
    // Stored by hand: approving needs every inspection, so it does not count.
    permissions: ["approve_inspections", "export_reports"],
    profiles: [{ count: 1 }],
  }),
];

let order: string[] = [];
let fullAdmin = true;

beforeEach(() => {
  vi.clearAllMocks();
  order = [];
  fullAdmin = true;
  vi.mocked(requireAdmin).mockImplementation(async () => {
    order.push("requireAdmin");
    return { id: "admin-id", email: "admin@test.local", fullName: "Test Admin", role: "admin" };
  });
  vi.mocked(createClient).mockImplementation(async () => {
    const rows = Promise.resolve({ data: ROWS, error: null });
    return {
      rpc: async (name: string) => {
        order.push(`rpc ${name}`);
        return { data: fullAdmin, error: null };
      },
      from: (table: string) => {
        order.push(`from ${table}`);
        return { select: () => rows };
      },
    } as never;
  });
});

async function render(): Promise<string> {
  return renderToStaticMarkup(await RolesPage());
}

/** The table's body rows. */
const bodyRows = (html: string) => html.split("<tbody")[1]?.split("<tr").slice(1) ?? [];
/** A row's cells as text. */
const cells = (rowHtml: string) =>
  rowHtml
    .split("<td")
    .slice(1)
    .map((cell) => cell.replace(/^[^>]*>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());

describe("/admin/roles", () => {
  it("checks for an admin, then for the Admin role, before it reads the roles", async () => {
    await render();
    expect(order).toEqual(["requireAdmin", "rpc is_full_admin", "from roles"]);
  });

  it("names the page only for the Admin role", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "Roles & Permissions" });
    expect(order).toEqual(["requireAdmin", "rpc is_full_admin"]);
  });

  it("is a 404 for anyone else with admin access, such as a custom role that sees everything", async () => {
    fullAdmin = false;
    await expect(render()).rejects.toThrow(NOT_FOUND);
    await expect(generateMetadata()).rejects.toThrow(NOT_FOUND);
    expect(order).not.toContain("from roles");
  });

  it("stops at requireAdmin's 404 for inspectors, before asking anything else", async () => {
    vi.mocked(requireAdmin).mockRejectedValue(new Error(NOT_FOUND));
    await expect(render()).rejects.toThrow(NOT_FOUND);
    await expect(generateMetadata()).rejects.toThrow(NOT_FOUND);
    expect(order).toEqual([]);
  });

  it("fails rather than guess when the Admin role cannot be checked", async () => {
    vi.mocked(createClient).mockResolvedValue({
      rpc: async () => ({ data: null, error: { message: "function is_full_admin() does not exist" } }),
    } as never);
    await expect(render()).rejects.toThrow("Could not check for the Admin role");
  });

  it("lists the built-in roles first, then custom ones, with what each sees, allows and who has it", async () => {
    const html = await render();

    expect(html).toContain("Roles &amp; Permissions");
    expect(html).toContain("Add Role");
    const rows = bodyRows(html).map(cells);
    expect(rows.map((cells) => cells.slice(0, 5))).toEqual([
      ["Admin Built-In Everything, including users and roles.", "All Inspections", "8 of 8", "8 of 8", "1"],
      ["Lead Inspector Built-In", "Team Inspections", "0 of 8", "1 of 8", "1"],
      ["Inspector Built-In Inspects, and sees their own inspections.", "Own Inspections", "0 of 8", "5 of 8", "3"],
      ["Clients Desk Keeps the client list.", "Own Inspections", "1 of 8", "1 of 8", "0"],
    ]);
  });

  it("opens the Admin role to view, every other role to edit", async () => {
    const html = await render();
    expect(html).toContain('aria-label="View Admin"');
    expect(html).toContain('aria-label="Edit Lead Inspector"');
    expect(html).toContain('aria-label="Edit Inspector"');
    expect(html).toContain('aria-label="Edit Clients Desk"');
    expect(html).not.toContain('aria-label="Edit Admin"');
  });
});
