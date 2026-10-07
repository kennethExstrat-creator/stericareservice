import { test, type BrowserContext, type Page } from "@playwright/test";
import { sessionCookies, sessionExpiry, type SessionCookie } from "../../support/session";

/** Sessions this worker signed in, by account: every describe and test of the spec shares them. */
const signedIn = new Map<string, SessionCookie[]>();
/** A test may take a few minutes: hand out a session only while its access token outlives one by far. */
const MIN_LEFT_MS = 15 * 60 * 1000;

/**
 * One sign-in per account and worker, shared by every describe and test: the
 * shared project rate-limits sign-ins (about 30 in a few minutes), and other
 * specs sign in too. A session is signed in again only when its access token
 * runs low (with E2E_SESSION_CACHE, e2e/support/session.ts may hand out one
 * another worker or run signed in). A limit hit waits a minute and tries
 * again, twice.
 */
export async function signInOnce(email: string, password?: string): Promise<SessionCookie[]> {
  const key = `${email.toLowerCase()}\n${password ?? ""}`;
  const known = signedIn.get(key);
  const expiry = known ? sessionExpiry(known) : null;
  if (known && expiry !== null && expiry - Date.now() >= MIN_LEFT_MS) return known;
  for (let attempt = 0; ; attempt++) {
    try {
      const cookies = await sessionCookies(email, password);
      signedIn.set(key, cookies);
      return cookies;
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
