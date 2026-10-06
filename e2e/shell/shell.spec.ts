import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookies, signIn, TEST_ACCOUNTS } from "../support/session";

/**
 * The app shell, the admin overview, the manifest and the 404 and error
 * screens (BUILD_SPEC 8, 10, 12 Phase 1), at the three sizes in
 * playwright.config.ts. Screenshots go to screenshots/shell/ (git-ignored).
 *
 * The inspector has no shell page of their own until the inspections list is
 * merged, and nothing in the app throws on purpose, so four checks take a
 * page from the environment and skip without one:
 *
 *   SHELL_E2E_PAGE             a signed-in page inside the shell (default
 *                              /inspections; skipped while it is a 404)
 *   SHELL_E2E_ERROR_PAGE       a page inside the shell that throws
 *   SHELL_E2E_SLOW_PAGE        a page inside the shell that takes a few seconds
 *   SHELL_E2E_ROOT_ERROR_PAGE  a page outside the shell that throws (under /auth/,
 *                              which needs no session)
 */
const SHELL_PAGE = process.env.SHELL_E2E_PAGE || "/inspections";
const ERROR_PAGE = process.env.SHELL_E2E_ERROR_PAGE;
const SLOW_PAGE = process.env.SHELL_E2E_SLOW_PAGE;
const ROOT_ERROR_PAGE = process.env.SHELL_E2E_ROOT_ERROR_PAGE;

/** The desktop layout starts at 1280 px (BUILD_SPEC 8). */
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280;

async function shot(page: Page, name: string, fullPage = true) {
  // Hide the dev-only Next.js indicator: it sits on top of the sidebar's user block.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({
    path: `screenshots/shell/${test.info().project.name}-${name}.png`,
    fullPage,
    animations: "disabled",
  });
}

/** The visible bar: the sidebar from 1280 px, the top bar below. */
function shellBar(page: Page) {
  return page.getByTestId(isDesktop(page) ? "shell-sidebar" : "shell-top-bar");
}

type SessionCookie = Awaited<ReturnType<typeof sessionCookies>>[number];

/**
 * One sign-in per account and size, shared by that describe's tests: the
 * shared project rate-limits sign-ins per address, and other specs run too.
 */
function useAccount(email: string) {
  let cookies: SessionCookie[] = [];
  test.beforeAll(async () => {
    cookies = await sessionCookies(email);
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await addSession(context, baseURL!, cookies);
  });
}

function addSession(context: BrowserContext, baseURL: string, cookies: SessionCookie[]) {
  return context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

async function openUserMenu(page: Page) {
  await page.getByRole("button", { name: /account menu/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  // Let the 100 ms zoom-in finish, or sizes are measured mid-scale.
  await menu.evaluate((element) => Promise.all(element.getAnimations({ subtree: true }).map((animation) => animation.finished)));
  return menu;
}

// React reports hydration mismatches as console errors; none are allowed.
let hydrationErrors: string[] = [];
test.beforeEach(({ page }) => {
  hydrationErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /hydrat/i.test(message.text())) hydrationErrors.push(message.text());
  });
});
test.afterEach(() => {
  expect(hydrationErrors).toEqual([]);
});

