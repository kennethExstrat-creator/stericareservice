import { mkdirSync, writeFileSync } from "node:fs";
import { devices, expect, test, type Browser, type Locator, type Page, type Request } from "@playwright/test";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import {
  adminClient,
  auditOf,
  createFlowsFixture,
  OVERRIDE_OFF,
  readInspection,
  removeInspection,
  removeLeftovers,
  SG_PRODUCT_NAME,
  TEMPLATE_OFF,
  todayInMalaysia,
  type FlowsFixture,
} from "./sg-and-flows.support";

/**
 * Acceptance (BUILD_SPEC 12), against the live project:
 *
 * (a) Phase 3: "an STD_SG inspection with R/L and dye leak works". Created on
 *     /inspections/new and entered on the iPad in landscape (1180 x 820,
 *     touch): watertight and visual with the right and left hands apart, dye
 *     leak and everything else a result needs; then the results, submit, the
 *     review and the export.
 * (b) Phase 2: "a module switched off in a template disappears from capture,
 *     validation and export", with a draft copy of STD_EG with weight off
 *     (sg-and-flows.support.ts); and an admin's switch-off for one inspection, with a
 *     reason, does the same (force at break).
 * (c) Phase 2: "losing the connection loses nothing": the connection drops
 *     mid-entry, the inspector keeps typing, the pill says offline, and once
 *     it is back the server has every value; a tab closed while offline keeps
 *     them too, and (c3) a section never opened before the connection dropped
 *     still shows its form offline (ACC-SGF-1, fixed).
 *
 * The inspector works on the iPad in landscape; the admin on a desktop
 * (1440 x 900) in a second browser context. One sign-in per role per run:
 * Supabase limits sign-ins. Screenshots and the exports go to
 * screenshots/acceptance/.
 *
 * Runs on the iPad in landscape only. ACCEPTANCE_PROJECT names another
 * project to run on instead (Kenneth's 13 inch iPad: ipad-pro-landscape), and
 * ACCEPTANCE_SHOTS another folder for its screenshots.
 */

test.describe.configure({ mode: "serial", timeout: 300_000 });

const RUN_ON = process.env.ACCEPTANCE_PROJECT ?? "ipad-landscape";
const SHOTS = process.env.ACCEPTANCE_SHOTS ?? "screenshots/acceptance";
const INSPECTION_URL = /\/inspections\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

type Cookies = { name: string; value: string }[];
// Set in beforeAll: the admin client needs .env.local, and the other projects skip this file.
let admin: ReturnType<typeof adminClient>;
let inspectorCookies: Cookies;
let adminCookies: Cookies;
let sgId: string | null = null;
let flows: FlowsFixture | null = null;

test.beforeAll(async () => {
  if (test.info().project.name !== RUN_ON) return;
  mkdirSync(SHOTS, { recursive: true });
  admin = adminClient();
  await removeLeftovers(admin);
  flows = await createFlowsFixture(admin);
  inspectorCookies = await sessionCookies(TEST_ACCOUNTS.inspector);
  adminCookies = await sessionCookies(TEST_ACCOUNTS.admin);
});

test.afterAll(async () => {
  if (test.info().project.name !== RUN_ON) return;
  // ACCEPTANCE_KEEP=1 leaves the rows for a look by hand; the next run removes them.
  if (process.env.ACCEPTANCE_KEEP || !admin) return;
  if (sgId) await removeInspection(admin, sgId);
  await removeLeftovers(admin);
});

test.beforeEach(() => {
  test.skip(test.info().project.name !== RUN_ON, `Acceptance runs on ${RUN_ON} only.`);
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

/** A tap on the iPad (the admin's desktop clicks instead). */
async function press(locator: Locator) {
  if (test.info().project.use.hasTouch) await locator.tap();
  else await locator.click();
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(250);
  await page.screenshot({ path: `${SHOTS}/${name}.png`, animations: "disabled", caret: "initial" });
}

/**
 * Viewport shots down a long page: a full-page capture drops touch emulation
 * while it resizes (e2e/README.md). name-1.png, name-2.png ...
 */
async function scrolledShots(page: Page, name: string, most = 6) {
  const { height, viewport } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
  }));
  const parts = Math.min(most, Math.max(1, Math.ceil(height / viewport)));
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await shot(page, `${name}-${part + 1}`);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function useSession(page: Page, baseURL: string, cookies: Cookies) {
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

/** A desktop browser for the admin, beside the inspector's iPad. */
async function adminDesktop(browser: Browser, baseURL: string) {
  const context = await browser.newContext({ ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 }, baseURL });
  await context.addCookies(adminCookies.map((cookie) => ({ ...cookie, url: baseURL })));
  const page = await context.newPage();
  return { context, page };
}

function savePill(page: Page) {
  return page.locator('[data-slot="save-status"]:visible').first();
}

/** The capture screen is up and its autosave runs: an editable field means hydrated and started. */
async function captureReady(page: Page) {
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  await expect(page.locator('[data-slot="section-frame"] :is(input, textarea):visible').first()).toBeEditable({ timeout: 30_000 });
}

