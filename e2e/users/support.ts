import { randomUUID } from "node:crypto";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient, throwawayEmail } from "../support/admin";

/** Throwaway accounts of these specs: e2e-users-<random>@test.local. */
const OWNER = "users";
const PREFIX = `e2e-${OWNER}-`;

/** Addresses this test process handed out; the sweep may delete these at any age. */
const handedOut = new Set<string>();

/** A new throwaway address, remembered for the cleanup sweep. */
export function throwawayAddress(): string {
  const email = throwawayEmail(OWNER).toLowerCase();
  handedOut.add(email);
  return email;
}

export type Throwaway = { id: string; email: string; password: string; fullName: string };

/**
 * A throwaway inspector account with a password, created through the Auth
 * admin API like a real user (the profile trigger fires). New accounts start
 * inactive (migration 20261006000600), so it is activated here, as an invite
 * would, unless `activate: false` leaves the profile exactly as the trigger
 * made it: no update at all, since any update counts as touched. Delete it
 * with deleteAccount() in a finally block.
 */
export async function createThrowaway(fullName: string, { activate = true }: { activate?: boolean } = {}): Promise<Throwaway> {
  const admin = createTestAdminClient();
  const email = throwawayAddress();
  const password = `E2e-${randomUUID().slice(0, 13)}-9`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName },
  });
  if (error) throw new Error(`Could not create ${email}: ${error.message}`);

  const id = data.user.id;
  if (activate) {
    const { error: profileError } = await admin.from("profiles").update({ active: true }).eq("id", id);
    if (profileError) {
      await admin.auth.admin.deleteUser(id);
      throw new Error(`Could not activate ${email}: ${profileError.message}`);
    }
  }
  return { id, email, password, fullName };
}

/** The profile as the database holds it (checks of what an action wrote, never of what a user can see). */
export async function profileOf(id: string) {
  const { data, error } = await createTestAdminClient()
    .from("profiles")
    .select("role, active, full_name")
    .eq("id", id)
    .single();
  if (error) throw new Error(`Could not read the profile ${id}: ${error.message}`);
  return data;
}

export async function profileByEmail(email: string) {
  const { data, error } = await createTestAdminClient()
    .from("profiles")
    .select("id, role, active, full_name")
    .eq("email", email.toLowerCase())
    .maybeSingle();
  if (error) throw new Error(`Could not read the profile of ${email}: ${error.message}`);
  return data;
}

/** True while Supabase Auth bans the account (deactivation). */
export async function isBanned(id: string): Promise<boolean> {
  const { data, error } = await createTestAdminClient().auth.admin.getUserById(id);
  if (error) throw new Error(`Could not read the auth user ${id}: ${error.message}`);
  const until = data.user.banned_until;
  return Boolean(until && Date.parse(until) > Date.now());
}

export async function deleteAccount(id: string): Promise<void> {
  const { error } = await createTestAdminClient().auth.admin.deleteUser(id);
  if (error && error.status !== 404) throw new Error(`Could not delete throwaway account ${id}: ${error.message}`);
}

/** The Auth users matching `match`, for cleanup. */
async function findAccounts(match: (email: string, createdAt: number) => boolean): Promise<string[]> {
  const admin = createTestAdminClient();
  const ids: string[] = [];
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw error;
    for (const user of data.users) {
      if (user.email && match(user.email.toLowerCase(), Date.parse(user.created_at))) ids.push(user.id);
    }
    if (data.users.length < 1000) break;
  }
  return ids;
}

/** Deletes the account an invite may have created, if it exists. */
export async function deleteAccountsWithEmail(email: string): Promise<void> {
  for (const id of await findAccounts((candidate) => candidate === email.toLowerCase())) await deleteAccount(id);
}

const STALE_MS = 30 * 60 * 1000;

/**
 * Removes the throwaways this run handed out, and any e2e-users-* account
 * older than 30 minutes that a crashed run left behind. A run still going in
 * another checkout keeps its fresh accounts. Never touches other addresses.
 */
export async function sweepThrowaways(): Promise<void> {
  const staleBefore = Date.now() - STALE_MS;
  const ids = await findAccounts(
    (email, createdAt) =>
      email.startsWith(PREFIX) && email.endsWith("@test.local") && (handedOut.has(email) || createdAt < staleBefore),
  );
  for (const id of ids) await deleteAccount(id);
}

/**
 * The app shell's main area pads every page (24 px, 40 px from 1280 px) and
 * caps it at 1280 px. Where the shell is not built yet (a branch without it),
 * screenshots get the same frame, so they show the page as it will sit.
 */
