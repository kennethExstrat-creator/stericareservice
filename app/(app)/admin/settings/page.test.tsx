// /admin/settings as the server renders it: the role check before anything,
// then the Supabase and Sign-In Emails cards with what the admin's own
// session reads, and the states the live project cannot show on demand (a
// table it cannot read, a production build without NEXT_PUBLIC_SITE_URL).
// Each card's own states are admin-status-cards.test.tsx's.
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth/session", () => ({ requirePermission: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ isAdminClientConfigured: vi.fn() }));

import { requirePermission } from "@/lib/auth/session";
import { isAdminClientConfigured } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import GeneralSettingsPage, { generateMetadata } from "./page";

const ADMIN = { id: "7c2d4e1a-0b3f-4a5c-9d8e-1f2a3b4c5d6e", email: "admin@test.local", fullName: "Test Admin", role: "admin" as const };

// Placeholders: the publishable key must not reach the page.
const SUPABASE_URL = "https://abcdefghijklmnopqrst.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_placeholder0123";

const notFound = Object.assign(new Error("NEXT_HTTP_ERROR_FALLBACK;404"), { digest: "NEXT_HTTP_ERROR_FALLBACK;404" });

type Answer = { data?: unknown; count?: number | null; error?: { message: string } | null };

/** What each table answers the admin's session: rows for profiles, a count for the rest. */
const TABLES: Record<string, Answer> = {
  profiles: {
    data: [
      { role: "admin", active: true },
      { role: "inspector", active: true },
      { role: "inspector", active: true },
      { role: "inspector", active: false },
    ],
  },
  manufacturers: { count: 2 },
  clients: { count: 1 },
  defect_codes: { count: 32 },
  templates: { count: 3 },
};

/** A stand-in for the admin's Supabase client: each table answers as `tables` says. */
function fakeClient(tables: Record<string, Answer>) {
  return {
    from: (table: string) => ({
      select: async () => ({ data: null, count: null, error: null, ...tables[table] }),
    }),
  };
}

/** The text a reader sees: tags dropped, entities decoded. */
function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ");
}

async function render(tables: Record<string, Answer> = TABLES): Promise<string> {
  vi.mocked(createClient).mockResolvedValue(fakeClient(tables) as never);
  return renderToStaticMarkup(await GeneralSettingsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requirePermission).mockResolvedValue(ADMIN);
  vi.mocked(isAdminClientConfigured).mockReturnValue(true);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", SUPABASE_URL);
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", PUBLISHABLE_KEY);
  vi.stubEnv("NEXT_PUBLIC_SITE_URL", "https://qc.example.com");
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("the role check", () => {
  it("stops at the role check: inspectors get the 404 it throws, before anything is read", async () => {
    vi.mocked(requirePermission).mockRejectedValue(notFound);
    await expect(render()).rejects.toBe(notFound);
    expect(createClient).not.toHaveBeenCalled();
    expect(isAdminClientConfigured).not.toHaveBeenCalled();
  });

  it("names the page only for an admin", async () => {
    await expect(generateMetadata()).resolves.toEqual({ title: "General Settings" });
    vi.mocked(requirePermission).mockRejectedValue(notFound);
    await expect(generateMetadata()).rejects.toBe(notFound);
  });
});

describe("the page", () => {
  it("shows Supabase and the sign-in emails under the page's title, the Steri-AI cards left to Steri-AI Settings", async () => {
    const html = await render();
    expect(html).toMatch(/<h1[^>]*>General Settings<\/h1>/);
    const titles = [...html.matchAll(/<h2 [^>]*>([^<]+)<\/h2>/g)].map((match) => match[1]);
    expect(titles).toEqual(["Supabase", "Sign-In Emails"]);
    expect(html).not.toContain("Steri-AI");
    expect(html).not.toContain(PUBLISHABLE_KEY);
  });

  it("counts what the admin's own session reads", async () => {
    const page = text(await render());
    expect(page).toContain("Ready");
    expect(page).toContain("abcdefghijklmnopqrst.supabase.co");
    expect(page).toContain("3 active (1 admin, 2 inspectors) · 1 deactivated");
    expect(page).toContain("2 manufacturers · 1 client · 32 defect codes · 3 templates");
    expect(page).not.toContain("Not Readable");
  });

  it("says which tables it could not read", async () => {
    const page = text(await render({ ...TABLES, profiles: { error: { message: "permission denied" } }, templates: { count: null } }));
    expect(page).toContain("Needs Attention");
    expect(page).toContain("Could not read the accounts. Check the migrations are applied.");
    expect(page).toContain("Could not read the reference tables. Check the migrations and seed are applied.");
  });

  it("needs the secret key to be ready", async () => {
    vi.mocked(isAdminClientConfigured).mockReturnValue(false);
    const page = text(await render());
    expect(page).toContain("Needs Attention");
    expect(page).toContain("Set SUPABASE_SECRET_KEY to invite and deactivate users.");
  });

  it("gives the Site URL to set, from NEXT_PUBLIC_SITE_URL", async () => {
    const page = text(await render());
    expect(page).toContain("Check by Hand");
    // The emails link back to the app that sent them (5cd669b): its address goes in the redirect URLs, the Site URL as it is.
    expect(page).toContain("add https://qc.example.com/** to the redirect URLs.");
    expect(page).not.toContain("set it to");
  });

  it("asks for NEXT_PUBLIC_SITE_URL in a production build without it, rather than the localhost fallback", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_SITE_URL", "");
    const page = text(await render());
    expect(page).toContain("NEXT_PUBLIC_SITE_URL is not set, so the app does not know its public address.");
    expect(page).not.toContain("localhost");
  });
});
