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

Specs need the test accounts (`npm run seed:dev-users -- --force`): `inspector@test.local`,
`admin@test.local` and the lead inspector `lead@test.local`, whose team the inspector is in.

## WebKit and the real iPad

Chrome and Safari on the iPad run on WebKit, so the reload specs (`e2e/autosave`) also run in the
`webkit-ipad-portrait` project (Playwright's WebKit, 820 × 1180, touch). Install it once with
`npx playwright install webkit`. That project matches `e2e/autosave` only, so
`e2e/capture/final.spec.ts` launches WebKit itself for its photo-tag test (a tap on + in WebKit),
from the `ipad-portrait` and `ipad-pro-landscape` projects. Playwright cannot drive the iPad's own
scrolling, so two things are checked by hand on a real iPad after a change to the capture screen's
reload handling:

- Chrome for iPad: a swipe down at the top of the capture screen does not pull to refresh (the page
  sets `overscroll-behavior-y: none`; the spec can only check that style). If it still refreshes,
  the values come back and the screen lands on the last field.
- A tab the iPad dropped in the background and loads again lands on the last field too. That needs
  WebKit to report the load as a reload; if it does not, the screen opens at the section's top and
  the values are still there.

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

Supabase allows about 30 sign-ins in five minutes for the whole machine, and a failed test restarts
its worker, whose hooks sign in again. For a series of runs, `E2E_SESSION_CACHE=<directory>` keeps
each session `sessionCookies()` signs in there and hands it out again, to other workers, projects and
runs, while its access token has half an hour left; `sign-ins.log` in it lists each real sign-in.
The files hold live tokens: use a private temporary directory and delete it afterwards.

## Screenshots on the iPad projects

Playwright's `fullPage: true` capture drops touch emulation while it resizes, so an "iPad"
full-page shot comes out at desktop density (coarse-pointer styles such as 44 px targets and
16 px text disappear). On `ipad-portrait` and `ipad-landscape`, take viewport screenshots while
scrolling (or stitch them) instead of `fullPage`, and assert sizes with `boundingBox()` rather
than from a full-page image.

## Rules for the shared database

- Never change, rename, deactivate or delete `inspector@test.local`, `admin@test.local`,
  `lead@test.local` or real accounts. `npm run seed:dev-users -- --force` sets them up:
  `lead@test.local` (Ngan Boon Keat) is an active lead inspector and `inspector@test.local` works
  in their team, so do not assume the inspector is in no team, or that the user list holds only
  these accounts. Specs that rename, re-role or deactivate someone use a throwaway account.
- Destructive tests use throwaway accounts from `throwawayEmail()` and delete them afterwards.
- Rows created for a test are deleted in `afterAll`. Teardown order: remove the inspection's
  Storage files, then call `deleteTestInspection()` for each inspection (the service role cannot
  delete approved inspections directly; this database function can, for `@test.local`
  inspectors only), then delete templates and throwaway accounts.
- Inspection inserts never send `id` or `ref_no`: the database draws the ref number. Every
  insert uses a number from the live sequence, so keep e2e runs few.
- A throwaway account that deletes an inspection itself (the list's Delete,
  `delete_draft_inspection()`) is named as the actor of the deletion record, which nothing removes:
  that account can then only be deactivated, not deleted. Let `inspector@test.local` make those
  deletions.
- An inspector's session cannot insert or update an inspection (`docs/DATABASE.md`, "Inspectors
  write through the app"): set up rows with `createTestAdminClient()`, and drive saves and submits
  through the app.
- New accounts start inactive: activate a throwaway account with the admin client
  (`update profiles set active = true`) before it signs in.
- `createTestAdminClient()` bypasses RLS, so use it for setup and teardown only, never to assert
  what a user can see.
- Supabase's built-in mailer only delivers to project team members and allows a few emails an
  hour: do not loop on invite or reset emails.

## Final acceptance (`e2e/acceptance`)

The specs from the final pass enter the example reports through the real screens and probe access,
data and design. They are skipped unless `ACCEPTANCE=1` is set, and they run against a production
build (`npm run build && npx next start -p 3900`, with `AI_REVIEW_PROVIDER=mock ENABLE_MOCK_AI=true`
for the AI steps). They write to the live project: every run draws inspection numbers and leaves
deletion records, so run them before a release, not routinely.

```bash
ACCEPTANCE=1 PLAYWRIGHT_BASE_URL=http://localhost:3900 npx playwright test e2e/acceptance/std-eg.spec.ts --project=ipad-pro-landscape
```

| Spec | Project | What it checks |
| --- | --- | --- |
| `std-eg.spec.ts` | `ipad-pro-landscape` | The STD_EG example report, entered on the capture screen, gives the expected results |
| `safedon-eg.spec.ts` | `ipad-portrait` | The same for SAFEDON_EG (Polyco Healthline) |
| `sg-and-flows.spec.ts` | `ipad-landscape` (or `ACCEPTANCE_PROJECT`) | STD_SG hands and dye leak, switched-off modules, losing the connection |
| `photos-export-ai.spec.ts` | `ipad-portrait`, `ipad-pro-landscape` | Photos and their tags, the export, the AI second opinion |
| `security.spec.ts` | `desktop` | Who can read and write what, through the screens, the API and Storage |
| `data-integrity.spec.ts` | `desktop` | Status changes, the audit log, frozen templates, two devices on one draft |
| `ux-audit.spec.ts` | any (`UX_AUDIT_WEBKIT=1` for WebKit) | Layout, touch targets, contrast, names and keyboard on every screen |

A test that pins a finding is marked `test.fail()` with what was found. Once the finding is fixed
the test turns red; take the marker off then.

The UX audit records rather than fails. With `UX_AUDIT_STRICT=1` it also fails on page overflow,
small touch targets and field text, serious axe violations and console errors (less what the final
audit judged acceptable, `ACCEPTED` in the spec), on a step that could not run, and on its findings
UX-01 to UX-14 coming back. A failed test restarts the worker and with it the fixture: add
`UX_AUDIT_KEEP=1` so the restart reuses the rows, then delete them with `UX_AUDIT_CLEANUP=1`.

An account named in a deletion record can never be deleted, because the audit log is append-only.
A throwaway account that deletes an inspection therefore stays behind, deactivated: let
`inspector@test.local` or the secret key delete the rows instead.

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
