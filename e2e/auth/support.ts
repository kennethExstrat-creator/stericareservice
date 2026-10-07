import { expect, test, type Locator, type Page, type Response, type TestInfo } from "@playwright/test";
import { SECURITY_HEADERS } from "../../lib/auth/security-headers";

/**
 * Shared bits for the auth hardening specs (final audit SEC-01, SEC-05,
 * SEC-06): the security headers, the session cookies' Set-Cookie lines,
 * screenshots and tap-or-click.
 */

const SHOTS = "screenshots/auth";

/** Every security header (lib/auth/security-headers.ts), with its exact value. */
export function expectSecurityHeaders(headers: Record<string, string>, where: string) {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect.soft(headers[name.toLowerCase()], `${name} on ${where}`).toBe(value);
  }
}

/**
 * The Set-Cookie lines of a response that write the Supabase session
 * (sb-<project>-auth-token, possibly in chunks .0, .1), not the ones that clear it.
 */
export async function sessionCookiesSet(response: Response): Promise<string[]> {
  return (await response.headersArray())
    .filter(({ name }) => name.toLowerCase() === "set-cookie")
    .map(({ value }) => value)
    .filter((value) => /^sb-[a-z0-9]+-auth-token(\.\d+)?=[^;]+/.test(value));
}

/** Specs that call Supabase Auth run in the projects named: the sign-in limit is per IP and shared. */
export function onlyIn(testInfo: TestInfo, projects: string[]) {
  test.skip(!projects.includes(testInfo.project.name), `calls Supabase Auth: runs in ${projects.join(", ")} only`);
}

/** Taps on the iPad projects, clicks on desktop. */
export function press(locator: Locator, testInfo: TestInfo) {
  return testInfo.project.use.hasTouch ? locator.tap() : locator.click();
}

/** Opens a page and waits until React has hydrated it (it tags hydrated DOM nodes with __reactFiber keys). */
export async function open(page: Page, url: string) {
  await page.goto(url);
  await page.waitForFunction(() => {
    const main = document.querySelector("main");
    return main !== null && Object.keys(main).some((key) => key.startsWith("__reactFiber"));
  });
}

/** The viewport as it is, per project: screenshots/auth/<project>-<name>.png. */
export async function shot(page: Page, testInfo: TestInfo, name: string) {
  await page.screenshot({
    path: `${SHOTS}/${testInfo.project.name}-${name}.png`,
    animations: "disabled",
    caret: "initial",
    // The Next.js dev indicator is not part of the app.
    style: "nextjs-portal { display: none !important; }",
  });
}
