import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import { INSPECTOR_IN_CHARGE } from "@/lib/auth/org";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import { chooseRowAction, pickLead, pickRole, rowFor, statusOf, teamsReady, toast } from "../users/support";
import { createOrgFixture, type Account, type OrgFixture } from "./fixtures";

/**
 * Lead inspectors and their teams (Kenneth, 7 October 2026; migration
 * 20261007170000) against the live project, at the four sizes in
 * playwright.config.ts, with throwaway accounts only (e2e/org/fixtures.ts):
 * a lead sees their team's inspections in every status, read-only, and
 * nobody else's; an admin sets levels and teams on /admin/users, and the
 * refused cases say why. Screenshots go to screenshots/org/.
 *
 * Needs the migration on the project in .env.local: until then every test
 * is skipped with that reason (e2e/users checks the screen without teams).
 * The tests share one fixture and run in order.
 */

test.describe.configure({ mode: "serial" });

let ready = false;
let fixture: OrgFixture;

test.beforeAll(async () => {
  test.setTimeout(120_000);
  ready = await teamsReady();
  if (ready) fixture = await createOrgFixture();
});

test.afterAll(async () => {
  test.setTimeout(120_000);
  if (ready) await fixture?.cleanup();
});

test.beforeEach(() => {
  test.skip(!ready, "Needs supabase/migrations/20261007170000_lead_inspectors.sql applied to the project in .env.local");
});

function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page.
 */
