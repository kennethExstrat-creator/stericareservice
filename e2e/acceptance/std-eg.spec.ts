import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { expect, test, type Locator, type Page } from "@playwright/test";
import { STD_EG_EXAMPLE as REPORT, STD_EG_EXPECTED as EXPECTED } from "../../tests/fixtures/examples";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { signIn, TEST_ACCOUNTS } from "../support/session";

/**
 * Phase 2 acceptance (BUILD_SPEC 12): the STD_EG example report entered on
 * the iPad, through the real capture screen, and every result checked
 * against the STD_EG rows of docs/examples/expected-results.md, held as
 * typed data in tests/fixtures/examples (anonymised placeholders for the
 * cartons, boxes, codes and dates).
 *
 * As inspector@test.local on a 13 inch iPad in landscape (1366 x 1024,
 * touch): /inspections/new picks No client, Hartalega NGC and examination
 * gloves, which resolves the standard template STD_EG; then the report goes
 * in section by section with taps, the numeric keypad (typed, Enter moving
 * on) and pasted columns where a grid takes them. Only the fixture's values
 * are entered. The two values the report does not print are entered as
 * docs/FIXTURES.md says: 13 force readings whose median is the printed
 * 6.537 N, and 13 weights of the printed 2.90 g average.
 *
 * The Glove Packing Check is typed before the carton list: with no list yet
 * its box numbers are typed and not checked, which is how the report's stray
 * box 2336 gets in. Once the cartons are entered, the app must flag the
 * carton entered twice and the box missing from the list as errors that
 * block submit (the two errors the original report missed), warn about the
 * weight, and suggest FAILED. The corrections in the expected data (the
 * second 525 becomes 830, the stray box becomes 2236, picked from the list)
 * clear both errors, the suggestion becomes PASSED, and the inspection is
 * submitted. The review page, the saved row and the export are checked too.
 * Along the way the tab is reloaded straight after the 50th carton (nothing
 * typed may be lost), and the conclusion is signed with a finger, as the
 * report is.
 *
 * Checks against the expected results are soft, so one run lists every
 * mismatch; the steps that drive the screen are hard. One project only
 * (ipad-pro-landscape), one inspection from the live ref sequence, deleted
 * in afterAll with deleteTestInspection (e2e/README.md). A run that dies
 * before afterAll leaves the inspection's id in screenshots/acceptance/, and
 * the next run deletes it first. Screenshots go to screenshots/acceptance/.
 */

const PROJECT = "ipad-pro-landscape";
const HARTALEGA = { id: "10000000-0000-4000-8000-000000000001", label: "Hartalega NGC" } as const;
const INSPECTION_URL = /\/inspections\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;
/** Where a crashed run leaves the id of the inspection it created (git-ignored, never cleared by Playwright). */
const LEFTOVER = "screenshots/acceptance/std-eg-inspection.json";

/** The STD_EG section titles, in the template's (the report's) wording. */
const SECTION = {
  header: "Manufacturer Information",
  gloveType: "Glove Type",
  gloveInfo: "Glove Information",
  order: "Order",
  packing: "Packing configuration",
  sampling: "Sampling Plan",
  cartons: "Finished Goods Sampling Information (carton number)",
  dimensions: "Dimension",
  force: "Force At Break in Newton (Refer to attached where applicable)",
  weight: "Weight (g) - average of 13 gloves per size",
  watertight: "Freedom from Holes by watertight test",
  visual: "Visual Inspection",
  packingCheck: "Glove Packing Check",
  labeling: "Packaging Labeling Inspection",
  conclusion: "Conclusion",
} as const;

/** The dimension measures as the template words them (the fixture's columns: length, width, finger, palm, cuff). */
const MEASURE_LABEL = {
  length: "Length",
  width: "Width",
  finger: "Finger Thickness",
  palm: "Palm Thickness",
  cuff: "Cuff Thickness",
} as const;

// Checks against the expected results: soft, so one run reports every mismatch; generous on a shared Mac.
const check = expect.configure({ soft: true, timeout: 15_000 });

/* ------------------------------------------------------------------ *
 * The example's values (tests/fixtures/examples) and what follows from them
 * ------------------------------------------------------------------ */

function must<T>(value: T | undefined | null, what: string): T {
  if (value === undefined || value === null) throw new Error(`The STD_EG fixture has no ${what}.`);
  return value;
}

const SIZE = "M";
const ORDER = must(REPORT.order.lines.M, "order line for size M");
const SAMPLING = must(REPORT.sampling.M, "sampling row for size M");
const CARTON_ROWS = must(REPORT.cartons.M, "carton grid for size M").rows;
const DIMENSIONS = must(REPORT.dimensions.perSize.M, "dimension table for size M");
const FORCE = must(REPORT.forceAtBreak.M, "force at break for size M");
const WEIGHT = must(REPORT.weight.M, "weight for size M");
const WATERTIGHT = must(REPORT.watertight.perSize.M, "watertight for size M");
const PACKING_BOXES = must(REPORT.dispensingPacking.perSize.M, "packing check for size M").boxes;
const INNER = must(REPORT.labeling.inner.perSize.M, "dispenser box labelling for size M");
const CARTON = must(REPORT.labeling.carton.perSize.M, "carton box labelling for size M");

const EXPECT_WATERTIGHT = must(EXPECTED.watertight.M, "expected watertight M");
const EXPECT_CRITICAL = must(EXPECTED.visual.critical.M, "expected critical M");
const EXPECT_MAJOR = must(EXPECTED.visual.major.M, "expected major M");
const EXPECT_MINOR = must(EXPECTED.visual.minor.M, "expected minor M");
const EXPECT_DIMENSIONS = must(EXPECTED.dimensions.M, "expected dimensions M");
const EXPECT_FORCE = must(EXPECTED.forceAtBreak.M, "expected force at break M");
const EXPECT_WEIGHT = must(EXPECTED.weight.M, "expected weight M");
const EXPECT_DISPENSING = must(EXPECTED.dispensing.M, "expected dispensing M");
const EXPECT_LABELING = must(EXPECTED.labeling.M, "expected labelling M");
const EXPECT_SAMPLING = must(EXPECTED.sampling.M, "expected sampling M");
const CARTON_ERROR = must(EXPECTED.errors.find((issue) => issue.module === "carton_sampling"), "carton error");
const BOX_ERROR = must(EXPECTED.errors.find((issue) => issue.module === "dispensing_packing"), "box error");
const WEIGHT_WARNING = must(EXPECTED.warnings.find((issue) => issue.module === "weight"), "weight warning");
const { duplicateCarton: FIX_CARTON, strayBox: FIX_BOX } = EXPECTED.corrections;

/**
 * The Pending panel's rows for the two errors and the warning: one row per section, its title
 * (a closing bracket left out) over a few words and the size, named in full for screen readers.
 */
const PENDING_ROW = {
  cartons: "Finished Goods Sampling Information: Carton entered twice: M. Needed before you submit.",
  box: `${SECTION.packingCheck}: Box not in the carton list: M. Needed before you submit.`,
  weight: `${SECTION.weight}: Weight differs from indicative: M.`,
} as const;

/** The carton numbers as entered, row by row, the duplicate kept. */
const CARTONS_ENTERED = CARTON_ROWS.flat();
/** The carton list once the second 525 is corrected. */
const CARTONS_CORRECTED = CARTONS_ENTERED.map((carton, index) =>
  index === (FIX_CARTON.cell.row - 1) * 10 + (FIX_CARTON.cell.column - 1) ? FIX_CARTON.to : carton,
);

/**
 * 13 readings whose median is the printed one, out of order: STD_EG prints
 * only the median, the readings are in the lab report (docs/FIXTURES.md).
 * As tests/acceptance/examples.ts readingsWithMedian.
 */
function readingsWithMedian(value: number, n = 13): number[] {
  const middle = (n - 1) / 2;
  const sorted = Array.from({ length: n }, (_, index) => Math.round((value + (index - middle) * 0.05) * 1e6) / 1e6);
  return [...sorted.filter((_, index) => index % 2 === 1), ...sorted.filter((_, index) => index % 2 === 0)];
}

