import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { expectNoPageScroll } from "../support/layout";
import { sessionCookies, TEST_ACCOUNTS, type SessionCookie } from "../support/session";

/**
 * Admin > Roles & Permissions (migration 20261027150000; Kenneth, 27 October
 * 2026: "build permission and module on off for each role", with custom roles
 * too) against the live project, at the sizes in playwright.config.ts. The
 * built-in roles are opened, never saved: their switches are everyone's live
 * access. One custom role per size, named E2E_ROLES…, is added, changed and
 * deleted; afterAll deletes any a failed run left. Screenshots go to
 * screenshots/roles/ (git-ignored).
 */

// Dev servers compile each page on its first visit, and the Mac running these is shared.
test.describe.configure({ timeout: 90_000 });

/** The custom roles these specs make, so cleanUp() finds leftovers of a failed run too. */
const PREFIX = "E2E_ROLES";

/** The desktop layout: 1280 px and wider with a mouse or trackpad; every touch size is the iPad layout (app/globals.css). */
const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280 && test.info().project.use.hasTouch !== true;

const isTouch = () => Boolean(test.info().project.use.hasTouch);

/**
 * A screenshot under screenshots/roles/: the full page on the desktop, the
 * viewport on the iPads (a full-page capture drops touch emulation while it
 * resizes, e2e/README.md).
 */
async function shot(page: Page, name: string) {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({
    path: `screenshots/roles/${test.info().project.name}-${name}.png`,
    fullPage: !isTouch(),
    animations: "disabled",
  });
}

/** One sign-in per account and size, shared by the describe's tests: the shared project rate-limits sign-ins. */
function useAccount(email: string) {
  let cookies: SessionCookie[] = [];
  test.beforeAll(async () => {
    cookies = await sessionCookies(email);
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
  });
}

/** Deletes the custom roles these specs made. Nobody is ever given one, so nothing restricts it. */
async function cleanUp() {
  const { error } = await createTestAdminClient().from("roles").delete().like("name", `${PREFIX}%`).is("built_in", null);
  if (error) throw new Error(`Could not delete the test roles: ${error.message}`);
}

test.afterAll(cleanUp);

/** The panel (a dialog) with this title. */
const panel = (page: Page, title: string) => page.getByRole("dialog", { name: title });

/** A button in the panel's footer (the panel's corner X is also called Close). */
const footerButton = (scope: Locator, name: string) =>
  scope.locator('[data-slot="sheet-footer"]').getByRole("button", { name, exact: true });

/** The table row that names `text`. */
const row = (page: Page, text: string) => page.getByRole("row").filter({ hasText: text });

/** A permission's switch, named by its label. */
const switchFor = (scope: Locator, label: string) => scope.getByRole("switch", { name: label, exact: true });

