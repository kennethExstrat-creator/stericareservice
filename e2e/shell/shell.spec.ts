import { expect, test, type BrowserContext, type Locator, type Page, type Route } from "@playwright/test";
import { expectNoPageScroll } from "../support/layout";
import { sessionCookies, signIn, TEST_ACCOUNTS } from "../support/session";
import { createShellFixture, type ShellFixture } from "./fixtures";

/**
 * The app shell, the admin overview, Sign Out, the manifest and the 404 and
 * error screens (BUILD_SPEC 8, 10, 12), at the three sizes in
 * playwright.config.ts. Screenshots go to screenshots/shell/ (git-ignored).
 *
 * The admin's tests that need a template version or an inspection make their
 * own (./fixtures.ts) and delete them afterwards. Nothing in the app throws or
 * stalls on purpose, so three checks take a page from the environment and
 * skip without one; a fourth can point at another shell page:
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

/** The error screens' tab title (components/shell/error-screen.tsx). */
const ERROR_TITLE = "This Page Did Not Load · SteriCare QC";

/** The admin section's pages, in the nav's order (components/shell/nav.ts). */
const ADMIN_PAGES = ["Overview", "Users", "Manufacturers", "Clients", "Defects", "Templates"];

/** Photo uploads to Storage (lib/photos/supabase-adapters.ts). */
const PHOTO_UPLOADS = "**/storage/v1/object/inspection-photos/**";

/** What Sign Out says while photos or files wait on this device (components/shell/sign-out-check.ts). */
const UPLOADS_WAITING = "Some photos or files are still only on this device. They will not upload while you are signed out";

/** What Sign Out says when its request fails, or has no answer within SIGN_OUT_TIMEOUT_MS (15 s). */
const SIGN_OUT_FAILED = "You are still signed in";
const SIGN_OUT_SLOW = "Signing out is taking too long";

// Dev servers compile each page on its first visit, and the Mac running these is shared.
test.describe.configure({ timeout: 90_000 });

/** The desktop layout: 1280 px and wider with a mouse or trackpad; every touch size is the iPad layout (app/globals.css). */
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280 && test.info().project.use.hasTouch !== true;

const isTouch = () => Boolean(test.info().project.use.hasTouch);

/**
 * A screenshot under screenshots/shell/. Full page on the desktop. A full-page
 * capture drops touch emulation while it resizes (e2e/README.md), so the iPads
 * get the viewport, scrolled: name.png, or name-1.png, name-2.png ... for a
 * longer page. `fullPage` false takes the viewport as it is (a menu, a
 * dialog). caret "initial" leaves the inputs alone: Playwright's caret hiding
 * writes a style attribute, which React would report as a hydration mismatch
 * if it landed first.
 */
async function shot(page: Page, name: string, fullPage = true) {
  // Hide the dev-only Next.js indicator: it sits on top of the sidebar's user block.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const path = (part = "") => `screenshots/shell/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  if (!fullPage || !isTouch()) {
    await page.screenshot({ ...options, path: path(), fullPage });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.max(1, Math.ceil(height / viewport));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The visible bar: the sidebar from 1280 px, the top bar below. */
function shellBar(page: Page) {
  return page.getByTestId(isDesktop(page) ? "shell-sidebar" : "shell-top-bar");
}

/** Where the admin pages are listed: the sidebar from 1280 px, the row at the top of the page below. */
function adminPages(page: Page) {
  return page.getByRole("navigation", { name: isDesktop(page) ? "Main" : "Admin" });
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

/** The Supabase session cookies the browser holds. */
async function authCookies(context: BrowserContext) {
  return (await context.cookies()).filter((cookie) => cookie.name.includes("-auth-token"));
}

/** Lets a menu's or dialog's 100 ms zoom-in finish, or sizes are measured mid-scale. */
async function settled(element: Locator) {
  await element.evaluate((node) => Promise.all(node.getAnimations({ subtree: true }).map((animation) => animation.finished)));
}

async function openUserMenu(page: Page) {
  await page.getByRole("button", { name: /account menu/ }).click();
  const menu = page.getByRole("menu");
  await expect(menu).toBeVisible();
  await settled(menu);
  return menu;
}

/**
 * Holds back Server Actions from now on (Sign out's is the only one these
 * pages send): a POST carrying Next.js's next-action header. "abort" fails it
 * as a dropped connection does; "stall" keeps it waiting, as Wi-Fi without
 * internet does. It never reaches the server, so the session stays. The
 * function returned lets go: stalled requests fail first, because unrouting
 * stops the browser holding them, and they would then reach the server.
 */
async function holdServerActions(page: Page, mode: "abort" | "stall") {
  const stalled: Route[] = [];
  const handler = async (route: Route) => {
    const request = route.request();
    if (request.method() !== "POST" || !(await request.headerValue("next-action"))) return route.fallback();
    if (mode === "abort") return route.abort("internetdisconnected");
    stalled.push(route);
  };
  await page.route("**/*", handler);
  return async () => {
    await Promise.all(stalled.map((route) => route.abort("internetdisconnected")));
    await page.unroute("**/*", handler);
  };
}

/** A photo as the iPad's library hands it over: a JPEG drawn by the browser. */
async function drawPhoto(page: Page) {
  const dataUrl = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 800;
    canvas.height = 600;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No 2D canvas");
    context.fillStyle = "#0074d6";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = "#ffffff";
    context.font = "bold 96px sans-serif";
    context.fillText("Glove", 80, 340);
    return canvas.toDataURL("image/jpeg", 0.9);
  });
  return {
    name: "glove-palm.jpg",
    mimeType: "image/jpeg",
    buffer: Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64"),
  };
}

