import { test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookies } from "../../support/session";

type SessionCookie = Awaited<ReturnType<typeof sessionCookies>>[number];

/**
 * One sign-in per account and project, shared by the describe's tests: the
 * shared project rate-limits sign-ins (about 30 in a few minutes), and other
 * specs sign in too. A limit hit waits a minute and tries again, twice.
 */
export async function signInOnce(email: string, password?: string): Promise<SessionCookie[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await sessionCookies(email, password);
    } catch (error) {
      if (attempt >= 2 || !/rate limit|too many/i.test(String(error))) throw error;
      await new Promise((resolve) => setTimeout(resolve, 65_000));
    }
  }
}

export function addSession(context: BrowserContext, baseURL: string, cookies: SessionCookie[]) {
  return context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

/** Resolves once React has hydrated the page's main element. */
export async function hydrated(page: Page) {
  await page.waitForFunction(
    () => {
      const main = document.querySelector("main");
      return main !== null && Object.keys(main).some((key) => key.startsWith("__reactFiber"));
    },
    undefined,
    { timeout: 30_000 },
  );
}

/** Opens a page, waits for the network to settle and the page to hydrate. */
export async function open(page: Page, url: string) {
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => undefined);
  await hydrated(page);
}

export function projectName(): string {
  return test.info().project.name;
}
