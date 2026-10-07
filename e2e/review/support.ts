import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { createServerClient } from "@supabase/ssr";
import type { Database } from "../../lib/supabase/database.types";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";

type Account = keyof typeof TEST_ACCOUNTS;
type Cookie = Awaited<ReturnType<typeof sessionCookies>>[number];

export function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/**
 * One sign-in per account and project, shared by the tests: the shared
 * project rate-limits sign-ins per address, and other specs run too.
 */
export function sessions() {
  const cache = new Map<Account, Cookie[]>();
  const cookiesOf = async (account: Account) => {
    const known = cache.get(account);
    if (known) return known;
    const fresh = await sessionCookies(TEST_ACCOUNTS[account]);
    cache.set(account, fresh);
    return fresh;
  };
  return {
    /** Signs the browser context in as `account` (and out of anyone else). */
    async signIn(context: BrowserContext, baseURL: string, account: Account) {
      await context.clearCookies();
      const cookies = await cookiesOf(account);
      await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
    },
    /** A Supabase client acting as `account`, with the same session: what a crafted request could do. */
    async client(account: Account) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
      const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
      if (!url || !key) throw new Error("Supabase is not configured: copy .env.local into this checkout.");
      const cookies = await cookiesOf(account);
      return createServerClient<Database>(url, key, {
        cookies: { getAll: () => cookies, setAll: () => undefined },
      });
    },
  };
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page. The dev-only
 * Next.js indicator is hidden.
 */
export async function shot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  const path = (part = "") => `screenshots/review/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  if (!isTouch()) {
    await page.screenshot({ ...options, path: path(), fullPage: true });
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

/** A viewport shot, for dialogs and toasts. */
export async function viewShot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({
    path: `screenshots/review/${test.info().project.name}-${name}.png`,
    animations: "disabled",
    caret: "initial",
  });
}

/** A tap on the iPads, a click on the desktop. */
export async function press(locator: Locator) {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/** Collects console errors, so hydration mismatches fail the test. */
export function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

export { expectNoPageScroll } from "../support/layout";

/** 44 px targets on the iPads (docs/DESIGN.md). */
export async function expectTouchTarget(locator: Locator) {
  if (!isTouch()) return;
  const box = await locator.boundingBox();
  expect(box, "the control is on screen").not.toBeNull();
  expect(box!.height, "44 px tall on touch").toBeGreaterThanOrEqual(44);
}

export function reviewPath(id: string): string {
  return `/inspections/${id}/review`;
}
