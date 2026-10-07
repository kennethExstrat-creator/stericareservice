import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoPageScroll } from "../support/layout";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  codeFor,
  createDraftTemplate,
  createUsedTemplate,
  storedTemplate,
  TEMPLATE_NAME,
  versionsOf,
  type EditorFixture,
} from "./fixtures";

/**
 * The template editor, /admin/templates/[id]/edit (BUILD_SPEC 4.5 and 10),
 * against the live project at the three sizes in playwright.config.ts.
 * Each size edits its own temporary E2E_EDITOR draft and deletes it after.
 * Screenshots go to screenshots/editor/.
 */

test.describe.configure({ mode: "serial" });

const INITIAL_ORDER = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "watertight",
  "visual",
  "conclusion",
];

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

function isDesktop() {
  return test.info().project.name === "desktop";
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while it
 * resizes (e2e/README.md), so the iPads get viewport shots, scrolled. caret
 * "initial" leaves the inputs alone (a style attribute written before
 * hydration would read as a mismatch).
 */
async function shot(page: Page, name: string) {
  const path = (part = "") => `screenshots/editor/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  // The dev-only Next.js indicator is not part of the page.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  if (!isTouch()) {
    // From the top, settled: sticky bars are drawn where the page is scrolled to.
    await page.evaluate(async () => {
      window.scrollTo(0, 0);
      await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      window.scrollTo(0, 0);
    });
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.min(6, Math.max(1, Math.ceil(height / viewport)));
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

function moduleList(page: Page) {
  return page.getByTestId("module-list");
}

function row(page: Page, key: string) {
  return moduleList(page).locator(`[data-module-key="${key}"]`);
}

function moduleOrder(page: Page) {
  return () =>
    moduleList(page)
      .locator("[data-module-key]")
      .evaluateAll((rows) => rows.map((entry) => entry.getAttribute("data-module-key")));
}

/** The details of one module: beside the list from 1024 px, in a sheet below that. */
async function openDetails(page: Page, key: string): Promise<Locator> {
  await press(row(page, key).getByRole("button", { name: /, edit$/ }));
  const details = page.locator(`[data-testid="module-details"][data-module-key="${key}"]`);
  await expect(details).toBeVisible();
  return details;
}

async function closeDetails(page: Page) {
  const sheet = page.getByRole("dialog");
  if (await sheet.isVisible()) {
    await press(sheet.getByRole("button", { name: "Close" }));
    await expect(sheet).toBeHidden();
  }
}

/** Drags a row by its handle, with the mouse, to where another row is. */
async function dragRow(page: Page, from: Locator, to: Locator) {
  const handle = from.getByRole("button", { name: /^Move / });
  const start = await handle.boundingBox();
  const target = await to.boundingBox();
  if (!start || !target) throw new Error("rows not on screen");
  await page.mouse.move(start.x + start.width / 2, start.y + start.height / 2);
  await page.mouse.down();
  await page.mouse.move(start.x + start.width / 2, target.y + target.height / 2 - 4, { steps: 12 });
  await page.mouse.up();
}

let draft: EditorFixture;

test.beforeAll(async ({}, testInfo) => {
  draft = await createDraftTemplate(codeFor(testInfo.project.name));
});

test.afterAll(async () => {
  await draft?.cleanup();
});

test("signed out, the editor sends you to sign in", async ({ page }) => {
  await page.goto(`/admin/templates/${draft.id}/edit`);
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Ftemplates%2F[0-9a-f-]+%2Fedit$/);
});

test("an inspector gets a 404 that names nothing", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  const response = await page.goto(`/admin/templates/${draft.id}/edit`);
  expect(response?.status()).toBe(404);
  await expect(page.getByText(/page not found|could not be found/i).first()).toBeVisible();
  expect(await page.locator("title").allTextContents()).not.toContainEqual(expect.stringContaining(draft.code));
  expect(await response?.text()).not.toContain(draft.code);
  await shot(page, "inspector-404");
});

test("an unknown or malformed template id shows the admin the not-found page", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  // The (app) loading screen has already streamed by the time the page knows,
  // so the status stays 200 (as for any record not found below it); the page is the 404 page.
  for (const id of ["not-a-uuid", "00000000-0000-4000-8000-000000000000"]) {
    await page.goto(`/admin/templates/${id}/edit`);
    await expect(page.getByText(/page not found|could not be found/i).first()).toBeVisible();
    await expect(page.getByTestId("template-editor")).toHaveCount(0);
  }
});

test("the admin edits a draft: switches, order, wording, settings, a custom field, preview, save", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(300_000);
  const hydration = watchConsole(page);
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);

  const response = await page.goto(`/admin/templates/${draft.id}/edit`);
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle(`Edit ${draft.code} v1 · SteriCare QC`);
  await expect(page.getByRole("heading", { level: 1, name: TEMPLATE_NAME })).toBeVisible();
  await expect(page.getByTestId("template-meta")).toContainText(`${draft.code} · Version 1 · Draft`);
  await expect.poll(moduleOrder(page)).toEqual(INITIAL_ORDER);
  const saveState = page.getByTestId("save-state");
  const save = page.getByRole("button", { name: "Save", exact: true });
  // The draft has no stored resolution yet: Save resolves and stores it, changed or not.
  await expect(saveState).toHaveText("Not Resolved Yet");
  await expect(save).toBeEnabled();
  await expect(page.getByTestId("resolve-due")).toContainText("Not resolved yet");
  await expectNoPageScroll(page);
  if (isTouch()) {
    // 44 px targets on the iPad: the drag handle and the switch's hit area.
    const handle = await row(page, "glove_info").getByRole("button", { name: /^Move / }).boundingBox();
    expect(handle?.height ?? 0).toBeGreaterThanOrEqual(44);
  }
  await shot(page, "1-modules");

  // Header and conclusion are always on.
  await expect(row(page, "header").getByRole("switch")).toBeDisabled();
  await expect(row(page, "conclusion").getByRole("switch")).toBeDisabled();

  // A module off, then on again.
  const visualSwitch = row(page, "visual").getByRole("switch");
  await press(visualSwitch);
  await expect(visualSwitch).toHaveAttribute("aria-checked", "false");
  await expect(row(page, "visual")).toHaveAttribute("data-included", "false");
  await expect(saveState).toHaveText("Unsaved Changes");
  await shot(page, "2-module-off");
  await press(visualSwitch);
  await expect(visualSwitch).toHaveAttribute("aria-checked", "true");

  // Reorder: arrow keys on the handle and a mouse drag on the desktop, Move Down on the iPads.
  const expectedOrder = isDesktop()
    ? ["header", "glove_info", "sampling_plan", "order_lots", "packing_config", "visual", "watertight", "conclusion"]
    : ["header", "glove_info", "order_lots", "packing_config", "sampling_plan", "visual", "watertight", "conclusion"];
  if (isDesktop()) {
    const handle = row(page, "watertight").getByRole("button", { name: /^Move / });
    await handle.focus();
    await page.keyboard.press("ArrowDown");
    await expect.poll(moduleOrder(page)).toEqual([...INITIAL_ORDER.slice(0, 5), "visual", "watertight", "conclusion"]);
    await expect(row(page, "watertight").getByRole("button", { name: /^Move / })).toBeFocused();
    await expect(page.getByRole("status").filter({ hasText: /moved to position 7 of 8/ })).toBeAttached();
    await dragRow(page, row(page, "sampling_plan"), row(page, "order_lots"));
  } else {
    const details = await openDetails(page, "watertight");
    await press(details.getByRole("button", { name: "Move Down" }));
    await expect(details.getByText("Position 7 of 8")).toBeVisible();
    await closeDetails(page);
  }
  await expect.poll(moduleOrder(page)).toEqual(expectedOrder);

  if (test.info().project.name === "ipad-portrait") {
    // The module sheet hands the focus back to the Edit button that opened it, by keyboard too.
    const edit = row(page, "glove_info").getByRole("button", { name: /, edit$/ });
    await edit.focus();
    await page.keyboard.press("Enter");
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await expect(sheet.locator("#module-sheet-heading")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(edit).toBeFocused();
  }

  // Wording and settings of glove_info, the module that is built.
  const details = await openDetails(page, "glove_info");
  await details.locator("#label-glove_info-colour").fill("Colour of glove");
  await details.locator("#title-glove_info").fill("Glove Details");
  const lengthSwitch = details.locator("#config-glove_info-fields-length");
  await expect(lengthSwitch).toHaveAttribute("aria-checked", "true");
  await press(lengthSwitch);
  await expect(lengthSwitch).toHaveAttribute("aria-checked", "false");
  await press(details.locator("#config-glove_info-indicativeWeightSize"));
  await press(page.getByRole("option", { name: "L", exact: true }));
  await expect(details.locator("#config-glove_info-indicativeWeightSize")).toContainText("L");
  await expect(details.getByText("Changed", { exact: true })).toHaveCount(2);
  await shot(page, "3-module-details");
  // The settings, in view: on the desktop the details panel scrolls on its own.
  await lengthSwitch.scrollIntoViewIfNeeded();
  await page.screenshot({ path: `screenshots/editor/${test.info().project.name}-3b-module-settings.png`, caret: "initial" });
  await closeDetails(page);
  await expect(row(page, "glove_info")).toContainText("Glove Details");
  await expect(row(page, "glove_info")).toContainText("Changed");

  // A problem stops the save and links to its place: order_lots gives the sizes.
  await press(row(page, "order_lots").getByRole("switch"));
  const problems = page.getByTestId("problems");
  await expect(problems).toContainText("so order_lots must be on");
  await expect(saveState).toHaveText("1 Problem");
  await expect(save).toBeDisabled();
  await shot(page, "4-problem");
  await press(problems.getByRole("button", { name: /Order/ }));
  const orderDetails = page.locator('[data-testid="module-details"][data-module-key="order_lots"]');
  await expect(orderDetails.locator("#include-order_lots")).toBeFocused();
  await press(orderDetails.locator("#include-order_lots"));
  await expect(problems).toBeHidden();
  await closeDetails(page);

  // A custom module with a field of each kind it needs.
  await press(page.getByRole("tab", { name: "Custom Modules" }));
  await expect(page.getByText("No custom modules")).toBeVisible();
  await press(page.getByRole("button", { name: "Add Custom Module" }).first());
  const form = page.getByTestId("custom-module-form");
  await form.locator("#custom-0-title").fill("Glove type");
  await form.locator("#custom-0-key").fill("glove_type");
  await form.locator("#custom-0-fields-0-label").fill("Glove type");
  await form.locator("#custom-0-fields-0-key").fill("gloveType");
  await press(form.locator("#custom-0-fields-0-type"));
  await press(page.getByRole("option", { name: "Choice from a List" }));
  await expect(page.getByTestId("problems")).toContainText("A select field needs at least one option.");
  await form.locator("#custom-0-fields-0-options").fill("Nitrile\nLatex");
  await press(form.getByRole("button", { name: "Add Field" }));
  await form.locator("#custom-0-fields-1-label").fill("Cuff length");
  await form.locator("#custom-0-fields-1-key").fill("cuffLength");
  await press(form.locator("#custom-0-fields-1-type"));
  await press(page.getByRole("option", { name: "Number", exact: true }));
  await press(form.locator("#custom-0-fields-1-unit"));
  await press(page.getByRole("option", { name: "mm", exact: true }));
  const min = form.locator("#custom-0-fields-1-min");
  await min.fill("2 40");
  const notANumber = "“2 40” is not a number: remove the space (240).";
  await expect(form.getByText(notANumber)).toHaveCount(1);
  await expect(min).toHaveAttribute("aria-describedby", "custom-0-fields-1-min-errors");
  await expect(save).toBeDisabled();
  // Closed, the entry stays a problem; its link opens the field again, entry and all.
  await press(page.getByRole("button", { name: "Close Glove type" }));
  await expect(form).toBeHidden();
  const entryProblem = page.getByTestId("problems");
  await expect(entryProblem).toContainText(notANumber);
  await expect(save).toBeDisabled();
  await shot(page, "5a-closed-with-problem");
  await press(entryProblem.getByRole("button", { name: /Custom Module Glove type/ }));
  await expect(min).toHaveValue("2 40");
  await expect(min).toBeFocused();
  await min.fill("240");
  await expect(page.getByTestId("problems")).toBeHidden();

  // A required number emptied is empty, and asked for; typing goes on from nothing: 13, emptied, then 5, is 5.
  await press(form.getByRole("radio", { name: /^Grid/ }));
  const columns = form.locator("#custom-0-grid-columns-default");
  await expect(columns).toHaveValue("13");
  await columns.click();
  await columns.press("End");
  await columns.press("Backspace");
  await columns.press("Backspace");
  await expect(columns).toHaveValue("");
  await expect(form.locator("#custom-0-grid-columns-default-errors")).toHaveText("Enter a number.");
  await expect(save).toBeDisabled();
  await columns.pressSequentially("5");
  await expect(columns).toHaveValue("5");
  await expect(page.getByTestId("problems")).toBeHidden();
  await press(form.getByRole("radio", { name: /^Fields/ }));
  await expect(columns).toHaveCount(0);
  await shot(page, "5-custom-module");

  // Details: name, sizes, report, where it applies, and the fixed code.
  await press(page.getByRole("tab", { name: "Details" }));
  const detailsTab = page.getByTestId("template-details");
  await expect(detailsTab.locator("#details-name")).toHaveValue(TEMPLATE_NAME);
  await expect(detailsTab.locator("#details-scope-productType")).toContainText("Examination Gloves");
  await expect(detailsTab.locator("#details-scope-standard")).toContainText("EN 455");
  await expect(detailsTab.locator("#details-scope-clientId")).toContainText("Any Client");
  await expect(detailsTab.locator("#details-code")).toHaveValue(draft.code);
  await expect(detailsTab.locator("#details-extends")).toHaveValue("None");
  await shot(page, "6-details");
  await press(page.getByRole("tab", { name: "JSON" }));
  const json = page.locator("#template-json");
  await expect(json).toHaveValue(/"glove_type"/);
  const text = await json.inputValue();
  await json.fill(text.replace(`"name": "${TEMPLATE_NAME}"`, '"name": ""'));
  await expect(page.getByText("name: Enter a value.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply JSON" })).toBeDisabled();
  await shot(page, "7-json-problem");
  await press(page.getByRole("button", { name: "Undo JSON Edits" }));
  await expect(page.getByText("Valid template definition.")).toBeVisible();

  // The preview draws every included module, the custom one in its place.
  await press(page.getByRole("tab", { name: "Preview" }));
  const preview = page.getByTestId("capture-preview");
  await expect(preview.locator("[data-preview-module]")).toHaveCount(8);
  await expect(preview.locator('[data-preview-module="glove_info"]')).toContainText("Glove Details");
  await expect(preview.locator('[data-preview-custom="glove_type"]')).toContainText("Nitrile / Latex");
  await expect(preview.locator('[data-preview-custom="glove_type"]')).toContainText("Cuff length (mm)");
  const sections = await preview
    .locator("[data-preview-module], [data-preview-custom]")
    .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-preview-module") ?? card.getAttribute("data-preview-custom")));
  expect(sections.slice(-2)).toEqual(["glove_type", "conclusion"]);
  await expectNoPageScroll(page);
  await shot(page, "8-preview");

  // Leaving with unsaved changes asks first, and Keep Editing hands the focus back to the link.
  const allTemplates = page.getByRole("link", { name: "All Templates" });
  await press(allTemplates);
  const leave = page.getByRole("alertdialog", { name: "Leave Without Saving?" });
  await expect(leave).toBeVisible();
  await press(leave.getByRole("button", { name: "Keep Editing" }));
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/admin/templates/${draft.id}/edit$`));
  await expect(allTemplates).toBeFocused();
  // So does a link in the shell: the sidebar on the desktop, the top bar on the iPad.
  const shellLink = page
    .getByRole("navigation", { name: "Main" })
    .getByRole("link", { name: "Inspections" })
    .filter({ visible: true })
    .first();
  await press(shellLink);
  await expect(leave).toBeVisible();
  await shot(page, "8b-leave-from-shell");
  await press(leave.getByRole("button", { name: "Keep Editing" }));
  await expect(leave).toBeHidden();
  await expect(page).toHaveURL(new RegExp(`/admin/templates/${draft.id}/edit$`));
  await expect(shellLink).toBeFocused();

  // A reload (or an iPad that dropped the page) keeps the changes on the device, and offers them back.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.reload();
  const offer = page.getByTestId("restore-offer");
  await expect(offer).toBeVisible();
  await expect.poll(moduleOrder(page)).toEqual(INITIAL_ORDER);
  await shot(page, "8c-restore-offer");
  await press(offer.getByRole("button", { name: "Restore Changes" }));
  await expect(offer).toHaveCount(0);
  await expect.poll(moduleOrder(page)).toEqual(expectedOrder);
  await expect(row(page, "glove_info")).toContainText("Glove Details");

  // Save, and what it stored.
  await expect(saveState).toHaveText("Unsaved Changes");
  await press(save);
  // The action resolves and writes, then the page re-renders: give a slow dev server time.
  await expect(saveState).toHaveText("Saved", { timeout: 30_000 });
  await expect(page.getByText(`Saved ${draft.code} version 1.`)).toBeVisible();
  const stored = await storedTemplate(draft.id);
  const definition = stored.definition as { modules: { key: string; title?: string; labels?: object; config?: object }[] };
  expect(definition.modules.map((entry) => entry.key)).toEqual(expectedOrder);
  expect(definition.modules.find((entry) => entry.key === "glove_info")).toEqual({
    key: "glove_info",
    include: true,
    title: "Glove Details",
    labels: { colour: "Colour of glove" },
    config: { fields: { length: false }, indicativeWeightSize: "L" },
  });
  const resolved = stored.resolved as { modules: { key: string; config: unknown }[]; customModules: { key: string }[] };
  expect(resolved.modules.map((entry) => entry.key)).toEqual(expectedOrder);
  expect(resolved.customModules.map((custom) => custom.key)).toEqual(["glove_type"]);
  expect(resolved.modules.find((entry) => entry.key === "glove_info")?.config).toEqual({
    fields: { surfaceTexture: true, indicativeWeight: true, colour: true, length: false },
    indicativeWeightSize: "L",
  });
  await shot(page, "9-saved");

  // Reload: it is all still there, nothing is unsaved, and no copy is offered.
  await page.reload();
  await expect.poll(moduleOrder(page)).toEqual(expectedOrder);
  await expect(saveState).toHaveText("No Changes");
  await expect(page.getByTestId("resolve-due")).toHaveCount(0);
  await expect(page.getByTestId("restore-offer")).toHaveCount(0);
  const again = await openDetails(page, "glove_info");
  await expect(again.locator("#label-glove_info-colour")).toHaveValue("Colour of glove");
  await expect(again.locator("#config-glove_info-fields-length")).toHaveAttribute("aria-checked", "false");
  await closeDetails(page);
  await press(page.getByRole("tab", { name: "Custom Modules" }));
  await expect(page.locator('[data-custom-key="glove_type"]')).toContainText("Cuff length");
  await shot(page, "10-reloaded");
  expect(hydration()).toEqual([]);
});

