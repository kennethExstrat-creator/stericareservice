import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  auditOf,
  createNewFixture,
  FIXTURE_TEMPLATE_CODE,
  FIXTURE_TEMPLATE_NAME,
  HARTALEGA,
  includedModules,
  inspectionsOfFixture,
  LEVEL_TEMPLATES,
  POLYCO,
  seedTemplatesLive,
  standardTemplates,
  type NewFixture,
} from "./fixtures";
import { expectNoPageScroll } from "../support/layout";

/**
 * /inspections/new (BUILD_SPEC 4.4, 8 and 10) against the live project, at
 * the three sizes in playwright.config.ts. Screenshots go to
 * screenshots/newseed/. Every inspection drawn from the live ref sequence
 * counts, so the spec that creates one runs on one size: a blank start on the
 * iPad in portrait (the capture device). Start From Previous is gone
 * (Kenneth, 26 October 2026).
 */

const INSPECTION_URL = /\/inspections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** STD_EG's modules, which the fixture template copies (BUILD_SPEC 11). */
const STD_EG_MODULES = includedModules("STD_EG");
const NO_TEMPLATE = "No active template for examination gloves yet.";

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
  const path = (part = "") => `screenshots/newseed/${test.info().project.name}-${name}${part}.png`;
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

async function choose(page: Page, label: string, option: string | RegExp) {
  await press(page.getByRole("combobox", { name: label }));
  await press(page.getByRole("option", { name: option }));
  await expect(page.getByRole("combobox", { name: label })).toHaveText(option);
}

/** A product type's card, found in its own group and by the start of its name. */
function productTypeCard(page: Page, type: "examination" | "surgical") {
  return page
    .getByRole("group", { name: "Product Type", exact: true })
    .getByRole("radio", { name: type === "examination" ? /^Examination Gloves/ : /^Surgical Gloves/ });
}

/** The picks that make the fixture template apply: its client at Hartalega, examination gloves. */
async function pickFixtureOrder(page: Page) {
  await choose(page, "Client", fixture.clientName);
  await choose(page, "Manufacturer", HARTALEGA.label);
  await press(productTypeCard(page, "examination"));
}

function templatePanel(page: Page) {
  return page.getByTestId("template-panel");
}

/** The template the page will use, and why: the rule's words. */
async function expectTemplate(page: Page, code: string, reason: string) {
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", code);
  await expect(page.getByTestId("choice-reason")).toHaveText(reason);
}

/**
 * The connection drops: Create's Server Action request (a POST to this page)
 * never reaches the server. Page loads go through.
 */
async function dropCreateRequests(page: Page) {
  await page.route(
    (url) => url.pathname === "/inspections/new",
    (route) => (route.request().method() === "POST" ? route.abort("internetdisconnected") : route.fallback()),
  );
}

const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

/**
 * The values given, and nothing else: every other key is empty. Module data
 * lists every field once a module is built, as null until entered.
 */
function expectOnly(actual: unknown, expected: Record<string, unknown>) {
  expect(actual).toMatchObject(expected);
  const others = Object.entries(actual as Record<string, unknown>).filter(([key]) => !(key in expected));
  expect(Object.fromEntries(others.filter(([, value]) => value !== null))).toEqual({});
}

/** Today in Malaysia, as the inspection is dated. */
function todayInMalaysia(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kuala_Lumpur" }).format(new Date());
}

test("signed out, the page sends you to sign in and back", async ({ page }) => {
  await page.goto("/inspections/new");
  await expect(page).toHaveURL(/\/login\?next=%2Finspections%2Fnew$/);
});