/** "5,800,000", as the screen groups thousands. */
const grouped = (value: number) => value.toLocaleString("en-US");

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-04-11" as the screens write a day in words: "11 Apr 2025". */
function dayInWords(iso: string) {
  const [year, month, day] = iso.split("-").map(Number);
  return `${day} ${MONTHS[month - 1]} ${year}`;
}

function escapeRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function specText(spec: { kind: string; min?: number; max?: number; nominal?: number; tolerance?: number } | undefined) {
  if (!spec || spec.kind === "na") return "NA";
  if (spec.kind === "min") return `≥ ${spec.min}`;
  if (spec.kind === "max") return `≤ ${spec.max}`;
  return `${spec.nominal} ± ${spec.tolerance}`;
}

/* ------------------------------------------------------------------ *
 * Driving the screen
 * ------------------------------------------------------------------ */

let inspectionId: string | null = null;
let inspectorName = "";

async function shot(page: Page, name: string, at?: Locator) {
  if (at) await at.evaluate((element) => element.scrollIntoView({ block: "center" }));
  // A viewport shot: a full-page capture drops touch emulation (e2e/README.md).
  await page.screenshot({
    path: `screenshots/acceptance/${PROJECT}-std-eg-${name}.png`,
    animations: "disabled",
    caret: "initial",
  });
}

function frameOf(page: Page) {
  return page.locator('[data-slot="section-frame"]');
}

/** The open section's result: the pill in its frame's header. */
function sectionStatus(page: Page) {
  return frameOf(page).locator(':scope > header [data-slot="status-pill"]').first();
}

/** The open section's summary line under its title. */
function sectionSummary(page: Page) {
  return frameOf(page).locator(":scope > header").first();
}

function savePill(page: Page) {
  return page.locator('[data-slot="save-status"]:visible');
}

/** The section's form has loaded and saving has started: it takes changes. */
async function sectionReady(page: Page, title: string) {
  await expect(page.getByRole("heading", { level: 2, name: title, exact: true })).toBeVisible();
  const frame = frameOf(page);
  await expect(frame.getByText("Loading the form…")).toHaveCount(0);
  await expect(frame.locator('[data-slot="photo-add"]')).toBeVisible();
  return frame;
}

/** Opens a section from the tab bar, as an inspector who jumps there. */
async function openTab(page: Page, title: string) {
  await page
    .getByRole("tablist", { name: "Sections" })
    .getByRole("tab", { name: new RegExp(`^${escapeRegExp(title)}`) })
    .tap();
  return sectionReady(page, title);
}

/** The next section, with the button at the foot of the screen, as an inspector going through the report. */
async function next(page: Page, title: string) {
  await page.getByRole("navigation", { name: "Previous and next section" }).getByRole("button", { name: `Next: ${title}` }).tap();
  return sectionReady(page, title);
}

/**
 * A tap into the field, the digits on the keypad, then Enter (the keypad's
 * Next). Arriving in a cell selects its text, so the digits replace it; a
 * cell that already had the focus (an issue link put it there) is selected
 * the same way, as a double tap would on the iPad.
 */
async function typeNumber(page: Page, field: Locator, value: number | string) {
  await field.tap();
  await field.selectText();
  await page.keyboard.type(String(value));
  await page.keyboard.press("Enter");
}

/** Pastes text into the input as a spreadsheet or caliper app would (a paste event with its clipboard data). */
async function paste(input: Locator, text: string) {
  await input.evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    element.dispatchEvent(new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true }));
  }, text);
}

/** A table row, found by its header cell; checked by its accessible name (header and cells, as read out). */
function row(scope: Locator, header: string) {
  return scope.getByRole("row", { name: new RegExp(`^${escapeRegExp(header)}( |$)`) });
}

/** The size tabs of a per-size section: only the ordered size, M (6.2 rule 4). */
async function expectOnlySizeM(page: Page, title: string) {
  const tabs = frameOf(page).getByRole("tab");
  await check(tabs, `${title}: one size tab`).toHaveCount(1);
  await check(tabs.first(), `${title}: the size tab is M`).toHaveAccessibleName(/^Size M\b/);
}

async function waitSaved(page: Page) {
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 30_000 });
}

async function storedRow(id: string) {
  const { data, error } = await createTestAdminClient()
    .from("inspections")
    .select("status, suggested_result, result, po_no, product_name, lot_numbers, inspection_date, client_id, manufacturer_id, data")
    .eq("id", id)
    .single();
  if (error) throw new Error(error.message);
  return data;
}

type StoredModules = {
  carton_sampling?: { sizes?: Record<string, { cartonNumbers?: (number | null)[] }> };
  dispensing_packing?: {
    sizes?: Record<string, { boxes?: { boxNo: number | null; layeringPct: number | null; dispensingPct: number | null; stickiness: string | null }[] }>;
  };
  dimensions?: { sizes?: Record<string, { gloves?: Record<string, number | null>[] }> };
  weight?: { sizes?: Record<string, { values?: (number | null)[] }> };
  force_at_break?: { sizes?: Record<string, { values?: (number | null)[] }> };
  conclusion?: { finalResult?: string | null; date?: string | null; remark?: string | null; signature?: unknown };
};

function modulesOf(row: Awaited<ReturnType<typeof storedRow>>): StoredModules {
  return ((row.data as { modules?: StoredModules } | null)?.modules ?? {}) as StoredModules;
}

/* ------------------------------------------------------------------ *
 * Setup and teardown: one inspection, ours, deleted afterwards
 * ------------------------------------------------------------------ */

async function deleteOurs(id: string) {
  const admin = createTestAdminClient();
  const { data, error } = await admin
    .from("inspections")
    .select("id, inspector_id, profiles:inspector_id(email)")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return;
  const owner = (data.profiles as { email: string | null } | null)?.email;
  if (owner !== TEST_ACCOUNTS.inspector) throw new Error(`Inspection ${id} is not the test inspector's: left alone.`);
  // No photos or files are added by this spec; remove any Storage object all the same (e2e/README.md order).
  const { data: photos } = await admin.from("inspection_photos").select("storage_path, thumb_path").eq("inspection_id", id);
  const photoPaths = (photos ?? []).flatMap((photo) => [photo.storage_path, photo.thumb_path]).filter((path): path is string => Boolean(path));
  if (photoPaths.length > 0) await admin.storage.from("inspection-photos").remove(photoPaths);
  const { data: files } = await admin.from("inspection_files").select("storage_path").eq("inspection_id", id);
  const filePaths = (files ?? []).map((file) => file.storage_path).filter((path): path is string => Boolean(path));
  if (filePaths.length > 0) await admin.storage.from("inspection-files").remove(filePaths);
  await deleteTestInspection(admin, id);
}

test.beforeAll(async ({}, testInfo) => {
  if (testInfo.project.name !== PROJECT) return;
  mkdirSync("screenshots/acceptance", { recursive: true });
  // A run that died before afterAll: its inspection goes first.
  if (existsSync(LEFTOVER)) {
    const { id } = JSON.parse(readFileSync(LEFTOVER, "utf8")) as { id: string };
    await deleteOurs(id);
    rmSync(LEFTOVER);
  }
  const { data, error } = await createTestAdminClient()
    .from("profiles")
    .select("full_name")
    .eq("email", TEST_ACCOUNTS.inspector)
    .single();
  if (error) throw new Error(error.message);
  inspectorName = data.full_name?.trim() || TEST_ACCOUNTS.inspector;
});

test.afterAll(async ({}, testInfo) => {
  if (testInfo.project.name !== PROJECT || inspectionId === null) return;
  await deleteOurs(inspectionId);
  if (existsSync(LEFTOVER)) rmSync(LEFTOVER);
  inspectionId = null;
});

/* ------------------------------------------------------------------ *
 * The acceptance run
 * ------------------------------------------------------------------ */