test("a number setting emptied and typed again keeps what is typed, not what it inherits", async ({
  page,
  context,
  baseURL,
}, testInfo) => {
  const numbers = await createDraftTemplate(codeFor(testInfo.project.name, "_NUMBERS"), "draft", ["weight"]);
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto(`/admin/templates/${numbers.id}/edit`);
    await expect(row(page, "weight")).toBeVisible();
    test.skip(
      await row(page, "weight").getByText("Not Built Yet").isVisible(),
      "weight is still a stub on this branch: its settings are JSON until the module lands.",
    );
    const details = await openDetails(page, "weight");
    const n = details.locator("#config-weight-n");
    await expect(n).toHaveValue("13");
    // Emptied as on the iPad keypad, then typed: the inherited 13 never comes back under the caret.
    await n.click();
    await n.press("End");
    await n.press("Backspace");
    await n.press("Backspace");
    await expect(n).toHaveValue("");
    await expect(details.locator("#config-weight-n-errors")).toHaveText("Enter a number.");
    await n.pressSequentially("5");
    await expect(n).toHaveValue("5");
    await expect(details.locator("#config-weight-n-errors")).toHaveCount(0);
    await n.blur();
    await expect(n).toHaveValue("5");
    await expect(page.getByTestId("save-state")).toHaveText("Unsaved Changes");
    await shot(page, "13-number-retyped");
    // Use Default goes back to the inherited value.
    await press(details.getByRole("button", { name: /^Use Default: / }).first());
    await expect(n).toHaveValue("13");
  } finally {
    await numbers.cleanup();
  }
});

