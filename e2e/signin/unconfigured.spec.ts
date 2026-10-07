import { expect, open, shot, test } from "./support";

// A fresh checkout with no Supabase project. Needs a dev server started with
// the Supabase variables blanked, which the shell's values override:
//
//   NEXT_PUBLIC_SUPABASE_URL= NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY= SUPABASE_SECRET_KEY= npx next dev --port 3201
//   SIGNIN_UNCONFIGURED=1 PLAYWRIGHT_BASE_URL=http://localhost:3201 npx playwright test e2e/signin/unconfigured.spec.ts

test.skip(!process.env.SIGNIN_UNCONFIGURED, "needs a dev server without Supabase (see the comment above)");

for (const path of ["/login", "/forgot-password", "/reset-password"]) {
  test(`${path} explains what to set up`, async ({ page }, testInfo) => {
    await open(page, path);
    await expect(page.getByRole("heading", { level: 1, name: "Connect Supabase" })).toBeVisible();
    for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "SUPABASE_SECRET_KEY"]) {
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
    await expect(page.getByRole("link", { name: "Open the Design Reference" })).toHaveAttribute("href", "/design");
    await expect(page.locator("form")).toHaveCount(0);
    if (path === "/login") await shot(page, testInfo, "login-unconfigured");
  });
}
