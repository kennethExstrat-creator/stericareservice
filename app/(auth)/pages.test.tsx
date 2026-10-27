// Server-rendered markup of the sign-in pages: which screen each session state
// and query string gets. The forms' behaviour is covered by actions.test.ts.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PHONE_HINT } from "@/lib/auth/fields";
import { MESSAGES } from "@/lib/auth/forms";
import type { SessionState, SessionUser } from "@/lib/auth/session";
import { lowerCaseWords } from "@/lib/design/capitalisation";

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
      rpc: vi.fn(),
    },
  };
});

vi.mock("@/lib/auth/session", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/auth/session")>()),
  getSession: mocks.getSession,
  requireUser: mocks.requireUser,
  authorizeAction: vi.fn(),
}));
vi.mock("@/lib/env", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/env")>()),
  isSupabaseConfigured: mocks.isSupabaseConfigured,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({ auth: { getClaims: mocks.getClaims }, rpc: mocks.rpc }),
}));
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
const { default: CreateAccountPage, generateMetadata: createMetadata } = await import("./create-account/page");

const INSPECTOR = { id: "user-1", email: "new.inspector@test.local", fullName: "Nur Aisyah", role: "inspector" as const };

function query(params: Record<string, string | string[]> = {}) {
  return { params: Promise.resolve({}), searchParams: Promise.resolve(params) };
}

async function html(page: Promise<ReactElement> | ReactElement) {
  return renderToStaticMarkup(await page);
}

/** The words of the markup, as a reader sees them. */
function words(markup: string) {
  return markup.replace(/<[^>]+>/g, "");
}

/** The opening tag of the element with this id. */
function tag(markup: string, id: string) {
  const match = new RegExp(`<[a-z]+ [^>]*id="${id}"[^>]*>`).exec(markup);
  if (!match) throw new Error(`no element #${id}`);
  return match[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isSupabaseConfigured.mockReturnValue(true);
  mocks.getSession.mockResolvedValue({ status: "active", user: INSPECTOR } satisfies SessionState);
  mocks.requireUser.mockResolvedValue(INSPECTOR);
  // By default the session came from an email link a moment ago.
  mocks.getClaims.mockResolvedValue(signedInWith("otp"));
  // A project without roles (migration 20261027150000): no role by name.
  mocks.rpc.mockResolvedValue({ data: null, error: { code: "PGRST202", message: "Could not find the function" } });
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
    expect(await html(ResetPasswordPage())).toMatch(/<h1[^>]*data-size="title"/);
    mocks.getSession.mockResolvedValue({ status: "active", user: { ...INSPECTOR, joined: false } } satisfies SessionState);
    expect(await html(CreateAccountPage())).toMatch(/<h1[^>]*data-size="title"/);
  });

  it("says accounts come from an invitation, under the form, not under the title", async () => {
    const page = await html(LoginPage(query()));
    expect(page).toContain("No account yet? Your SteriCare administrator sends you an invitation by email.");
    expect(page.indexOf("No account yet?")).toBeGreaterThan(page.indexOf("</form>"));
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
    const page = await html(ResetPasswordPage());
    expect(page).toContain("This Link Has Expired or Was Already Used");
    expect(page).toContain('href="/forgot-password"');
    expect(page).not.toContain("<form");
    expect(mocks.requireUser).not.toHaveBeenCalled();
    expect(await resetMetadata()).toEqual({ title: "Link Expired" });
  });

  it("sends a deactivated session through requireUser", async () => {
    mocks.getSession.mockResolvedValue({ status: "deactivated", userId: INSPECTOR.id } satisfies SessionState);
    mocks.requireUser.mockImplementation(async () => {
      throw new Redirect("/auth/sign-out?reason=deactivated");
    });
    await expect(ResetPasswordPage()).rejects.toMatchObject({ url: "/auth/sign-out?reason=deactivated" });
  });

  it("sends an invitation not yet answered on to Account Creation, through requireUser", async () => {
    // An invitation emailed before Account Creation (?flow=invite), or a reset link for a lost invitation.
    mocks.getSession.mockResolvedValue({ status: "active", user: { ...INSPECTOR, joined: false } } satisfies SessionState);
    mocks.requireUser.mockImplementation(async () => {
      throw new Redirect("/create-account");
    });
    await expect(ResetPasswordPage()).rejects.toMatchObject({ url: "/create-account" });
  });

  it("words a reset as choosing a new password, with the policy up front", async () => {
    const page = await html(ResetPasswordPage());
    expect(page).toContain("Choose a New Password");
    expect(page).toContain("new.inspector@test.local");
    expect(page).toContain("At least 10 characters");
    expect(page).toContain("Letters and digits");
    expect(page.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(page).toContain(">Save New Password<");
    expect(page).not.toContain("Welcome");
    expect(await resetMetadata()).toEqual({ title: "Choose a New Password" });
  });

  it("shows the setup notice while Supabase is not configured", async () => {
    mocks.getSession.mockResolvedValue({ status: "unconfigured" } satisfies SessionState);
    expect(await html(ResetPasswordPage())).toContain("Connect Supabase");
  });

  it("sends a password session to the email link instead of showing the form", async () => {
    mocks.getClaims.mockResolvedValue(signedInWith("password"));
    const page = await html(ResetPasswordPage());
    expect(page).toContain("Use Your Email Link");
    expect(page).toContain("opened in the last hour");
    expect(page).toContain(">Sign Out<");
    expect(page).toContain('href="/inspections"');
    expect(page).not.toContain('name="password"');
    expect(await resetMetadata()).toEqual({ title: "Use Your Email Link" });
  });
});