test("a retired version reads only and offers a new version", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name === "desktop", "The desktop run checks a version in use instead.");
  const retired = await createDraftTemplate(codeFor(testInfo.project.name, "_RETIRED"), "retired");
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto(`/admin/templates/${retired.id}/edit`);
    await expect(page.getByTestId("locked")).toContainText("Version 1 is retired, so it cannot be changed.");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(row(page, "glove_info").getByRole("switch")).toBeDisabled();
    await expect(page.getByRole("button", { name: "New Version" })).toBeVisible();
    await expectNoPageScroll(page);
    await shot(page, "11-read-only");
  } finally {
    await retired.cleanup();
  }
});

test("a version in use reads only, and New version makes the next draft", async ({ page, context, baseURL }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop", "One inspection per run (e2e/README.md): the desktop run covers it.");
  test.setTimeout(120_000);
  const used = await createUsedTemplate(codeFor(testInfo.project.name, "_USED"));
  try {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto(`/admin/templates/${used.id}/edit`);
    const locked = page.getByTestId("locked");
    await expect(locked).toContainText("Version 1 cannot be changed: 1 inspection uses it");
    await expect(page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await expect(row(page, "visual").getByRole("switch")).toBeDisabled();
    await shot(page, "11-read-only");

    await page.getByRole("button", { name: "New Version" }).click();
    await expect(page).not.toHaveURL(new RegExp(used.id), { timeout: 30_000 });
    await expect(page.getByTestId("template-meta")).toContainText(`${used.code} · Version 2 · Draft`);
    await expect(page.getByTestId("locked")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    expect((await versionsOf(used.code)).map((row) => [row.version, row.status])).toEqual([
      [1, "draft"],
      [2, "draft"],
    ]);
    await shot(page, "12-new-version");
  } finally {
    await used.cleanup();
  }
});