async function shot(page: Page, name: string): Promise<void> {
  // Let toasts and dialogs finish their 100-150 ms entrance first.
  await page.waitForTimeout(300);
  const path = (part = "") => `screenshots/org/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  const dialogOpen = (await page.getByRole("dialog").or(page.getByRole("alertdialog")).count()) > 0;
  if (!isTouch() || dialogOpen) {
    await page.screenshot({ ...options, path: path(), fullPage: !isTouch() && !dialogOpen });
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

/** A list row by its reference number. */
const listRow = (page: Page, ref: string): Locator => page.getByRole("row").filter({ hasText: ref });

/** Collects console errors, so hydration mismatches fail the test. */
function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  return errors;
}

/** A separate browser signed in as `account`. */
async function as(browser: Browser, baseURL: string, account: Account) {
  const context = await browser.newContext({ baseURL });
  await signIn(context, baseURL, account.email, account.password);
  return { context, page: await context.newPage() };
}

test.describe("a lead inspector", () => {
  test("sees every inspection of their team in the list, and their own, but no other team's", async ({ page, context, baseURL }) => {
    const errors = watchConsole(page);
    await signIn(context, baseURL!, fixture.linaLead.email, fixture.linaLead.password);
    await page.goto("/inspections");

    const { ivanDraft, ivanSubmitted, idaApproved, linaDraft, beaDraft } = fixture.inspections;
    for (const inspection of [ivanDraft, ivanSubmitted, idaApproved, linaDraft]) {
      await expect(listRow(page, inspection.ref)).toBeVisible();
    }
    await expect(listRow(page, beaDraft.ref)).toHaveCount(0);
    // The list's eyebrow, in whichever case the list writes it (e2e/list checks its words).
    await expect(page.getByText(/^Your team$/i)).toBeVisible();

    // Who is in charge of each, the lead's own included, in a column of its own.
    await expect(page.getByRole("columnheader", { name: INSPECTOR_IN_CHARGE, exact: true })).toHaveCount(1);
    await expect(listRow(page, ivanDraft.ref)).toContainText(fixture.ivan.name, { useInnerText: true });
    await expect(listRow(page, idaApproved.ref)).toContainText(fixture.ida.name, { useInnerText: true });
    await expect(listRow(page, linaDraft.ref)).toContainText(fixture.linaLead.name, { useInnerText: true });

    // The team's inspections open read-only: only View, never Continue or Delete, whatever their status.
    for (const inspection of [ivanDraft, ivanSubmitted, idaApproved]) {
      const row = listRow(page, inspection.ref);
      await expect(row.getByRole("link", { name: `View ${inspection.ref}`, exact: true })).toBeVisible();
      await expect(row.getByRole("link", { name: `Continue ${inspection.ref}` })).toHaveCount(0);
      await expect(row.getByRole("button", { name: `Delete ${inspection.ref}` })).toHaveCount(0);
    }
    // Their own draft, as for any inspector: Continue and Delete.
    await expect(listRow(page, linaDraft.ref).getByRole("link", { name: `Continue ${linaDraft.ref}`, exact: true })).toBeVisible();
    await expect(listRow(page, linaDraft.ref).getByRole("button", { name: `Delete ${linaDraft.ref}`, exact: true })).toBeVisible();
    await shot(page, "lead-list");
    expect(errors).toEqual([]);
  });

  test("opens a team member's draft read-only", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, fixture.linaLead.email, fixture.linaLead.password);
    await page.goto(`/inspections/${fixture.inspections.ivanDraft.id}`);

    await expect(page.getByText(fixture.inspections.ivanDraft.ref).first()).toBeVisible();
    await expect(page.getByText("This inspection belongs to another inspector: read-only.")).toBeVisible();
    // Submit is only there for whoever may edit it.
    await expect(page.getByRole("button", { name: /Submit/ })).toHaveCount(0);
    await shot(page, "lead-team-draft");
  });

  test("reads a team member's submitted review, with no approve or reopen", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, fixture.linaLead.email, fixture.linaLead.password);
    await page.goto(`/inspections/${fixture.inspections.ivanSubmitted.id}/review`);

    await expect(page.getByRole("heading", { name: fixture.inspections.ivanSubmitted.ref, level: 1 })).toBeVisible();
    await expect(page.getByText("only an admin can reopen it for changes")).toBeVisible();
    await expect(page.getByText(fixture.ivan.name).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open inspection" })).toBeVisible();
    await shot(page, "lead-team-review");
  });

  test("cannot open another team's inspection", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, fixture.linaLead.email, fixture.linaLead.password);
    await page.goto(`/inspections/${fixture.inspections.beaDraft.id}/review`);
    await expect(page.getByRole("heading", { name: "Inspection not found" })).toBeVisible();
    await expect(page.getByText(fixture.inspections.beaDraft.ref)).toHaveCount(0);
    await shot(page, "lead-other-team");
  });

  test("leaves a team member seeing only their own", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, fixture.ivan.email, fixture.ivan.password);
    await page.goto("/inspections");
    const { ivanDraft, ivanSubmitted, idaApproved, linaDraft } = fixture.inspections;
    await expect(listRow(page, ivanDraft.ref)).toBeVisible();
    await expect(listRow(page, ivanSubmitted.ref)).toBeVisible();
    await expect(listRow(page, idaApproved.ref)).toHaveCount(0);
    await expect(listRow(page, linaDraft.ref)).toHaveCount(0);
    // Only their own, so no Inspector in Charge column.
    await expect(page.getByRole("columnheader", { name: INSPECTOR_IN_CHARGE, exact: true, includeHidden: true })).toHaveCount(0);
    await expect(page.getByText(/^Your inspections$/i)).toBeVisible();
  });
});

test.describe("an admin on /admin/users", () => {
  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  });

  test("sees each person's role and lead, and one lead's team at a time", async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto("/admin/users");
    await expect(rowFor(page, fixture.linaLead.email)).toContainText("Lead Inspector");
    await expect(rowFor(page, fixture.ivan.email)).toContainText(fixture.linaLead.name);
    await expect(rowFor(page, fixture.bea.email)).toContainText(fixture.leoLead.name);

    await page.getByRole("combobox", { name: "Team", exact: true }).click();
    await page.getByRole("option", { name: `${fixture.linaLead.name}'s Team (2)`, exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/admin/users\\?team=${fixture.linaLead.id}$`));
    await expect(page.getByRole("status").filter({ hasText: `${fixture.linaLead.name}'s team: 2 inspectors.` })).toBeVisible();
    const rows = page.locator("tbody tr");
    await expect(rows).toHaveCount(3);
    await expect(rows.first()).toContainText(fixture.linaLead.name);
    await expect(rowFor(page, fixture.bea.email)).toHaveCount(0);
    await shot(page, "admin-team-filter");
    expect(errors).toEqual([]);
  });

  test("lists active inspectors in no team, with a link to only them that a finger finds", async ({ page }) => {
    await page.goto("/admin/users");
    const alert = page.getByTestId("no-lead-alert");
    await expect(alert).toBeVisible();
    // Other accounts in no team may be listed too: "Show Them" for one person, "Show Only Them" for more.
    const link = alert.getByRole("link", { name: /^Show (Only )?Them$/ });
    if (isTouch()) {
      // 44 px on touch (docs/DESIGN.md, Density).
      expect((await link.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    }
    await shot(page, "no-lead-alert");

    await link.click();
    await expect(page).toHaveURL(/\/admin\/users\?team=none$/);
    await expect(rowFor(page, fixture.gail.email)).toBeVisible();
    await expect(rowFor(page, fixture.ivan.email)).toHaveCount(0);
  });

  test("moves an inspector to another lead's team, out of the old lead's view", async ({ page, browser, baseURL }) => {
    await page.goto("/admin/users");
    const row = rowFor(page, fixture.ida.email);
    const dialog = await chooseRowAction(page, row, "Change Lead Inspector");
    await expect(dialog).toContainText(`They work in ${fixture.linaLead.name}'s team now.`);
    await pickLead(page, dialog, fixture.leoLead.name);
    await shot(page, "change-lead");
    await dialog.getByRole("button", { name: "Save Lead Inspector", exact: true }).click();
    await expect(toast(page, `${fixture.ida.name} now works in ${fixture.leoLead.name}'s team.`)).toBeVisible();
    await expect(row).toContainText(fixture.leoLead.name);

    const leo = await as(browser, baseURL!, fixture.leoLead);
    const lina = await as(browser, baseURL!, fixture.linaLead);
    try {
      await leo.page.goto("/inspections");
      await expect(listRow(leo.page, fixture.inspections.idaApproved.ref)).toBeVisible();
      await lina.page.goto("/inspections");
      await expect(listRow(lina.page, fixture.inspections.ivanDraft.ref)).toBeVisible();
      await expect(listRow(lina.page, fixture.inspections.idaApproved.ref)).toHaveCount(0);
    } finally {
      await leo.context.close();
      await lina.context.close();
    }
  });

  test("will not deactivate a lead whose team has members, and says who to move first", async ({ page }) => {
    await page.goto("/admin/users");
    const dialog = await chooseRowAction(page, rowFor(page, fixture.linaLead.email), "Deactivate");
    await expect(dialog).toContainText(`${fixture.linaLead.name} Still Leads a Team`);
    await expect(dialog).toContainText(`${fixture.linaLead.name} leads 1 inspector: ${fixture.ivan.name}.`);
    await shot(page, "deactivate-lead-refused");
    await dialog.getByRole("button", { name: "Close" }).click();
    await expect(statusOf(rowFor(page, fixture.linaLead.email))).toHaveText("Active");
  });

  test("will not demote a lead whose team has members, and keeps every choice after the refusal", async ({ page }) => {
    await page.goto("/admin/users");
    const dialog = await chooseRowAction(page, rowFor(page, fixture.leoLead.email), "Change Role");
    await pickRole(dialog, "Inspector");
    await expect(dialog.locator('[data-slot="team-note"]')).toContainText(`${fixture.leoLead.name} leads 2 inspectors`);
    await pickLead(page, dialog, fixture.linaLead.name);
    await dialog.getByRole("button", { name: "Save Role", exact: true }).click();

    await expect(dialog.getByRole("alert").filter({ hasText: `${fixture.leoLead.name} leads 2 inspectors` })).toBeVisible();
    // React resets a form after its action; this one submits by hand, so the Radix choices stay.
    await expect(dialog.getByRole("radio", { name: /^Inspector\b/ })).toBeChecked();
    await expect(dialog.getByRole("combobox", { name: "Lead Inspector" })).toHaveText(fixture.linaLead.name);
    await shot(page, "demote-lead-refused");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(rowFor(page, fixture.leoLead.email)).toContainText("Lead Inspector");
  });

  test("makes an inspector a lead inspector, and back into a team", async ({ page }) => {
    await page.goto("/admin/users");
    const row = rowFor(page, fixture.ivan.email);

    let dialog = await chooseRowAction(page, row, "Change Role");
    await pickRole(dialog, "Lead Inspector");
    await expect(dialog.getByRole("combobox", { name: "Lead Inspector" })).toHaveCount(0);
    await shot(page, "make-lead");
    await dialog.getByRole("button", { name: "Save Role", exact: true }).click();
    await expect(toast(page, `${fixture.ivan.name} is now a lead inspector.`)).toBeVisible();
    await expect(row).toContainText("Lead Inspector");

    dialog = await chooseRowAction(page, row, "Change Role");
    await pickRole(dialog, "Inspector");
    await pickLead(page, dialog, fixture.linaLead.name);
    await dialog.getByRole("button", { name: "Save Role", exact: true }).click();
    await expect(toast(page, `${fixture.ivan.name} is now an inspector in ${fixture.linaLead.name}'s team.`)).toBeVisible();
    await expect(row).toContainText(fixture.linaLead.name);
  });

  test("activating an inspector asks for their lead first", async ({ page }) => {
    await page.goto("/admin/users");
    const row = rowFor(page, fixture.pat.email);
    await expect(statusOf(row)).toHaveText("Pending Activation");

    const dialog = await chooseRowAction(page, row, "Activate");
    await expect(dialog.getByRole("radio", { name: /^Inspector\b/ })).toBeChecked();
    await dialog.getByRole("button", { name: "Activate" }).click();
    const lead = dialog.getByRole("combobox", { name: "Lead Inspector" });
    await expect(lead).toHaveAttribute("aria-invalid", "true");
    await expect(lead).toHaveAccessibleDescription("Choose their lead inspector.");
    await expect(lead).toBeFocused();
    await shot(page, "activate-needs-lead");

    await pickLead(page, dialog, fixture.linaLead.name);
    await dialog.getByRole("button", { name: "Activate" }).click();
    await expect(
      toast(page, `${fixture.pat.name} is active and can sign in. They work in ${fixture.linaLead.name}'s team.`),
    ).toBeVisible();
    await expect(statusOf(row)).toHaveText("Active");
    await expect(row).toContainText(fixture.linaLead.name);
  });

  test("a refused invite keeps the role and the lead chosen", async ({ page }) => {
    await page.goto("/admin/users");
    await page.getByRole("button", { name: "Invite User", exact: true }).click();
    const dialog = page.getByRole("dialog", { name: "Invite a User", exact: true });
    await dialog.getByLabel("Full Name", { exact: true }).fill("E2E Org Invitee");
    // Already an account: refused before any email, whatever the mailer.
    await dialog.getByLabel("Email", { exact: true }).fill(fixture.bea.email);
    await pickLead(page, dialog, fixture.leoLead.name);
    await dialog.getByRole("button", { name: "Send Invite", exact: true }).click();

    await expect(dialog.getByText(/That email already has an account/)).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /^Inspector\b/ })).toBeChecked();
    await expect(dialog.getByRole("combobox", { name: "Lead Inspector" })).toHaveText(fixture.leoLead.name);
    await shot(page, "invite-refused");
    await dialog.getByRole("button", { name: "Cancel" }).click();
  });
});
