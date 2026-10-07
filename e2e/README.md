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

## Screenshots on the iPad projects

Playwright's `fullPage: true` capture drops touch emulation while it resizes, so an "iPad"
full-page shot comes out at desktop density (coarse-pointer styles such as 44 px targets and
16 px text disappear). On `ipad-portrait` and `ipad-landscape`, take viewport screenshots while
scrolling (or stitch them) instead of `fullPage`, and assert sizes with `boundingBox()` rather
than from a full-page image.

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

## Leftovers from a crashed run

A run that dies before `afterAll` leaves its `E2E_*` templates behind, with their inspections,
photos, files and Storage objects. Most fixtures remove their own leftovers on the next run;
for the rest, list them first, then delete:

```bash
npm run clean:e2e                       # lists; deletes nothing
npm run clean:e2e -- --apply            # deletes what the listing said
npm run clean:e2e -- --only E2E_NEWSEED # only codes that start with E2E_NEWSEED
```

For each template it removes the Storage objects of each inspection (`inspection-photos`,
`inspection-files`), the inspection through `delete_test_inspection()`, the template's source
files in `template-sources`, then the template. It leaves alone anything younger than an hour
(`--min-age <minutes>`: someone's run may be using it), inspections of accounts that are not
`@test.local` (and their templates), and every other row: clients, manufacturers and throwaway
accounts are only listed, for deleting by hand. Each deleted inspection leaves an admin-only
`deleted` audit row, and its ref number is not reused (`docs/DATABASE.md`). On a project others
are testing against, run `--apply` only when nobody else is running specs, or narrow it with
`--only`.