test("the most specific template wins: client and manufacturer, client, manufacturer, standard", async ({
  page,
  context,
  baseURL,
}) => {
  test.skip(true, "Kenneth, 26 October 2026: every client uses the standard template of the product type: the fixture's scoped templates never apply. Rewrite for the standard rule.");
  const hydration = watchConsole(page);
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");

  await expect(page.getByRole("heading", { level: 1, name: "New Inspection" })).toBeVisible();
  await expect(templatePanel(page)).toContainText("The template follows from the client, manufacturer and product type.");
  // Start From Previous is gone (Kenneth, 26 October 2026).
  await expect(page.getByTestId("previous-picker")).toHaveCount(0);
  await expectNoPageScroll(page);
  await shot(page, "empty");

  // The client at Hartalega: the template for that client at that manufacturer.
  await pickFixtureOrder(page);
  const chosen = page.getByTestId("chosen-template");
  await expectTemplate(page, FIXTURE_TEMPLATE_CODE, `For ${fixture.clientName} at ${HARTALEGA.label}`);
  await expect(chosen).toContainText(FIXTURE_TEMPLATE_NAME);
  await expect(chosen).toContainText(`${FIXTURE_TEMPLATE_CODE} Version 1 · EN 455`);
  await expect(chosen).toContainText("XS, S, M, L, XL (pieces)");
  await expectNoPageScroll(page);
  await shot(page, "template");

  // The sections the template switches on, in order.
  await press(page.getByText("Show the Sections"));
  await expect(chosen.getByRole("listitem")).toHaveCount(STD_EG_MODULES.length + 1);
  await expect(chosen.getByRole("listitem").first()).toHaveText("Manufacturer Information");
  await expect(chosen.getByRole("listitem").nth(1)).toHaveText("Glove Type");

  // The client at manufacturer A, which has a template for anyone: the client's own comes
  // first. Its header has no product name, so the form takes none.
  await choose(page, "Manufacturer", fixture.manufacturerA.label);
  await expectTemplate(page, LEVEL_TEMPLATES.client.code, `For ${fixture.clientName}`);
  const productName = page.getByRole("textbox", { name: /Product Name/ });
  await expect(productName).toBeDisabled();
  await expect(productName).toHaveAttribute("placeholder", "None with this template");
  // Greyed, not faded: faded, it read as an empty field to type in.
  await expect(productName).toHaveCSS("opacity", "1");
  await expect(page.getByTestId("product-name-hint")).toHaveText("This template's header has no product name, so none is recorded.");
  await expectNoPageScroll(page);
  await shot(page, "level-client");

  // The client at manufacturer B: the template for that client there, before the client's own.
  await choose(page, "Manufacturer", fixture.manufacturerB.label);
  await expectTemplate(page, LEVEL_TEMPLATES.clientManufacturer.code, `For ${fixture.clientName} at ${fixture.manufacturerB.label}`);
  await expect(productName).toBeEnabled();

  // No client at manufacturer A: the manufacturer's template; the client's templates need the client.
  await choose(page, "Client", "No Client");
  await choose(page, "Manufacturer", fixture.manufacturerA.label);
  await expectTemplate(page, LEVEL_TEMPLATES.manufacturer.code, `For ${fixture.manufacturerA.label}`);
  await expect(chosen).toContainText(`${LEVEL_TEMPLATES.manufacturer.code} Version 1 · ASTM D6319`);
  await expect(productName).toBeEnabled();
  await shot(page, "level-manufacturer");

  // No client at manufacturer B, which has only the client's template: only a standard
  // template can apply (once seeded, STD_EG).
  await choose(page, "Manufacturer", fixture.manufacturerB.label);
  const [standard] = await standardTemplates("examination");
  if (standard) {
    await expectTemplate(page, standard.code, "Standard Template for Examination Gloves");
  } else {
    await expect(page.getByTestId("no-template")).toContainText(NO_TEMPLATE);
  }
  await expectNoPageScroll(page);
  await shot(page, "standard");

  // Back with the client at Hartalega, where the fixture has an earlier inspection: the
  // product name stays as typed, since nothing starts from an earlier inspection any more.
  await choose(page, "Client", fixture.clientName);
  await choose(page, "Manufacturer", HARTALEGA.label);
  await expectTemplate(page, FIXTURE_TEMPLATE_CODE, `For ${fixture.clientName} at ${HARTALEGA.label}`);
  await productName.fill("E2E typed name");
  await expect(productName).toHaveValue("E2E typed name");
  await expectNoPageScroll(page);

  if (isTouch()) {
    for (const control of [
      page.getByRole("combobox", { name: "Client" }),
      page.getByRole("combobox", { name: "Manufacturer" }),
      productName,
      page.getByRole("button", { name: "Create Inspection" }),
      page.getByRole("link", { name: "Cancel" }),
      page.locator("[data-slot=choice-card]").first(),
    ]) {
      expect((await control.boundingBox())!.height, (await control.textContent()) ?? "").toBeGreaterThanOrEqual(44);
    }
    const fontSize = await productName.evaluate((input) => getComputedStyle(input).fontSize);
    expect(fontSize).toBe("16px");
  }
  expect(hydration()).toEqual([]);
});

