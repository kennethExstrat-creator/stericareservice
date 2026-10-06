import { expect, test as base, type Locator, type Page, type TestInfo } from "@playwright/test";
import { createTestAdminClient, throwawayEmail } from "../support/admin";

/**
 * Shared bits for the sign-in specs: screenshots per project, tap-or-click,
 * throwaway accounts that clean up after themselves, and a guard that fails a
 * test on browser errors or hydration warnings.
 */

const SHOTS = "screenshots/signin";

// The Next.js dev indicator is not part of the app.
const HIDE_DEV_UI = "nextjs-portal { display: none !important; }";

/** Resolves once React has hydrated the page (it tags hydrated DOM nodes with __reactFiber keys). */
export async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const main = document.querySelector("main");
    return main !== null && Object.keys(main).some((key) => key.startsWith("__reactFiber"));
  });
}

/** Opens a page and waits until its buttons and forms are live. */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await hydrated(page);
}

export async function shot(page: Page, testInfo: TestInfo, name: string) {
  // Hydrated first, and the caret left alone: caret "hide" writes inline styles
  // into the inputs, which a page still hydrating reports as a mismatch.
  await hydrated(page);
  await page.screenshot({
    path: `${SHOTS}/${testInfo.project.name}/${name}.png`,
    fullPage: true,
    animations: "disabled",
    caret: "initial",
    style: HIDE_DEV_UI,
  });
}

export function isTouch(testInfo: TestInfo): boolean {
  return Boolean(testInfo.project.use.hasTouch);
}

/** Taps on the iPad projects, clicks on desktop. */
export function press(locator: Locator, testInfo: TestInfo) {
  return isTouch(testInfo) ? locator.tap() : locator.click();
}

/**
 * Specs that call Supabase Auth run in one project only (`project` below):
 * every spec in the repo shares the project's per-IP sign-in and email limits.
 */
export function onlyIn(testInfo: TestInfo, project: "ipad-portrait" | "ipad-landscape" | "desktop") {
  base.skip(testInfo.project.name !== project, `calls Supabase Auth: runs in ${project} only`);
}

// ---- Throwaway accounts -----------------------------------------------------

export const THROWAWAY_PASSWORD = "Throwaway-signin-2026";

export type Throwaway = { email: string; password: string; userId: string };

export type Accounts = {
  /**
   * A confirmed e2e-signin-…@test.local account. New accounts start inactive
   * (migration 20261006000600), so say which state the test needs.
   */
  create(options: { active: boolean }): Promise<Throwaway>;
  /** Activates or deactivates a profile, as an admin would. */
  setActive(userId: string, active: boolean): Promise<void>;
  /** Deletes an account made another way (an invite link) after the test. */
  track(userId: string): void;
};

// ---- Fixtures ---------------------------------------------------------------

export const test = base.extend<{ browserProblems: string[]; accounts: Accounts }>({
  browserProblems: [
    async ({ page }, use) => {
      const problems: string[] = [];
      page.on("console", (message) => {
        const text = message.text();
        // A 404 for a page another engineer has not built yet (e.g. /inspections) is expected.
        if (message.type() === "error" && !text.startsWith("Failed to load resource")) problems.push(text);
        if (message.type() === "warning" && /hydrat/i.test(text)) problems.push(text);
      });
      page.on("pageerror", (error) => problems.push(error.message));
      await use(problems);
      expect(problems, "browser console errors and hydration warnings").toEqual([]);
    },
    { auto: true },
  ],

  // Every account made through this fixture is deleted after its test, pass or fail.
  // (Playwright's `use` is called `provide` here: the React hooks lint rule reads `use` as a hook.)
  accounts: async ({}, provide) => {
    const admin = createTestAdminClient();
    const created = new Set<string>();

    const setActive: Accounts["setActive"] = async (userId, active) => {
      const { error } = await admin.from("profiles").update({ active }).eq("id", userId);
      if (error) throw new Error(`Could not set active=${active} on ${userId}: ${error.message}`);
    };

    await provide({
      async create({ active }) {
        const email = throwawayEmail("signin");
        const password = THROWAWAY_PASSWORD;
        const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
        if (error || !data.user) throw new Error(`Could not create ${email}: ${error?.message}`);
        created.add(data.user.id);
        await setActive(data.user.id, active);
        return { email, password, userId: data.user.id };
      },
      setActive,
      track(userId) {
        created.add(userId);
      },
    });

    const leftovers: string[] = [];
    for (const userId of created) {
      const { error } = await admin.auth.admin.deleteUser(userId);
      if (error) leftovers.push(`${userId}: ${error.message}`);
    }
    expect(leftovers, "throwaway accounts that could not be deleted").toEqual([]);
  },
});

export { expect };