test.describe("as the admin", () => {
  useAccount(TEST_ACCOUNTS.admin);

  test("lists the built-in roles first, with what each sees, allows and who has it", async ({ page }) => {
    await page.goto("/admin/roles");
    await expect(page).toHaveTitle("Roles & Permissions · SteriCare QC");
    await expect(page.getByRole("heading", { level: 1, name: "Roles & Permissions" })).toBeVisible();

    const rows = page.getByRole("row");
    await expect(rows.nth(1)).toContainText("Admin");
    await expect(rows.nth(1)).toContainText("All Inspections");
    await expect(rows.nth(1)).toContainText("8 of 8");
    await expect(rows.nth(2)).toContainText("Lead Inspector");
    await expect(rows.nth(2)).toContainText("Team Inspections");
    await expect(rows.nth(3)).toContainText("Inspector");
    await expect(rows.nth(3)).toContainText("Own Inspections");
    for (const index of [1, 2, 3]) await expect(rows.nth(index)).toContainText("Built-In");

    const nav = page.getByRole("navigation", { name: isDesktop(page) ? "Main" : "Admin" });
    await expect(nav.getByRole("link", { name: "Roles & Permissions" })).toHaveAttribute("aria-current", "page");
    if (isTouch()) {
      expect((await page.getByRole("button", { name: "Edit Inspector" }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoPageScroll(page);
    await shot(page, "list");
  });

  test("opens the Admin role read-only: every switch on and locked, nothing to save", async ({ page }) => {
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: "View Admin" }).click();
    const admin = panel(page, "Admin Role");
    await expect(admin).toBeVisible();

    const switches = admin.getByRole("switch");
    await expect(switches).toHaveCount(16);
    for (const control of await switches.all()) {
      await expect(control).toBeChecked();
      await expect(control).toBeDisabled();
    }
    await expect(admin.getByRole("radio", { name: "All Inspections" })).toBeChecked();
    await expect(admin.getByRole("radio", { name: "All Inspections" })).toBeDisabled();
    await expect(admin.getByRole("textbox")).toHaveCount(0);
    await expect(footerButton(admin, "Save Changes")).toHaveCount(0);
    await shot(page, "admin-role");

    await footerButton(admin, "Close").click();
    await expect(admin).toBeHidden();
    await expect(page.getByRole("button", { name: "View Admin" })).toBeFocused();
  });

  test("keeps a built-in role's name and what it sees, and never offers to delete it", async ({ page }) => {
    await page.goto("/admin/roles");
    await page.getByRole("button", { name: "Edit Inspector" }).click();
    const edit = panel(page, "Edit Role");
    await expect(edit.getByText("Built-in roles keep their names.")).toBeVisible();
    await expect(edit.getByText("Built-in roles keep what they see.")).toBeVisible();
    for (const name of ["Own Inspections", "Team Inspections", "All Inspections"]) {
      await expect(edit.getByRole("radio", { name })).toBeDisabled();
    }
    await expect(edit.getByRole("radio", { name: "Own Inspections" })).toBeChecked();
    // Needs every inspection; and no switch gives Users.
    await expect(switchFor(edit, "Approve and Reopen")).toBeDisabled();
    await expect(switchFor(edit, "Users")).toBeDisabled();
    await expect(switchFor(edit, "Dashboard")).toBeEnabled();
    await expect(edit.getByRole("button", { name: "Delete Role" })).toHaveCount(0);
    if (isTouch()) expect((await switchFor(edit, "Dashboard").boundingBox())?.height).toBeGreaterThanOrEqual(28);
    await shot(page, "inspector-role");
    // Nothing is saved: the Inspector role's switches are everyone's live access.
    await footerButton(edit, "Close").click();
    await expect(edit).toBeHidden();
  });

  test("adds, changes and deletes a custom role", async ({ page }) => {
    const name = `${PREFIX} ${test.info().project.name} ${Math.random().toString(36).slice(2, 7)}`;
    await page.goto("/admin/roles");

    // Add: the name is required.
    await page.getByRole("button", { name: "Add Role" }).click();
    const add = panel(page, "Add Role");
    await footerButton(add, "Add Role").click();
    await expect(add.getByText("Enter the role's name.")).toBeVisible();
    await expect(add.getByLabel("Name", { exact: true })).toBeFocused();

    await add.getByLabel("Name", { exact: true }).fill(`  ${name}  `);
    await add.getByLabel("Description (Optional)").fill("Keeps the client list.");
    // Approving needs every inspection: locked while the role sees fewer.
    await expect(switchFor(add, "Approve and Reopen")).toBeDisabled();
    await add.getByRole("radio", { name: "Team Inspections" }).click();
    await switchFor(add, "Clients").click();
    // The label switches too.
    await add.getByText("Export Reports", { exact: true }).click();
    await expect(switchFor(add, "Export Reports")).toBeChecked();
    await shot(page, "custom-add");
    await footerButton(add, "Add Role").click();
    await expect(page.getByText(`${name} added.`)).toBeVisible();
    await expect(add).toBeHidden();
    await expect(row(page, name)).toContainText("Team Inspections");
    await expect(row(page, name)).toContainText("Keeps the client list.");

    // Change: every inspection, and approving with it.
    await row(page, name).getByRole("button", { name: `Edit ${name}` }).click();
    const edit = panel(page, "Edit Role");
    await expect(edit.getByText("Nobody has this role yet.")).toBeVisible();
    await edit.getByRole("radio", { name: "All Inspections" }).click();
    await switchFor(edit, "Approve and Reopen").click();
    await expect(switchFor(edit, "Approve and Reopen")).toBeChecked();
    await footerButton(edit, "Save Changes").click();
    await expect(page.getByText(`${name} saved.`)).toBeVisible();
    await expect(row(page, name)).toContainText("All Inspections");
    await expect(row(page, name)).toContainText("2 of 8");

    // Seeing fewer switches approving off again, before anything is saved.
    await row(page, name).getByRole("button", { name: `Edit ${name}` }).click();
    const again = panel(page, "Edit Role");
    await expect(switchFor(again, "Approve and Reopen")).toBeChecked();
    await again.getByRole("radio", { name: "Own Inspections" }).click();
    await expect(switchFor(again, "Approve and Reopen")).not.toBeChecked();
    await expect(switchFor(again, "Approve and Reopen")).toBeDisabled();

    // Delete it, nobody having it.
    await expect(again.getByText("Nobody has this role, so it can be deleted.")).toBeVisible();
    await again.getByRole("button", { name: "Delete Role" }).click();
    const confirm = page.getByRole("alertdialog", { name: `Delete ${name}?` });
    await expect(confirm).toBeVisible();
    await confirm.getByRole("button", { name: "Delete Role" }).click();
    await expect(page.getByText(`${name} deleted.`)).toBeVisible();
    await expect(again).toBeHidden();
    await expect(row(page, name)).toHaveCount(0);
  });
});

test.describe("as the inspector", () => {
  useAccount(TEST_ACCOUNTS.inspector);

  test("/admin/roles is a 404 that names nothing", async ({ page }) => {
    const response = await page.goto("/admin/roles");
    await expect(page.getByRole("heading", { name: "Page Not Found" })).toBeVisible();
    expect(response?.status()).toBe(404);
    await expect(page).toHaveTitle("Page Not Found · SteriCare QC");
    await expect(page.getByText("Roles & Permissions")).toHaveCount(0);
  });
});