test("once seeded, the seed templates apply as BUILD_SPEC 11 scopes them", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "Reads only: one size is enough.");
  test.skip(
    !(await seedTemplatesLive()),
    "STD_EG and STD_SG are not active yet (npm run seed:templates -- --apply, README.md step 7).",
  );
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");

  // Polyco Healthline, SAFEDON_EG's client until 26 October 2026: the standard template, as every client.
  const [examination] = await standardTemplates("examination");
  await choose(page, "Client", POLYCO.label);
  await choose(page, "Manufacturer", fixture.manufacturerB.label);
  await press(productTypeCard(page, "examination"));
  await expectTemplate(page, examination.code, "Standard Template for Examination Gloves");
  await shot(page, "seeded");

  // No client: the same standard template for the product type.
  await choose(page, "Client", "No Client");
  await expectTemplate(page, examination.code, "Standard Template for Examination Gloves");
  await press(productTypeCard(page, "surgical"));
  const [surgical] = await standardTemplates("surgical");
  await expectTemplate(page, surgical.code, "Standard Template for Surgical Gloves");
  await expect(page.getByTestId("chosen-template")).toContainText("(pairs)");
});

test("Create asks for what is missing, and focuses the first", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");
  await press(page.getByRole("button", { name: "Create Inspection" }));

  await expect(page.getByText("Choose the client, or No Client.")).toBeVisible();
  await expect(page.getByText("Choose the manufacturer.")).toBeVisible();
  await expect(page.getByText("Choose the product type.")).toBeVisible();
  await expect(page.getByTestId("form-error")).toContainText("Check the highlighted fields.");
  await expect(page.getByRole("combobox", { name: "Client" })).toBeFocused();
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveAttribute("aria-invalid", "true");
  await shot(page, "errors");

  // Choosing clears that field's error.
  await choose(page, "Client", "No Client");
  await expect(page.getByText("Choose the client, or No Client.")).toHaveCount(0);
});

