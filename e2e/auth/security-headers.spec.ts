import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { expect, test } from "@playwright/test";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import { expectSecurityHeaders, onlyIn, open, shot } from "./support";

/*
 * Final audit SEC-01: every page, redirect and Route Handler answers with the
 * security headers proxy.ts adds (lib/auth/security-headers.ts), and another
 * site cannot show the app in a frame. Headers do not change with the screen,
 * but the framing check and the console check run at every size; the one
 * sign-in (the admin, through Supabase directly) happens in desktop only.
 */

const NOWHERE = "00000000-0000-4000-8000-000000000000";

/**
 * Another site, for the framing test: a page on 127.0.0.1 (the app runs on
 * localhost, a different site to the browser), from a small server of its own.
 * A page Playwright makes up would not do: Chrome treats it as public, and
 * keeps public pages from framing local addresses at all.
 */
async function serveAnotherSite(html: string): Promise<{ url: string; close: () => Promise<void> }> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(html);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}/`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

test("signed out: pages, the redirects to /login, the email-link landing and the API carry the headers", async ({ request }) => {
  const answers: [string, number][] = [
    ["/login", 200],
    ["/forgot-password", 200],
    ["/reset-password", 200],
    ["/create-account", 200],
    ["/", 307],
    ["/inspections?status=draft", 307],
    ["/admin/users", 307],
    // No token: the route sends the link to /login without asking Supabase.
    ["/auth/confirm", 307],
    [`/api/inspections/${NOWHERE}/export`, 401],
  ];
  for (const [path, status] of answers) {
    const answer = await request.get(path, { maxRedirects: 0 });
    expect.soft(answer.status(), path).toBe(status);
    expectSecurityHeaders(answer.headers(), path);
  }
});

test("signed in: the admin's pages carry the headers too", async ({ request, baseURL }, testInfo) => {
  onlyIn(testInfo, ["desktop"]);
  const cookie = (await sessionCookies(TEST_ACCOUNTS.admin)).map(({ name, value }) => `${name}=${value}`).join("; ");
  for (const path of ["/inspections", "/admin/users"]) {
    const answer = await request.get(`${baseURL}${path}`, { headers: { cookie }, maxRedirects: 0 });
    expect.soft(answer.status(), path).toBe(200);
    expectSecurityHeaders(answer.headers(), `${path} (admin)`);
  }
});

test("another site cannot show the sign-in page in a frame", async ({ page, baseURL }, testInfo) => {
  // Next to it, the app's icon: a static file, which the proxy (and so the
  // headers) leave alone, shows that the frames do reach the app.
  const site = await serveAnotherSite(`<!doctype html><title>Another site</title><h1>Another site</h1>
    <iframe id="app" src="${baseURL}/login" style="width: 60vw; height: 60vh; border: 2px solid red"></iframe>
    <iframe id="icon" src="${baseURL}/icon.png" style="width: 20vw; height: 20vh; border: 2px solid green"></iframe>`);
  try {
    // goto waits for the page's load event, which waits for both frames to load or fail.
    await page.goto(site.url);

    await expect(page.frameLocator("#icon").locator("img")).toBeVisible();
    await expect(page.frameLocator("#app").getByLabel("Email")).toHaveCount(0);
    await expect(page.frameLocator("#app").getByRole("button", { name: "Sign In" })).toHaveCount(0);
    await shot(page, testInfo, "framed-by-another-site");
  } finally {
    await site.close();
  }
});

test("the headers raise no browser warnings on the sign-in screens", async ({ page }, testInfo) => {
  // An unknown Permissions-Policy feature or a malformed CSP shows up as a console message.
  const messages: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") messages.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => messages.push(`pageerror: ${error.message}`));

  await open(page, "/login");
  await shot(page, testInfo, "login");
  await open(page, "/forgot-password");

  expect(messages.filter((text) => /permissions-policy|content security policy|content-security-policy|x-frame-options|feature policy/i.test(text))).toEqual([]);
});

test("the framework is not announced (X-Powered-By)", async ({ request }) => {
  const answer = await request.get("/login");
  expect(answer.headers()["x-powered-by"]).toBeUndefined();
});