function escape(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sectionTabs(page: Page) {
  return page.getByRole("tablist", { name: "Sections" });
}

async function openSection(page: Page, title: string) {
  const tab = sectionTabs(page).getByRole("tab", { name: new RegExp(`^${escape(title)}`) });
  await press(tab);
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
}

/** The section's tab names its result: "Watertight Inspection Passed". */
async function expectSectionStatus(page: Page, title: string, status: string) {
  await expect(sectionTabs(page).getByRole("tab", { name: new RegExp(`^${escape(title)}`) })).toHaveAccessibleName(
    `${title} ${status}`,
  );
}

function panel(page: Page) {
  return page.locator('[data-slot="section-frame"]');
}

/** "3 of 14 done" in the progress tracker on screen. */
function progress(page: Page, total: number) {
  return page.getByText(new RegExp(`^\\d+ of ${total} done$`)).filter({ visible: true });
}

/** A size tab of the open section names the size's result: "Size 7.5 , Failed". */
async function expectSizeStatus(page: Page, size: string, status: string) {
  await expect(panel(page).getByRole("tab", { name: new RegExp(`^Size ${escape(size)}\\b`) })).toHaveAccessibleName(
    new RegExp(`${escape(status)}$`),
  );
}

/** A row's text as shown: cells of the sizes not on screen are left out. */
async function expectRow(table: Locator, name: RegExp, text: string | RegExp) {
  await expect(table.getByRole("row", { name })).toContainText(text, { useInnerText: true });
}

/** Types a value and Enter, which commits it and moves on (numbers commit on Enter or when left; lots are added on Enter). */
async function enter(field: Locator, value: string) {
  await field.fill(value);
  await field.press("Enter");
}

/** Taps a stepper's + or - `times` times, waiting for each tap to land. */
async function step(page: Page, name: string, times: number, direction: "Increase" | "Decrease" = "Increase") {
  const counter = page.getByRole("spinbutton", { name, exact: true });
  for (let index = 0; index < times; index += 1) {
    const before = Number(await counter.getAttribute("aria-valuenow"));
    await press(page.getByRole("button", { name: `${direction} ${name}`, exact: true }));
    await expect(counter).toHaveAttribute("aria-valuenow", String(before + (direction === "Increase" ? 1 : -1)));
  }
}

async function chooseSize(page: Page, size: string) {
  const tab = panel(page).getByRole("tab", { name: new RegExp(`^Size ${escape(size)}\\b`) });
  await press(tab);
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Pastes a block of text (rows by line, columns by tab) into a grid cell, as from a caliper app or a spreadsheet. */
async function paste(field: Locator, text: string) {
  await field.focus();
  await field.evaluate((element, value) => {
    const data = new DataTransfer();
    data.setData("text/plain", value);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

async function openPending(page: Page) {
  await press(page.getByRole("button", { name: /^Pending/ }).first());
  const sheet = page.getByRole("dialog", { name: /^(Pending|Before you submit)$/ });
  await expect(sheet).toBeVisible();
  return sheet;
}

async function closePending(page: Page) {
  const sheet = page.getByRole("dialog", { name: /^(Pending|Before you submit)$/ });
  await press(sheet.getByRole("button", { name: "Close" }));
  await expect(sheet).toBeHidden();
}

type Json = Record<string, unknown>;
function at(value: unknown, ...path: (string | number)[]): unknown {
  return path.reduce<unknown>((current, key) => (current as Record<string | number, unknown> | undefined)?.[key], value);
}

async function stored(inspectionId: string) {
  return readInspection(admin, inspectionId);
}

/* ------------------------------------------------------------------ *
 * (a) STD_SG with right and left hands and dye leak
 * ------------------------------------------------------------------ */

// Two sizes of the surgical range. 6.5: 80 gloves (code J: watertight Ac 3 / Re 4,
// major 5 / 6, minor 7 / 8); 7.5: 125 gloves (code K: watertight 5 / 6, major 7 / 8,
// minor 10 / 11). Critical is always 0 / 1.
const DIMENSIONS_65 = [
  "270\t89\t0.22\t0.20\t0.18",
  "272\t90\t0.21\t0.19\t0.17",
  "271\t89\t0.22\t0.20\t0.18",
  "269\t88\t0.23\t0.21\t0.18",
  "273\t90\t0.22\t0.20\t0.19",
  "270\t89\t0.21\t0.20\t0.17",
  "271\t90\t0.22\t0.19\t0.18",
  "272\t89\t0.22\t0.20\t0.18",
  "270\t88\t0.23\t0.21\t0.19",
  "271\t89\t0.22\t0.20\t0.18",
  "274\t90\t0.21\t0.20\t0.17",
  "270\t89\t0.22\t0.19\t0.18",
  "271\t89\t0.22\t0.20\t0.18",
].join("\n");
const DIMENSIONS_75 = DIMENSIONS_65.replace(/^27(\d)\t8(\d)/gm, (_all, a: string, b: string) => `28${a}\t10${b}`);

test("(a) an STD_SG inspection with right and left hands and dye leak works on the iPad in landscape", async ({ page, baseURL }) => {
  await useSession(page, baseURL!, inspectorCookies);

  /* New inspection: no client, Hartalega, surgical gloves: the standard surgical template. */
  await page.goto("/inspections/new");
  await press(page.getByRole("combobox", { name: "Client" }));
  await press(page.getByRole("option", { name: "No client" }));
  await press(page.getByRole("combobox", { name: "Manufacturer" }));
  await press(page.getByRole("option", { name: /^Hartalega NGC/ }));
  await press(page.getByRole("radio", { name: /Surgical gloves/ }));
  await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", "STD_SG");
  await expect(page.getByTestId("choice-reason")).toHaveText("Standard template for surgical gloves");
  await page.getByRole("textbox", { name: /^Product name/ }).fill(SG_PRODUCT_NAME);
  await shot(page, "a-new-inspection");
  await press(page.getByRole("button", { name: "Create inspection" }));
  await expect(page).toHaveURL(INSPECTION_URL, { timeout: 30_000 });
  sgId = INSPECTION_URL.exec(new URL(page.url()).pathname)![1];
  await captureReady(page);

  const row = await stored(sgId);
  expect(row.status).toBe("draft");
  expect(row.product_name).toBe(SG_PRODUCT_NAME);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(row.ref_no);
  // STD_SG's sections, in the onsite form's order.
  await expect(sectionTabs(page).getByRole("tab")).toHaveText([
    /^Purchase Order \/ Shipment Information/,
    /^Glove Type/,
    /^PO Info/,
    /^Packing Mode/,
    /^Sampling Plan/,
    /^Watertight Inspection/,
    /^Visual Inspection/,
    /^Dimension/,
    /^Dye leak test/,
    /^Conclusion/,
  ]);

  /* Purchase Order / Shipment Information */
  await openSection(page, "Purchase Order / Shipment Information");
  await page.getByRole("textbox", { name: "Purchase/Sales Order No." }).fill("PO-E2E-FINAL-SG-001");
  await page.getByRole("textbox", { name: "Product code" }).fill("SG-CODE-PLACEHOLDER");
  await expect(page.getByRole("textbox", { name: "Product Name" })).toHaveValue(SG_PRODUCT_NAME);
  await page.getByRole("textbox", { name: "Mfg Date" }).fill("2026-03-02");
  await page.getByRole("textbox", { name: "Exp Date" }).fill("2031-03-01");

  /* Glove Type (the custom module) */
  await openSection(page, "Glove Type");
  await page.getByRole("textbox", { name: "Glove Type", exact: true }).fill("Latex, powder-free, sterile");

  /* PO Info: two sizes */
  await openSection(page, "PO Info");
  await enter(page.getByRole("textbox", { name: "Qty (case), Size 6.5" }), "40");
  await enter(page.getByRole("textbox", { name: "Qty (case), Size 7.5" }), "60");
  await enter(page.getByRole("textbox", { name: "Lot Number, Size 6.5: add" }), "LOT-E2E-65");
  await enter(page.getByRole("textbox", { name: "Lot Number, Size 7.5: add" }), "LOT-E2E-75");

  /* Packing Mode: a pair per pouch, 200 pouches a case */
  await openSection(page, "Packing Mode");
  await enter(page.getByRole("textbox", { name: "# glove per inner box" }), "1");
  await enter(page.getByRole("textbox", { name: "# inners per case" }), "200");
  await enter(page.getByRole("textbox", { name: "# gloves per case" }), "200");
  await page.getByRole("textbox", { name: "Packing Mode" }).fill("1 pair per pouch, 50 pouches per inner box, 4 inner boxes per case");
  await shot(page, "a-packing");
  await openSection(page, "PO Info");
  await expect(panel(page).getByRole("row", { name: /^6\.5/ })).toContainText("8,000");
  await shot(page, "a-po-info");

  /* Sampling Plan, per size */
  await openSection(page, "Sampling Plan");
  const plan = async (size: string, values: Record<string, string>) => {
    await chooseSize(page, size);
    for (const [label, value] of Object.entries(values)) {
      await enter(page.getByRole("textbox", { name: `${label}, size ${size}` }), value);
    }
  };
  const planned = { Case: "5", "Inner Box": "5", "# Gloves dimension": "13", "# Gloves (FAB)": "13", "# pouches (dye leak test)": "13" };
  await plan("6.5", { ...planned, Pouches: "40", "# gloves": "80" });
  await plan("7.5", { ...planned, Pouches: "63", "# gloves": "125" });
  await expectSectionStatus(page, "Sampling Plan", "Info");

  /* Watertight: holes per hand; both hands count against one limit per size */
  await openSection(page, "Watertight Inspection");
  const hands = page.getByRole("radiogroup", { name: "Hand" });
  await expect(hands.getByRole("radio", { name: "Both hands" })).toHaveAttribute("aria-checked", "true");
  await chooseSize(page, "6.5");
  await press(page.getByRole("button", { name: "Use 80 for size 6.5" }));
  await expect(page.getByRole("textbox", { name: /^No\. of sample tested\s*, size 6\.5$/ })).toHaveValue("80");
  await step(page, "Palm, Size 6.5, right hand", 1);
  await step(page, "Finger, Size 6.5, left hand", 1);
  await step(page, "Between fingers (crotch), Size 6.5, left hand", 1);
  const watertightTable = panel(page).getByRole("table", { name: "Watertight Inspection" });
  await expectRow(watertightTable, /^Defect Limit/, /3\D+4/);
  await expectRow(watertightTable, /^Total WTT/, "3");
  await expectRow(watertightTable, /^Freedom from holes/, "Passed");
  await expectSizeStatus(page, "6.5", "Passed");
  await shot(page, "a-watertight-6.5");
  // A photo taken now is tagged with the size and the hand on screen (BUILD_SPEC 8.1).
  await press(hands.getByRole("radio", { name: "Right hand" }));
  const nextTags = panel(page).locator('[data-slot="next-tags"]');
  await expect(nextTags).toContainText("6.5");
  await expect(nextTags).toContainText(/right hand/i);
  console.log(`[a] photo tags with the right hand on screen: ${await nextTags.innerText()}`);
  await press(hands.getByRole("radio", { name: "Both hands" }));

  await chooseSize(page, "7.5");
  await press(page.getByRole("button", { name: "Use 125 for size 7.5" }));
  await step(page, "Cuff, Size 7.5, right hand", 2);
  await step(page, "Palm, Size 7.5, left hand", 2);
  await step(page, "Other :, Size 7.5, left hand", 1);
  await page.getByRole("textbox", { name: /^Other : description \(Size 7\.5, left hand\)/ }).fill("Near the thumb tip");
  await expectRow(watertightTable, /^Defect Limit/, /5\D+6/);
  await expectRow(watertightTable, /^Total WTT/, "5");
  await expectRow(watertightTable, /^Freedom from holes/, "Passed");
  // One more hole on the left hand: 2 right + 4 left reach Reject 6 for the size, though neither hand alone does.
  await step(page, "Between fingers (crotch), Size 7.5, left hand", 1);
  await expectRow(watertightTable, /^Total WTT/, "6");
  await expectRow(watertightTable, /^Freedom from holes/, "Failed");
  await expectSizeStatus(page, "7.5", "Failed");
  await expectSectionStatus(page, "Watertight Inspection", "Failed");
  await shot(page, "a-watertight-7.5-failed");
  // Only the left hand on screen: its steppers, not the right hand's.
  await press(hands.getByRole("radio", { name: "Left hand" }));
  await expect(page.getByRole("spinbutton", { name: "Palm, Size 7.5, left hand" })).toBeVisible();
  await expect(page.getByRole("spinbutton", { name: "Palm, Size 7.5, right hand" })).toHaveCount(0);
  await step(page, "Between fingers (crotch), Size 7.5, left hand", 1, "Decrease");
  await press(hands.getByRole("radio", { name: "Both hands" }));
  await expectRow(watertightTable, /^Total WTT/, "5");
  await expectSizeStatus(page, "7.5", "Passed");
  await expectSectionStatus(page, "Watertight Inspection", "Passed");

  /* Visual: three classes per size, per hand */
  await openSection(page, "Visual Inspection");
  await chooseSize(page, "6.5");
  await press(page.getByRole("button", { name: "Use 80 for every class of size 6.5" }));
  await step(page, "Thin spot on glove body, Size 6.5, right hand", 2);
  await step(page, "Oil stain, Size 6.5, left hand", 1);
  await step(page, "Small dirt / stain, Size 6.5, right hand", 1);
  await step(page, "Sticky pleats (< 5mm), Size 6.5, left hand", 2);
  await chooseSize(page, "7.5");
  await press(page.getByRole("button", { name: "Use 125 for every class of size 7.5" }));
  // A critical defect on either hand fails the size at once.
  await step(page, "Embedded Insects, Size 7.5, left hand", 1);
  const critical = panel(page).getByRole("table", { name: /^Critical Defects/ });
  await expectRow(critical, /^Disposition - Visual Critical/, "Failed");
  await expectSizeStatus(page, "7.5", "Failed");
  await expectSectionStatus(page, "Visual Inspection", "Failed");
  await shot(page, "a-visual-7.5-critical");
  await step(page, "Embedded Insects, Size 7.5, left hand", 1, "Decrease");
  await step(page, "Big Lumps (>2mm), Size 7.5, right hand", 1);
  await step(page, "Rolled bead, Size 7.5, left hand", 1);
  // A defect the list does not have, counted on the left hand: kept unmapped for an admin.
  const minor = panel(page).getByRole("region", { name: "Minor defect" });
  await press(minor.getByRole("button", { name: "Defect not in the list" }));
  await minor.getByRole("textbox", { name: "Defect not in the list" }).fill("Glove stuck to pouch");
  await press(minor.getByRole("button", { name: "Add", exact: true }));
  await step(page, "Glove stuck to pouch, Size 7.5, left hand", 1);
  await expect(minor.getByRole("rowheader", { name: /^Glove stuck to pouch/ })).toHaveAttribute("data-unmapped", "true");
  await expectSectionStatus(page, "Visual Inspection", "Passed");

  /* Dimension: 13 gloves a size, pasted as from a caliper app (no specs yet: nothing judged) */
  await openSection(page, "Dimension");
  await chooseSize(page, "6.5");
  await paste(panel(page).getByRole("region", { name: "Dimension - Size 6.5" }).getByRole("textbox", { name: "Length, No. 1", exact: true }), DIMENSIONS_65);
  await chooseSize(page, "7.5");
  await paste(panel(page).getByRole("region", { name: "Dimension - Size 7.5" }).getByRole("textbox", { name: "Length, No. 1", exact: true }), DIMENSIONS_75);
  await expect(panel(page).getByRole("region", { name: "Dimension - Size 7.5" }).getByRole("textbox", { name: "Cuff Thickness, No. 13" })).toHaveValue("0.18");

  /* Dye leak: 13 pouches a size from the plan; one leak fails the size */
  await openSection(page, "Dye leak test");
  await chooseSize(page, "6.5");
  await expect(panel(page)).toContainText(/Pouches planned:\s*13/);
  await press(page.getByRole("button", { name: "No leaks, Pouches failed, Size 6.5" }));
  await expect(page.getByRole("spinbutton", { name: "Pouches tested, Size 6.5" })).toHaveAttribute("aria-valuenow", "13");
  await chooseSize(page, "7.5");
  await press(page.getByRole("button", { name: "No leaks, Pouches failed, Size 7.5" }));
  await step(page, "Pouches failed, Size 7.5", 1);
  await expectSectionStatus(page, "Dye leak test", "Failed");
  await shot(page, "a-dye-leak-failed");
  await step(page, "Pouches failed, Size 7.5", 1, "Decrease");
  await page.getByRole("textbox", { name: "Notes, Size 7.5" }).fill("Pouch 4 dipped twice, no dye inside");
  await expectSectionStatus(page, "Dye leak test", "Passed");

  /* Conclusion */
  await openSection(page, "Conclusion");
  const suggestion = panel(page).getByRole("region", { name: "Suggested result" });
  await expect(suggestion.locator('[data-slot="status-pill"]')).toHaveText("Passed");
  await press(page.getByRole("radio", { name: "PASSED" }));
  await page.getByRole("textbox", { name: "Remark" }).fill("E2E acceptance: STD_SG with right and left hands and dye leak.");
  await panel(page).getByRole("textbox", { name: "Date" }).fill(todayInMalaysia());

  /* Every section has its result */
  for (const [title, status] of [
    ["Purchase Order / Shipment Information", "Info"],
    ["Glove Type", "Info"],
    ["PO Info", "Info"],
    ["Packing Mode", "Info"],
    ["Sampling Plan", "Info"],
    ["Watertight Inspection", "Passed"],
    ["Visual Inspection", "Passed"],
    ["Dimension", "Info"],
    ["Dye leak test", "Passed"],
    ["Conclusion", "Passed"],
  ] as const) {
    await expectSectionStatus(page, title, status);
  }
  await expect(progress(page, 10)).toHaveText("10 of 10 done");
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });

  /* The server has the hands apart */
  await expect
    .poll(async () => (await stored(sgId!)).data.modules, { timeout: 30_000 })
    .toMatchObject({
      watertight: {
        sizes: {
          "6.5": { tested: 80, R: { holes: { hole_palm: 1 } }, L: { holes: { hole_finger: 1, hole_crotch: 1 } } },
          "7.5": {
            tested: 125,
            R: { holes: { hole_cuff: 2 } },
            L: { holes: { hole_palm: 2, hole_other: 1 }, otherDescription: "Near the thumb tip" },
          },
        },
      },
      visual: {
        sizes: {
          "6.5": {
            major: { inspected: 80 },
            R: { major: { counts: { thin_spot: 2 } }, minor: { counts: { dirt_small: 1 } } },
            L: { major: { counts: { stain: 1 } }, minor: { counts: { sticky_pleats: 2 } } },
          },
          "7.5": {
            critical: { inspected: 125 },
            R: { major: { counts: { lump_big: 1 } } },
            L: { minor: { counts: { bead_rolled: 1 }, unmapped: [{ label: "Glove stuck to pouch", count: 1 }] } },
          },
        },
      },
      dye_leak: {
        sizes: {
          "6.5": { pouchesTested: 13, pouchesFailed: 0 },
          "7.5": { pouchesTested: 13, pouchesFailed: 0, notes: "Pouch 4 dipped twice, no dye inside" },
        },
      },
      conclusion: { finalResult: "pass" },
    });

  /* Pending, then submit */
  const sheet = await openPending(page);
  const pendingText = (await sheet.textContent()) ?? "";
  await shot(page, "a-pending");
  await closePending(page);
  test.info().annotations.push({ type: "pending before submit", description: pendingText });

  await press(page.getByRole("button", { name: "Submit", exact: true }));
  const confirm = page.getByRole("alertdialog", { name: `Submit ${row.ref_no} for review?` });
  await expect(confirm).toBeVisible();
  await expect(confirm).toContainText("Pass");
  await shot(page, "a-submit");
  await press(confirm.getByRole("button", { name: "Submit for review" }));
  await expect(page).toHaveURL(new RegExp(`/inspections/${sgId}/review$`), { timeout: 60_000 });

  /* The review */
  await expect(page.getByRole("heading", { level: 1, name: row.ref_no })).toBeVisible();
  const watertight = page.locator('[data-module="watertight"]');
  await expect(watertight).toHaveAttribute("data-status", "pass");
  await expect(watertight.locator('[data-size="6.5"]')).toContainText("Passed");
  await expect(watertight.locator('[data-size="6.5"]')).toContainText("3 / 80");
  await expect(watertight.locator('[data-size="7.5"]')).toContainText("5 / 125");
  await expect(page.locator('[data-module="visual"]')).toHaveAttribute("data-status", "pass");
  await expect(page.locator('[data-module="dye_leak"]')).toHaveAttribute("data-status", "pass");
  await expect(page.locator('[data-module="dimensions"]')).toHaveAttribute("data-status", "info");
  await expect(page.locator('[data-module="conclusion"]')).toHaveAttribute("data-status", "pass");
  // What the reviewer reads, one line a module (evidence for the run's log).
  for (const key of ["watertight", "visual", "dye_leak", "packing_config", "order_lots"]) {
    const text = await page.locator(`#modules [data-module="${key}"]`).innerText();
    console.log(`[a] review, ${key}: ${text.replace(/\s+/g, " ")}`);
  }
  await scrolledShots(page, "a-review");

  /* Submitted, the capture screen is read-only and still shows each hand's counts */
  await page.goto(`/inspections/${sgId}?module=watertight`);
  await expect(page.getByText(/Submitted for review: read-only/)).toBeVisible({ timeout: 30_000 });
  await chooseSize(page, "7.5");
  const readOnlyTable = panel(page).getByRole("table", { name: "Watertight Inspection" });
  await expectRow(readOnlyTable, /^Cuff/, /^Cuff\s*2\s*0$/);
  await expectRow(readOnlyTable, /^Palm/, /^Palm\s*0\s*2$/);
  await expect(panel(page).getByRole("button", { name: /^Increase/ })).toHaveCount(0);
  await shot(page, "a-read-only-watertight");

  const submitted = await stored(sgId);
  expect(submitted.status).toBe("submitted");
  expect(submitted.result).toBe("pass");
  expect(submitted.suggested_result).toBe("pass");
  expect(submitted.po_no).toBe("PO-E2E-FINAL-SG-001");

  /* The export: the hands apart, the totals per size, dye leak and the conclusion */
  const response = await page.request.get(`/api/inspections/${sgId}/export`);
  expect(response.status()).toBe(200);
  const document = (await response.json()) as Json;
  writeFileSync(`${SHOTS}/a-export.json`, JSON.stringify(document, null, 2));
  const modules = document.modules as Json[];
  const byKey = (key: string) => modules.find((entry) => entry.key === key) as Json;
  expect(modules.map((entry) => entry.key)).toEqual([
    "header",
    "order_lots",
    "packing_config",
    "sampling_plan",
    "watertight",
    "visual",
    "dimensions",
    "dye_leak",
    "conclusion",
  ]);
  expect(at(document, "template", "code")).toBe("STD_SG");
  const wt = byKey("watertight");
  expect(at(wt, "config", "handSplit")).toBe(true);
  expect(at(wt, "computed", "sizes", "6.5")).toMatchObject({
    tested: 80,
    codeLetter: "J",
    accept: 3,
    reject: 4,
    totalDefects: 3,
    hands: { R: { total: 1 }, L: { total: 2 } },
    result: "pass",
  });
  expect(at(wt, "computed", "sizes", "7.5")).toMatchObject({
    tested: 125,
    codeLetter: "K",
    accept: 5,
    reject: 6,
    totalDefects: 5,
    hands: { R: { total: 2 }, L: { total: 3 } },
    result: "pass",
  });
  expect(at(wt, "data", "sizes", "7.5", "L", "otherDescription")).toBe("Near the thumb tip");
  const visual = byKey("visual");
  expect(at(visual, "computed", "sizes", "6.5", "major")).toMatchObject({ total: 3, hands: { R: { total: 2 }, L: { total: 1 } }, result: "pass" });
  expect(at(visual, "computed", "sizes", "7.5", "critical")).toMatchObject({ total: 0, result: "pass" });
  expect(at(visual, "computed", "sizes", "7.5", "minor")).toMatchObject({
    total: 2,
    hands: { R: { total: 0 }, L: { total: 2 } },
    unmapped: [{ label: "Glove stuck to pouch", count: 1, hand: "L" }],
    result: "pass",
  });
  expect(at(byKey("dye_leak"), "computed")).toMatchObject({ totalTested: 26, totalFailed: 0, result: { "6.5": "pass", "7.5": "pass" } });
  expect(document.excludedModules).toEqual([]);
  expect(document.conclusion).toMatchObject({ suggestedResult: "pass", finalResult: "pass" });
  expect((document.custom as Json[]).find((entry) => entry.key === "glove_type")).toMatchObject({
    values: { gloveType: "Latex, powder-free, sterile" },
  });
});

/* ------------------------------------------------------------------ *
 * (b) A module switched off in the template
 * ------------------------------------------------------------------ */

test("(b1) a module switched off in the template is not in capture or the Pending list", async ({ page, baseURL }) => {
  const fixture = flows!;
  await useSession(page, baseURL!, inspectorCookies);
  await page.goto(`/inspections/${fixture.inspectionId}`);
  await captureReady(page);

  // Capture: every other section, in order, and not weight's.
  const tabs = sectionTabs(page).getByRole("tab");
  await expect(tabs).toHaveCount(fixture.sectionTitles.length);
  for (const [index, title] of fixture.sectionTitles.entries()) {
    await expect(tabs.nth(index)).toHaveAccessibleName(new RegExp(`^${escape(title)} `));
  }
  await expect(sectionTabs(page)).not.toContainText("Weight");
  await expect(progress(page, fixture.sectionTitles.length)).toBeVisible();

  // Asked for by its key, the screen opens on the first section instead.
  await page.goto(`/inspections/${fixture.inspectionId}?module=${TEMPLATE_OFF}`);
  await captureReady(page);
  await expect(page.getByRole("heading", { level: 2 })).toHaveText(fixture.sectionTitles[0]);
  await expect(page.getByText(fixture.titles[TEMPLATE_OFF])).toHaveCount(0);

  // Validation: its saved values (text in a numeric cell, an error were it on) count for nothing:
  // the panel, one row per section with something open, has no row for it.
  const sheet = await openPending(page);
  await expect(sheet).not.toContainText("Weight");
  await expect(sheet.locator(`[data-task="${TEMPLATE_OFF}"]`)).toHaveCount(0);
  await expect(sheet.locator("[data-needed]")).toHaveCount(1);
  await expect(sheet.locator("[data-needed]")).toContainText("Conclusion");
  await shot(page, "b1-pending");
  await closePending(page);
});

/* ------------------------------------------------------------------ *
 * (c) Losing the connection loses nothing
 * ------------------------------------------------------------------ */

const OFFLINE = {
  texture: "Micro-textured fingertips",
  weight: "3.6",
  length: "240 mm minimum",
  po: "PO-E2E-OFFLINE-001",
  gloveType: "Nitrile, powder-free (typed offline)",
  readings: ["7.137", "7.402", "6.918"],
  comment: "Readings from the lab sheet, typed while offline.",
};

async function localCopy(page: Page, userId: string, inspectionId: string) {
  return page.evaluate(
    ({ key }) =>
      new Promise<unknown>((resolve, reject) => {
        const open = indexedDB.open("stericare-offline");
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const read = db.transaction("drafts", "readonly").objectStore("drafts").get(key);
          read.onsuccess = () => {
            resolve(read.result);
            db.close();
          };
          read.onerror = () => reject(read.error);
        };
      }),
    { key: `draft:${userId}:${inspectionId}` },
  );
}

test("(c1) losing the connection mid-entry loses nothing: offline, the inspector keeps typing, and back online the server has every value", async ({
  page,
  context,
  baseURL,
}) => {
  const fixture = flows!;
  const inspector = (await admin.from("profiles").select("id").eq("email", TEST_ACCOUNTS.inspector).single()).data!.id;
  await useSession(page, baseURL!, inspectorCookies);
  // The inspector has been through a few sections while the signal was there (a section
  // opened for the first time offline shows its form too: c3).
  await page.goto(`/inspections/${fixture.inspectionId}?module=${OVERRIDE_OFF}`);
  await captureReady(page);
  await openSection(page, fixture.sectionTitles[0]);
  await openSection(page, "Glove Information");
  await page.getByRole("textbox", { name: "Glove colour" }).fill("Blue");
  await page.getByRole("textbox", { name: "Glove colour" }).press("Tab");
  await expect.poll(async () => at((await stored(fixture.inspectionId)).data, "modules", "glove_info", "colour"), { timeout: 20_000 }).toBe("Blue");

  // The signal drops mid-entry: a value typed a moment ago, its save not sent yet (800 ms).
  await page.getByRole("textbox", { name: "Glove colour" }).fill("Royal blue");
  await context.setOffline(true);
  await page.getByRole("textbox", { name: "Glove surface texture" }).fill(OFFLINE.texture);
  await expect(savePill(page)).toHaveAttribute("data-state", "offline", { timeout: 20_000 });
  await expect(savePill(page)).toHaveText("Offline (will sync)");
  await shot(page, "c1-offline");
  await enter(page.getByRole("textbox", { name: "Indicative weight (size M)" }), OFFLINE.weight);
  await page.getByRole("textbox", { name: "Glove length" }).fill(OFFLINE.length);

  // Other sections, still offline: a text, a custom field, readings on the grid and a comment.
  await openSection(page, fixture.sectionTitles[0]);
  await page.getByRole("textbox", { name: "PO / SO Number" }).fill(OFFLINE.po);
  await openSection(page, "Glove Type");
  await page.getByRole("textbox", { name: "Glove Type", exact: true }).fill(OFFLINE.gloveType);
  await openSection(page, fixture.titles[OVERRIDE_OFF]);
  for (const [index, reading] of OFFLINE.readings.entries()) {
    const cell = page.getByRole("textbox", { name: `Force at break (N), No. ${index + 1}`, exact: true });
    await expect(cell).toBeEditable();
    await enter(cell, reading);
  }
  await page.getByRole("textbox", { name: "Inspector comment" }).fill(OFFLINE.comment);
  await page.getByRole("textbox", { name: "Inspector comment" }).press("Tab");
  await expect(savePill(page)).toHaveAttribute("data-state", "offline");

  // Nothing of it is on the server yet; all of it is on the iPad.
  const offlineRow = await stored(fixture.inspectionId);
  expect(at(offlineRow.data, "modules", "glove_info", "surfaceTexture") ?? null).toBeNull();
  await expect
    .poll(async () => {
      const draft = (await localCopy(page, inspector, fixture.inspectionId)) as Json | undefined;
      return {
        unsaved: Number(draft?.revision) > Number(draft?.syncedRevision),
        colour: at(draft, "data", "modules", "glove_info", "colour"),
        texture: at(draft, "data", "modules", "glove_info", "surfaceTexture"),
        weight: at(draft, "data", "modules", "glove_info", "indicativeWeight"),
        po: at(draft, "data", "modules", "header", "poNo"),
        gloveType: at(draft, "data", "custom", "glove_type", "gloveType"),
        readings: at(draft, "data", "modules", OVERRIDE_OFF, "sizes", "M", "values"),
      };
    })
    .toEqual({
      unsaved: true,
      colour: "Royal blue",
      texture: OFFLINE.texture,
      weight: 3.6,
      po: OFFLINE.po,
      gloveType: OFFLINE.gloveType,
      readings: OFFLINE.readings.map(Number),
    });
  await shot(page, "c1-offline-typed");

  // Back online: saved by itself, every value on the server.
  await context.setOffline(false);
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 45_000 });
  await expect
    .poll(async () => (await stored(fixture.inspectionId)).data, { timeout: 30_000 })
    .toMatchObject({
      modules: {
        glove_info: { colour: "Royal blue", surfaceTexture: OFFLINE.texture, indicativeWeight: 3.6, length: OFFLINE.length },
        header: { poNo: OFFLINE.po },
        [OVERRIDE_OFF]: { sizes: { M: { values: OFFLINE.readings.map(Number) } }, comment: OFFLINE.comment },
      },
      custom: { glove_type: { gloveType: OFFLINE.gloveType } },
    });
  expect((await stored(fixture.inspectionId)).po_no).toBe(OFFLINE.po);
});

