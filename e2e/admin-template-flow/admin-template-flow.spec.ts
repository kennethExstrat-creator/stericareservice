import { expect, test, type Locator, type Page } from "@playwright/test";
import { expectNoPageScroll } from "../support/layout";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import { chooseFile, openDialog, SOURCE_PDF, toast } from "../templates/support";
import {
  createFlowFixture,
  HARTALEGA,
  inspectionRow,
  storedFiles,
  takeCode,
  templatesOfCode,
  type FlowFixture,
} from "./fixtures";

/**
 * BUILD_SPEC 12, Phase 3 done-when: "an admin builds a new template by
 * switching modules and setting labels, without code changes" (the admin
 * flow of BUILD_SPEC 4.5), at the three sizes in playwright.config.ts.
 *
 * From an active copy of STD_EG (the fixture's base, scoped to a client of
 * the run's own): New Template on /admin/templates (a code another admin
 * takes meanwhile is refused, and every choice stays), then in the editor
 * two modules off and one on, a module moved, a heading and a field label in
 * the client's words, a setting changed, a custom field added, the AI second
 * opinion switched on, saved; on its version page the source file, the
 * coverage checklist and activation; /inspections/new picks it for the
 * client at its manufacturer; and an inspection started from it shows on the
 * capture screen exactly the modules switched on, in order, in the
 * template's words: on iPad portrait (the tab bar) and the desktop (the
 * sidebar), one inspection each, as each draws a live ref number. Everything
 * is deleted in afterAll. Screenshots go to screenshots/admin/flow/.
 */

// Server Actions answer with the page re-rendered, which a dev server on a busy machine can take seconds over.
const ACTION = { timeout: 30_000 };

const INSPECTION_URL = /\/inspections\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EDITOR_URL = /\/admin\/templates\/[0-9a-f-]{36}\/edit$/;

