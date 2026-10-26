import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";

/**
 * /inspections/new keeps what was chosen and typed across a reload (UX-04,
 * app/(app)/inspections/new/_lib/draft.ts): the client, manufacturer and
 * product type, the product name as typed and an admin's template, per user
 * in the tab's sessionStorage, until the form is cancelled or the inspection
 * created. Start From Previous is gone (Kenneth, 26 October 2026): the draft
 * names no earlier inspection.
 *
 * As the admin, who can choose the template: one sign-in per size, on the
 * iPad in portrait and on the desktop. The spec only reads the database, to
 * find picks an earlier inspection was made with, and never presses Create:
 * that would draw a number from the live sequence. Screenshots go to
 * screenshots/new-draft/.
 */

// The dev server compiles on first use and the Mac runs several at once: allow for it.
test.describe.configure({ timeout: 120_000 });

const SIZES = ["ipad-portrait", "desktop"];
const DRAFT_PREFIX = "stericare:new-inspection:";
const TYPED = "E2E draft: typed before the reload";

type SessionCookie = Awaited<ReturnType<typeof sessionCookies>>[number];

/** What to choose, as the pickers show it, and the earlier inspection the picks come from (null: none to be had). */
type Order = { client: string; manufacturer: string; productType: "examination" | "surgical"; previousId: string | null };

let cookies: SessionCookie[] = [];
let adminId = "";
let order: Order;

test.beforeAll(async ({}, testInfo) => {
  test.skip(!SIZES.includes(testInfo.project.name), "Checked on the iPad in portrait and on the desktop.");
  ({ adminId, order } = await findOrder());
  cookies = await sessionCookies(TEST_ACCOUNTS.admin);
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
});

/** Rows other specs make for a while and delete again: their codes and names start with E2E. */
function temporary(name: string | null | undefined): boolean {
  return name?.startsWith("E2E") ?? false;
}

/**
 * The admin's id, and picks an earlier inspection was made with: the newest
 * inspection for its client, manufacturer and product type, and not another
 * spec's, whose rows go again. The preference for a named, submitted one
 * dates from Start From Previous (gone: Kenneth, 26 October 2026) and does
 * no harm. Without any, the first client and manufacturer. Reads only.
 */
async function findOrder(): Promise<{ adminId: string; order: Order }> {
  const admin = createTestAdminClient();
  const [profile, clients, manufacturers, inspections] = await Promise.all([
    admin.from("profiles").select("id").eq("email", TEST_ACCOUNTS.admin).single(),
    admin.from("clients").select("id, name").order("name"),
    admin.from("manufacturers").select("id, name, factory_name").order("name"),
    admin
      .from("inspections")
      .select("id, client_id, manufacturer_id, product_name, status, template:templates(code, product_type)")
      .not("manufacturer_id", "is", null)
      .order("inspection_date", { ascending: false })
      .order("created_at", { ascending: false })
      .limit(200),
  ]);
  for (const result of [profile, clients, manufacturers, inspections]) {
    if (result.error) throw new Error(`Reading the new inspection's choices failed: ${result.error.message}`);
  }
  // As lib/inspections/format.ts manufacturerLabel.
  const label = (entry: { name: string; factory_name: string | null }) =>
    entry.factory_name?.trim() ? `${entry.name} · ${entry.factory_name.trim()}` : entry.name;
  const stableClients = clients.data!.filter((client) => !temporary(client.name));
  const stableManufacturers = manufacturers.data!.filter((manufacturer) => !temporary(manufacturer.name));
  const candidates: { order: Order; named: boolean; kept: boolean }[] = [];
  const seen = new Set<string>();
  for (const row of inspections.data!) {
    if (!row.template) continue;
    const picks = [row.client_id, row.manufacturer_id, row.template.product_type].join("|");
    if (seen.has(picks)) continue;
    seen.add(picks);
    if (temporary(row.template.code) || temporary(row.product_name)) continue;
    const client = row.client_id === null ? "No Client" : stableClients.find((entry) => entry.id === row.client_id)?.name;
    const manufacturer = stableManufacturers.find((entry) => entry.id === row.manufacturer_id);
    if (client === undefined || !manufacturer) continue;
    candidates.push({
      order: { client, manufacturer: label(manufacturer), productType: row.template.product_type, previousId: row.id },
      named: Boolean(row.product_name?.trim()),
      // Only drafts can be deleted: a submitted or approved one cannot vanish while the test runs.
      kept: row.status !== "draft",
    });
  }
  const chosen =
    candidates.find((candidate) => candidate.named && candidate.kept) ??
    candidates.find((candidate) => candidate.kept) ??
    candidates.find((candidate) => candidate.named) ??
    candidates[0];
  if (chosen) return { adminId: profile.data!.id, order: chosen.order };
  const [manufacturer] = stableManufacturers;
  if (!manufacturer) throw new Error("No manufacturers yet: the form cannot be filled in.");
  return {
    adminId: profile.data!.id,
    order: { client: stableClients[0]?.name ?? "No Client", manufacturer: label(manufacturer), productType: "examination", previousId: null },
  };
}

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