test("(c2) a tab closed while offline keeps what was typed: opened again online, it is restored and saved", async ({
  page,
  context,
  baseURL,
}) => {
  const fixture = flows!;
  await useSession(page, baseURL!, inspectorCookies);
  const closing = await context.newPage();
  await closing.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await captureReady(closing);
  await context.setOffline(true);
  await closing.getByRole("textbox", { name: "Glove length" }).fill("245 mm, closed while offline");
  await expect(savePill(closing)).toHaveAttribute("data-state", "offline", { timeout: 20_000 });
  // With runBeforeUnload, close() does not wait for the page to go: wait for it.
  await Promise.all([closing.waitForEvent("close"), closing.close({ runBeforeUnload: true })]);
  await context.setOffline(false);

  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByRole("textbox", { name: "Glove length" })).toHaveValue("245 mm, closed while offline", { timeout: 30_000 });
  await expect(page.getByText("Unsaved changes from this device were restored")).toBeVisible();
  await expect
    .poll(async () => at((await stored(fixture.inspectionId)).data, "modules", "glove_info", "length"), { timeout: 30_000 })
    .toBe("245 mm, closed while offline");
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
});

/**
 * Follows the page's script downloads from before it opens, so `settled` can wait for the
 * capture screen to download every section's form: it asks for them once it is idle, at the
 * latest 2 s after it opens (capture-screen.tsx, preloadCaptures).
 */