test.describe("signed out", () => {
  test("/ sends a visitor to sign in", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/login$/);
  });

  test("the manifest and its icons load without a session", async ({ request }) => {
    const response = await request.get("/manifest.webmanifest");
    expect(response.status()).toBe(200);
    expect(response.headers()["content-type"]).toContain("application/manifest+json");

    const manifest = await response.json();
    expect(manifest).toMatchObject({
      name: "SteriCare QC",
      short_name: "SteriCare QC",
      start_url: "/inspections",
      scope: "/",
      display: "standalone",
      orientation: "any",
      background_color: "#f5f9fc",
    });
    expect(manifest.icons.map((icon: { purpose: string }) => icon.purpose)).toContain("maskable");
    for (const icon of manifest.icons as { src: string }[]) {
      const image = await request.get(icon.src);
      expect(image.status(), icon.src).toBe(200);
      expect(image.headers()["content-type"]).toBe("image/png");
    }
  });

  test("pages link the manifest", async ({ page }) => {
    await page.goto("/auth/no-such-page");
    await expect(page.locator('link[rel="manifest"]')).toHaveAttribute("href", "/manifest.webmanifest");
  });

  test("an unknown address shows the 404 page", async ({ page }) => {
    // /auth/* is open to visitors, so this one is not sent to sign in first.
    const response = await page.goto("/auth/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page).toHaveTitle("Page not found · SteriCare QC");
    await expect(page.getByRole("link", { name: "Go to inspections" })).toHaveAttribute("href", "/inspections");
    await shot(page, "signed-out-404");
  });

  test("an error outside the app shows the standalone error page", async ({ page }) => {
    test.skip(!ROOT_ERROR_PAGE, "Set SHELL_E2E_ROOT_ERROR_PAGE to a page outside the shell that throws.");
    const response = await page.goto(ROOT_ERROR_PAGE!);
    expect(response?.status()).toBe(500);
    await expect(page.getByRole("heading", { name: "This page did not load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText(/^Reference:/)).toBeVisible();
    await expect(page.getByRole("link", { name: "SteriCare home" })).toBeVisible();
    await shot(page, "root-error");
  });
});

test.describe("as the admin", () => {
  useAccount(TEST_ACCOUNTS.admin);

  test("/ goes to the inspections list", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/inspections$/);
  });

  test("the shell: top bar with tabs below 1280 px, sidebar from 1280 px", async ({ page }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();

    const topBar = page.getByTestId("shell-top-bar");
    const sidebar = page.getByTestId("shell-sidebar");
    const nav = page.getByRole("navigation", { name: "Main" });

    if (isDesktop(page)) {
      await expect(sidebar).toBeVisible();
      await expect(topBar).toBeHidden();
      await expect(sidebar.getByRole("link", { name: "SteriCare home" })).toBeVisible();
      await expect(nav.getByText("Admin", { exact: true })).toBeVisible();
      await expect(nav.getByRole("link")).toHaveText(["Inspections", "Overview", "Users"]);
      await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      for (const planned of ["Manufacturers", "Clients", "Defects", "Templates"]) {
        await expect(nav.getByText(planned, { exact: true })).toBeVisible();
      }
      await expect(nav.getByText("Phase 3")).toHaveCount(4);
      // The sidebar stays put while the page scrolls.
      const box = await sidebar.boundingBox();
      expect(box?.height).toBe(page.viewportSize()?.height);
    } else {
      await expect(topBar).toBeVisible();
      await expect(sidebar).toBeHidden();
      await expect(topBar.getByRole("link", { name: "SteriCare home" })).toBeVisible();
      await expect(nav.getByRole("link")).toHaveText(["Inspections", "Admin"]);
      await expect(nav.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "page");
      await expect(nav.getByRole("link", { name: "Inspections" })).not.toHaveAttribute("aria-current", "page");
      // Tabs are touch targets.
      for (const tab of await nav.getByRole("link").all()) {
        expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      // No sidebar, so the admin pages are listed at the top of the page.
      const section = page.getByRole("navigation", { name: "Admin" });
      await expect(section.getByRole("link")).toHaveText(["Overview", "Users"]);
      await expect(section.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      await expect(section.getByText("Manufacturers, Clients, Defects and Templates")).toBeVisible();
      // The top bar sticks while the page scrolls.
      await page.mouse.wheel(0, 600);
      await expect.poll(async () => (await topBar.boundingBox())?.y).toBe(0);
    }
  });

  test("the admin overview shows status, never secrets", async ({ page }) => {
    await page.goto("/admin");
    for (const card of ["Supabase", "Sign-in emails", "AI second opinion", "AI report"]) {
      await expect(page.getByRole("heading", { level: 3, name: card })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Invite people/ })).toHaveAttribute("href", "/admin/users");
    await expect(page.getByRole("link", { name: /Every inspection/ })).toHaveAttribute("href", "/inspections");
    await expect(page.getByRole("link", { name: /Set-up guide/ })).toHaveAttribute("target", "_blank");
    await expect(page).toHaveTitle("Admin overview · SteriCare QC");

    const html = await page.content();
    for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "ANTHROPIC_API_KEY", "AI_WEBHOOK_SECRET", "AI_REVIEW_WEBHOOK_URL", "AI_REPORT_WEBHOOK_URL"]) {
      const value = process.env[name]?.trim();
      if (value) expect(html.includes(value), `${name} must not reach the page`).toBe(false);
    }
    await shot(page, "admin-overview");
  });

  test("the user menu shows who is signed in", async ({ page }) => {
    await page.goto("/admin");
    const menu = await openUserMenu(page);
    await expect(menu.getByText(TEST_ACCOUNTS.admin)).toBeVisible();
    await expect(menu.getByText("Admin", { exact: true })).toBeVisible();
    const signOut = menu.getByRole("menuitem", { name: "Sign out" });
    await expect(signOut).toBeVisible();
    expect((await signOut.boundingBox())?.height).toBeGreaterThanOrEqual(isDesktop(page) ? 28 : 44);
    await shot(page, "admin-user-menu");
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("the keyboard reaches the content first", async ({ page }) => {
    await page.goto("/admin");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("an unknown address shows the 404 page", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await shot(page, "admin-404");
    await page.getByRole("link", { name: "Go to inspections" }).click();
    await expect(page).toHaveURL(/\/inspections$/);
  });

  test("Sign out ends the session", async ({ page, context, baseURL }) => {
    // A session of its own: signing out revokes it, and the other tests share theirs.
    await context.clearCookies();
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin");
    const menu = await openUserMenu(page);
    await menu.getByRole("menuitem", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/login$/);
    expect((await context.cookies()).filter((cookie) => cookie.name.includes("-auth-token"))).toEqual([]);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  });

  test("an error in a page shows inside the shell", async ({ page }) => {
    test.skip(!ERROR_PAGE, "Set SHELL_E2E_ERROR_PAGE to a page that throws.");
    await page.goto(ERROR_PAGE!);
    await expect(page.getByRole("heading", { name: "This page did not load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to inspections" })).toBeVisible();
    await expect(shellBar(page)).toBeVisible();
    await shot(page, "admin-error");
  });

  test("a page loading shows the skeleton inside the shell", async ({ page }) => {
    test.skip(!SLOW_PAGE, "Set SHELL_E2E_SLOW_PAGE to a page that takes a few seconds.");
    await page.goto(SLOW_PAGE!, { waitUntil: "commit" });
    await expect(page.locator('main [role="status"]')).toBeAttached();
    await expect(shellBar(page)).toBeVisible();
    await shot(page, "admin-loading", false);
  });
});

test.describe("as the inspector", () => {
  useAccount(TEST_ACCOUNTS.inspector);

  test("/ goes to the inspections list", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/inspections$/);
  });

  test("/admin is a 404", async ({ page }) => {
    const response = await page.goto("/admin");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    expect(response?.status()).toBe(404);
    await expect(page.getByText("Overview")).toHaveCount(0);
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await shot(page, "inspector-admin-404");
  });

  test("the shell has no Admin for an inspector", async ({ page }) => {
    const response = await page.goto(SHELL_PAGE);
    test.skip(response?.status() === 404, `${SHELL_PAGE} is not built in this branch; set SHELL_E2E_PAGE.`);

    const nav = page.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link")).toHaveText(["Inspections"]);
    if (SHELL_PAGE.startsWith("/inspections")) {
      await expect(nav.getByRole("link", { name: "Inspections" })).toHaveAttribute("aria-current", "page");
    }
    await expect(page.locator('a[href^="/admin"]')).toHaveCount(0);
    await expect(page.getByText("Phase 3")).toHaveCount(0);
    await shot(page, "inspector-shell");

    const menu = await openUserMenu(page);
    await expect(menu.getByText(TEST_ACCOUNTS.inspector)).toBeVisible();
    await expect(menu.getByText("Inspector", { exact: true })).toBeVisible();
    await shot(page, "inspector-user-menu");
  });
});