test("the STD_EG example entered on the iPad gives every expected result", async ({ page, context, baseURL }) => {
  test.skip(test.info().project.name !== PROJECT, `One iPad size: ${PROJECT} (a 13 inch iPad in landscape).`);
  test.setTimeout(20 * 60_000);
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));

  // One sign-in for the whole run (the shared project limits sign-ins).
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);

  await test.step("New inspection: no client, Hartalega NGC, examination gloves resolve STD_EG", async () => {
    await page.goto("/inspections/new");
    await expect(page.getByRole("heading", { level: 1, name: "New inspection" })).toBeVisible();
    const choose = async (label: string, option: string) => {
      await page.getByRole("combobox", { name: label }).tap();
      await page.getByRole("option", { name: option, exact: true }).tap();
      await expect(page.getByRole("combobox", { name: label })).toHaveText(option);
    };
    await choose("Client", "No client");
    await choose("Manufacturer", HARTALEGA.label);
    await page.getByRole("radio", { name: /Examination gloves/ }).tap();
    await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", EXPECTED.template);
    await check(page.getByTestId("choice-reason")).toHaveText("Standard template for examination gloves");
    await check(page.getByTestId("chosen-template")).toContainText("STD_EG version 1 · EN 455");
    await check(page.getByTestId("chosen-template")).toContainText("XS, S, M, L, XL (pieces)");
    await page.getByRole("textbox", { name: /Product name/ }).fill(REPORT.header.productName);
    await shot(page, "01-new");
    await page.getByRole("button", { name: "Create inspection" }).tap();
    await expect(page).toHaveURL(INSPECTION_URL, { timeout: 90_000 });
    inspectionId = INSPECTION_URL.exec(page.url())![1];
    writeFileSync(LEFTOVER, JSON.stringify({ id: inspectionId }));
  });
  const id = inspectionId!;

  await test.step("Manufacturer Information: typed once; manufacturer, client and inspector from the inspection", async () => {
    const frame = await sectionReady(page, SECTION.header);
    const facts = frame.getByRole("region", { name: "From the inspection" });
    // Inspector: recorded automatically (the report has no inspector at all).
    await check(facts, EXPECTED.inspector.check).toContainText(`Inspected by${inspectorName}`);
    await check(facts).toContainText(`Manufacturer / Supplier${HARTALEGA.label}`);
    await check(facts).toContainText("Client Name—");
    const text = async (label: string, value: string) => {
      const field = frame.getByLabel(label, { exact: true });
      await field.tap();
      await field.fill(value);
    };
    await text("Supplier Factory Address / Location", REPORT.header.factoryAddress);
    await text("PO / SO Number", REPORT.header.po.printed);
    // Product code: one value, typed once here (expected results: "one value, used everywhere").
    await text("Product code", must(REPORT.header.productCode, "product code"));
    await check(frame.getByLabel("Product Name (Brand, code & description)", { exact: true })).toHaveValue(REPORT.header.productName);
    // Dates from the date picker (6.2 rule 3).
    await frame.getByLabel("Inspection date", { exact: true }).fill(REPORT.header.inspectionDate.iso);
    await frame.getByLabel("Manufacturing date", { exact: true }).fill(REPORT.header.mfgDate.iso);
    await frame.getByLabel("Expiry date", { exact: true }).fill(REPORT.header.expiryDate.iso);
    await check(sectionStatus(page)).toHaveAttribute("data-status", "info");
    // The summary writes the day in words, as the rest of the app does.
    await check(sectionSummary(page)).toContainText(
      `${REPORT.header.po.printed}: ${REPORT.header.productName}; ${HARTALEGA.label}; Inspection date ${dayInWords(REPORT.header.inspectionDate.iso)}.`,
    );
    await shot(page, "02-header");
  });

  await test.step("Glove Type: not on the STD_EG report, left blank", async () => {
    await next(page, SECTION.gloveType);
  });

  await test.step("Glove Information", async () => {
    const frame = await next(page, SECTION.gloveInfo);
    const info = REPORT.gloveInfo;
    await frame.getByLabel("Glove surface texture", { exact: true }).tap();
    await frame.getByLabel("Glove surface texture", { exact: true }).fill(info.surfaceTexture);
    await typeNumber(page, frame.getByLabel("Indicative weight (size M)", { exact: true }), info.indicativeWeightG);
    await frame.getByLabel("Glove colour", { exact: true }).fill(info.colour);
    await frame.getByLabel("Glove length", { exact: true }).fill(info.length);
    await frame.getByLabel("Glove length", { exact: true }).press("Tab");
    await check(sectionStatus(page)).toHaveAttribute("data-status", "info");
    await check(sectionSummary(page)).toContainText(
      `${info.surfaceTexture}, ${info.colour}, ${info.length}; indicative weight ${info.indicativeWeightG} g (size M).`,
    );
  });

  await test.step("Order: size M only, 2,900 cases, one lot", async () => {
    const frame = await next(page, SECTION.order);
    await typeNumber(page, frame.getByRole("textbox", { name: "Qty (cases), Size M", exact: true }), ORDER.qtyCases);
    for (const lot of ORDER.lots) {
      await frame.getByRole("textbox", { name: "Lot Number, Size M: add" }).tap();
      await page.keyboard.type(lot);
      await page.keyboard.press("Enter");
    }
    await check(frame.getByRole("button", { name: `Remove Lot Number ${ORDER.lots[0]}, Size M` })).toBeVisible();
    await check(frame.getByRole("definition").first(), "Total # carton").toHaveText(grouped(EXPECTED.totals.cartons));
  });

  await test.step("Packing configuration: 200 per inner box, 10 per case, 2,000 per case", async () => {
    const frame = await next(page, SECTION.packing);
    await typeNumber(page, frame.getByLabel("# glove per inner box", { exact: true }), REPORT.packing.glovesPerInner);
    await typeNumber(page, frame.getByLabel("# inners per case", { exact: true }), REPORT.packing.innersPerCase);
    await typeNumber(page, frame.getByLabel("# gloves per case", { exact: true }), REPORT.packing.printedGlovesPerCase);
    await check(frame.getByRole("definition"), "gloves per case, computed").toHaveText(grouped(REPORT.packing.printedGlovesPerCase));
    await check(sectionStatus(page)).toHaveAttribute("data-status", "info");
  });

  await test.step("Sampling Plan: the seven counts in one run, Enter moving on; level I gives code N, 500", async () => {
    const frame = await next(page, SECTION.sampling);
    await expectOnlySizeM(page, SECTION.sampling);
    await frame.getByRole("textbox", { name: "Case, size M", exact: true }).tap();
    for (const value of [
      SAMPLING.cases,
      SAMPLING.inners,
      SAMPLING.gloves,
      SAMPLING.watertightVisualGloves,
      SAMPLING.dimensionGloves,
      SAMPLING.physicalTestGloves,
      SAMPLING.dispensingInners,
    ]) {
      await page.keyboard.type(String(value));
      await page.keyboard.press("Enter");
    }
    await check(frame.getByRole("textbox", { name: "# inner box for packaging & dispensing inspection, size M", exact: true })).toHaveValue(
      String(SAMPLING.dispensingInners),
    );
    const facts = frame.getByRole("tabpanel", { name: /^Size M\b/ });
    await check(facts).toContainText(`Order Qty (case)${grouped(ORDER.qtyCases)}`);
    await check(facts, "lot size in gloves").toContainText(`Lot size (gloves)${grouped(EXPECT_SAMPLING.lotGloves)}`);
    await check(facts).toContainText(`Inspection level${EXPECT_SAMPLING.level}`);
    await check(facts).toContainText(`Code letter${EXPECT_SAMPLING.codeLetter}`);
    await check(facts).toContainText(`Sample size by plan${EXPECT_SAMPLING.required}`);
    // 500 sampled meets level I: an info result, no notice (expected results: the plan matches).
    await check(sectionStatus(page)).toHaveAttribute("data-status", "info");
    await check(sectionSummary(page)).toContainText(
      `Size M: Case: ${SAMPLING.cases}; # gloves for watertight & Visual: ${SAMPLING.watertightVisualGloves}; inspection level I needs ${EXPECT_SAMPLING.required} (code ${EXPECT_SAMPLING.codeLetter}).`,
    );
    await check(frame.locator(".text-warn, .text-fail"), "no sampling notice").toHaveCount(0);
    await shot(page, "03-sampling-plan");
  });

  await test.step("Order totals: 2,900 cartons, 5,800,000 gloves", async () => {
    const frame = await openTab(page, SECTION.order);
    const totals = frame.locator("dl").filter({ hasText: "Total # carton" });
    await check(totals, EXPECTED.totals.check).toContainText(`Total # carton${grouped(EXPECTED.totals.cartons)}`);
    await check(totals, EXPECTED.totals.check).toContainText(`Total # gloves${grouped(EXPECTED.totals.gloves)}`);
    await check(row(frame, SIZE), "lot size of size M").toHaveAccessibleName(
      new RegExp(`^M ${ORDER.qtyCases} ${ORDER.lots[0]} .*${escapeRegExp(grouped(EXPECTED.totals.gloves))}$`),
    );
    // Sizes not ordered stay in the order table (to order them), empty.
    for (const size of EXPECTED.unorderedSizes.sizes) {
      await check(frame.getByRole("textbox", { name: `Qty (cases), Size ${size}`, exact: true })).toHaveValue("");
    }
    await shot(page, "04-order");
  });

  await test.step("Glove Packing Check, typed from the paper before the carton list: box numbers not checked yet", async () => {
    const frame = await openTab(page, SECTION.packingCheck);
    await expectOnlySizeM(page, SECTION.packingCheck);
    for (const [index, box] of PACKING_BOXES.entries()) {
      await frame.getByRole("combobox", { name: `Box #, Item ${index + 1}`, exact: true }).tap();
      const typed = page.getByRole("textbox", { name: "Box number" });
      await expect(typed).toBeFocused();
      if (index === 0) {
        await check(page.getByRole("dialog", { name: /^Box #, Item 1: carton list for size M/ })).toContainText(
          "No carton list for size M yet. Type the box number; it is not checked until the cartons are entered.",
        );
      }
      await page.keyboard.type(String(box.box));
      await page.keyboard.press("Enter");
      await expect(typed).toHaveCount(0);
    }
    // Layering and dispensing % pasted as columns; stickiness picked per box.
    const layering = frame.getByRole("textbox", { name: "Layering %, Item 1", exact: true });
    await layering.tap();
    await paste(layering, PACKING_BOXES.map((box) => box.layeringPct).join("\n"));
    const dispensing = frame.getByRole("textbox", { name: "Dispensing %, Item 1", exact: true });
    await dispensing.tap();
    await paste(dispensing, PACKING_BOXES.map((box) => box.dispensingPct).join("\n"));
    for (const [index, box] of PACKING_BOXES.entries()) {
      await frame.getByRole("combobox", { name: `Stickiness **, Item ${index + 1}`, exact: true }).selectOption(box.stickiness);
    }
    for (const [index, box] of PACKING_BOXES.entries()) {
      await check(frame.getByRole("combobox", { name: `Box #, Item ${index + 1}`, exact: true })).toHaveText(String(box.box));
    }
    const results = frame.getByRole("table", { name: "Glove Packing Check, Size M" }).last();
    const dispensingCheck = EXPECT_DISPENSING;
    await check(row(results, "Layering %"), dispensingCheck.check).toHaveAccessibleName(
      `Layering % ${dispensingCheck.layeringAvgPct}% ≥ ${dispensingCheck.minLayeringPct}% Passed`,
    );
    await check(row(results, "Dispensing %"), dispensingCheck.check).toHaveAccessibleName(
      `Dispensing % ${dispensingCheck.dispensingAvgPct}% ≥ ${dispensingCheck.minDispensingPct}% Passed`,
    );
    await check(row(results, "Stickiness **"), dispensingCheck.check).toHaveAccessibleName("Stickiness ** A A, B, B1, C Passed");
    await check(sectionStatus(page), dispensingCheck.check).toHaveAttribute("data-status", dispensingCheck.status);
    await check(sectionSummary(page)).toContainText(
      `Size M: Layering ${dispensingCheck.layeringAvgPct}% (min. ${dispensingCheck.minLayeringPct}%), Dispensing ${dispensingCheck.dispensingAvgPct}% (min. ${dispensingCheck.minDispensingPct}%), Stickiness A: Passed.`,
    );
    // 13 boxes is code letter E (the report's title says "D & E").
    await check(frame.getByText(/^Glove Packing Check \(Sampling code letter E\) : min\. 70% layering & 80% dispensing$/)).toBeVisible();
    await shot(page, "05-packing-check-typed", results);
  });

  await test.step("Carton list: 50 cartons typed cell by cell, Enter moving along, then a reload; 525 twice is an error", async () => {
    const frame = await openTab(page, SECTION.cartons);
    await expectOnlySizeM(page, SECTION.cartons);
    await check(frame.getByText("Sampling Quantity 0 / 50")).toBeVisible();
    await frame.getByRole("textbox", { name: "M (Carton #), row 1 column 1", exact: true }).tap();
    for (const carton of CARTONS_ENTERED) {
      await page.keyboard.type(String(carton));
      await page.keyboard.press("Enter");
    }
    // The iPad reloads the tab straight after the last carton (a pull to refresh, a tab dropped
    // in the background): nothing typed is lost.
    await page.reload();
    await sectionReady(page, SECTION.cartons);
    const { cartonList } = EXPECTED;
    for (const [index, cells] of CARTON_ROWS.entries()) {
      for (const [column, carton] of cells.entries()) {
        await check(frame.getByRole("textbox", { name: `M (Carton #), row ${index + 1} column ${column + 1}`, exact: true })).toHaveValue(
          String(carton),
        );
      }
    }
    await check(frame.getByText(`Sampling Quantity ${cartonList.entries} / ${SAMPLING.cases}`), "50 entries").toBeVisible();
    const message = `Size M: ${CARTON_ERROR.message}`;
    // Both cells of the carton entered twice are marked, each described by the error.
    for (const cell of cartonList.duplicate.cells) {
      await check(
        frame.getByRole("textbox", { name: `M (Carton #), row ${cell.row} column ${cell.column}`, exact: true }),
        `${cartonList.check}: row ${cell.row} column ${cell.column} marked`,
      ).toHaveAccessibleDescription(message);
    }
    await check(frame.getByRole("button", { name: message }), `${cartonList.check}: the error under the grid`).toBeVisible();
    await check(sectionStatus(page), cartonList.check).toHaveAttribute("data-status", cartonList.status);
    await check(sectionSummary(page)).toContainText(message);
    await shot(page, "06-cartons-duplicate", frame.getByRole("button", { name: message }));
  });

  await test.step("Dimension: five columns pasted from the caliper; medians 245, 95, 0.09, 0.05, 0.04", async () => {
    const frame = await next(page, SECTION.dimensions);
    await expectOnlySizeM(page, SECTION.dimensions);
    const columns = REPORT.dimensions.columns;
    for (const [index, measure] of columns.entries()) {
      const first = frame.getByRole("textbox", { name: `${MEASURE_LABEL[measure]}, No. 1`, exact: true });
      await first.tap();
      await paste(first, DIMENSIONS.gloves.map((glove) => glove[index]).join("\n"));
    }
    // The last glove's readings landed (shown at the template's decimals: 0.1 reads 0.10).
    for (const [index, measure] of columns.entries()) {
      const cell = frame.getByRole("textbox", { name: `${MEASURE_LABEL[measure]}, No. 13`, exact: true });
      await check.poll(async () => Number(await cell.inputValue()), { message: `${MEASURE_LABEL[measure]}, No. 13` }).toBe(
        DIMENSIONS.gloves[12][index],
      );
    }
    const table = frame.getByRole("table", { name: "Dimension - Size M" });
    const expected = EXPECT_DIMENSIONS;
    await check(row(table, "Median"), expected.check).toHaveAccessibleName(
      `Median ${columns.map((measure) => expected.median[measure]).join(" ")}`,
    );
    await check(row(table, "Spec."), expected.check).toHaveAccessibleName(
      `Spec. ${columns.map((measure) => specText(expected.spec[measure])).join(" ")}`,
    );
    await check(row(table, "P/F *"), expected.check).toHaveAccessibleName(
      `P/F * ${columns.map((measure) => (expected.perMeasure[measure] === "na" ? "NA" : expected.perMeasure[measure] === "pass" ? "Passed" : "Failed")).join(" ")}`,
    );
    await check(sectionStatus(page), expected.check).toHaveAttribute("data-status", expected.status);
    await shot(page, "07-dimensions", table.getByRole("row", { name: /^Median/ }));
  });

  await test.step("Force at break: the lab report's 13 readings pasted; median 6.537 N against 6 N", async () => {
    const frame = await next(page, SECTION.force);
    await expectOnlySizeM(page, SECTION.force);
    const first = frame.getByRole("textbox", { name: "Force at break (N), No. 1", exact: true });
    await first.tap();
    await paste(first, readingsWithMedian(FORCE.medianN).join("\n"));
    const table = frame.getByRole("table", { name: /, size M$/ });
    await check(row(table, "Median"), EXPECT_FORCE.check).toHaveAccessibleName(`Median ${EXPECT_FORCE.medianN}`);
    await check(row(table, "Spec."), EXPECT_FORCE.check).toHaveAccessibleName(`Spec. ≥ ${EXPECT_FORCE.minN}`);
    await check(row(table, "Passed / Failed"), EXPECT_FORCE.check).toHaveAccessibleName("Passed / Failed Passed");
    await check(sectionStatus(page), EXPECT_FORCE.check).toHaveAttribute("data-status", EXPECT_FORCE.status);
    await check(sectionSummary(page)).toContainText(`Size M: Median ${EXPECT_FORCE.medianN} N. Spec. ≥ ${EXPECT_FORCE.minN} N.`);
    await shot(page, "08-force-at-break", table.getByRole("row", { name: /^Median/ }));
  });

  await test.step("Weight: 13 gloves typed down the column; average 2.90 g is a warning, 17.1% below 3.5 g", async () => {
    const frame = await next(page, SECTION.weight);
    await expectOnlySizeM(page, SECTION.weight);
    await frame.getByRole("textbox", { name: "Weight (g), No. 1", exact: true }).tap();
    for (let glove = 0; glove < WEIGHT.gloves; glove++) {
      await page.keyboard.type(String(WEIGHT.averageG));
      await page.keyboard.press("Enter");
    }
    await check(frame.getByRole("textbox", { name: `Weight (g), No. ${WEIGHT.gloves}`, exact: true })).toHaveValue(
      WEIGHT.averageG.toFixed(2),
    );
    const table = frame.getByRole("table", { name: "Weight (g), size M" });
    const expected = EXPECT_WEIGHT;
    await check(row(table, "Average"), expected.check).toHaveAccessibleName(`Average ${expected.averageG.toFixed(2)}`);
    const deviation = frame.locator('[data-slot="weight-deviation"]');
    await check(deviation, expected.check).toContainText(new RegExp(`[-−]${escapeRegExp(String(Math.abs(expected.deviationPct)))}%`));
    await check(deviation, expected.check).toContainText(`indicative ${expected.indicativeG} g, threshold ${expected.thresholdPct}%`);
    await check(deviation.locator('[data-slot="status-pill"]'), expected.check).toHaveAttribute("data-status", "warn");
    await check(sectionStatus(page), expected.check).toHaveAttribute("data-status", expected.status);
    await check(sectionSummary(page)).toContainText(
      `Average: M ${expected.averageG.toFixed(2)} g (${Math.abs(expected.deviationPct)}% below the indicative ${expected.indicativeG} g, beyond the ${expected.thresholdPct}% threshold).`,
    );
    await shot(page, "09-weight", deviation);
  });

  await test.step("Watertight: 500 from the sampling plan in one tap, one hole at the finger; code N, 14 / 15", async () => {
    const frame = await next(page, SECTION.watertight);
    await expectOnlySizeM(page, SECTION.watertight);
    await frame.getByRole("button", { name: `Use ${WATERTIGHT.tested} for size M` }).tap();
    await check(frame.getByRole("textbox", { name: /^No\. of sample tested/ })).toHaveValue(String(WATERTIGHT.tested));
    for (const location of REPORT.watertight.rows) {
      const holes = WATERTIGHT.holes[location.code] ?? 0;
      for (let tap = 0; tap < holes; tap++) {
        await frame.getByRole("button", { name: `Increase ${location.label}, Size M`, exact: true }).tap();
      }
    }
    const expected = EXPECT_WATERTIGHT;
    const table = frame.getByRole("table", {
      name: `Freedom from Holes by watertight test (Single sampling code letter ${expected.codeLetter}, AQL ${expected.aql})`,
    });
    await check(table, `${expected.check}: the heading names code ${expected.codeLetter}`).toBeVisible();
    await check(frame.getByText(`Sampling code letter ${expected.codeLetter} · AQL ${expected.aql}`)).toBeVisible();
    await check(row(table, "Defect Limit"), expected.check).toHaveAccessibleName(
      `Defect Limit Accept ${expected.accept} / Reject ${expected.reject}`,
    );
    for (const location of REPORT.watertight.rows) {
      await check(frame.getByRole("spinbutton", { name: `${location.label}, Size M`, exact: true })).toHaveAttribute(
        "aria-valuenow",
        String(expected.byLocation[location.code] ?? 0),
      );
    }
    await check(row(table, "Total number of defects found"), expected.check).toHaveAccessibleName(
      `Total number of defects found ${expected.found}`,
    );
    await check(row(table, "Freedom from holes (Passed / Failed)"), expected.check).toHaveAccessibleName(
      "Freedom from holes (Passed / Failed) Passed",
    );
    await check(sectionStatus(page), expected.check).toHaveAttribute("data-status", expected.status);
    await check(sectionSummary(page)).toContainText(
      `Size M: ${expected.found} / ${expected.n} (Finger ${expected.found}), Defect Limit ${expected.accept} / ${expected.reject}: Passed.`,
    );
    await shot(page, "10-watertight", table);
  });

  await test.step("Visual: 500 for every class in one tap, 8 major defects tapped; 0 / 1, 21 / 22, 21 / 22", async () => {
    const frame = await next(page, SECTION.visual);
    await expectOnlySizeM(page, SECTION.visual);
    await frame.getByRole("button", { name: `Use ${REPORT.visual.major.perSize.M?.inspected} for every class of size M` }).tap();
    for (const cls of ["critical", "major", "minor"] as const) {
      const block = REPORT.visual[cls];
      for (const defect of block.rows) {
        const count = block.perSize.M?.counts[defect.code] ?? 0;
        for (let tap = 0; tap < count; tap++) {
          await frame.getByRole("button", { name: `Increase ${defect.label}, Size M`, exact: true }).tap();
        }
      }
    }
    await check(frame.getByText(`Sampling code letter ${EXPECT_MAJOR.codeLetter}`, { exact: true })).toBeVisible();
    const classes = [
      { expected: EXPECT_CRITICAL, region: "Critical Defects (AQL 0.0)", limit: "Defect Limit : Accept / Reject", limitText: `Acc. = ${EXPECT_CRITICAL.accept} / Rej. = ${EXPECT_CRITICAL.reject}`, total: 'Total number of "Critical Defects" found', result: "Disposition - Visual Critical (Passed / Failed)" },
      { expected: EXPECT_MAJOR, region: "Major Defects (AQL 2.5)", limit: "Defect Limit", limitText: `Accept ${EXPECT_MAJOR.accept} / Reject ${EXPECT_MAJOR.reject}`, total: 'Total number of "Major Defects" found', result: "Disposition - Visual Major (Passed / Failed)" },
      { expected: EXPECT_MINOR, region: "Minor Defects (AQL 4.0)", limit: "Defect Limit", limitText: `Accept ${EXPECT_MINOR.accept} / Reject ${EXPECT_MINOR.reject}`, total: 'Total number of "Minor Defects" found', result: "Disposition - Visual Minor (Passed / Failed)" },
    ];
    for (const { expected, region, limit, limitText, total, result } of classes) {
      const section = frame.getByRole("region", { name: region });
      await check(section.getByRole("textbox", { name: /^No\. of sample inspected/ }), expected.check).toHaveValue(String(expected.n));
      await check(row(section, limit), expected.check).toHaveAccessibleName(`${limit} ${limitText}`);
      await check(row(section, total), expected.check).toHaveAccessibleName(`${total} ${expected.found}`);
      await check(row(section, result), expected.check).toHaveAccessibleName(`${result} Passed`);
    }
    for (const [code, count] of Object.entries(EXPECT_MAJOR.byDefect)) {
      const label = must(REPORT.visual.major.rows.find((defect) => defect.code === code), `major row ${code}`).label;
      await check(frame.getByRole("spinbutton", { name: `${label}, Size M`, exact: true }), EXPECT_MAJOR.check).toHaveAttribute(
        "aria-valuenow",
        String(count),
      );
    }
    await check(sectionStatus(page), "Visual M").toHaveAttribute("data-status", "pass");
    await check(sectionSummary(page)).toContainText(
      `Size M: Critical Defects ${EXPECT_CRITICAL.found} / ${EXPECT_CRITICAL.n}, Major Defects ${EXPECT_MAJOR.found} / ${EXPECT_MAJOR.n}, Minor Defects ${EXPECT_MINOR.found} / ${EXPECT_MINOR.n}: Passed.`,
    );
    await shot(page, "11-visual-major", frame.getByRole("region", { name: "Major Defects (AQL 2.5)" }));
  });

  await test.step("Glove Packing Check once the cartons are in: box 2336 is not in the carton list", async () => {
    const frame = await next(page, SECTION.packingCheck);
    const { dispensingBox } = EXPECTED;
    const stray = frame.getByRole("combobox", { name: `Box #, Item ${dispensingBox.item}`, exact: true });
    await check(stray, dispensingBox.check).toHaveText(String(dispensingBox.box));
    await check(stray, dispensingBox.check).toHaveAttribute("aria-invalid", "true");
    await check(stray, dispensingBox.check).toHaveAccessibleDescription(
      `Box ${dispensingBox.box} is not in the carton list for size M. Pick the box from the list.`,
    );
    // The other twelve boxes are in the list.
    await check(frame.locator('[role="combobox"][aria-invalid="true"]'), "only the stray box is marked").toHaveCount(1);
    // The packing check's own result stands on its averages and codes (docs/FIXTURES.md).
    await check(sectionStatus(page), EXPECT_DISPENSING.check).toHaveAttribute("data-status", EXPECT_DISPENSING.status);
    await shot(page, "12-packing-check-stray-box", stray);
  });

  await test.step("Labelling: 3 dispenser boxes and 1 carton recorded in a tap each, no defects", async () => {
    const frame = await next(page, SECTION.labeling);
    await expectOnlySizeM(page, SECTION.labeling);
    await frame.getByRole("button", { name: `Record ${INNER.inspected} boxes inspected: Dispenser Box, size M` }).tap();
    await frame.getByRole("button", { name: `Record ${CARTON.inspected} box inspected: Carton Box, size M` }).tap();
    const expected = EXPECT_LABELING;
    for (const [level, n, defects, result] of [
      ["Dispenser Box", expected.inner.n, expected.inner.defects, "Disposition - Inner Box (Passed / Failed)"],
      ["Carton Box", expected.carton.n, expected.carton.defects, "Disposition - Carton Box (Passed / Failed)"],
    ] as const) {
      const section = frame.getByRole("region", { name: level });
      await check(section.getByRole("spinbutton", { name: `No. of sampled boxes inspected, ${level}, size M` }), expected.check).toHaveAttribute(
        "aria-valuenow",
        String(n),
      );
      await check(row(section, "Defect Limit"), expected.check).toHaveAccessibleName("Defect Limit Accept 0 / Reject 1");
      await check(row(section, "Total number of defects found"), expected.check).toHaveAccessibleName(`Total number of defects found ${defects}`);
      // The carton level reads "Carton Box", not the report's "Inner Box" [sic].
      await check(row(section, result), expected.check).toHaveAccessibleName(`${result} Passed`);
    }
    await check(sectionStatus(page), expected.check).toHaveAttribute("data-status", expected.status);
    await shot(page, "13-labelling");
  });

  await test.step("Conclusion: PASSED as on the report, while the app suggests FAILED for the carton list", async () => {
    const frame = await next(page, SECTION.conclusion);
    await frame.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio", { name: "PASSED" }).tap();
    await frame.getByRole("textbox", { name: "Date", exact: true }).fill(REPORT.conclusion.date.iso);
    const suggested = frame.getByRole("region", { name: "Suggested result" });
    // Failed on the pill, as on every result pill; the template's FAILED stays with the choice and its warning.
    await check(suggested.locator('[data-slot="status-pill"]'), EXPECTED.conclusion.check).toHaveText("Failed");
    await check(suggested).toContainText(`Failed: ${SECTION.cartons}.`);
    await check(suggested).toContainText(`Warnings: ${SECTION.weight}.`);
    await check(frame.getByText(`Conclusion PASSED differs from the suggestion, FAILED (failed: ${SECTION.cartons}). Explain why under Remark.`)).toBeVisible();
    await check(frame.getByRole("textbox", { name: "Inspected by", exact: true }), EXPECTED.inspector.check).toHaveValue(inspectorName);
    // The report is signed: the inspector signs on the pad with a finger (touch events, as on the iPad).
    if (REPORT.conclusion.signed) {
      const pad = frame.getByRole("group", { name: "Signature" });
      const surface = pad.getByRole("img", { name: "Signature" });
      await surface.scrollIntoViewIfNeeded();
      const box = (await surface.boundingBox())!;
      const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
      const finger = await context.newCDPSession(page);
      await finger.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [at(0.12, 0.6)] });
      for (let step = 1; step <= 14; step++) {
        await finger.send("Input.dispatchTouchEvent", {
          type: "touchMove",
          touchPoints: [at(0.12 + step * 0.05, 0.6 - 0.25 * Math.sin(step / 2))],
        });
      }
      await finger.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
      await finger.detach();
      await check(pad, "signed on the pad").toContainText(`Signed by ${inspectorName}.`);
    }
    await waitSaved(page);
    await shot(page, "14-conclusion-failed");
  });

  await test.step("Pending: exactly the two errors are needed before submit; the weight warning is listed", async () => {
    await page.getByRole("button", { name: /^Pending/ }).tap();
    const sheet = page.getByRole("dialog", { name: "Pending" });
    await expect(sheet).toBeVisible();
    // One short row per section, named in full for screen readers; the section, the review and
    // the export keep each message in full (checked there).
    const needed = sheet.locator('[data-slot="needed-tasks"] [data-task]');
    await check(needed, "two errors block submit, one section each").toHaveCount(EXPECTED.errors.length);
    await check(sheet.getByRole("button", { name: PENDING_ROW.cartons, exact: true })).toBeVisible();
    await check(sheet.getByRole("button", { name: PENDING_ROW.box, exact: true })).toBeVisible();
    await check(sheet.getByRole("button", { name: PENDING_ROW.weight, exact: true })).toBeVisible();
    await shot(page, "15-pending-errors");
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toBeHidden();
  });

  await test.step("Review page while the errors stand: suggested FAILED, 2 errors, each under its module", async () => {
    await page.goto(`/inspections/${id}/review`);
    await expect(page.getByRole("heading", { level: 1, name: /^INS-\d{4}-\d+$/ })).toBeVisible();
    const result = page.getByRole("region", { name: "Result", exact: true });
    await check(result).toContainText(/Suggested by the app\s*Failed/);
    await check(result).toContainText("2 errors");
    await check(page.locator('li[data-module="carton_sampling"]')).toHaveAttribute("data-status", "fail");
    await check(page.locator('li[data-module="carton_sampling"] [data-issue][data-level="error"]')).toContainText(CARTON_ERROR.message);
    await check(page.locator('li[data-module="dispensing_packing"] [data-issue][data-level="error"]')).toContainText(BOX_ERROR.message);
    await shot(page, "16-review-with-errors", result);
  });

  await test.step("Submit is blocked until the errors are fixed, and each error links to its cell", async () => {
    await page.goto(`/inspections/${id}?module=conclusion`);
    await sectionReady(page, SECTION.conclusion);
    await waitSaved(page);
    await page.getByRole("button", { name: "Submit", exact: true }).tap();
    const sheet = page.getByRole("dialog", { name: "Before you submit" });
    await expect(sheet, EXPECTED.cartonList.check).toBeVisible();
    await check(sheet.getByRole("alert")).toHaveText("2 items are needed before you can submit.");
    await shot(page, "17-submit-blocked");
    expect((await storedRow(id)).status, "still a draft").toBe("draft");
    await sheet.getByRole("button", { name: PENDING_ROW.cartons, exact: true }).tap();
    await sectionReady(page, SECTION.cartons);
    const second = page.getByRole("textbox", { name: `M (Carton #), row ${FIX_CARTON.cell.row} column ${FIX_CARTON.cell.column}`, exact: true });
    await check(second, "the link lands on the second 525").toBeFocused();
    // An issue link checks 700 ms on that its section has the focus, and gives it to the section
    // title if not (capture-screen.tsx, goToIssue). At the spec's speed that check would land
    // while the box list opened below is open, and close it: an inspector reads the cell first.
    await page.waitForTimeout(1_000);
    await check(second, "the cell keeps the focus").toBeFocused();
  });

  await test.step("Correction 1: the second 525 becomes 830; the carton list passes", async () => {
    const frame = frameOf(page);
    await typeNumber(page, frame.getByRole("textbox", { name: `M (Carton #), row ${FIX_CARTON.cell.row} column ${FIX_CARTON.cell.column}`, exact: true }), FIX_CARTON.to);
    await check(sectionStatus(page), "carton list once corrected").toHaveAttribute("data-status", "pass");
    await check(sectionSummary(page)).toContainText(`Size M: ${EXPECTED.cartonList.entries} carton numbers, unique and between 1 and ${grouped(ORDER.qtyCases)}.`);
    await check(frame.locator(".text-fail"), "no carton error left").toHaveCount(0);
    await shot(page, "18-cartons-corrected");
  });

  await test.step("Correction 2: box 2336 cannot be picked from the list; 2236 is, and the error goes", async () => {
    const frame = await openTab(page, SECTION.packingCheck);
    const { dispensingBox } = EXPECTED;
    await frame.getByRole("combobox", { name: `Box #, Item ${dispensingBox.item}`, exact: true }).tap();
    const list = page.getByRole("dialog", { name: new RegExp(`^Box #, Item ${dispensingBox.item}: carton list for size M`) });
    await expect(list).toBeVisible();
    await check(list).toContainText(`Box ${dispensingBox.box} is not in the carton list for size M. Pick the box from the list.`);
    await check(list.getByRole("option"), "the 50 sampled cartons").toHaveCount(EXPECTED.cartonList.entries);
    const find = list.getByRole("combobox", { name: "Find a box" });
    await find.tap();
    await page.keyboard.type(String(dispensingBox.box));
    await check(list.getByText(`No box in the list matches “${dispensingBox.box}”.`), "the stray box is not offered").toBeVisible();
    await shot(page, "19-box-not-in-list", list);
    await find.fill("");
    await list.getByRole("option", { name: String(FIX_BOX.to), exact: true }).tap();
    await expect(list).toBeHidden();
    const box = frame.getByRole("combobox", { name: `Box #, Item ${dispensingBox.item}`, exact: true });
    await check(box).toHaveText(String(FIX_BOX.to));
    await check(box).not.toHaveAttribute("aria-invalid", "true");
    await check(frame.locator('[role="combobox"][aria-invalid="true"]'), "no box outside the list").toHaveCount(0);
    await check(sectionStatus(page), EXPECT_DISPENSING.check).toHaveAttribute("data-status", EXPECT_DISPENSING.status);
  });

  await test.step("Conclusion once corrected: the app suggests PASSED, with the weight warning", async () => {
    const frame = await openTab(page, SECTION.conclusion);
    const suggested = frame.getByRole("region", { name: "Suggested result" });
    await check(suggested.locator('[data-slot="status-pill"]'), EXPECTED.conclusion.check).toHaveText("Passed");
    await check(suggested).toContainText(`Warnings: ${SECTION.weight}.`);
    await check(suggested).not.toContainText("Failed:");
    await check(frame.getByText(/differs from the suggestion/)).toHaveCount(0);
    await check(sectionStatus(page)).toHaveAttribute("data-status", "pass");
    await check(sectionSummary(page)).toContainText(`Conclusion: PASSED. Suggested result: PASSED (warnings: ${SECTION.weight}).`);
    await check(sectionSummary(page), "signed").not.toContainText("Not signed.");
    await waitSaved(page);
    await shot(page, "20-conclusion-passed");

    // Every report section is done; the template's extra Glove Type section is not on the report.
    const progress = page.locator('[data-slot="progress-tracker"]:visible').first();
    test.info().annotations.push({ type: "progress once complete", description: (await progress.innerText()).replace(/\s+/g, " ").trim() });
    const pending = page.getByRole("button", { name: /^Pending/ });
    test.info().annotations.push({ type: "Pending once complete", description: await pending.ariaSnapshot() });
    const sectionTabs = page.getByRole("tablist", { name: "Sections" });
    test.info().annotations.push({ type: "section tabs once complete", description: await sectionTabs.ariaSnapshot() });
    await pending.tap();
    const sheet = page.getByRole("dialog", { name: "Pending" });
    await check(sheet.locator('[data-slot="needed-tasks"]'), "nothing needed before submit").toHaveCount(0);
    await check(sheet.locator("[data-task]"), "only the weight warning").toHaveCount(EXPECTED.warnings.length);
    await check(sheet.getByRole("button", { name: PENDING_ROW.weight, exact: true })).toBeVisible();
    await shot(page, "21-pending-warning-only");
    await sheet.getByRole("button", { name: "Close" }).tap();
    await expect(sheet).toBeHidden();
  });

  await test.step("Submit: suggested Pass with one warning for the report; it lands on the review", async () => {
    await page.getByRole("button", { name: "Submit", exact: true }).tap();
    const dialog = page.getByRole("alertdialog", { name: /^Submit INS-\d{4}-\d+ for review\?$/ });
    await expect(dialog).toBeVisible();
    await check(dialog).toContainText(/Suggested result\s*Pass/);
    await check(dialog).toContainText(`1 warning goes into the report.`);
    await shot(page, "22-submit");
    await dialog.getByRole("button", { name: "Submit for review" }).tap();
    await expect(page).toHaveURL(new RegExp(`/inspections/${id}/review$`), { timeout: 60_000 });
  });

  await test.step("Review page: every module's result as expected, sizes M only", async () => {
    await expect(page.getByRole("heading", { level: 1, name: /^INS-\d{4}-\d+$/ })).toBeVisible();
    const result = page.getByRole("region", { name: "Result", exact: true });
    await check(result, EXPECTED.conclusion.check).toContainText(/Suggested by the app\s*Passed/);
    await check(result).toContainText(/Final result \(inspector\)\s*Passed/);
    await check(result).toContainText("No errors");
    await check(result).toContainText("1 warning");
    await check(result).toContainText("Every module is done");
    const facts = page.locator("dl").filter({ hasText: "Inspector" }).first();
    await check(facts, EXPECTED.inspector.check).toContainText(new RegExp(`Inspector\\s*${escapeRegExp(inspectorName)}`));
    await check(facts).toContainText(new RegExp(`PO\\s*${escapeRegExp(REPORT.header.po.printed)}`));
    await check(facts).toContainText(new RegExp(`Lot numbers\\s*${escapeRegExp(ORDER.lots.join(", "))}`));
    const moduleRow = (key: string) => page.locator(`li[data-module="${key}"]`);
    const sizeLine = (key: string) => moduleRow(key).locator(`li[data-size="${SIZE}"]`);
    await check(moduleRow("order_lots"), EXPECTED.totals.check).toContainText(
      `Total # carton ${grouped(EXPECTED.totals.cartons)}; Total # gloves ${grouped(EXPECTED.totals.gloves)}.`,
    );
    const statuses: [string, string][] = [
      ["header", "info"],
      ["glove_info", "info"],
      ["order_lots", "info"],
      ["packing_config", "info"],
      ["sampling_plan", "info"],
      ["carton_sampling", "pass"],
      ["dimensions", EXPECT_DIMENSIONS.status],
      ["force_at_break", EXPECT_FORCE.status],
      ["weight", EXPECT_WEIGHT.status],
      ["watertight", EXPECT_WATERTIGHT.status],
      ["visual", "pass"],
      ["dispensing_packing", EXPECT_DISPENSING.status],
      ["labeling", EXPECT_LABELING.status],
      ["conclusion", "pass"],
    ];
    for (const [key, status] of statuses) await check(moduleRow(key), `${key} result`).toHaveAttribute("data-status", status);
    await check(sizeLine("watertight"), EXPECT_WATERTIGHT.check).toContainText(
      `${EXPECT_WATERTIGHT.found} / ${EXPECT_WATERTIGHT.n} (Finger ${EXPECT_WATERTIGHT.found}), Defect Limit ${EXPECT_WATERTIGHT.accept} / ${EXPECT_WATERTIGHT.reject}: Passed.`,
    );
    await check(sizeLine("visual"), EXPECT_CRITICAL.check).toContainText(
      `Critical Defects ${EXPECT_CRITICAL.found} / ${EXPECT_CRITICAL.n}, Defect Limit ${EXPECT_CRITICAL.accept} / ${EXPECT_CRITICAL.reject}: Passed`,
    );
    await check(sizeLine("visual"), EXPECT_MAJOR.check).toContainText(
      `Major Defects ${EXPECT_MAJOR.found} / ${EXPECT_MAJOR.n} (Thin area between fingers (crotch) 2, Thin area on glove body 1, Thin spot on glove body 5), Defect Limit ${EXPECT_MAJOR.accept} / ${EXPECT_MAJOR.reject}: Passed`,
    );
    await check(sizeLine("visual"), EXPECT_MINOR.check).toContainText(
      `Minor Defects ${EXPECT_MINOR.found} / ${EXPECT_MINOR.n}, Defect Limit ${EXPECT_MINOR.accept} / ${EXPECT_MINOR.reject}: Passed`,
    );
    await check(sizeLine("dimensions"), EXPECT_DIMENSIONS.check).toContainText(
      `Median: Length ${EXPECT_DIMENSIONS.median.length} Passed (≥ 240), Width ${EXPECT_DIMENSIONS.median.width} Passed (95 ± 10), Finger Thickness ${EXPECT_DIMENSIONS.median.finger} (NA), Palm Thickness ${EXPECT_DIMENSIONS.median.palm} (NA), Cuff Thickness ${EXPECT_DIMENSIONS.median.cuff} (NA).`,
    );
    await check(sizeLine("force_at_break"), EXPECT_FORCE.check).toContainText(`Median ${EXPECT_FORCE.medianN} N`);
    await check(sizeLine("weight"), EXPECT_WEIGHT.check).toContainText(
      `Average ${EXPECT_WEIGHT.averageG.toFixed(2)} g; ${Math.abs(EXPECT_WEIGHT.deviationPct)}% below the indicative ${EXPECT_WEIGHT.indicativeG} g.`,
    );
    await check(moduleRow("weight").locator('[data-issue][data-level="warning"]'), EXPECT_WEIGHT.check).toContainText(WEIGHT_WARNING.message);
    await check(sizeLine("dispensing_packing"), EXPECT_DISPENSING.check).toContainText(
      `Layering ${EXPECT_DISPENSING.layeringAvgPct}% (min. ${EXPECT_DISPENSING.minLayeringPct}%), Dispensing ${EXPECT_DISPENSING.dispensingAvgPct}% (min. ${EXPECT_DISPENSING.minDispensingPct}%), Stickiness A: Passed.`,
    );
    await check(sizeLine("labeling"), EXPECT_LABELING.check).toContainText(
      `Dispenser Box: ${EXPECT_LABELING.inner.defects} defects in ${EXPECT_LABELING.inner.n}; Carton Box: ${EXPECT_LABELING.carton.defects} defects in ${EXPECT_LABELING.carton.n}.`,
    );
    await check(sizeLine("carton_sampling")).toContainText(`${EXPECTED.cartonList.entries} carton numbers, unique and between 1 and ${grouped(ORDER.qtyCases)}.`);
    // Sizes not ordered (XS, S, L, XL): no tables, no results.
    const sizes = await page.locator("#modules li[data-size]").evaluateAll((items) => items.map((item) => item.getAttribute("data-size")));
    check(new Set(sizes), EXPECTED.unorderedSizes.check).toEqual(new Set([SIZE]));
    await check(page.locator("#modules [data-issue][data-level=\"error\"]"), "no errors left").toHaveCount(0);
    await shot(page, "23-review-result", result);
    await shot(page, "24-review-modules", moduleRow("visual"));
  });

  await test.step("Saved row and export: what was typed is what is stored, product code once, warning exported", async () => {
    const stored = await storedRow(id);
    check(stored).toMatchObject({
      status: "submitted",
      suggested_result: EXPECTED.conclusion.result,
      result: "pass",
      po_no: REPORT.header.po.printed,
      product_name: REPORT.header.productName,
      lot_numbers: [...ORDER.lots],
      inspection_date: REPORT.header.inspectionDate.iso,
      client_id: null,
      manufacturer_id: HARTALEGA.id,
    });
    const modules = modulesOf(stored);
    check(modules.carton_sampling?.sizes?.M?.cartonNumbers, "carton list as corrected").toEqual(CARTONS_CORRECTED);
    check(
      modules.dispensing_packing?.sizes?.M?.boxes?.map(({ boxNo, layeringPct, dispensingPct, stickiness }) => [boxNo, layeringPct, dispensingPct, stickiness]),
      "packing check rows, the stray box corrected",
    ).toEqual(
      PACKING_BOXES.map((box, index) => [
        index === FIX_BOX.item - 1 ? FIX_BOX.to : box.box,
        box.layeringPct,
        box.dispensingPct,
        box.stickiness,
      ]),
    );
    check(
      (modules.dimensions?.sizes?.M?.gloves ?? []).map((glove) =>
        ["length", "width", "fingerThickness", "palmThickness", "cuffThickness"].map((key) => glove[key] ?? null),
      ),
      "the 13 gloves' dimension readings, as pasted",
    ).toEqual(DIMENSIONS.gloves.map((glove) => [...glove]));
    check(modules.weight?.sizes?.M?.values, "13 weights").toEqual(Array.from({ length: WEIGHT.gloves }, () => WEIGHT.averageG));
    check(modules.force_at_break?.sizes?.M?.values, "13 force readings").toEqual(readingsWithMedian(FORCE.medianN));
    check(modules.conclusion, "the conclusion as on the report").toMatchObject({ finalResult: "pass", date: REPORT.conclusion.date.iso, remark: null });
    check(modules.conclusion?.signature ?? null, "signed").not.toBeNull();

    const response = await page.request.get(`/api/inspections/${id}/export`);
    expect(response.status(), "the export").toBe(200);
    const exported = (await response.json()) as {
      template: { code: string };
      inspector: { name: string };
      modules: { key: string; data: Record<string, unknown>; result: { status: string }; warnings: { code: string; message: string }[]; errors: unknown[] }[];
      conclusion: { suggestedResult: string; finalResult: string };
    };
    check(exported.template.code).toBe(EXPECTED.template);
    check(exported.inspector.name, EXPECTED.inspector.check).toBe(inspectorName);
    check(exported.conclusion).toMatchObject({ suggestedResult: "pass", finalResult: "pass" });
    const header = exported.modules.find((entry) => entry.key === "header");
    check(header?.data.productCode, EXPECTED.productCode.check).toBe(EXPECTED.productCode.code);
    check(JSON.stringify(exported), "the file-name code never enters").not.toContain(must(REPORT.header.productCodeElsewhere, "other code").code);
    const weight = exported.modules.find((entry) => entry.key === "weight");
    check(weight?.warnings.map((warning) => warning.message), "the weight warning goes into the export").toEqual([WEIGHT_WARNING.message]);
    check(exported.modules.flatMap((entry) => entry.errors), "no errors in the export").toEqual([]);
  });

  check(pageErrors, "no page errors").toEqual([]);
});
