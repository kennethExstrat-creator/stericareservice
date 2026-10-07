// Server-rendered markup of the sign-in pages: which screen each session state
// and query string gets. The forms' behaviour is covered by actions.test.ts.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SessionState } from "@/lib/auth/session";

const { Redirect, mocks } = vi.hoisted(() => {
  class Redirect extends Error {
    constructor(readonly url: string) {
      super(`redirect ${url}`);
    }
  }
  return {
    Redirect,
    mocks: {
      getSession: vi.fn(),
      requireUser: vi.fn(),
      isSupabaseConfigured: vi.fn(),
      getClaims: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth/session", () => ({
  getSession: mocks.getSession,
  requireUser: mocks.requireUser,
  authorizeAction: vi.fn(),
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getClaims: mocks.getClaims } }) }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Redirect(url);
  },
}));

const { default: AuthError } = await import("./error");
const { default: LoginPage } = await import("./login/page");
const { default: ForgotPasswordPage } = await import("./forgot-password/page");
const { default: ResetPasswordPage, generateMetadata: resetMetadata } = await import("./reset-password/page");

const INSPECTOR = { id: "user-1", email: "new.inspector@test.local", fullName: "Nur Aisyah", role: "inspector" as const };

function query(params: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(params) };
}

async function html(page: Promise<ReactElement> | ReactElement) {
  return renderToStaticMarkup(await page);
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.getSession.mockResolvedValue({ status: "active", user: INSPECTOR } satisfies SessionState);
  mocks.requireUser.mockResolvedValue(INSPECTOR);
  // By default the session came from an email link a moment ago.
  mocks.getClaims.mockResolvedValue(signedInWith("otp"));
});

function signedInWith(method: string) {
  return { data: { claims: { amr: [{ method, timestamp: Date.now() / 1000 - 10 }] } }, error: null };
}

