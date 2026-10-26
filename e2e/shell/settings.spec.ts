import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoPageScroll } from "../support/layout";
import { sessionCookies, TEST_ACCOUNTS, type SessionCookie } from "../support/session";

/**
 * The system status the admin overview showed until it became the dashboard
 * (Kenneth, 27 October 2026: "these looks more like should be in general
 * settings or AI settings"): Supabase and the sign-in emails on Admin >
 * General Settings, the second opinion and the report under the key on
 * Steri-AI Settings' General. At the sizes in playwright.config.ts, as the
 * admin, reading only: nothing is saved. Each card's states are
 * components/shell/admin-status-cards.test.tsx's: this run only sees the
 * live, configured project. Screenshots go to screenshots/shell/
 * (git-ignored).
 */

// Dev servers compile each page on its first visit, and the Mac running these is shared.
test.describe.configure({ timeout: 90_000 });

/** The desktop layout: 1280 px and wider with a mouse or trackpad; every touch size is the iPad layout (app/globals.css). */
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280 && test.info().project.use.hasTouch !== true;

const isTouch = () => Boolean(test.info().project.use.hasTouch);

/** The variables whose values must never reach a page. */
const SECRETS = ["SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "ANTHROPIC_API_KEY", "AI_WEBHOOK_SECRET", "AI_REVIEW_WEBHOOK_URL", "AI_REPORT_WEBHOOK_URL"];

/** What a hand-off's pill may say (aiPill in components/shell/admin-status-cards.tsx). */
const AI_PILL = /^(Connected|Not Connected|Test Data Only|Configuration Error)$/;

/**
 * A screenshot under screenshots/shell/: the full page on the desktop, the
 * viewport on the iPads (a full-page capture drops touch emulation while it
 * resizes, e2e/README.md).
 */
async function shot(page: Page, name: string) {
  // Hide the dev-only Next.js indicator: it sits on top of the sidebar's user block.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({
    path: `screenshots/shell/${test.info().project.name}-${name}.png`,
    fullPage: !isTouch(),
    animations: "disabled",
    caret: "initial",
  });
}

/** A card: a section named by its h2 title. */
function card(page: Page, title: string): Locator {
  return page.getByRole("region", { name: title, exact: true });
}

/** Where the admin pages are listed: the sidebar from 1280 px, the row at the top of the page below. */
function adminPages(page: Page): Locator {
  return page.getByRole("navigation", { name: isDesktop(page) ? "Main" : "Admin" });
}

async function expectNoSecrets(page: Page) {
  const html = await page.content();
  for (const name of SECRETS) {
    const value = process.env[name]?.trim();
    if (value) expect(html.includes(value), `${name} must not reach the page`).toBe(false);
  }
}

test.describe("as the admin", () => {
  // One sign-in per size, shared by the tests: the shared project rate-limits sign-ins.
  let cookies: SessionCookie[] = [];
  test.beforeAll(async () => {
    cookies = await sessionCookies(TEST_ACCOUNTS.admin);
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
  });

  test("General Settings: Supabase and the sign-in emails, never a secret", async ({ page }) => {
    await page.goto("/admin/settings");
    await expect(page).toHaveTitle("General Settings · SteriCare QC");
    await expect(page.getByRole("heading", { level: 1, name: "General Settings" })).toBeVisible();

    // Two cards, each titled by an h2 under the page's h1; the Steri-AI cards are Steri-AI Settings'.
    await expect(page.getByRole("main").getByRole("heading", { level: 2 })).toHaveText(["Supabase", "Sign-In Emails"]);
    for (const title of ["Supabase", "Sign-In Emails"]) {
      await expect(card(page, title).getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
    }

    // The admin's own session reads every account and reference table (Row Level Security lets it).
    const supabase = card(page, "Supabase");
    await expect(supabase.getByText("Ready", { exact: true })).toBeVisible();
    await expect(supabase.getByText(/^\d+ active \(\d+ admins?, \d+ inspectors?\)/)).toBeVisible();
    await expect(supabase.getByText("Not Readable")).toHaveCount(0);

    // The email links start with the Supabase project's Site URL: the card says
    // what it must be (this app's address, as getSiteUrl() reads it) and links
    // to the setting.
    const emails = card(page, "Sign-In Emails");
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
    await expect(emails.getByText(`${siteUrl}/**`, { exact: true })).toBeVisible();
    await expect(emails.getByRole("link", { name: /Open the URL Settings/ })).toHaveAttribute(
      "href",
      /^https:\/\/supabase\.com\/dashboard\/project\/[a-z0-9]+\/auth\/url-configuration$/,
    );
    await expect(emails.getByRole("link", { name: /Set-Up Guide/ })).toHaveAttribute("target", "_blank");
    if (isTouch()) {
      for (const link of await emails.getByRole("link").all()) {
        expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
    }

    // Its nav entry is current, and the admin row, one entry longer, wraps rather than widening the page.
    const pages = adminPages(page);
    await expect(pages.getByRole("link", { name: "General Settings" })).toHaveAttribute("aria-current", "page");
    await expect(pages.locator("a[aria-current]")).toHaveCount(1);
    await expectNoPageScroll(page);

    await expectNoSecrets(page);
    await shot(page, "admin-settings");
  });

  test("Steri-AI Settings' General: the second opinion and the report under the key, never a secret", async ({ page }) => {
    await page.goto("/admin/ai");
    await expect(page).toHaveTitle("Steri-AI Settings · SteriCare QC");
    await expect(page.getByTestId("ai-general")).toBeVisible();

    const review = card(page, "Steri-AI Second Opinion");
    const report = card(page, "Steri-AI Report");
    for (const [title, section] of [
      ["Steri-AI Second Opinion", review],
      ["Steri-AI Report", report],
    ] as const) {
      await expect(section.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
      await expect(section.locator('[data-slot="status-pill"]').first()).toHaveText(AI_PILL);
      await expect(section.getByText("Provider", { exact: true })).toBeVisible();
    }

    // Under the key's cards, side by side from 1024 px, one above the other on iPad portrait.
    const connection = (await card(page, "Connection").boundingBox())!;
    const reviewBox = (await review.boundingBox())!;
    const reportBox = (await report.boundingBox())!;
    expect(reviewBox.y).toBeGreaterThan(connection.y + connection.height);
    if ((page.viewportSize()?.width ?? 0) >= 1024) expect(reportBox.y).toBe(reviewBox.y);
    else expect(reportBox.y).toBeGreaterThan(reviewBox.y + reviewBox.height);
    await expectNoPageScroll(page);
    await expectNoSecrets(page);
    await shot(page, "admin-ai-general");

    // They are General's alone.
    await page.goto("/admin/ai?view=inspection");
    await expect(page.getByTestId("ai-inspection-settings")).toBeVisible();
    await expect(page.getByRole("heading", { name: /^Steri-AI (Second Opinion|Report)$/ })).toHaveCount(0);
  });
});