test("a failed Create keeps every choice and says why", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");
  await pickFixtureOrder(page);
  await page.getByRole("textbox", { name: /Product Name/ }).fill("E2E kept name");
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", FIXTURE_TEMPLATE_CODE);

  await dropCreateRequests(page);
  await press(page.getByRole("button", { name: "Create Inspection" }));

  const message = page.getByTestId("form-error");
  await expect(message).toContainText(UNREACHABLE);
  await expect(message).toBeFocused();
  // Nothing was reset: the next try needs no new choices.
  await expect(page.getByRole("combobox", { name: "Client" })).toHaveText(fixture.clientName);
  await expect(page.getByRole("combobox", { name: "Manufacturer" })).toHaveText(HARTALEGA.label);
  await expect(productTypeCard(page, "examination")).toBeChecked();
  await expect(page.getByRole("textbox", { name: /Product Name/ })).toHaveValue("E2E kept name");
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", FIXTURE_TEMPLATE_CODE);
  await expect(page.getByRole("button", { name: "Create Inspection" })).toBeEnabled();
  await expectNoPageScroll(page);
  await shot(page, "offline");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

test("the inspector creates an inspection from the manufacturer's template and lands on it", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name !== "ipad-portrait", "Creates an inspection: one size only (e2e/README.md).");
  test.skip(true, "Kenneth, 26 October 2026: every client uses the standard template of the product type: a manufacturer's template never applies. Rewrite to create from the standard template.");
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto("/inspections/new");
  // No client at manufacturer A: the server picks the manufacturer's template again, past the
  // client's own, which does not apply without that client.
  await choose(page, "Client", "No Client");
  await choose(page, "Manufacturer", fixture.manufacturerA.label);
  await press(productTypeCard(page, "examination"));
  await page.getByRole("textbox", { name: /Product Name/ }).fill("E2E blank start");
  await expectTemplate(page, LEVEL_TEMPLATES.manufacturer.code, `For ${fixture.manufacturerA.label}`);
  await press(page.getByRole("button", { name: "Create Inspection" }));

  await expect(page).toHaveURL(INSPECTION_URL, { timeout: 90_000 });
  const id = page.url().split("/").at(-1)!;
  const templateId = fixture.templateIds[LEVEL_TEMPLATES.manufacturer.code];
  const [created] = (await inspectionsOfFixture(templateId)).filter((row) => row.id === id);
  // The columns the list shows and searches, as the capture screen's save writes them.
  expect(created).toMatchObject({
    status: "draft",
    inspector_id: fixture.inspectorId,
    template_id: templateId,
    client_id: null,
    manufacturer_id: fixture.manufacturerA.id,
    product_name: "E2E blank start",
    po_no: null,
    lot_numbers: [],
    inspection_date: todayInMalaysia(),
    suggested_result: "hold",
    result: null,
    remarks: null,
  });
  const data = created.data as { modules: Record<string, unknown>; custom: Record<string, unknown> };
  // Every module SAFEDON_EG switches on starts with its own empty data; jsonb keeps no key order.
  expect(Object.keys(data.modules).sort()).toEqual([...includedModules("SAFEDON_EG")].sort());
  // Dated today, with the product name typed and the manufacturer's address.
  expectOnly(data.modules.header, {
    inspectionDate: todayInMalaysia(),
    productName: "E2E blank start",
    factoryAddress: fixture.manufacturerA.address,
  });
  expectOnly(data.modules.glove_info, {});
  expectOnly(data.modules.packing_config, {});
  expect(data.custom).toEqual({});
  expect((await auditOf(id)).map((row) => row.action)).toEqual(["created"]);
  await shot(page, "created");
});

test("an admin can choose another template", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name === "ipad-landscape", "The admin's view once on each layout.");
  test.skip(true, "Kenneth, 26 October 2026: every client uses the standard template of the product type: Automatic is the standard template, not the fixture's. Rewrite for the standard rule.");
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto("/inspections/new");
  await pickFixtureOrder(page);
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", FIXTURE_TEMPLATE_CODE);
  const picker = page.getByRole("combobox", { name: "Use Another Template" });
  await expect(picker).toHaveText(`Automatic: ${FIXTURE_TEMPLATE_CODE} Version 1`);
  await press(picker);
  const option = page.getByRole("option", { name: `${FIXTURE_TEMPLATE_CODE} Version 1`, exact: true });
  await expect(option).toBeVisible();
  await press(option);
  await expect(page.getByTestId("choice-reason")).toHaveText("Chosen by an Admin");
  await expectNoPageScroll(page);
  await shot(page, "admin");

  // A failed Create keeps the admin's choice.
  await dropCreateRequests(page);
  await press(page.getByRole("button", { name: "Create Inspection" }));
  await expect(page.getByTestId("form-error")).toContainText(UNREACHABLE);
  await expect(page.getByTestId("form-error")).toBeFocused();
  await expect(picker).toHaveText(`${FIXTURE_TEMPLATE_CODE} Version 1`);
  await expect(page.getByTestId("choice-reason")).toHaveText("Chosen by an Admin");
  await page.unrouteAll({ behavior: "ignoreErrors" });
});