describe("/create-account", () => {
  // Invited with the name the admin typed, signed in by the invitation link a moment ago.
  const INVITEE: SessionUser = { ...INSPECTOR, joined: false };

  function invited(user: Partial<SessionUser> = {}) {
    mocks.getSession.mockResolvedValue({ status: "active", user: { ...INVITEE, ...user } } satisfies SessionState);
  }

  beforeEach(() => invited());

  it("asks for the name, the phone and a password, showing the invitation's email read-only", async () => {
    const page = await html(CreateAccountPage());

    expect(page).toMatch(/<h1[^>]*>Create Your Account<\/h1>/);
    const name = tag(page, "create-name");
    expect(name).toContain('name="fullName"');
    expect(name).toMatch(/autocomplete="name"/i);
    expect(name).toContain('value="Nur Aisyah"');
    // Shown, never sent: no name attribute, and the action reads the account from the session.
    const email = tag(page, "create-email");
    expect(email).toContain('value="new.inspector@test.local"');
    expect(email).toMatch(/readonly=""/i);
    expect(email).not.toContain("name=");
    expect(email).toMatch(/autocomplete="username"/i);
    const phone = tag(page, "create-phone");
    expect(phone).toContain('name="phone"');
    expect(phone).toContain('type="tel"');
    expect(phone).toMatch(/inputmode="tel"/i);
    expect(phone).toMatch(/autocomplete="tel"/i);
    expect(phone).toContain('aria-describedby="create-phone-hint"');
    expect(words(page)).toContain(PHONE_HINT);
    // Its example number on one line: the card would break it at the hyphen.
    expect(page).toContain('<span class="whitespace-nowrap">+60 12-345 6789</span>');
    expect(page.match(/autocomplete="new-password"/gi)).toHaveLength(2);
    expect(page).toContain("At least 10 characters");
    expect(page).toMatch(/<button [^>]*type="submit"[^>]*>Create Account<\/button>/);
    expect(await createMetadata()).toEqual({ title: "Create Your Account" });
    // It reads the session itself: requireUser would send this account straight back here.
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("writes its labels in Title Case (docs/DESIGN.md, Capitalisation)", async () => {
    const page = await html(CreateAccountPage());
    const labels = [...page.matchAll(/<label[^>]*>([^<]*)<\/label>/g)].map(([, label]) => label);
    expect(labels).toEqual(["Full Name", "Email", "Phone", "Password", "Confirm Password"]);
    for (const label of [...labels, "Create Your Account", "Create Account", "Ask for a New Invitation"]) {
      expect(lowerCaseWords(label), label).toEqual([]);
    }
  });

  it.each([
    ["an inspector", {}, "You are joining as an Inspector."],
    ["a lead inspector", { isLead: true }, "You are joining as a Lead Inspector."],
    ["an admin", { role: "admin" as const }, "You are joining as an Admin."],
  ])("names the level the admin chose for %s, read-only, on a project without roles", async (_label, placement, sentence) => {
    invited(placement);
    const page = await html(CreateAccountPage());
    expect(words(page)).toContain(sentence);
    expect(page).not.toContain('name="role"');
  });

  it("names a custom role by its own name", async () => {
    mocks.rpc.mockResolvedValue({
      data: [{ id: "role-1", name: "QC Supervisor", built_in: null, access: "team", permissions: [] }],
      error: null,
    });
    expect(words(await html(CreateAccountPage()))).toContain("You are joining as a QC Supervisor.");
    expect(mocks.rpc).toHaveBeenCalledWith("my_role");
  });

  it("falls back to the level's name when the role cannot be read", async () => {
    mocks.rpc.mockRejectedValue(new Error("fetch failed"));
    invited({ isLead: true });
    expect(words(await html(CreateAccountPage()))).toContain("You are joining as a Lead Inspector.");
  });

  it("leaves Full Name to fill in when the admin gave no name", async () => {
    invited({ fullName: null });
    expect(tag(await html(CreateAccountPage()), "create-name")).toContain('value=""');
  });

  it("says an expired or used invitation needs a new one, with no form", async () => {
    mocks.getSession.mockResolvedValue({ status: "signed-out" } satisfies SessionState);
    const page = await html(CreateAccountPage());
    expect(page).toContain("This Invitation Has Expired or Was Already Used");
    expect(page).toContain(MESSAGES.invitationExpired);
    expect(page).toContain('href="/login"');
    expect(page).not.toContain("<form");
    expect(await createMetadata()).toEqual({ title: "Invitation Expired" });
  });

  it("signs a deactivated account out, as requireUser would", async () => {
    mocks.getSession.mockResolvedValue({ status: "deactivated", userId: INSPECTOR.id } satisfies SessionState);
    await expect(CreateAccountPage()).rejects.toMatchObject({ url: "/auth/sign-out?reason=deactivated" });
  });

  it.each([
    ["an inspector", "inspector" as const, "/inspections"],
    ["an admin", "admin" as const, "/admin"],
  ])("sends %s who created their account already to their dashboard", async (_label, role, dashboard) => {
    invited({ role, joined: true });
    await expect(CreateAccountPage()).rejects.toMatchObject({ url: dashboard });
  });

  it("asks for a new invitation when the link was opened over an hour ago", async () => {
    mocks.getClaims.mockResolvedValue({
      data: { claims: { amr: [{ method: "otp", timestamp: Date.now() / 1000 - 60 * 61 }] } },
      error: null,
    });
    const page = await html(CreateAccountPage());
    expect(page).toContain("Ask for a New Invitation");
    expect(page).toContain(MESSAGES.invitationLinkRequired);
    expect(page).toContain(">Sign Out<");
    expect(page).not.toContain('name="password"');
    expect(await createMetadata()).toEqual({ title: "Ask for a New Invitation" });
  });

  it("shows the setup notice while Supabase is not configured", async () => {
    mocks.getSession.mockResolvedValue({ status: "unconfigured" } satisfies SessionState);
    expect(await html(CreateAccountPage())).toContain("Connect Supabase");
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