function trackScripts(page: Page) {
  const loading = new Set<Request>();
  page.on("request", (request) => {
    if (request.resourceType() === "script") loading.add(request);
  });
  const done = (request: Request) => loading.delete(request);
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  return {
    async settled() {
      await page.waitForTimeout(2_500);
      await expect.poll(() => loading.size, { message: "every section's form is downloaded", timeout: 20_000 }).toBe(0);
    },
  };
}

test("(c3) a section not opened before the signal dropped opens offline: the screen has every section's form", async ({
  page,
  context,
  baseURL,
}) => {
  // ACC-SGF-1, fixed: the capture screen downloads every section's form soon after it opens
  // (capture-screen.tsx, preloadCaptures), so a section opened for the first time offline shows
  // its form, never "The form for ... could not be shown".
  const fixture = flows!;
  await useSession(page, baseURL!, inspectorCookies);
  const scripts = trackScripts(page);
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await captureReady(page);
  await scripts.settled();
  await context.setOffline(true);
  try {
    // Neither section has been opened on this page: a counter form, then another.
    for (const title of [fixture.titles.visual, fixture.titles.watertight]) {
      await openSection(page, title);
      await expect(panel(page).getByRole("tab", { name: /^Size M\b/ })).toBeVisible();
      await expect(panel(page).getByRole("button", { name: /^Increase .+, Size M$/ }).first()).toBeEnabled();
      await expect(panel(page).getByText("Loading the form…")).toHaveCount(0);
      await expect(panel(page).getByText(/could not be shown/), `${title} shows its form offline`).toHaveCount(0);
      if (title === fixture.titles.visual) await shot(page, "c3-offline-section");
    }
  } finally {
    await context.setOffline(false);
  }
  await expect(panel(page).getByText(/could not be shown/)).toHaveCount(0);
});

