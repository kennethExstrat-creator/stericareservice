# End-to-end checks

Playwright specs that run against a dev server and the Supabase project in `.env.local`, at the
three sizes in BUILD_SPEC section 8: `ipad-portrait` (820 × 1180, touch), `ipad-landscape`
(1180 × 820, touch) and `desktop` (1440 × 900).

```bash
npm run dev                                   # in one terminal
npx playwright test                           # every spec, every size
npx playwright test e2e/shell --project=desktop
PLAYWRIGHT_BASE_URL=http://localhost:3202 npx playwright test e2e/shell
```

Specs need the test accounts (`npm run seed:dev-users -- --force`).

## Signing in

```ts
import { expect, test } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";

test("the inspector lands on the inspections list", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/");
  await expect(page).toHaveURL(/\/inspections$/);
  await page.screenshot({ path: `screenshots/shell/${test.info().project.name}-inspections.png`, fullPage: true });
});
```

## Rules for the shared database

- Never change, deactivate or delete `inspector@test.local`, `admin@test.local` or real accounts.
- Destructive tests use throwaway accounts from `throwawayEmail()` and delete them afterwards.
- Rows created for a test are deleted in `afterAll`. Teardown order: remove the inspection's
  Storage files, then call `deleteTestInspection()` for each inspection (the service role cannot
  delete approved inspections directly; this database function can, for `@test.local`
  inspectors only), then delete templates and throwaway accounts.
- Inspection inserts never send `id` or `ref_no`: the database draws the ref number. Every
  insert uses a number from the live sequence, so keep e2e runs few.
- New accounts start inactive: activate a throwaway account with the admin client
  (`update profiles set active = true`) before it signs in.
- `createTestAdminClient()` bypasses RLS, so use it for setup and teardown only, never to assert
  what a user can see.
- Supabase's built-in mailer only delivers to project team members and allows a few emails an
  hour: do not loop on invite or reset emails.