describe("/login", () => {
  it("shows email, password and the way to reset, but no sign-up", async () => {
    const page = await html(LoginPage(query()));
    // HTML attribute names are case-insensitive; React keeps the camelCase spelling.
    expect(page).toMatch(/autocomplete="username"/i);
    expect(page).toMatch(/autocomplete="current-password"/i);
    expect(page).toContain('aria-label="Show Password"');
    expect(page).toContain('href="/forgot-password"');
    expect(page).not.toMatch(/sign up|create an account|register/i);
  });

  it("puts “Forgot Password?” after the password field, so Tab goes from the email to the password", async () => {
    const page = await html(LoginPage(query()));
    const order = ['id="login-email"', 'id="login-password"', 'href="/forgot-password"', 'type="submit"'].map((marker) =>
      page.indexOf(marker),
    );
    expect(order.every((index) => index >= 0)).toBe(true);
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("writes its labels in Title Case (docs/DESIGN.md, Capitalisation)", async () => {
    const page = await html(LoginPage(query()));
    expect(page).toMatch(/<h1[^>]*>Sign In<\/h1>/);
    expect(page).toMatch(/<label[^>]*for="login-email"[^>]*>Email<\/label>/);
    expect(page).toMatch(/<label[^>]*for="login-password"[^>]*>Password<\/label>/);
    expect(page).toMatch(/<a [^>]*href="\/forgot-password"[^>]*>Forgot Password\?<\/a>/);
    expect(page).toMatch(/<button [^>]*type="submit"[^>]*>Sign In<\/button>/);
  });

  it("titles the screen in DESIGN.md's Display style; the other cards keep H1", async () => {
    expect(await html(LoginPage(query()))).toMatch(/<h1[^>]*data-size="display"[^>]*class="text-4xl leading-10 font-extrabold /);
    expect(await html(ForgotPasswordPage())).toMatch(/<h1[^>]*data-size="title"[^>]*class="text-3xl leading-tight font-bold /);
    expect(await html(ResetPasswordPage(query()))).toMatch(/<h1[^>]*data-size="title"/);
  });

  it("carries ?next= into the form for the action to check", async () => {
    const page = await html(LoginPage(query({ next: "/inspections/abc" })));
    expect(page).toContain('name="next" value="/inspections/abc"');
  });

  it.each([
    ["deactivated", "This account has been deactivated. Ask your SteriCare administrator."],
    ["link_invalid", "That link has expired or was already used."],
  ])("explains ?error=%s", async (error, message) => {
    expect(await html(LoginPage(query({ error })))).toContain(message);
  });

  it("ignores unknown error codes", async () => {
    const page = await html(LoginPage(query({ error: "Your account was hacked, call 555-0100" })));
    expect(page).not.toContain('role="alert"');
    expect(page).not.toContain("555-0100");
  });

  it("names the env vars to set while Supabase is not configured", async () => {
    mocks.isSupabaseConfigured.mockReturnValue(false);
    const page = await html(LoginPage(query()));
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
      expect(page).toContain(name);
    }
    expect(page).toContain("README.md");
    expect(page).toContain('href="/design"');
    expect(page).not.toContain("<form");
  });
});

describe("/forgot-password", () => {
  it("asks for the email and links back to sign in", async () => {
    const page = await html(ForgotPasswordPage());
    expect(page).toContain('name="email"');
    expect(page).toContain("Send Reset Link");
    expect(page).toContain('href="/login"');
  });
});

describe("/reset-password", () => {
  it("needs the session from the email link", async () => {
    mocks.getSession.mockResolvedValue({ status: "signed-out" } satisfies SessionState);
    const page = await html(ResetPasswordPage(query({ flow: "recovery" })));
    expect(page).toContain("This Link Has Expired or Was Already Used");
    expect(page).toContain('href="/forgot-password"');
    expect(page).not.toContain("<form");
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(await resetMetadata(query())).toEqual({ title: "Link Expired" });
  });

  it("sends a deactivated session through requireUser", async () => {
    mocks.getSession.mockResolvedValue({ status: "deactivated", userId: INSPECTOR.id } satisfies SessionState);
    mocks.requireUser.mockImplementation(async () => {
      throw new Redirect("/auth/sign-out?reason=deactivated");
    });
    await expect(ResetPasswordPage(query())).rejects.toMatchObject({ url: "/auth/sign-out?reason=deactivated" });
  });

  it("welcomes an invited user and shows the policy up front", async () => {
    const page = await html(ResetPasswordPage(query({ flow: "invite" })));
    expect(page).toContain("Set Your Password");
    expect(page).toContain("Welcome to SteriCare QC, Nur Aisyah.");
    expect(page).toContain("new.inspector@test.local");
    expect(page).toContain("At least 10 characters");
    expect(page).toContain("Letters and digits");
    expect(page.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(page).toContain(">Set Password<");
    expect(await resetMetadata(query({ flow: "invite" }))).toEqual({ title: "Set Your Password" });
  });

  it("words a reset as choosing a new password", async () => {
    const page = await html(ResetPasswordPage(query({ flow: "recovery" })));
    expect(page).toContain("Choose a New Password");
    expect(page).toContain(">Save New Password<");
    expect(page).not.toContain("Welcome");
  });

  it("shows the setup notice while Supabase is not configured", async () => {
    mocks.getSession.mockResolvedValue({ status: "unconfigured" } satisfies SessionState);
    expect(await html(ResetPasswordPage(query()))).toContain("Connect Supabase");
  });

  it("sends a password session to the email link instead of showing the form", async () => {
    mocks.getClaims.mockResolvedValue(signedInWith("password"));
    const page = await html(ResetPasswordPage(query({ flow: "recovery" })));
    expect(page).toContain("Use Your Email Link");
    expect(page).toContain("opened in the last hour");
    expect(page).toContain(">Sign Out<");
    expect(page).toContain('href="/inspections"');
    expect(page).not.toContain('name="password"');
    expect(await resetMetadata(query())).toEqual({ title: "Use Your Email Link" });
  });
});

describe("the sign-in error boundary", () => {
  it("offers a retry and a code to quote, never the error message", () => {
    const error = Object.assign(new Error("connection refused at 10.0.0.5"), { digest: "4242" });
    const page = renderToStaticMarkup(<AuthError error={error} retry={() => {}} />);
    expect(page).toContain("Something Went Wrong");
    expect(page).toContain(">Try Again<");
    expect(page).toContain("quote code");
    expect(page).toContain("4242");
    expect(page).not.toContain("10.0.0.5");
    expect(page).toContain('href="/login"');
  });
});
