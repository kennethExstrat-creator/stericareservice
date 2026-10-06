import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  auditOf,
  createNewFixture,
  FIXTURE_TEMPLATE_CODE,
  FIXTURE_TEMPLATE_NAME,
  HARTALEGA,
  inspectionsOfFixture,
  PREVIOUS,
  TERANG_NUSA,
  type NewFixture,
} from "./fixtures";

/**
 * /inspections/new (BUILD_SPEC 4.4, 8 and 10) against the live project, at
 * the three sizes in playwright.config.ts. Screenshots go to screenshots/new/.
 * Every inspection drawn from the live ref sequence counts, so the two specs
 * that create one run on one size each: a blank start on the iPad in
 * portrait (the capture device), start from previous on the desktop.
 */

const INSPECTION_URL = /\/inspections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** STD_EG's modules, which the fixture template copies (BUILD_SPEC 11). */
const STD_EG_MODULES = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "carton_sampling",
  "dimensions",
  "force_at_break",
  "weight",
  "watertight",
  "visual",
  "dispensing_packing",
  "labeling",
  "conclusion",
];

// The dev server compiles on first use and the Mac runs several at once: allow for it.
test.describe.configure({ timeout: 120_000 });

let fixture: NewFixture;

test.beforeAll(async () => {
  fixture = await createNewFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled.
 */
async function shot(page: Page, name: string) {
  const path = (part = "") => `screenshots/new/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  if (!isTouch()) {
    await page.screenshot({ ...options, path: path(), fullPage: true });
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

/** A tap on the iPads, a click on the desktop. */
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

async function expectNoPageScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

async function choose(page: Page, label: string, option: string | RegExp) {
  await press(page.getByRole("combobox", { name: label }));
  await press(page.getByRole("option", { name: option }));
  await expect(page.getByRole("combobox", { name: label })).toHaveText(option);
}

/** The picks that make the fixture template apply: its client at Hartalega, examination gloves. */
async function pickFixtureOrder(page: Page) {
  await choose(page, "Client", fixture.clientName);
  await choose(page, "Manufacturer", HARTALEGA.label);
  await press(page.getByRole("radio", { name: /Examination gloves/ }));
}

function templatePanel(page: Page) {
  return page.getByTestId("template-panel");
}

/** Today in Malaysia, as the inspection is dated. */
function todayInMalaysia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

test("signed out, the page sends you to sign in and back", async ({ page }) => {
  await page.goto("/inspections/new");
  await expect(page).toHaveURL(/\/login\?next=%2Finspections%2Fnew$/);
});

test("the template follows the client, manufacturer and product type", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");

  await expect(page.getByRole("heading", { level: 1, name: "New inspection" })).toBeVisible();
  await expect(templatePanel(page)).toContainText("The template follows from the client, manufacturer and product type.");
  await expect(page.getByTestId("previous-picker")).toContainText("Choose the client, manufacturer and product type first.");
  await expectNoPageScroll(page);
  await shot(page, "empty");

  await pickFixtureOrder(page);
  const chosen = page.getByTestId("chosen-template");
  await expect(chosen).toHaveAttribute("data-code", FIXTURE_TEMPLATE_CODE);
  await expect(chosen).toContainText(FIXTURE_TEMPLATE_NAME);
  await expect(chosen).toContainText(`${FIXTURE_TEMPLATE_CODE} version 1 · EN 455`);
  await expect(chosen).toContainText(`For ${fixture.clientName} at ${HARTALEGA.label}`);
  await expect(chosen).toContainText("XS, S, M, L, XL (pieces)");
  await expect(page.getByRole("radio", { name: new RegExp(PREVIOUS.productName) })).toBeVisible();
  await expect(page.getByRole("radio", { name: "Start blank" })).toBeChecked();
  await expectNoPageScroll(page);
  await shot(page, "template");

  // The sections the template switches on, in order.
  await press(page.getByText("Show the sections"));
  await expect(chosen.getByRole("listitem")).toHaveCount(STD_EG_MODULES.length + 1);
  await expect(chosen.getByRole("listitem").first()).toHaveText("Manufacturer Information");
  await expect(chosen.getByRole("listitem").nth(1)).toHaveText("Glove Type");

  // Another manufacturer: the fixture's template no longer applies.
  await choose(page, "Manufacturer", TERANG_NUSA.label);
  await expect(page.getByTestId("chosen-template").or(page.getByTestId("no-template"))).toBeVisible();
  await expect(page.locator(`[data-testid=chosen-template][data-code=${FIXTURE_TEMPLATE_CODE}]`)).toHaveCount(0);
  await expect(page.getByTestId("no-previous")).toBeVisible();
  if (await page.getByTestId("no-template").isVisible()) {
    await expect(page.getByTestId("no-template")).toContainText(
      "No active template for examination gloves fits these choices. An admin needs to activate one.",
    );
    await shot(page, "no-template");
  }

  // Back at Hartalega, start from the earlier inspection: its product name comes along.
  await choose(page, "Manufacturer", HARTALEGA.label);
  await press(page.getByRole("radio", { name: new RegExp(PREVIOUS.productName) }));
  const summary = page.getByTestId("copy-summary");
  await expect(summary).toContainText(`Copied from ${fixture.previousRef}`);
  await expect(summary).toContainText("Manufacturer Information: product name and code, factory address and factory glove code");
  await expect(summary).toContainText("Glove Information: every field");
  await expect(summary).toContainText("Packing configuration: every field");
  await expect(summary).toContainText("Never copied: PO number, dates, lots, sampling, test results, comments and photos.");
  await expect(summary).toContainText(`Same template as last time (${FIXTURE_TEMPLATE_CODE} version 1): its specs and AQL carry over.`);
  await expect(page.getByRole("textbox", { name: /Product name/ })).toHaveValue(PREVIOUS.productName);
  await expectNoPageScroll(page);
  await shot(page, "previous");

  if (isTouch()) {
    for (const control of [
      page.getByRole("combobox", { name: "Client" }),
      page.getByRole("combobox", { name: "Manufacturer" }),
      page.getByRole("textbox", { name: /Product name/ }),
      page.getByRole("button", { name: "Create inspection" }),
      page.getByRole("link", { name: "Cancel" }),
      page.locator("[data-slot=choice-card]").first(),
    ]) {
      expect((await control.boundingBox())!.height, await control.textContent()).toBeGreaterThanOrEqual(44);
    }
    const fontSize = await page.getByRole("textbox", { name: /Product name/ }).evaluate((input) => getComputedStyle(input).fontSize);
    expect(fontSize).toBe("16px");
  }
  expect(hydration()).toEqual([]);
});

test("Create asks for what is missing, and focuses the first", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");
  await press(page.getByRole("button", { name: "Create inspection" }));

  await expect(page.getByText("Choose the client, or No client.")).toBeVisible();
  await expect(page.getByText("Choose the manufacturer.")).toBeVisible();
  await expect(page.getByText("Choose the product type.")).toBeVisible();
  await expect(page.getByTestId("form-error")).toContainText("Check the highlighted fields.");
  await expect(page.getByRole("combobox", { name: "Client" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveAttribute("aria-invalid", "true");
  await shot(page, "errors");

  // Choosing clears that field's error.
  await choose(page, "Client", "No client");
  await expect(page.getByText("Choose the client, or No client.")).toHaveCount(0);
});

test("the inspector creates an inspection and lands on it", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name !== "ipad-portrait", "Creates an inspection: one size only (e2e/README.md).");
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");
  await pickFixtureOrder(page);
  await page.getByRole("textbox", { name: /Product name/ }).fill("E2E blank start");
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", FIXTURE_TEMPLATE_CODE);
  await press(page.getByRole("button", { name: "Create inspection" }));

  await expect(page).toHaveURL(INSPECTION_URL, { timeout: 90_000 });
  const id = page.url().split("/").at(-1)!;
  const [created] = (await inspectionsOfFixture(fixture.templateId)).filter((row) => row.id === id);
  expect(created).toMatchObject({
    status: "draft",
    inspector_id: fixture.inspectorId,
    template_id: fixture.templateId,
    client_id: fixture.clientId,
    manufacturer_id: HARTALEGA.id,
    product_name: "E2E blank start",
    inspection_date: todayInMalaysia(),
  });
  const data = created.data as { modules: Record<string, unknown>; custom: Record<string, unknown> };
  // jsonb keeps no key order: compare as a set.
  expect(Object.keys(data.modules).sort()).toEqual([...STD_EG_MODULES].sort());
  expect(data.modules.header).toEqual({ inspectionDate: todayInMalaysia(), productName: "E2E blank start" });
  expect(data.modules.glove_info).toEqual({ surfaceTexture: null, indicativeWeight: null, colour: null, length: null });
  expect(data.custom).toEqual({});
  expect((await auditOf(id)).map((row) => row.action)).toEqual(["created"]);
  await shot(page, "created");
});

test("start from previous copies the product's details and nothing else", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "Creates an inspection: one size only (e2e/README.md).");
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");
  await pickFixtureOrder(page);
  await press(page.getByRole("radio", { name: new RegExp(PREVIOUS.productName) }));
  await press(page.getByRole("button", { name: "Create inspection" }));

  await expect(page).toHaveURL(INSPECTION_URL, { timeout: 90_000 });
  const id = page.url().split("/").at(-1)!;
  const [created] = (await inspectionsOfFixture(fixture.templateId)).filter((row) => row.id === id);
  expect(created.product_name).toBe(PREVIOUS.productName);
  const data = created.data as { modules: Record<string, unknown>; custom: Record<string, unknown> };
  expect(data.modules.header).toEqual({
    factoryAddress: PREVIOUS.header.factoryAddress,
    productName: PREVIOUS.header.productName,
    productCode: PREVIOUS.header.productCode,
    factoryGloveCode: PREVIOUS.header.factoryGloveCode,
    inspectionDate: todayInMalaysia(),
  });
  expect(data.modules.glove_info).toEqual(PREVIOUS.gloveInfo);
  expect(data.modules.packing_config).toEqual(PREVIOUS.packing);
  const text = JSON.stringify(data);
  for (const never of [PREVIOUS.header.poNo, PREVIOUS.header.mfgDate, PREVIOUS.header.expiryDate, PREVIOUS.header.comment, PREVIOUS.conclusion.remark, "never copied"]) {
    expect(text, never).not.toContain(never);
  }
  expect(data.custom).toEqual({});
  const audit = await auditOf(id);
  expect(audit.map((row) => row.action).sort()).toEqual(["created", "started_from_previous"]);
  expect(audit.find((row) => row.action === "started_from_previous")?.changes).toEqual({
    from: { id: fixture.previousId, ref_no: fixture.previousRef },
    copied: ["header", "glove_info", "packing_config"],
  });
});

test("an admin can choose another template", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name === "ipad-landscape", "The admin's view once on each layout.");
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto("/inspections/new");
  await pickFixtureOrder(page);
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", FIXTURE_TEMPLATE_CODE);
  const picker = page.getByRole("combobox", { name: "Use another template" });
  await expect(picker).toHaveText(`Automatic: ${FIXTURE_TEMPLATE_CODE} version 1`);
  await press(picker);
  const option = page.getByRole("option", { name: `${FIXTURE_TEMPLATE_CODE} version 1`, exact: true });
  await expect(option).toBeVisible();
  await press(option);
  await expect(page.getByTestId("chosen-template")).toContainText("Chosen by an admin");
  // Admins see every inspector's earlier inspections.
  await expect(page.getByRole("radio", { name: new RegExp(PREVIOUS.productName) })).toBeVisible();
  await expectNoPageScroll(page);
  await shot(page, "admin");
});