/** A tap on the iPad, a click on the desktop. */
async function press(locator: Locator) {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/** Collects console errors, so hydration mismatches fail the test. */
function watchConsole(page: Page) {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

/** The form has hydrated, and the render after it (where a draft comes back) has landed. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const form = document.querySelector('[data-testid="new-inspection-form"]');
    return form !== null && Object.keys(form).some((key) => key.startsWith("__reactFiber"));
  });
  await page.evaluate(
    () => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 50)),
  );
}

/** The new-inspection drafts in this tab: key and stored value. */
async function drafts(page: Page): Promise<Record<string, unknown>> {
  return page.evaluate((prefix) => {
    const found: Record<string, unknown> = {};
    for (let index = 0; index < sessionStorage.length; index++) {
      const key = sessionStorage.key(index);
      if (key?.startsWith(prefix)) found[key] = JSON.parse(sessionStorage.getItem(key) ?? "null");
    }
    return found;
  }, DRAFT_PREFIX);
}

async function shot(page: Page, name: string) {
  await page.evaluate(() => window.scrollTo(0, 0));
  // A full-page capture drops touch emulation while it resizes (e2e/README.md): the iPad gets the viewport.
  await page.screenshot({
    path: `screenshots/new-draft/${test.info().project.name}-${name}.png`,
    fullPage: !isTouch(),
    animations: "disabled",
    caret: "initial",
  });
}

async function choose(page: Page, label: string, option: string) {
  await press(page.getByRole("combobox", { name: label }));
  await press(page.getByRole("option", { name: option, exact: true }));
  await expect(page.getByRole("combobox", { name: label })).toHaveText(option);
}

test("a reload brings back every choice and the typed name; Cancel drops them", async ({ page }) => {
  const hydration = watchConsole(page);
  await page.goto("/inspections/new");
  await hydrated(page);
  const productName = page.getByRole("textbox", { name: /Product Name/ });
  const productType = page
    .getByRole("group", { name: "Product Type" })
    .getByRole("radio", { name: order.productType === "examination" ? /^Examination Gloves/ : /^Surgical Gloves/ });
  const templatePicker = page.getByRole("combobox", { name: "Use Another Template" });
  const reason = page.getByTestId("choice-reason");

  // Typed first, while no template can switch the field off.
  await productName.fill(TYPED);
  await choose(page, "Client", order.client);
  await choose(page, "Manufacturer", order.manufacturer);
  await press(productType);
  await expect(productType).toBeChecked();
  // Start From Previous is gone (Kenneth, 26 October 2026).
  await expect(page.getByTestId("previous-picker")).toHaveCount(0);

  // The admin's own choice of template, past the automatic one (not another spec's, which would go again).
  await press(templatePicker);
  const option = page.locator('[role="option"]:not([data-disabled])').filter({ hasNotText: /^(Automatic|E2E)/ }).first();
  const template = (await option.textContent())!.trim();
  await press(option);
  await expect(templatePicker).toHaveText(template);
  await expect(reason).toHaveText("Chosen by an Admin");
  const shownName = await productName.inputValue();

  // Kept in the tab under the admin's own key, as it changed.
  const key = `${DRAFT_PREFIX}${adminId}`;
  expect(Object.keys(await drafts(page))).toEqual([key]);
  const stored = (await drafts(page))[key];
  expect(stored).toMatchObject({
    v: 1,
    productType: order.productType,
    productName: TYPED,
  });
  expect(stored).not.toHaveProperty("previous");
  expect(stored).not.toHaveProperty("nameFromPrevious");

  await page.reload();
  await hydrated(page);
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveText(order.client);
  await expect(page.getByRole("combobox", { name: "Manufacturer" })).toHaveText(order.manufacturer);
  await expect(productType).toBeChecked();
  await expect(productName).toHaveValue(shownName);
  await expect(templatePicker).toHaveText(template);
  await expect(reason).toHaveText("Chosen by an Admin");
  // Coming back changed nothing in the draft: no picker reported itself cleared on the way.
  expect((await drafts(page))[key]).toEqual(stored);
  await shot(page, "restored");

  // Cancel drops the draft: the form opens empty again. The list may compile on first use.
  await press(page.getByRole("link", { name: "Cancel", exact: true }));
  await expect(page).toHaveURL(/\/inspections$/, { timeout: 90_000 });
  expect(await drafts(page)).toEqual({});
  await page.goto("/inspections/new");
  await hydrated(page);
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveText("Choose the client");
  await expect(page.getByRole("combobox", { name: "Manufacturer" })).toHaveText("Choose the manufacturer");
  await expect(productType).not.toBeChecked();
  await expect(productName).toHaveValue("");
  expect(await drafts(page)).toEqual({});
  expect(hydration()).toEqual([]);
});