test("(c4) Back while offline: the list cannot open without the connection, and nothing typed is lost", async ({
  page,
  context,
  baseURL,
}) => {
  const fixture = flows!;
  await useSession(page, baseURL!, inspectorCookies);
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await captureReady(page);
  await context.setOffline(true);
  await page.getByRole("textbox", { name: "Glove length" }).fill("250 mm, Back while offline");
  await expect(savePill(page)).toHaveAttribute("data-state", "offline", { timeout: 20_000 });
  await press(page.getByRole("link", { name: /^Back/ }));
  // No service worker yet (BUILD_SPEC 12, Later): a page opened offline does not load. Where Back lands is noted, not judged.
  await page.waitForTimeout(5_000);
  console.log(`[c4] after Back while offline: ${page.url()}`);
  await shot(page, "c4-back-offline").catch(() => undefined);
  await context.setOffline(false);

  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByRole("textbox", { name: "Glove length" })).toHaveValue("250 mm, Back while offline", { timeout: 30_000 });
  await expect
    .poll(async () => at((await stored(fixture.inspectionId)).data, "modules", "glove_info", "length"), { timeout: 30_000 })
    .toBe("250 mm, Back while offline");
});

/* ------------------------------------------------------------------ *
 * (b) An admin's switch-off for one inspection, then submit and export
 * ------------------------------------------------------------------ */