const SHELL_FRAME = `
  body { padding: 1.5rem 1.5rem 2.5rem; }
  @media (min-width: 768px) { body { padding-top: 2rem; } }
  @media (min-width: 1280px) { body { padding: 2.5rem; } }
  body > div:first-of-type { width: 100%; max-width: 80rem; margin-inline: auto; }
`;

/** Full-page screenshot under screenshots/users/<project>-<name>.png (git-ignored). */
export async function shot(page: Page, name: string): Promise<void> {
  if ((await page.locator("#main-content").count()) === 0) await page.addStyleTag({ content: SHELL_FRAME });
  // Let toasts and dialogs finish their 100-150 ms entrance first.
  await page.waitForTimeout(300);
  await page.screenshot({ path: `screenshots/users/${test.info().project.name}-${name}.png`, fullPage: true });
}

export const rowFor = (page: Page, email: string): Locator => page.getByRole("row").filter({ hasText: email });

export const statusOf = (row: Locator): Locator => row.locator('[data-slot="account-status"]');

export const toast = (page: Page, text: string | RegExp): Locator =>
  page.locator("[data-sonner-toast]").filter({ hasText: text });

/**
 * Opens a row's menu and picks an item, then returns the dialog it opens: a
 * confirmation (alertdialog), or a form for a role or a lead (dialog).
 */
export async function chooseRowAction(page: Page, row: Locator, item: string): Promise<Locator> {
  await row.getByRole("button", { name: /^Actions for / }).click();
  await page.getByRole("menuitem", { name: item, exact: true }).click();
  const dialog = page.getByRole("alertdialog").or(page.getByRole("dialog"));
  await expect(dialog).toBeVisible();
  return dialog;
}

/**
 * True when the project has lead inspectors (migration 20261007170000).
 * Until it has, the Users screen works with roles only, and the specs check
 * that instead.
 */
export async function teamsReady(): Promise<boolean> {
  const { error } = await createTestAdminClient().from("profiles").select("is_lead").limit(1);
  if (!error) return true;
  if (error.code === "42703") return false;
  throw new Error(`Could not tell whether the project has lead inspectors: ${error.message}`);
}

/** Picks a role in a role dialog: Inspector, Lead inspector or Admin. */
export async function pickRole(dialog: Locator, role: "Inspector" | "Lead inspector" | "Admin"): Promise<void> {
  await dialog.getByRole("radio", { name: new RegExp(`^${role}\\b`) }).click();
}

/** Picks a lead inspector in a dialog's Lead inspector picker. */
export async function pickLead(page: Page, dialog: Locator, name: string): Promise<void> {
  await dialog.getByRole("combobox", { name: "Lead inspector" }).click();
  await page.getByRole("option", { name, exact: true }).click();
}

export type ChromeName = { name: string; description: string };

/**
 * The elements with `role` inside `scope`, in order, named and described as
 * Chrome itself computes it: read from its accessibility tree over the
 * DevTools protocol, so Chromium projects only. Playwright's getByRole
 * computes names on its own and can find a name where Chrome finds none, as
 * it did for a radio inside its card's label (see
 * app/(app)/admin/_components/radio-card.tsx). A screen reader hears Chrome's.
 */
export async function chromeNames(scope: Locator, role: string): Promise<ChromeName[]> {
  const page = scope.page();
  const mark = randomUUID();
  await scope.evaluate((element, value) => element.setAttribute("data-chrome-names", value), mark);
  const cdp = await page.context().newCDPSession(page);
  try {
    await cdp.send("Accessibility.enable");
    const { result } = await cdp.send("Runtime.evaluate", {
      expression: `document.querySelector('[data-chrome-names="${mark}"]')`,
    });
    if (!result.objectId) throw new Error("chromeNames: the scope left the page.");
    const { nodes } = await cdp.send("Accessibility.queryAXTree", { objectId: result.objectId, role });
    // The query also returns nodes left out of the tree, such as Radix's hidden native radios.
    return nodes
      .filter((node) => !node.ignored)
      .map((node) => ({ name: String(node.name?.value ?? ""), description: String(node.description?.value ?? "") }));
  } finally {
    await cdp.detach();
    await scope.evaluate((element) => element.removeAttribute("data-chrome-names")).catch(() => undefined);
  }
}

/** The role radios of the invite, change role and activate dialogs, as Chrome names them. */
export function roleRadios(teams: boolean): ChromeName[] {
  return [
    { name: "Inspector", description: "Records inspections and sees their own." },
    ...(teams ? [{ name: "Lead inspector", description: "Also sees their team's inspections, read-only." }] : []),
    { name: "Admin", description: "Manages users and templates, and approves inspections." },
  ];
}