/** STD_EG's modules (BUILD_SPEC 11), as the base lists them. */
const BASE_ORDER = [
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

/** What the admin changes, in the client's words. */
const WORDS = {
  visualTitle: "Visual Defects Check",
  documentsTitle: "Certificates and documents",
  colourLabel: "Colour of glove",
  customTitle: "Seal check",
  customKey: "seal_check",
  fieldLabel: "Seal number",
  fieldKey: "sealNumber",
  templateName: "E2E admin flow: client template (temporary)",
  sourceFile: "Client form.pdf",
  storedFile: "Client-form.pdf",
} as const;

/**
 * The new template's modules: force at break and the packing check off,
 * documents added before the conclusion, visual moved above watertight.
 */
const NEW_ORDER = [
  "header",
  "glove_info",
  "order_lots",
  "packing_config",
  "sampling_plan",
  "carton_sampling",
  "dimensions",
  "force_at_break",
  "weight",
  "visual",
  "watertight",
  "dispensing_packing",
  "labeling",
  "documents",
  "conclusion",
];
const OFF = ["force_at_break", "dispensing_packing"];
const INCLUDED = NEW_ORDER.filter((key) => !OFF.includes(key));

/**
 * The capture screen's sections, as the template words them: the base's
 * custom Glove Type after the header, the new custom module after labelling.
 */
const SECTIONS = [
  "Manufacturer Information",
  "Glove Type",
  "Glove Information",
  "Order",
  "Packing configuration",
  "Sampling Plan",
  "Finished Goods Sampling Information (carton number)",
  "Dimension",
  "Weight (g) - average of 13 gloves per size",
  WORDS.visualTitle,
  "Freedom from Holes by watertight test",
  "Packaging Labeling Inspection",
  WORDS.customTitle,
  WORDS.documentsTitle,
  "Conclusion",
];
/** Headings of the modules switched off: on no screen of the inspection. */
const SWITCHED_OFF = ["Force At Break in Newton (Refer to attached where applicable)", "Glove Packing Check"];

test.describe.configure({ mode: "serial" });

let fixture: FlowFixture;

test.beforeAll(async ({}, testInfo) => {
  fixture = await createFlowFixture(testInfo.project.name);
});

test.afterAll(async () => {
  if (!fixture) return;
  await fixture.cleanup();
  // Nothing of this run is left: no templates, no files, no client (its inspection went with the templates).
  for (const code of [fixture.base.code, fixture.newCode, fixture.takenCode]) {
    expect(await templatesOfCode(code), code).toEqual([]);
    expect(await storedFiles(code), code).toEqual([]);
  }
});

function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

function isDesktop(): boolean {
  return test.info().project.name === "desktop";
}

/** A tap on the iPads, a click on the desktop. */
async function press(locator: Locator): Promise<void> {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page.
 */
async function shot(page: Page, name: string): Promise<void> {
  const path = (part = "") => `screenshots/admin/flow/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  // The dev-only Next.js indicator is not part of the page; toasts and dialogs finish their entrance first.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(300);
  if (!isTouch()) {
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ ...options, path: path(), fullPage: true });
    return;
  }
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.min(8, Math.max(1, Math.ceil(height / viewport)));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: path(parts > 1 ? `-${part + 1}` : "") });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** A viewport shot of what is on screen now: a dialog, a sheet, a section in view. */
async function view(page: Page, name: string): Promise<void> {
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.waitForTimeout(300);
  await page.screenshot({
    path: `screenshots/admin/flow/${test.info().project.name}-${name}.png`,
    animations: "disabled",
    caret: "initial",
  });
}

/** Collects console errors, so hydration mismatches fail the test. */
function watchConsole(page: Page): () => string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error) => errors.push(error.message));
  return () => errors.filter((text) => /hydrat|did not match|server rendered/i.test(text));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Chooses an option of a Radix Select by the label it is known by. */
async function choose(scope: Page | Locator, page: Page, label: string, option: string | RegExp): Promise<void> {
  const trigger = scope.getByRole("combobox", { name: label });
  await press(trigger);
  await press(page.getByRole("option", { name: option }));
  await expect(trigger).toContainText(option);
}

/* ------------------------------------------------------------------ *
 * The template editor
 * ------------------------------------------------------------------ */

function moduleRow(page: Page, key: string): Locator {
  return page.getByTestId("module-list").locator(`[data-module-key="${key}"]`);
}

function moduleOrder(page: Page): () => Promise<(string | null)[]> {
  return () =>
    page
      .getByTestId("module-list")
      .locator("[data-module-key]")
      .evaluateAll((rows) => rows.map((row) => row.getAttribute("data-module-key")));
}

/** A module's details: beside the list from 1024 px, in a sheet below that (iPad portrait). */
async function openDetails(page: Page, key: string): Promise<Locator> {
  await press(moduleRow(page, key).getByRole("button", { name: /, edit$/ }));
  const details = page.locator(`[data-testid="module-details"][data-module-key="${key}"]`);
  await expect(details).toBeVisible();
  return details;
}

async function closeDetails(page: Page): Promise<void> {
  const sheet = page.getByRole("dialog");
  if (await sheet.isVisible()) {
    await press(sheet.getByRole("button", { name: "Close" }));
    await expect(sheet).toBeHidden();
  }
}

/* ------------------------------------------------------------------ *
 * The capture screen
 * ------------------------------------------------------------------ */

/** The sections in order: the sidebar's list from 1280 px, the tab bar below that. */
function captureSections(page: Page): Locator {
  return isDesktop()
    ? page.getByRole("list", { name: "Sections, with progress and result" }).getByRole("listitem")
    : page.getByRole("tablist", { name: "Sections" }).getByRole("tab");
}

async function openSection(page: Page, title: string): Promise<Locator> {
  const name = new RegExp(`^${escapeRegExp(title)}`);
  const target = isDesktop()
    ? page.getByRole("navigation", { name: "Sections" }).getByRole("button", { name })
    : page.getByRole("tab", { name });
  await press(target);
  await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  return page.locator('[data-slot="section-frame"]');
}

test("an admin builds a template from a base without code changes, and an inspection captures it as built", async ({
  page,
  context,
  baseURL,
}) => {
  test.setTimeout(600_000);
  const hydration = watchConsole(page);
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  let templateId = "";

  await test.step("New Template: built on the base, and a code taken meanwhile is refused with every choice kept", async () => {
    await page.goto("/admin/templates");
    await expect(page.getByRole("heading", { level: 1, name: "Templates" })).toBeVisible();
    const dialog = page.getByRole("dialog", { name: "New Template" });
    // Until the page has hydrated the button does nothing: press until the dialog shows.
    await expect(async () => {
      if (!(await dialog.isVisible())) await press(page.getByRole("button", { name: "New Template" }));
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 30_000 });

    await choose(dialog, page, "Build on", new RegExp(`^${fixture.base.code}`));
    // Where it applies starts as the base's.
    await expect(dialog.getByRole("combobox", { name: "Product Type" })).toHaveText("Examination Gloves");
    await expect(dialog.getByRole("combobox", { name: "Standard" })).toHaveText("EN 455");
    await expect(dialog.locator("[data-note]")).toContainText(
      `every module, label and setting comes from ${fixture.base.code} v1, and so do the sizes (XS, S, M, L, XL, in pieces)`,
    );
    // Typed in lower case, the code reads as it will be saved once the admin moves on.
    const code = dialog.getByRole("textbox", { name: "Code" });
    await code.fill(fixture.takenCode.toLowerCase());
    await dialog.getByRole("textbox", { name: "Name" }).fill(WORDS.templateName);
    await expect(code).toHaveValue(fixture.takenCode);
    await choose(dialog, page, "Client", fixture.clientName);
    await choose(dialog, page, "Manufacturer", HARTALEGA.label);
    if (isTouch()) {
      for (const control of [code, dialog.getByRole("combobox", { name: "Build on" }), dialog.getByRole("button", { name: "Create and Edit" })]) {
        expect((await control.boundingBox())!.height).toBeGreaterThanOrEqual(44);
      }
      expect(await code.evaluate((input) => getComputedStyle(input).fontSize)).toBe("16px");
    }
    await view(page, "1-new-template");

    // Another admin takes the code while the form is open: the page's list of codes cannot know.
    await takeCode(fixture.takenCode, fixture.clientId);
    await press(dialog.getByRole("button", { name: "Create and Edit" }));
    await expect(dialog.getByText(`${fixture.takenCode} is taken`)).toBeVisible(ACTION);
    await expect(code).toBeFocused();
    await expect(code).toHaveAttribute("aria-invalid", "true");
    // React resets a form after its action: nothing here may go back to how it started.
    await expect(dialog.getByRole("combobox", { name: "Build on" })).toContainText(fixture.base.code);
    await expect(dialog.getByRole("combobox", { name: "Product Type" })).toHaveText("Examination Gloves");
    await expect(dialog.getByRole("combobox", { name: "Standard" })).toHaveText("EN 455");
    await expect(dialog.getByRole("combobox", { name: "Client" })).toHaveText(fixture.clientName);
    await expect(dialog.getByRole("combobox", { name: "Manufacturer" })).toHaveText(HARTALEGA.label);
    await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue(WORDS.templateName);
    await expect(code).toHaveValue(fixture.takenCode);
    expect(await templatesOfCode(fixture.newCode)).toEqual([]);
    await view(page, "2-new-template-refused");

    await code.fill(fixture.newCode);
    await expect(dialog.getByText(`${fixture.takenCode} is taken`)).toHaveCount(0);
    await press(dialog.getByRole("button", { name: "Create and Edit" }));
    await expect(page).toHaveURL(EDITOR_URL, ACTION);
    templateId = page.url().split("/").at(-2)!;

    // Version 1, a draft that lists only what it must, resolved on the base's active version.
    const [created] = await templatesOfCode(fixture.newCode);
    expect(created).toMatchObject({
      id: templateId,
      version: 1,
      status: "draft",
      extends_code: fixture.base.code,
      client_id: fixture.clientId,
      manufacturer_id: HARTALEGA.id,
      product_type: "examination",
      standard: "EN455",
      source_file_path: null,
      coverage_confirmed_at: null,
    });
    expect(created.definition).toEqual({
      code: fixture.newCode,
      name: WORDS.templateName,
      extends: fixture.base.code,
      scope: { productType: "examination", standard: "EN455", clientId: fixture.clientId, manufacturerId: HARTALEGA.id },
      unit: "pcs",
      sizes: ["XS", "S", "M", "L", "XL"].map((value) => ({ value })),
      modules: [],
    });
    const resolved = created.resolved as { chain: string[]; modules: { key: string }[] };
    expect(resolved.chain).toEqual([fixture.newCode, fixture.base.code]);
    expect(resolved.modules.map((entry) => entry.key)).toEqual(BASE_ORDER);
  });

  await test.step("the editor: modules off and on, one moved, the client's words, a setting, a custom field, saved", async () => {
    await expect(page.getByRole("heading", { level: 1, name: WORDS.templateName })).toBeVisible();
    await expect(page.getByTestId("template-meta")).toContainText(
      `${fixture.newCode} · Version 1 · Draft · Extends ${fixture.base.code} v1 · Client: ${fixture.clientName} · Manufacturer: ${HARTALEGA.label}`,
    );
    await expect.poll(moduleOrder(page)).toEqual(BASE_ORDER);
    const saveState = page.getByTestId("save-state");
    await expect(saveState).toHaveText("No Changes");
    await expectNoPageScroll(page);
    await shot(page, "3-editor");

    // Two modules off.
    for (const key of OFF) {
      const toggle = moduleRow(page, key).getByRole("switch");
      await press(toggle);
      await expect(toggle).toHaveAttribute("aria-checked", "false");
      await expect(moduleRow(page, key)).toHaveAttribute("data-included", "false");
    }
    await expect(saveState).toHaveText("Unsaved Changes");

    // One on that the base does not use: it goes in before the conclusion.
    await press(page.getByRole("button", { name: /^Not in This Template/ }));
    await press(page.getByTestId("unused-modules").getByRole("button", { name: "Add Documents", exact: true }));
    await expect(moduleRow(page, "documents").getByRole("switch")).toHaveAttribute("aria-checked", "true");
    await expect.poll(moduleOrder(page)).toEqual([...BASE_ORDER.slice(0, -1), "documents", "conclusion"]);

    // Visual above watertight: the handle's arrow keys on the desktop, Move Up in its details on the iPads.
    if (isDesktop()) {
      const handle = moduleRow(page, "visual").getByRole("button", { name: /^Move / });
      await handle.focus();
      await page.keyboard.press("ArrowUp");
      await expect(moduleRow(page, "visual").getByRole("button", { name: /^Move / })).toBeFocused();
    } else {
      const details = await openDetails(page, "visual");
      await press(details.getByRole("button", { name: "Move Up" }));
      await expect(details.getByText("Position 10 of 15")).toBeVisible();
      await closeDetails(page);
    }
    await expect.poll(moduleOrder(page)).toEqual(NEW_ORDER);

    // Headings and a field label in the client's words; a field switched off in the settings.
    let details = await openDetails(page, "visual");
    await details.locator("#title-visual").fill(WORDS.visualTitle);
    await closeDetails(page);
    details = await openDetails(page, "documents");
    await details.locator("#title-documents").fill(WORDS.documentsTitle);
    await closeDetails(page);
    details = await openDetails(page, "glove_info");
    await details.locator("#label-glove_info-colour").fill(WORDS.colourLabel);
    const length = details.locator("#config-glove_info-fields-length");
    await expect(length).toHaveAttribute("aria-checked", "true");
    await press(length);
    await expect(length).toHaveAttribute("aria-checked", "false");
    await expect(details.getByText("Changed", { exact: true })).toHaveCount(1);
    await expect(details.locator("#label-glove_info-colour")).toHaveValue(WORDS.colourLabel);
    // "Use <base>'s" goes back to what the base sets; a long base code ends in an ellipsis inside the details.
    const reset = details.getByRole("button", { name: `Use ${fixture.base.code}'s: Glove length`, exact: true });
    await reset.scrollIntoViewIfNeeded();
    await view(page, "4-module-details");
    const [resetBox, detailsBox] = [await reset.boundingBox(), await details.boundingBox()];
    expect(resetBox!.x + resetBox!.width, "the reset button runs past the details").toBeLessThanOrEqual(
      detailsBox!.x + detailsBox!.width,
    );
    await closeDetails(page);
    await expect(moduleRow(page, "visual")).toContainText(WORDS.visualTitle);
    await expect(moduleRow(page, "documents")).toContainText(WORDS.documentsTitle);
    await shot(page, "5-modules-changed");

    // Spec values carry the module's canonical unit (BUILD_SPEC 4.2 rule 5): a dimension's in mm.
    details = await openDetails(page, "dimensions");
    const lengthSpec = details.locator('input[id^="config-dimensions-specs-0-specs-length-"]').first();
    await lengthSpec.scrollIntoViewIfNeeded();
    await expect(lengthSpec.locator("xpath=..").locator('[data-slot="input-group-addon"]')).toHaveText("mm");
    await view(page, "5b-dimension-specs");
    await closeDetails(page);

    // A custom field, after the labelling inspection.
    await press(page.getByRole("tab", { name: "Custom Modules" }));
    await expect(page.locator('[data-custom-key="glove_type"]')).toContainText("Glove Type");
    await press(page.getByRole("button", { name: "Add Custom Module" }).first());
    const form = page.getByTestId("custom-module-form");
    await form.locator("#custom-0-title").fill(WORDS.customTitle);
    await form.locator("#custom-0-key").fill(WORDS.customKey);
    await press(form.locator("#custom-0-after"));
    await press(page.getByRole("option", { name: "Packaging Labeling Inspection", exact: true }));
    await form.locator("#custom-0-fields-0-label").fill(WORDS.fieldLabel);
    await form.locator("#custom-0-fields-0-key").fill(WORDS.fieldKey);
    await expect(page.getByTestId("problems")).toBeHidden();
    await shot(page, "6-custom-module");

    // The AI second opinion when an inspector submits (BUILD_SPEC 9.2): off in the base, on here.
    await press(page.getByRole("tab", { name: "Details" }));
    const ai = page.getByTestId("template-ai").getByRole("switch");
    await expect(ai).toHaveAttribute("aria-checked", "false");
    await press(ai);
    await expect(ai).toHaveAttribute("aria-checked", "true");
    await shot(page, "7-details");

    // The live preview: the modules switched on, in order, the custom ones in their place.
    await press(page.getByRole("tab", { name: "Preview" }));
    const preview = page.getByTestId("capture-preview");
    await expect
      .poll(() =>
        preview
          .locator("[data-preview-module], [data-preview-custom]")
          .evaluateAll((cards) => cards.map((card) => card.getAttribute("data-preview-module") ?? card.getAttribute("data-preview-custom"))),
      )
      .toEqual(["header", "glove_type", ...INCLUDED.slice(1, -2), WORDS.customKey, "documents", "conclusion"]);
    await expect(preview.locator('[data-preview-module="visual"]')).toContainText(WORDS.visualTitle);
    await expect(preview.locator(`[data-preview-custom="${WORDS.customKey}"]`)).toContainText(WORDS.fieldLabel);
    await expectNoPageScroll(page);
    await shot(page, "8-preview");
    // The visual tables as the screen shows them (a full-page capture misplaces their sticky rows).
    await preview.locator('[data-preview-module="visual"]').evaluate((card) => card.scrollIntoView({ block: "end" }));
    await view(page, "8b-preview-visual");

    const save = page.getByRole("button", { name: "Save", exact: true });
    await press(save);
    await expect(saveState).toHaveText("Saved", ACTION);
    await expect(toast(page, `Saved ${fixture.newCode} version 1.`)).toBeVisible();

    // Stored: the definition lists what differs from the base, and resolves to the template the admin built.
    const [saved] = await templatesOfCode(fixture.newCode);
    const definition = saved.definition as { extends?: string; ai?: unknown };
    expect(definition.extends).toBe(fixture.base.code);
    expect(definition.ai).toEqual({ reviewOnSubmit: true });
    const resolved = saved.resolved as {
      modules: { key: string; include: boolean; title: string; labels: Record<string, string>; config: Record<string, unknown> }[];
      customModules: { key: string; title: string; after: string; fields: { key: string; label: string }[] }[];
      ai?: unknown;
    };
    expect(resolved.modules.map((entry) => entry.key)).toEqual(NEW_ORDER);
    expect(resolved.modules.filter((entry) => !entry.include).map((entry) => entry.key)).toEqual(OFF);
    const moduleOf = (key: string) => resolved.modules.find((entry) => entry.key === key)!;
    expect(moduleOf("visual").title).toBe(WORDS.visualTitle);
    expect(moduleOf("documents").title).toBe(WORDS.documentsTitle);
    expect(moduleOf("glove_info").labels.colour).toBe(WORDS.colourLabel);
    expect(moduleOf("glove_info").config).toMatchObject({ fields: { length: false, colour: true } });
    expect(resolved.customModules.map((custom) => [custom.key, custom.after])).toEqual([
      ["glove_type", "header"],
      [WORDS.customKey, "labeling"],
    ]);
    expect(resolved.customModules[1].fields).toEqual([{ key: WORDS.fieldKey, label: WORDS.fieldLabel, type: "text" }]);
    expect(resolved.ai).toEqual({ reviewOnSubmit: true });
  });

  await test.step("its version page: the source file, the coverage checklist, then activate", async () => {
    await press(page.getByTestId("version-page-link"));
    await expect(page).toHaveURL(new RegExp(`/admin/templates/${templateId}$`), ACTION);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(`${fixture.newCode} Version 1`);

    await chooseFile(page, page.getByRole("button", { name: "Upload Source File" }), {
      name: WORDS.sourceFile,
      mimeType: "application/pdf",
      buffer: SOURCE_PDF,
    });
    await expect(toast(page, "Source file added.")).toBeVisible(ACTION);
    await expect(page.getByTestId("source-file-name")).toHaveText(WORDS.storedFile, ACTION);

    const checklist = page.locator("#coverage");
    for (const tab of await checklist.getByRole("tab").all()) {
      await press(tab);
      for (const box of await checklist.getByRole("tabpanel").getByRole("checkbox").all()) await box.check();
    }
    await checklist.getByRole("checkbox", { name: new RegExp(`I have checked ${escapeRegExp(WORDS.storedFile)}`) }).check();
    await expect(checklist.getByText("Ready to confirm.")).toBeVisible();
    await shot(page, "9-version-ready");
    await press(checklist.getByRole("button", { name: "Confirm Coverage" }));
    await expect(toast(page, /Coverage confirmed/)).toBeVisible(ACTION);

    const activate = page.getByRole("button", { name: "Activate", exact: true });
    await expect(activate).toBeEnabled(ACTION);
    const dialog = await openDialog(page, activate);
    await expect(dialog).toContainText(`Activate ${fixture.newCode} Version 1?`);
    await press(dialog.getByRole("button", { name: "Activate", exact: true }));
    await expect(toast(page, `${fixture.newCode} version 1 is active.`)).toBeVisible(ACTION);
    await expect(page.locator('[data-slot="page-header"] [data-slot="template-status"]')).toHaveText("Active", ACTION);
    const [active] = await templatesOfCode(fixture.newCode);
    expect(active.status).toBe("active");
    expect(active.coverage_confirmed_at).not.toBeNull();
    expect(active.source_file_path).toMatch(new RegExp(`^${fixture.newCode}/v1/[0-9a-f-]{36}/${escapeRegExp(WORDS.storedFile)}$`));
    await expectNoPageScroll(page);
    await shot(page, "10-version-active");
  });

  await test.step("a new inspection for the client at Hartalega starts from it", async () => {
    await page.goto("/inspections/new");
    await choose(page, page, "Client", fixture.clientName);
    await choose(page, page, "Manufacturer", HARTALEGA.label);
    await press(page.getByRole("radio", { name: /^Examination Gloves/ }));
    // The most specific active template wins (BUILD_SPEC 4.4): the client's at this manufacturer, not the base.
    const chosen = page.getByTestId("chosen-template");
    await expect(chosen).toHaveAttribute("data-code", fixture.newCode);
    await press(page.getByText("Show the sections"));
    await expect(chosen.getByRole("listitem")).toHaveText(SECTIONS);
    await page.getByRole("textbox", { name: /Product name/i }).fill("E2E admin flow nitrile gloves");
    await shot(page, "11-new-inspection");
  });

  // Each inspection draws a number from the live ref sequence (e2e/README.md): one per layout of the capture
  // screen. iPad landscape has iPad portrait's tab bar, so its run ends at the template the screen picked.
  if (test.info().project.name === "ipad-landscape") {
    expect(hydration()).toEqual([]);
    return;
  }

  let inspectionId = "";
  await test.step("Create starts it, on the capture screen", async () => {
    await press(page.getByRole("button", { name: "Create inspection" }));
    await expect(page).toHaveURL(INSPECTION_URL, { timeout: 90_000 });
    inspectionId = page.url().split("/").at(-1)!;
  });

  await test.step("the capture screen shows exactly the modules switched on, in order, in the template's words", async () => {
    await expect(page.getByRole("heading", { level: 2, name: "Manufacturer Information" })).toBeVisible(ACTION);
    await expect(captureSections(page)).toHaveText(SECTIONS.map((title) => new RegExp(`^${escapeRegExp(title)}`)));
    const nav = isDesktop() ? page.getByRole("navigation", { name: "Sections" }) : page.getByRole("tablist", { name: "Sections" });
    for (const title of SWITCHED_OFF) await expect(nav).not.toContainText(title);
    await expect(nav).not.toContainText("Switched off");
    await expectNoPageScroll(page);
    await shot(page, "12-capture");

    // Glove Information in the client's words, without the field the settings switched off.
    const gloveInfo = await openSection(page, "Glove Information");
    await expect(gloveInfo.getByText(WORDS.colourLabel, { exact: true })).toBeVisible();
    await expect(gloveInfo.getByText("Glove colour", { exact: true })).toHaveCount(0);
    await expect(gloveInfo.getByText("Glove length", { exact: true })).toHaveCount(0);
    await expect(gloveInfo.getByText("Glove surface texture", { exact: true })).toBeVisible();
    await view(page, "13-capture-glove-information");

    await openSection(page, WORDS.visualTitle);
    const custom = await openSection(page, WORDS.customTitle);
    await expect(custom.getByRole("textbox", { name: WORDS.fieldLabel })).toBeVisible();
    await view(page, "14-capture-custom");
    await openSection(page, WORDS.documentsTitle);
    await expectNoPageScroll(page);
    await view(page, "15-capture-documents");

    // The inspection keeps the version it started with (BUILD_SPEC 4.2 rule 8), and holds data for the modules on.
    const row = await inspectionRow(inspectionId);
    expect(row).toMatchObject({ template_id: templateId, client_id: fixture.clientId, manufacturer_id: HARTALEGA.id, status: "draft" });
    const data = row.data as { modules: Record<string, unknown> };
    expect(Object.keys(data.modules).sort()).toEqual([...INCLUDED].sort());
  });

  expect(hydration()).toEqual([]);
});