const OVERRIDE_REASON = "E2E: the client did not order the force at break test for this lot.";

test("(b2) an admin switches a module off for one inspection with a reason: gone from capture, validation, submit and the export", async ({
  page,
  browser,
  baseURL,
}) => {
  const fixture = flows!;
  const title = fixture.titles[OVERRIDE_OFF];

  // The inspector has the inspection open on the iPad.
  await useSession(page, baseURL!, inspectorCookies);
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await captureReady(page);
  // Its row in the Pending panel (one per section, the title without its closing bracket).
  const before = await openPending(page);
  await expect(before.locator(`[data-task="${OVERRIDE_OFF}"]`)).toContainText(title.replace(/\s*\([^()]*\)$/, ""));
  await closePending(page);

  // The admin, on the desktop, switches force at break off with a reason.
  const desk = await adminDesktop(browser, baseURL!);
  try {
    await desk.page.goto(`/inspections/${fixture.inspectionId}?module=${OVERRIDE_OFF}`);
    await expect(desk.page.getByRole("heading", { level: 2, name: title })).toBeVisible({ timeout: 30_000 });
    await desk.page.getByRole("button", { name: "Switch off" }).click();
    const dialog = desk.page.getByRole("dialog", { name: `Switch off ${title}?` });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("textbox", { name: "Reason" }).fill(OVERRIDE_REASON);
    await dialog.getByRole("button", { name: "Switch off" }).click();
    await expect(dialog).toBeHidden({ timeout: 30_000 });
    await expect(desk.page.locator('[data-slot="section-frame"]')).toContainText("is switched off for this inspection");
    await expect(desk.page.locator('[data-slot="section-frame"]')).toContainText(OVERRIDE_REASON);
    await desk.page.screenshot({ path: `${SHOTS}/b2-admin-switched-off.png` });
  } finally {
    await desk.context.close();
  }
  const overridden = await stored(fixture.inspectionId);
  expect(overridden.module_overrides).toMatchObject({ [OVERRIDE_OFF]: { reason: OVERRIDE_REASON } });
  // Its values stay saved.
  expect(at(overridden.data, "modules", OVERRIDE_OFF, "sizes", "M", "values")).toEqual(OFFLINE.readings.map(Number));
  const audit = await auditOf(admin, fixture.inspectionId);
  expect(audit.some((entry) => entry.action === "module_override" && at(entry.changes, "reason") === OVERRIDE_REASON)).toBe(true);

  // The inspector's open screen follows at its next save: the section is marked off.
  await page.getByRole("textbox", { name: "Glove colour" }).fill("Blue, checked again");
  await page.getByRole("textbox", { name: "Glove colour" }).press("Tab");
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  const offTab = sectionTabs(page).locator(`[data-section="${OVERRIDE_OFF}"]`);
  await expect(offTab).toHaveAttribute("data-excluded", "true", { timeout: 30_000 });
  await expect(offTab).toHaveAccessibleName(new RegExp(`^${escape(title)}\\s*, switched off for this inspection$`));

  // Opened again: the section says why, it is out of the progress and of the Pending list.
  await page.goto(`/inspections/${fixture.inspectionId}?module=${OVERRIDE_OFF}`);
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  await expect(panel(page)).toContainText("is switched off for this inspection");
  await expect(panel(page)).toContainText(OVERRIDE_REASON);
  await expect(panel(page).getByRole("textbox", { name: /Force at break/ })).toHaveCount(0);
  await expect(progress(page, fixture.sectionTitles.length - 1)).toBeVisible();
  await shot(page, "b2-inspector-switched-off");
  const after = await openPending(page);
  await expect(after.locator(`[data-task="${OVERRIDE_OFF}"]`)).toHaveCount(0);
  await expect(after).not.toContainText("Force At Break");
  await expect(after).not.toContainText("Weight");
  await closePending(page);

  // Submit, on hold: the conclusion is the one thing needed.
  await openSection(page, "Conclusion");
  await press(page.getByRole("radio", { name: "HOLD" }));
  await panel(page).getByRole("textbox", { name: "Date" }).fill(todayInMalaysia());
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
  await press(page.getByRole("button", { name: "Submit", exact: true }));
  const confirm = page.getByRole("alertdialog", { name: `Submit ${fixture.refNo} for review?` });
  await expect(confirm).toBeVisible();
  await press(confirm.getByRole("button", { name: "Submit for review" }));
  await expect(page).toHaveURL(new RegExp(`/inspections/${fixture.inspectionId}/review$`), { timeout: 60_000 });

  // The review: neither module among the results; force at break listed as switched off, with the reason.
  await expect(page.locator(`[data-module="${TEMPLATE_OFF}"]`)).toHaveCount(0);
  await expect(page.locator("#modules [data-module]").first()).toBeVisible();
  await expect(page.locator(`#modules [data-module="${OVERRIDE_OFF}"]`)).toHaveCount(0);
  const offList = page.locator(`#switched-off [data-module="${OVERRIDE_OFF}"]`);
  await expect(offList).toContainText(title);
  await expect(offList).toContainText(OVERRIDE_REASON);
  await offList.scrollIntoViewIfNeeded();
  await shot(page, "b2-review-switched-off");

  // The export.
  const response = await page.request.get(`/api/inspections/${fixture.inspectionId}/export`);
  expect(response.status()).toBe(200);
  const text = await response.text();
  writeFileSync(`${SHOTS}/b2-export.json`, text);
  const document = JSON.parse(text) as Json;
  const keys = (document.modules as Json[]).map((entry) => entry.key);
  expect(keys).not.toContain(TEMPLATE_OFF);
  expect(keys).not.toContain(OVERRIDE_OFF);
  expect(document.excludedModules).toEqual([{ key: OVERRIDE_OFF, title, reason: OVERRIDE_REASON }]);
  expect(text).not.toContain("2 42");
  expect(text).not.toContain(OFFLINE.readings[0]);
  expect(at(document, "conclusion", "finalResult")).toBe("hold");
  const submitted = await stored(fixture.inspectionId);
  expect(submitted.status).toBe("submitted");
});