/**
 * Uncaught errors and console errors on the page from now on, apart from
 * requests the test itself cut off. Sign out rethrows the Server Action's
 * redirect to Next.js: it must never surface as an error.
 */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !/^Failed to load resource/.test(message.text())) errors.push(message.text());
  });
  return () => errors;
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
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
    await expect(page).toHaveTitle("Page Not Found · SteriCare QC");
    await expect(page.getByRole("link", { name: "Go to Inspections" })).toHaveAttribute("href", "/inspections");
    await shot(page, "signed-out-404");
  });

  test("an error outside the app shows the standalone error page", async ({ page }) => {
    test.skip(!ROOT_ERROR_PAGE, "Set SHELL_E2E_ROOT_ERROR_PAGE to a page outside the shell that throws.");
    const response = await page.goto(ROOT_ERROR_PAGE!);
    expect(response?.status()).toBe(500);
    const heading = page.getByRole("heading", { name: "This Page Did Not Load" });
    await expect(heading).toBeVisible();
    // Focus on the heading, so VoiceOver reads what happened; the tab says it too.
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(ERROR_TITLE);
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
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
      // Every admin screen is a link; nothing is announced as coming.
      await expect(nav.getByRole("link")).toHaveText(["Inspections", ...ADMIN_PAGES]);
      await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      await expect(nav.locator("a[aria-current]")).toHaveCount(1);
      await expect(nav.getByText(/Phase \d|coming/i)).toHaveCount(0);
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
      // Tabs and the logo's home link are touch targets.
      for (const tab of await nav.getByRole("link").all()) {
        expect((await tab.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      expect((await topBar.getByRole("link", { name: "SteriCare home" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
      // No sidebar, so the admin pages are listed at the top of the page: every one a link.
      const section = page.getByRole("navigation", { name: "Admin" });
      await expect(section.getByRole("link")).toHaveText(ADMIN_PAGES);
      await expect(section.getByRole("link", { name: "Overview" })).toHaveAttribute("aria-current", "page");
      await expect(section.getByText(/Coming in|Phase \d/)).toHaveCount(0);
      for (const pill of await section.getByRole("link").all()) {
        expect((await pill.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
      // The top bar sticks while the page scrolls.
      await page.mouse.wheel(0, 600);
      await expect.poll(async () => (await topBar.boundingBox())?.y).toBe(0);
    }
  });

  test("the top bar fits narrow iPad windows", async ({ page }) => {
    test.skip(test.info().project.name !== "ipad-portrait", "Sets its own iPad window sizes; once is enough.");
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const topBar = page.getByTestId("shell-top-bar");
    const nav = topBar.getByRole("navigation", { name: "Main" });
    const trigger = topBar.getByRole("button", { name: /account menu/ });

    // A long name (the test account's is short; it must not change): the
    // name gives way, never the tabs. Swapped in once React has hydrated the
    // button (its DOM node carries React's fiber key), or hydration would
    // report a mismatch.
    await expect
      .poll(() => trigger.evaluate((element) => Object.keys(element).some((key) => key.startsWith("__reactFiber$"))))
      .toBe(true);
    const name = (await trigger.getAttribute("aria-label"))!.replace(/, account menu$/, "");
    const longName = "Maximiliana Wolfeschlegelsteinhausen-Bergdorff";
    await trigger.getByText(name, { exact: true }).evaluate((element, text) => {
      element.textContent = text;
    }, longName);
    const nameText = trigger.getByText(longName, { exact: true });

    // iPad mini portrait, half Split View, Slide Over.
    for (const width of [744, 585, 320]) {
      await page.setViewportSize({ width, height: 1180 });
      const bar = await trigger.boundingBox();
      expect(bar, `${width} px`).not.toBeNull();
      for (const tab of await nav.getByRole("link").all()) {
        const box = (await tab.boundingBox())!;
        expect(box.x + box.width, `${width} px: tab clear of the account menu`).toBeLessThanOrEqual(bar!.x);
        expect(box.height).toBeGreaterThanOrEqual(44);
      }
      expect(bar!.x + bar!.width, `${width} px: account menu inside the window`).toBeLessThanOrEqual(width);
      expect(bar!.height).toBeGreaterThanOrEqual(44);
      // The home link (the mark below 640 px) stays a 44 px target.
      const home = (await topBar.getByRole("link", { name: "SteriCare home" }).boundingBox())!;
      expect(Math.min(home.width, home.height), `${width} px: home link`).toBeGreaterThanOrEqual(44);
      expect(await topBar.evaluate((element) => element.scrollWidth <= element.clientWidth), `${width} px`).toBe(true);

      if (width === 744) {
        // Shortened with an ellipsis, still there.
        await expect(nameText).toBeVisible();
        expect(await nameText.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
        await shot(page, "admin-top-bar-744", false);
      } else {
        // Only the avatar: the name is in the menu and the button's label.
        await expect(nameText).toBeHidden();
      }
    }
    // Tabs keep their names for screen readers when only the icons show.
    await expect(nav.getByRole("link")).toHaveText(["Inspections", "Admin"]);
    // The admin row wraps rather than widening the page.
    await expectNoPageScroll(page);
    await shot(page, "admin-top-bar-320", false);
  });

  test("the admin overview: what waits, every admin screen, the status, never secrets", async ({ page }) => {
    await page.goto("/admin");
    await expect(page).toHaveTitle("Admin Overview · SteriCare QC");

    // What waits for an admin: the submitted inspections, counted, and linked filtered.
    const waiting = page.getByRole("region", { name: "Inspections", exact: true });
    const awaiting = waiting.getByRole("link", { name: /^Awaiting Approval\b/ });
    await expect(awaiting).toHaveAttribute("href", "/inspections?status=submitted");
    await expect(awaiting).toContainText(
      /\d+ submitted inspections? to approve or reopen\.|Nothing to approve: no inspection is submitted\./,
    );
    await expect(waiting.getByRole("link", { name: /Every inspection/ })).toHaveAttribute("href", "/inspections");

    // Every admin screen, unmapped defect labels beside the codes; nothing announced as coming.
    const setUp = page.getByRole("region", { name: "Set-Up", exact: true });
    const screens: [RegExp, string][] = [
      [/^Users\b.*Invite people/, "/admin/users"],
      [/^Manufacturers\b/, "/admin/manufacturers"],
      [/^Clients\b/, "/admin/clients"],
      [/^Defect Codes\b/, "/admin/defects"],
      [/^Unmapped Labels\b/, "/admin/defects/unmapped"],
      [/^Templates\b/, "/admin/templates"],
    ];
    await expect(setUp.getByRole("link")).toHaveCount(screens.length);
    for (const [name, href] of screens) {
      await expect(setUp.getByRole("link", { name }), href).toHaveAttribute("href", href);
    }
    await expect(page.getByText(/Coming in|Phase \d|next build/)).toHaveCount(0);
    if (isTouch()) {
      for (const link of [awaiting, ...(await setUp.getByRole("link").all())]) {
        expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
      }
    }

    for (const card of ["Supabase", "Sign-In Emails", "AI Second Opinion", "AI Report"]) {
      await expect(page.getByRole("heading", { level: 3, name: card })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: /Set-Up Guide/ })).toHaveAttribute("target", "_blank");

    // The email links start with the Supabase project's Site URL: the card says
    // what it must be (this app's address, as getSiteUrl() reads it) and links
    // to the setting.
    const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL?.trim() || "http://localhost:3000").replace(/\/+$/, "");
    await expect(page.getByText(`${siteUrl}/**`, { exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: /Open the URL Settings/ })).toHaveAttribute(
      "href",
      /^https:\/\/supabase\.com\/dashboard\/project\/[a-z0-9]+\/auth\/url-configuration$/,
    );

    const html = await page.content();
    for (const name of ["SUPABASE_SECRET_KEY", "SUPABASE_DB_URL", "ANTHROPIC_API_KEY", "AI_WEBHOOK_SECRET", "AI_REVIEW_WEBHOOK_URL", "AI_REPORT_WEBHOOK_URL"]) {
      const value = process.env[name]?.trim();
      if (value) expect(html.includes(value), `${name} must not reach the page`).toBe(false);
    }
    await shot(page, "admin-overview");

    // Awaiting Approval opens the list, filtered to what an admin approves or reopens.
    await awaiting.click();
    await expect(page).toHaveURL(/\/inspections\?status=submitted$/);
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveText("Submitted");
  });

  test("the user menu shows who is signed in", async ({ page }) => {
    await page.goto("/admin");
    const menu = await openUserMenu(page);
    await expect(menu.getByText(TEST_ACCOUNTS.admin)).toBeVisible();
    await expect(menu.getByText("Admin", { exact: true })).toBeVisible();
    const signOut = menu.getByRole("menuitem", { name: "Sign Out" });
    await expect(signOut).toBeVisible();
    expect((await signOut.boundingBox())?.height).toBeGreaterThanOrEqual(isDesktop(page) ? 28 : 44);
    await shot(page, "admin-user-menu", false);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  test("the keyboard reaches the content first", async ({ page }) => {
    await page.goto("/admin");
    await page.keyboard.press("Tab");
    const skip = page.getByRole("link", { name: "Skip to Content" });
    await expect(skip).toBeFocused();
    await expect(skip).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(page.locator("#main-content")).toBeFocused();
  });

  test("an unknown address shows the 404 page", async ({ page }) => {
    const response = await page.goto("/no-such-page");
    expect(response?.status()).toBe(404);
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
    await shot(page, "admin-404");
    await page.getByRole("link", { name: "Go to Inspections" }).click();
    await expect(page).toHaveURL(/\/inspections$/);
    // Rendered in full before the test closes the page, so the server never streams into a closed tab.
    await expect(page.getByRole("heading", { level: 1, name: "Inspections" })).toBeVisible();
    await expect(page.locator('section[aria-label="Inspections"] [role="status"]')).not.toBeEmpty();
  });

  test("Sign Out ends the session at once when nothing waits on this device", async ({ page, context, baseURL }) => {
    // A session of its own: signing out revokes it, and the other tests share theirs.
    await context.clearCookies();
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/admin");
    const errors = watchErrors(page);
    const menu = await openUserMenu(page);
    await menu.getByRole("menuitem", { name: "Sign Out" }).click();
    // No question first: straight to sign-in.
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("alertdialog")).toHaveCount(0);
    expect(await authCookies(context)).toEqual([]);
    expect(errors()).toEqual([]);

    await page.goto("/admin");
    await expect(page).toHaveURL(/\/login\?next=%2Fadmin$/);
  });

  test("Sign Out that does not reach the server keeps the session and gives the menu back", async ({ page, context }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const errors = watchErrors(page);
    const release = await holdServerActions(page, "abort");
    const menu = await openUserMenu(page);
    await menu.getByRole("menuitem", { name: "Sign Out", exact: true }).click();

    await expect(page.getByText(SIGN_OUT_FAILED)).toBeVisible();
    await expect(page.getByText("Signing out did not reach the server.")).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Sign Out", exact: true })).toBeVisible();
    await expect(page).toHaveURL(/\/admin$/);
    expect(await authCookies(context)).not.toEqual([]);
    // The page is the user's again: the menu closes.
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
    await release();
    // The failed request is reported by the toast, never as an error on the page.
    expect(errors()).toEqual([]);
  });

  test("Sign Out with no answer gives the page back after its time limit", async ({ page, context }) => {
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    const errors = watchErrors(page);
    const release = await holdServerActions(page, "stall");
    try {
      const menu = await openUserMenu(page);
      await menu.getByRole("menuitem", { name: "Sign Out", exact: true }).click();
      // Waiting for the server: the menu says so and stays.
      await expect(menu.getByRole("menuitem", { name: "Signing Out…" })).toBeVisible();

      // 15 s on, the page comes back, without claiming the request failed: it may still go through.
      const slow = page.getByText(SIGN_OUT_SLOW);
      await expect(slow).toBeVisible({ timeout: 25_000 });
      await expect(page.getByText("The server has not answered yet.")).toBeVisible();
      await expect(page.getByText(SIGN_OUT_FAILED)).toHaveCount(0);
      await expect(menu.getByRole("menuitem", { name: "Sign Out", exact: true })).toBeVisible();
      await shot(page, "admin-sign-out-no-answer", false);
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
      await expect(page).toHaveURL(/\/admin$/);
      expect(await authCookies(context)).not.toEqual([]);
      // Back at work: the shell's links go again.
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("link", { name: "Inspections", exact: true }).click();
      await expect(page).toHaveURL(/\/inspections$/);
      await expect(page.getByRole("heading", { level: 1, name: "Inspections" })).toBeVisible();
      await expect(page.locator('section[aria-label="Inspections"] [role="status"]')).not.toBeEmpty();
    } finally {
      await release();
    }
    expect(errors()).toEqual([]);
    // The request never reached the server: the session still opens the admin pages.
    await page.goto("/admin");
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
  });

  test("an error in a page shows inside the shell", async ({ page }) => {
    test.skip(!ERROR_PAGE, "Set SHELL_E2E_ERROR_PAGE to a page that throws.");
    await page.goto(ERROR_PAGE!);
    const heading = page.getByRole("heading", { name: "This Page Did Not Load" });
    await expect(heading).toBeVisible();
    // The message replaces the page: focus goes to its heading, not <body>.
    await expect(heading).toBeFocused();
    await expect(page.getByRole("button", { name: "Try Again" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Go to Inspections" })).toBeVisible();
    await expect(shellBar(page)).toBeVisible();
    await shot(page, "admin-error");

    // A retry that fails again says so again.
    await page.getByRole("button", { name: "Try Again" }).click();
    await expect(heading).toBeFocused();

    // After a client-side navigation (away through the nav, then Back) the tab
    // title changes and Next's route announcer reads it out.
    const away = isDesktop(page) ? "Overview" : "Admin";
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: away }).click();
    await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
    await page.goBack();
    await expect(heading).toBeFocused();
    await expect(page).toHaveTitle(ERROR_TITLE);
    await expect(page.locator("#__next-route-announcer__")).toHaveText(ERROR_TITLE);
  });

  test("a page loading shows the skeleton inside the shell", async ({ page }) => {
    test.skip(!SLOW_PAGE, "Set SHELL_E2E_SLOW_PAGE to a page that takes a few seconds.");
    await page.goto(SLOW_PAGE!, { waitUntil: "commit" });
    await expect(page.locator('main [role="status"]')).toBeAttached();
    await expect(shellBar(page)).toBeVisible();
    await shot(page, "admin-loading", false);
  });

  test.describe("with a template version and an inspection of its own", () => {
    let fixture: ShellFixture;

    test.beforeAll(async ({}, testInfo) => {
      fixture = await createShellFixture(testInfo.project.name);
    });

    test.afterAll(async () => {
      await fixture?.cleanup();
    });

    test("Defects and Templates stay current on the pages below them", async ({ page }) => {
      const below = [
        { path: "/admin/defects/labels", entry: "Defects", heading: "Defects" },
        { path: `/admin/templates/${fixture.templateId}/edit`, entry: "Templates", heading: null },
      ];
      for (const { path, entry, heading } of below) {
        await page.goto(path);
        if (heading) await expect(page.getByRole("heading", { level: 1, name: heading })).toBeVisible();
        // Inside the section, not the page itself: "true", never "page", and only this entry.
        const pages = adminPages(page);
        await expect(pages.getByRole("link", { name: entry, exact: true }), path).toHaveAttribute("aria-current", "true");
        await expect(pages.locator("a[aria-current]"), path).toHaveCount(1);
        if (!isDesktop(page)) {
          const tabs = page.getByRole("navigation", { name: "Main" });
          await expect(tabs.getByRole("link", { name: "Admin" })).toHaveAttribute("aria-current", "true");
          await expect(tabs.locator("a[aria-current]")).toHaveCount(1);
        }
        await shot(page, `admin-nav-${entry.toLowerCase()}-below`, false);
      }

      // Back up to the list, where the entry is the page itself.
      const templates = adminPages(page).getByRole("link", { name: "Templates", exact: true });
      await templates.click();
      await expect(page).toHaveURL(/\/admin\/templates$/);
      await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
      await expect(templates).toHaveAttribute("aria-current", "page");
    });

    test("Sign Out asks first while a photo waits on this device", async ({ page, context, baseURL }) => {
      // A session of its own: signing out revokes it, and the other tests share theirs.
      await context.clearCookies();
      await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
      // Uploads fail as on a dropped connection, so the photo stays on this device.
      await page.route(PHOTO_UPLOADS, (route) => route.abort("internetdisconnected"));
      const errors = watchErrors(page);
      const gallery = `/inspections/${fixture.inspectionId}/photos`;
      await page.goto(gallery);
      await expect(page.getByRole("heading", { level: 1, name: "Photos and Files" })).toBeVisible();
      await page.locator('input[data-photo-input="library"]').setInputFiles(await drawPhoto(page));
      const badge = page.locator('[data-slot="upload-badge"]');
      await expect(badge).toHaveAttribute("data-count", "1", { timeout: 20_000 });

      const dialog = page.getByRole("alertdialog", { name: "Sign Out Now?" });
      const stay = dialog.getByRole("button", { name: "Stay Signed In" });
      await (await openUserMenu(page)).getByRole("menuitem", { name: "Sign Out" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(UPLOADS_WAITING);
      await expect(dialog.getByRole("button", { name: "Sign Out Anyway" })).toBeVisible();
      // Staying is the default: it has the focus, and the menu has handed over to the dialog.
      await expect(stay).toBeFocused();
      await expect(page.getByRole("menu")).toHaveCount(0);
      await settled(dialog);
      if (isTouch()) {
        for (const button of await dialog.getByRole("button").all()) {
          expect((await button.boundingBox())?.height).toBeGreaterThanOrEqual(44);
        }
      }
      await shot(page, "admin-sign-out-photo-waiting", false);

      // Stay: still signed in, on the same page, the photo still waiting, focus back on the menu button.
      await stay.click();
      await expect(dialog).toBeHidden();
      await expect(page).toHaveURL(new RegExp(`${gallery}$`));
      await expect(page.getByRole("button", { name: /account menu/ })).toBeFocused();
      expect(await authCookies(context)).not.toEqual([]);
      await expect(badge).toHaveAttribute("data-count", "1");

      // From any other page too, reached through the shell's nav: the check covers every inspection on this device.
      const nav = page.getByRole("navigation", { name: "Main" });
      await nav.getByRole("link", { name: isDesktop(page) ? "Overview" : "Admin", exact: true }).click();
      await expect(page).toHaveURL(/\/admin$/);
      await expect(page.getByRole("heading", { level: 1, name: "Overview" })).toBeVisible();
      await (await openUserMenu(page)).getByRole("menuitem", { name: "Sign Out" }).click();
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText(UPLOADS_WAITING);

      // A sign-out that does not reach the server: still signed in, and the dialog keeps both choices.
      const release = await holdServerActions(page, "abort");
      await dialog.getByRole("button", { name: "Sign Out Anyway" }).click();
      await expect(page.getByText(SIGN_OUT_FAILED)).toBeVisible();
      await expect(dialog.getByRole("button", { name: "Sign Out Anyway" })).toBeEnabled();
      await expect(stay).toBeEnabled();
      expect(await authCookies(context)).not.toEqual([]);
      await release();

      // Sign Out Anyway: the session ends, and the photo stays on this device for the next sign-in.
      await dialog.getByRole("button", { name: "Sign Out Anyway" }).click();
      await expect(page).toHaveURL(/\/login$/);
      expect(await authCookies(context)).toEqual([]);
      expect(errors()).toEqual([]);
    });
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
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
    expect(response?.status()).toBe(404);
    // Nothing gives the admin area away: not the tab title, not the HTML.
    await expect(page).toHaveTitle("Page Not Found · SteriCare QC");
    expect(await response?.text()).not.toMatch(/Admin overview/i);
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
    await shot(page, "inspector-user-menu", false);
  });
});
