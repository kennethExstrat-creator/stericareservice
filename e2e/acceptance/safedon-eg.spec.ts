import { expect, test, type Locator, type Page } from "@playwright/test";
import { SAFEDON_EG_EXAMPLE as REPORT, SAFEDON_EG_EXPECTED as EXPECTED } from "../../tests/fixtures/examples";
import { createTestAdminClient } from "../support/admin";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import {
  correctTextCells,
  dimensionCell,
  enterConclusion,
  enterCartons,
  enterDimensions,
  enterDispensing,
  enterGloveInfo,
  enterHeader,
  enterLabeling,
  enterOrder,
  enterPacking,
  enterSampling,
  enterTensile,
  enterVisual,
  enterWatertight,
  enterWeight,
  escapeRegExp,
  EXPECTED_DATA,
  expectReview,
  expectStoredModule,
  frame,
  grouped,
  HEADER,
  MEASURES,
  named,
  openSection,
  press,
  removeInspection,
  saved,
  savePill,
  sectionTab,
  shot,
  shownAverage,
  showSize,
  SIZES,
  stored,
  viewShot,
  type AdminClient,
} from "./safedon-eg.steps";
import { expectNoPageScroll } from "../support/layout";

/**
 * Acceptance (BUILD_SPEC 12, Phase 2 done-when): the SAFEDON_EG example
 * report, entered on the iPad, gives every result of
 * docs/examples/expected-results.md part A. The anonymised fixture
 * (tests/fixtures/examples) is typed into the capture screen at iPad
 * portrait (820 x 1180, touch) by the test inspector, on the live template
 * /inspections/new picks for the SAFEDON_EG client at the example's
 * manufacturer (supabase/seed.sql rows, read by id), examination gloves
 * (SAFEDON_EG); each section's screen is checked against the expected
 * results it shows, the inspection is submitted, and the review screen is
 * checked row by row, as the inspector and as an admin. The inspection is
 * deleted afterwards (its lab report first). Screenshots go to
 * screenshots/acceptance/.
 *
 * Expected values are read from SAFEDON_EG_EXPECTED. Where the screen rounds
 * to the report's printed precision (dimension averages: 0 decimals for mm,
 * 2 for thickness), the expected average is compared at that precision, and
 * the export's computed average at the expected results' own decimals
 * (docs/FIXTURES.md "Printed precision": thickness from the printed
 * readings).
 *
 * Run: PLAYWRIGHT_BASE_URL=http://localhost:3900 npx playwright test e2e/acceptance/safedon-eg.spec.ts --project=ipad-portrait
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

/** Marks the inspections this spec creates, so a run that died is cleaned up by the next. */
const MARKER = "E2E acceptance run (e2e/acceptance/safedon-eg.spec.ts): deleted after the run.";
const INSPECTION_URL = /\/inspections\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/;

/** The SAFEDON_EG client and the example's manufacturer: supabase/seed.sql rows (fixed ids). */
const SEED = {
  client: "20000000-0000-4000-8000-000000000001",
  manufacturer: "10000000-0000-4000-8000-000000000001",
} as const;

let admin: AdminClient;
/** Their names as the app shows them, read from the database. */
let names = { client: "", manufacturer: "" };
let inspectorCookies: { name: string; value: string }[];
let inspectionId: string | null = null;
let refNo = "";

/** Inspections of the test inspector that an earlier run of this spec left behind. */
async function leftovers(): Promise<string[]> {
  const { data: inspector, error } = await admin.from("profiles").select("id").eq("email", TEST_ACCOUNTS.inspector).single();
  if (error) throw new Error(`Finding the test inspector: ${error.message}`);
  const { data, error: findError } = await admin
    .from("inspections")
    .select("id, data")
    .eq("inspector_id", inspector.id)
    .eq("product_name", REPORT.header.productName);
  if (findError) throw new Error(`Finding leftovers: ${findError.message}`);
  return data
    .filter((row) => (row.data as { modules?: { header?: { comment?: string } } })?.modules?.header?.comment === MARKER)
    .map((row) => row.id);
}

test.beforeAll(async () => {
  test.skip(test.info().project.name !== "ipad-portrait", "Entered on the iPad in portrait: one project (e2e/README.md).");
  admin = createTestAdminClient();
  const [client, manufacturer] = await Promise.all([
    admin.from("clients").select("name").eq("id", SEED.client).single(),
    admin.from("manufacturers").select("name").eq("id", SEED.manufacturer).single(),
  ]);
  if (client.error || manufacturer.error) throw new Error("The seed client and manufacturer are missing (supabase/seed.sql).");
  names = { client: client.data.name, manufacturer: manufacturer.data.name };
  for (const id of await leftovers()) await removeInspection(admin, id);
  // One sign-in for every test of the run: Supabase limits sign-ins per address.
  inspectorCookies = await sessionCookies(TEST_ACCOUNTS.inspector);
});

test.afterAll(async () => {
  if (inspectionId) await removeInspection(admin, inspectionId);
});

async function asInspector(page: Page, baseURL: string | undefined) {
  await page.context().addCookies(inspectorCookies.map((cookie) => ({ ...cookie, url: baseURL! })));
}

/** Opens the inspection's capture screen once it has hydrated and saved. */
async function openCapture(page: Page, baseURL: string | undefined) {
  await asInspector(page, baseURL);
  await page.goto(`/inspections/${inspectionId}`);
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");
  // The pill is in the server's HTML: an editable field means the page has hydrated and the autosave runs.
  await expect(frame(page).locator("input:visible, textarea:visible").first()).toBeEditable();
}

/** 44 px touch targets on the iPad (docs/DESIGN.md). */
async function expectTouchTarget(locator: Locator) {
  const box = await locator.boundingBox();
  expect(box, "the control is on screen").not.toBeNull();
  expect(box!.height, `${await locator.getAttribute("aria-label") ?? await locator.textContent()} is 44 px tall`).toBeGreaterThanOrEqual(44);
}

/**
 * A section's own header, by its module key: its title, result pill and the
 * result's summary (the order's page has two frames: e2e/README.md).
 */
function frameHeader(page: Page, key: string): Locator {
  return frame(page, key).locator(":scope > header");
}

/** A section's result pill in its frame header ("Passed", "Warning", "Info", "Not Done"). */
function sectionStatus(page: Page, key: string): Locator {
  return frameHeader(page, key).locator("[data-slot='status-pill']");
}

/** A table row by its exact accessible name (the row header and its visible cells), the template's words in any case. */
function row(scope: Locator, name: string): Locator {
  return scope.getByRole("row", { name: named(name) });
}

/** The measurement grid's footer rows of the size on screen: Average, Spec., A / Rej. */
function dimensionFooter(page: Page, index: 0 | 1 | 2): Locator {
  return frame(page, "dimensions").locator('[data-slot="measurement-grid"] tfoot tr').nth(index).locator("td");
}

/* ------------------------------------------------------------------ *
 * Capture, section by section
 * ------------------------------------------------------------------ */

test("the inspector starts it on /inspections/new: the SAFEDON_EG client at the example's manufacturer, examination gloves, picks SAFEDON_EG", async ({
  page,
  baseURL,
}) => {
  await asInspector(page, baseURL);
  await page.goto("/inspections/new");
  const choose = async (label: string, option: string) => {
    await press(page.getByRole("combobox", { name: label }));
    await press(page.getByRole("option", { name: option, exact: true }));
    await expect(page.getByRole("combobox", { name: label })).toHaveText(option);
  };
  await choose("Client", names.client);
  await choose("Manufacturer", names.manufacturer);
  await press(page.getByRole("radio", { name: /^Examination Gloves/ }));

  // The client's own template wins (BUILD_SPEC 4.4): the live, active version.
  const { data: live, error } = await admin.from("templates").select("id, version").eq("code", "SAFEDON_EG").eq("status", "active").single();
  if (error) throw new Error(`Finding the active SAFEDON_EG: ${error.message}`);
  const chosen = page.getByTestId("chosen-template");
  await expect(chosen).toHaveAttribute("data-code", "SAFEDON_EG");
  await expect(chosen).toContainText(`SAFEDON_EG Version ${live.version} · ASTM D6319`);
  await expect(chosen).toContainText("XS, S, M, L, XL (pieces)");
  await expect(page.getByTestId("choice-reason")).toHaveText(`For ${names.client}`);
  // Start Blank is chosen when there are earlier inspections to copy from; with none, the card says so.
  const startBlank = page.getByRole("radio", { name: "Start Blank" });
  const noneEarlier = page.getByText(/^No earlier inspections of yours for this client/);
  await expect(startBlank.or(noneEarlier)).toBeVisible();
  if (await startBlank.isVisible()) await expect(startBlank).toBeChecked();
  await page.getByRole("textbox", { name: /Product Name/ }).fill(HEADER.productName);
  await shot(page, "01-new");
  await press(page.getByRole("button", { name: "Create Inspection" }));

  await expect(page).toHaveURL(INSPECTION_URL, { timeout: 90_000 });
  inspectionId = INSPECTION_URL.exec(page.url())![1];
  // Marked at once, so a run that dies from here on is cleaned up by the next.
  await openSection(page, "header");
  await frame(page, "header").getByRole("textbox", { name: "Inspector Comment" }).fill(MARKER);
  await saved(page);
  await expectStoredModule(admin, inspectionId, "header", { comment: MARKER });

  const created = await stored(admin, inspectionId);
  expect(created).toMatchObject({
    status: "draft",
    template_id: live.id,
    client_id: SEED.client,
    manufacturer_id: SEED.manufacturer,
    product_name: HEADER.productName,
  });
  refNo = (await page.getByRole("heading", { level: 1 }).textContent())?.match(/INS-\d{4}-\d+/)?.[0] ?? "";
  expect(refNo).not.toBe("");
  // The capture header is short: the client and manufacturer on one line, Back on the right of the actions.
  await expect(page.locator("main p").filter({ hasText: names.client }).first()).toHaveText(
    new RegExp(`^${escapeRegExp(names.client)}\\s*·\\s*${escapeRegExp(names.manufacturer)}$`),
  );
  const back = await page.getByRole("link", { name: "Back to Inspections" }).boundingBox();
  const submit = await page.getByRole("button", { name: "Submit", exact: true }).boundingBox();
  expect(back!.x).toBeGreaterThan(submit!.x + submit!.width);
  await expect(page.getByRole("tablist", { name: "Sections" })).toBeVisible();
  // A tab per page: SAFEDON_EG's 14 modules and 2 custom sections, packing configuration on the order's tab.
  await expect(page.getByRole("tablist", { name: "Sections" }).getByRole("tab")).toHaveCount(15);
  await expect(sectionTab(page, "packing_config")).toHaveAttribute("data-section", "order_lots");
});

test("Manufacturer Information and Glove Information: the inspector is recorded, dates come from pickers", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await enterHeader(page);
  const section = frame(page, "header");
  await expect(section.getByRole("region", { name: "From the inspection" })).toContainText(names.manufacturer);
  await expect(section.getByRole("region", { name: "From the inspection" })).toContainText("Test Inspector");
  await expect(section.getByText("The inspector is recorded automatically.")).toBeVisible();
  await expect(section.getByRole("combobox", { name: "Manufacturing Date: month" })).toHaveText("Feb");
  await expect(section.getByRole("combobox", { name: "Expiry Date: year" })).toHaveText("2030");
  await saved(page);
  await expect(sectionStatus(page, "header")).toHaveText("Info");
  await expectNoPageScroll(page);
  await shot(page, "02-header", { parts: 2 });

  await enterGloveInfo(page);
  await saved(page);
  await expectStoredModule(admin, inspectionId!, "header", EXPECTED_DATA.header);
  await expectStoredModule(admin, inspectionId!, "glove_info", EXPECTED_DATA.glove_info);
  expect(await stored(admin, inspectionId!)).toMatchObject({ po_no: HEADER.poNo, inspection_date: HEADER.inspectionDate });
});

test("Order and Packing: Totals 1,530 cartons, 3,060,000 gloves", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await enterOrder(page);
  // Below the order, on the same page (its tab is the order's): no tab to change.
  await enterPacking(page);
  await saved(page);
  await expect(sectionTab(page, "order_lots")).toHaveAttribute("aria-selected", "true");
  const order = frame(page, "order_lots");
  const packing = frame(page, "packing_config");

  // Packing: 125 x 16 = 2,000 gloves per case, as printed; its own result in its own frame.
  await expect(packing.getByRole("definition")).toHaveText("2,000");
  await expect(sectionStatus(page, "packing_config")).toHaveText("Info");

  // The order's totals, on the page the gloves per case were typed on.
  await expect(order.getByRole("definition")).toHaveText([grouped(EXPECTED.totals.cartons), grouped(EXPECTED.totals.gloves)]);
  await expect(frameHeader(page, "order_lots")).toContainText(
    `Total # Carton ${grouped(EXPECTED.totals.cartons)}; Total # Gloves ${grouped(EXPECTED.totals.gloves)}.`,
    { ignoreCase: true },
  );
  await expect(sectionStatus(page, "order_lots")).toHaveText("Info");
  // The lot of each size in gloves: the sampling notice's lot sizes.
  for (const size of SIZES) {
    await expect(order.getByRole("row", { name: new RegExp(`^${size} `) })).toContainText(grouped(EXPECTED.sampling[size]!.lotGloves));
  }
  // XL was not ordered: nothing in its row, and no module shows it (6.2 rule 4).
  await expect(order.getByRole("textbox", { name: named("Qty (Cases), Size XL") })).toHaveValue("");
  await expectNoPageScroll(page);
  await shot(page, "03-order-totals", { parts: 3 });
  await expectStoredModule(admin, inspectionId!, "order_lots", EXPECTED_DATA.order_lots);
  await expectStoredModule(admin, inspectionId!, "packing_config", EXPECTED_DATA.packing_config);
  expect((await stored(admin, inspectionId!)).lot_numbers).toEqual(["LOT-B01", "LOT-B02", "LOT-B03", "LOT-B04"]);
});

test("Sampling Plan: with inspection level I, 80 and 200 gloves are flagged below the plan (XS and L need 200, S and M 500)", async ({
  page,
  baseURL,
}) => {
  await openCapture(page, baseURL);
  await enterSampling(page);
  await saved(page);
  const section = frame(page, "sampling_plan");
  await expect(sectionStatus(page, "sampling_plan")).toHaveText("Warning");
  // Only the sizes ordered have tabs.
  await expect(section.locator('[role="tab"][data-size]')).toHaveCount(SIZES.length);
  for (const size of SIZES) {
    const notice = EXPECTED.sampling[size]!;
    await showSize(page, size);
    const facts = section.locator("dl:visible").first();
    // The template's labels, whatever their case (named).
    await expect(facts).toContainText(`Lot Size (Gloves)${grouped(notice.lotGloves)}`, { ignoreCase: true });
    await expect(facts).toContainText(`Inspection Level${notice.level}`, { ignoreCase: true });
    await expect(facts).toContainText(`Code Letter${notice.codeLetter}`, { ignoreCase: true });
    await expect(facts).toContainText(`Sample Size by Plan${notice.required}`, { ignoreCase: true });
    const warning = EXPECTED.warnings.find((issue) => issue.size === size)!;
    await expect(section.getByText(`Size ${size}, # Gloves for Watertight & Visual: ${warning.message}`)).toBeVisible();
    if (size === "XS") await shot(page, "04-sampling-xs", { parts: 2 });
  }
  await expectStoredModule(admin, inspectionId!, "sampling_plan", EXPECTED_DATA.sampling_plan);
});

test("Finished goods sampling: every size's carton list is complete, unique and in range", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await enterCartons(page);
  await saved(page);
  const section = frame(page, "carton_sampling");
  await expect(sectionStatus(page, "carton_sampling")).toHaveText("Passed");
  for (const size of SIZES) {
    await showSize(page, size);
    const cases = REPORT.sampling[size]!.cases;
    await expect(section.getByText(`Sampling Quantity ${cases} / ${cases}`)).toBeVisible();
  }
  // Size S keeps the carton that broke the rising run: unique and in range, so accepted.
  await showSize(page, "S");
  await expect(page.locator("#carton-sampling-S-6")).toHaveValue("81");
  await expect(page.locator("#carton-sampling-S-6")).not.toHaveAttribute("aria-invalid", "true");
  await shot(page, "05-cartons-s", { parts: 2 });
  await expectStoredModule(admin, inspectionId!, "carton_sampling", EXPECTED_DATA.carton_sampling);
});

test("Dimension: the five size S cells typed with a space are refused, and S stays not done until they are typed again", async ({
  page,
  baseURL,
}) => {
  await openCapture(page, baseURL);
  await enterDimensions(page, ["XS", "S"], "typed");
  // The keypad's cells at 16 px on the iPad: Safari zooms into smaller text fields.
  expect(await dimensionCell(page, "Length", 1).evaluate((cell) => getComputedStyle(cell).fontSize)).toBe("16px");
  await expectTouchTarget(dimensionCell(page, "Length", 1));
  // Still on size S, where the five cells were typed as the report has them.
  const section = frame(page, "dimensions");
  const refused = EXPECTED.rejectedInputs;
  const measureOf = (measure: string) => MEASURES.find((entry) => entry.key === (measure === "length" ? "length" : `${measure}Thickness`))!;
  for (const input of refused) {
    const measure = measureOf(input.measure);
    const cell = dimensionCell(page, measure.label, input.glove);
    await expect(cell, `${input.raw} stays on screen, refused`).toHaveValue(input.raw);
    await expect(cell).toHaveAttribute("aria-invalid", "true");
    await expect(
      section.getByRole("button", { name: `No. ${input.glove}, ${measure.label}: “${input.raw}” is not stored.`, exact: false }),
    ).toBeVisible();
  }
  await expect(section.locator('[data-slot="measurement-grid"]').getByRole("button", { name: /^No\. \d+, / })).toHaveCount(refused.length);
  // Not Done, never Passed (6.2 rule 5). Meanwhile the footer averages the readings stored so far, marked "12 of 13":
  // the report's own average over its numeric cells, never a result.
  await expect(section.locator('[role="tab"][data-size="S"]')).toHaveAccessibleName(/Not Done/);
  await expect(dimensionFooter(page, 2)).toHaveText(["Not Done", "A", "Not Done", "Not Done"]);
  await expect(dimensionFooter(page, 0).nth(0)).toContainText("12 of 13");
  await expect(dimensionFooter(page, 0).nth(2)).toContainText("11 of 13");
  await expect(dimensionFooter(page, 0).nth(3)).toContainText("11 of 13");
  await shot(page, "06-dimensions-s-refused", { parts: 3 });

  await enterDimensions(page, ["M", "L"], "typed");
  await saved(page);
  await expect(sectionStatus(page, "dimensions")).toHaveText("Not Done");
  await expect(frameHeader(page, "dimensions")).toContainText("Not done for size S.");
  // Text is never stored (6.2 rule 1): the five cells are empty in the data.
  await expect
    .poll(async () => {
      const dimensions = (await stored(admin, inspectionId!)).data.modules.dimensions as {
        sizes: Record<string, { gloves: Record<string, number | null>[] }>;
      };
      return refused.map((input) => dimensions.sizes.S.gloves[input.glove - 1][measureOf(input.measure).key]);
    })
    .toEqual(refused.map(() => null));
  // Back on S after the other sizes: still not done, 12 of 13 lengths.
  await showSize(page, "S");
  await expect(dimensionFooter(page, 2)).toHaveText(["Not Done", "A", "Not Done", "Not Done"]);
  await expect(dimensionFooter(page, 0).nth(0)).toContainText("12 of 13");
});

test("Dimension averages: typed again correctly, every size passes at the expected averages", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await correctTextCells(page);
  await saved(page);
  const section = frame(page, "dimensions");
  await expect(sectionStatus(page, "dimensions")).toHaveText("Passed");
  for (const size of SIZES) {
    const expected = EXPECTED.dimensions[size]!;
    await showSize(page, size);
    await expect(section.locator(`[role="tab"][data-size="${size}"]`)).toHaveAccessibleName(/Passed/);
    // The expected averages at the report's printed precision (template decimals: 0 for mm, 2 for thickness).
    await expect(dimensionFooter(page, 0)).toHaveText(
      (["length", "width", "finger", "palm"] as const).map((measure) => shownAverage(expected.average[measure]!, measure)),
    );
    await expect(dimensionFooter(page, 2)).toHaveText(["A", "A", "A", "A"]);
    if (size === "S") await shot(page, "07-dimensions-s-corrected", { parts: 3 });
  }
  await expectStoredModule(admin, inspectionId!, "dimensions", EXPECTED_DATA.dimensions);
});

test("Physical properties: tensile and elongation pass at ≥ 14 MPa and ≥ 500% once the lab report is attached; weight", async ({
  page,
  baseURL,
}) => {
  await openCapture(page, baseURL);
  await enterTensile(page);
  await saved(page);
  const section = frame(page, "tensile");
  await expect(sectionStatus(page, "tensile")).toHaveText("Passed");
  for (const size of SIZES) {
    const expected = EXPECTED.tensile[size]!;
    await showSize(page, size);
    await expect(section.getByRole("textbox", { name: "Tensile Strength (Average) (MPa)" })).toHaveValue(expected.tensileMPa.toFixed(2));
    await expect(section.getByRole("textbox", { name: "Elongation at Break, Average (%)" })).toHaveValue(String(expected.elongationPct));
    // Each average with its spec and verdict, the size on screen only.
    const fields = section.locator('[data-slot="number-field"]').filter({ visible: true });
    await expect(fields).toHaveCount(2);
    await expect(fields.nth(0)).toContainText(`Spec. (ASTM D6319) ≥ ${expected.minTensileMPa.toFixed(2)} MPa`);
    await expect(fields.nth(0).locator("[data-slot='status-pill']")).toHaveText("Passed");
    await expect(fields.nth(1)).toContainText(`Spec. (ASTM D6319) ≥ ${expected.minElongationPct}%`);
    await expect(fields.nth(1).locator("[data-slot='status-pill']")).toHaveText("Passed");
    await expect(section.locator(`[role="tab"][data-size="${size}"]`)).toHaveAccessibleName(/Passed/);
  }
  await expect(frameHeader(page, "tensile")).toContainText(
    SIZES.map((size) => `Size ${size}: ${EXPECTED.tensile[size]!.tensileMPa.toFixed(2)} MPa / ${EXPECTED.tensile[size]!.elongationPct}%`).join("; "),
  );
  await shot(page, "08-tensile", { parts: 2 });
  const { data: files } = await admin.from("inspection_files").select("id, module_key, kind").eq("inspection_id", inspectionId!);
  expect(files).toEqual([expect.objectContaining({ module_key: "tensile", kind: "lab_report" })]);
  await expectStoredModule(admin, inspectionId!, "tensile", { ...EXPECTED_DATA.tensile, labReport: files![0].id });

  await enterWeight(page);
  await saved(page);
  await expect(sectionStatus(page, "weight")).toHaveText("Info");
  await expectStoredModule(admin, inspectionId!, "weight", EXPECTED_DATA.weight);
});

test("Watertight: XS 1 / 80 and L 1 / 80 (glove burst) at 3 / 4, S and M 0 / 200 at 7 / 8, all pass", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await enterWatertight(page);
  await saved(page);
  const section = frame(page, "watertight");
  await expect(sectionStatus(page, "watertight")).toHaveText("Passed");
  await expect(section.getByText("Sampling Code Letter J & L · AQL 1.5")).toBeVisible();
  for (const size of SIZES) {
    const expected = EXPECTED.watertight[size]!;
    await showSize(page, size);
    await expect(row(section, `Defect Limit Accept ${expected.accept} / Reject ${expected.reject}`)).toBeVisible();
    await expect(row(section, `Total Number of Defects Found ${expected.found}`)).toBeVisible();
    await expect(row(section, "Freedom From Holes (Passed / Failed) Passed")).toBeVisible();
    if (size === "XS") {
      await shot(page, "09-watertight-xs", { parts: 2 });
      await expectTouchTarget(section.getByRole("button", { name: "Increase Finger, Size XS", exact: true }));
    }
  }
  // The total the report showed as a date (1 Jan 1980) is a count over the gloves tested.
  await expect(frameHeader(page, "watertight")).toContainText(
    `Size XS: 1 / ${EXPECTED.watertight.XS!.n} (Finger 1), Defect Limit ${EXPECTED.watertight.XS!.accept} / ${EXPECTED.watertight.XS!.reject}: Passed`,
  );
  // The hole location in the template's wording, whatever its case.
  await expect(frameHeader(page, "watertight")).toContainText(
    `size L: 1 / ${EXPECTED.watertight.L!.n} (Glove Burst 1), Defect Limit ${EXPECTED.watertight.L!.accept} / ${EXPECTED.watertight.L!.reject}: Passed`,
    { ignoreCase: true },
  );
  await expectStoredModule(admin, inspectionId!, "watertight", EXPECTED_DATA.watertight);
});

test("Visual: critical 0 at 0 / 1 (labelled critical, not 'Visual Minor'); major and minor at the limits of n 80 and n 200; all pass", async ({
  page,
  baseURL,
}) => {
  await openCapture(page, baseURL);
  await enterVisual(page);
  await saved(page);
  const section = frame(page, "visual");
  await expect(sectionStatus(page, "visual")).toHaveText("Passed");
  const headings = { critical: "Critical Defects (AQL 0.0)", major: "Major Defects (AQL 2.5)", minor: "Minor Defects (AQL 4.0)" };
  const totals = { critical: 'Total Number of "Critical Defects" Found', major: 'Total Number of "Major Defects" Found', minor: 'Total Number of "Minor Defects" Found' };
  const results = {
    critical: "Disposition - Visual Critical (Passed / Failed)",
    major: "Disposition - Visual Major (Passed / Failed)",
    minor: "Disposition - Visual Minor (Passed / Failed)",
  };
  for (const size of SIZES) {
    await showSize(page, size);
    for (const cls of ["critical", "major", "minor"] as const) {
      const expected = EXPECTED.visual[cls][size]!;
      const block = section.getByRole("region", { name: headings[cls] });
      await expect(block.getByRole("textbox", { name: /^No\. of Sample Inspected/i })).toHaveValue(String(expected.n));
      await expect(row(block, `Defect Limit Accept ${expected.accept} / Reject ${expected.reject}`)).toBeVisible();
      await expect(row(block, `${totals[cls]} ${expected.found}`)).toBeVisible();
      await expect(row(block, `${results[cls]} Passed`)).toBeVisible();
    }
    // The report printed the critical result as "Visual Minor": here it is the critical class's own.
    await expect(section.getByRole("region", { name: headings.critical }).getByText("Visual Minor")).toHaveCount(0);
    if (size === "XS") await shot(page, "10-visual-xs", { parts: 3 });
  }
  await expectStoredModule(admin, inspectionId!, "visual", EXPECTED_DATA.visual);
});

test("Glove dispensing: rates per box from the counts (XS 0.008 and 0.016), totals 3 / 625, 0 / 1,000, 11 / 1,000 and 0 / 625, all pass", async ({
  page,
  baseURL,
}) => {
  await openCapture(page, baseURL);
  await enterDispensing(page);
  await saved(page);
  const section = frame(page, "dispensing_safedon");
  await expect(sectionStatus(page, "dispensing_safedon")).toHaveText("Passed");
  await expect(section.getByText("Glove Dispensing Inspection (Sampling Code Letter C & D)")).toBeVisible();
  const sizeRate: Record<string, string> = {
    XS: "3 / 625 (0.48%)",
    S: "0 / 1,000 (0%)",
    M: "11 / 1,000 (1.1%)",
    L: "0 / 625 (0%)",
  };
  for (const size of SIZES) {
    const expected = EXPECTED.dispensing[size]!;
    await showSize(page, size);
    // Each box in turn: its defects over the 125 gloves of the pack, and the rate as the report writes it.
    for (const [index, box] of expected.boxes.entries()) {
      await press(section.getByRole("button", { name: `Count Column ${index + 1}`, exact: true }));
      await expect(section.getByText(`Box # ${box.box} · ${index + 1} / ${expected.boxes.length}`)).toBeVisible();
      await expect(row(section, `Total ${box.defects}`)).toBeVisible();
      await expect(row(section, `Defects / Gloves per Pack ${box.defects}/125`)).toBeVisible();
      await expect(row(section, `Defect Rate ${box.rate.toFixed(3)}`)).toBeVisible();
      if (size === "XS" && index === 4) await shot(page, "11-dispensing-xs-box-33", { parts: 3 });
    }
    expect(sizeRate[size]).toContain(`${expected.defects} / ${grouped(expected.gloves)} (${expected.ratePct}%)`);
    const requirement = section.getByRole("row", { name: /^Defect Rate \(%\)/i });
    await expect(requirement).toContainText(sizeRate[size]);
    await expect(requirement).toContainText(`≤ ${expected.maxRatePct}%`);
    await expect(requirement).toContainText("Passed");
    await expect(requirement).toContainText(`Boxes Tested: ${expected.boxes.length} / ${expected.boxes.length}`, { ignoreCase: true });
  }
  await expectTouchTarget(section.getByRole("textbox", { name: "Box #, No. 1", exact: true }));
  await expectStoredModule(admin, inspectionId!, "dispensing_safedon", EXPECTED_DATA.dispensing_safedon);
});

test("Labelling: 3 inner packs and 1 carton per size, 0 defects at 0 / 1, pass; Conclusion PASSED and signed", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await enterLabeling(page);
  await saved(page);
  const section = frame(page, "labeling");
  await expect(sectionStatus(page, "labeling")).toHaveText("Passed");
  for (const size of SIZES) {
    await showSize(page, size);
    for (const [level, result] of [
      ["Inner Boxes/Packs", "Disposition - Inner Box (Passed / Failed) Passed"],
      ["Carton Boxes", "Disposition - Carton Box (Passed / Failed) Passed"],
    ] as const) {
      const block = section.getByRole("region", { name: level });
      await expect(row(block, "Limit : Accept / Reject Acc. = 0 / Rej. = 1")).toBeVisible();
      await expect(row(block, "Total Number of Defects Found 0")).toBeVisible();
      await expect(row(block, result)).toBeVisible();
    }
  }
  await shot(page, "12-labeling", { parts: 2 });
  await expectStoredModule(admin, inspectionId!, "labeling", EXPECTED_DATA.labeling);

  await enterConclusion(page);
  await saved(page);
  const conclusion = frame(page, "conclusion");
  await expect(conclusion.getByRole("region", { name: "Suggested Result" }).locator("[data-slot='status-pill']")).toHaveText("Passed");
  await expect(conclusion.getByRole("region", { name: "Suggested Result" })).toContainText("Warnings: Sampling Plan.");
  await expect(conclusion.getByRole("textbox", { name: "Inspected By" })).toHaveValue("Test Inspector");
  await expect(sectionStatus(page, "conclusion")).toHaveText("Passed");
  await shot(page, "13-conclusion", { parts: 2 });
  await expectStoredModule(admin, inspectionId!, "conclusion", {
    finalResult: EXPECTED.conclusion.result,
    date: REPORT.conclusion.date.iso,
    signature: expect.objectContaining({ strokes: expect.any(Array) }),
  });
});

test("nothing typed is lost on a reload, and only the sampling warnings are pending", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await page.reload();
  await expect(savePill(page)).toHaveAttribute("data-state", "saved");
  await viewShot(page, "14-capture-after-reload");
  // The whole example as stored, every module.
  const { data } = await stored(admin, inspectionId!);
  for (const [key, expected] of Object.entries(EXPECTED_DATA)) expect(data.modules[key], key).toMatchObject(expected);

  // A sample of it back on screen after the reload.
  await openSection(page, "dimensions");
  await showSize(page, "S");
  await expect(dimensionCell(page, "Finger Thickness", 1)).toHaveValue("0.18");
  await expect(dimensionCell(page, "Length", 3)).toHaveValue("242");
  await openSection(page, "dispensing_safedon");
  await showSize(page, "XS");
  await press(frame(page, "dispensing_safedon").getByRole("button", { name: "Count Column 5", exact: true }));
  await expect(frame(page, "dispensing_safedon").getByRole("spinbutton", { name: named("No Cuff, Box 33") })).toHaveAttribute("aria-valuenow", "2");

  // Every section of the report has its result; the two onsite-form extras stay empty. A tab names
  // its page's result: packing configuration has no tab of its own (the order's tab holds it).
  const results: Record<string, RegExp> = {
    header: /Info$/,
    glove_info: /Info$/,
    order_lots: /Info$/,
    sampling_plan: /Warning$/,
    carton_sampling: /Passed$/,
    dimensions: /Passed$/,
    tensile: /Passed$/,
    weight: /Info$/,
    watertight: /Passed$/,
    visual: /Passed$/,
    dispensing_safedon: /Passed$/,
    labeling: /Passed$/,
    conclusion: /Passed$/,
  };
  for (const [key, status] of Object.entries(results)) await expect(sectionTab(page, key), key).toHaveAccessibleName(status);
  // Packing configuration's own result: its frame's pill, below the order.
  await openSection(page, "packing_config");
  await expect(sectionStatus(page, "packing_config")).toHaveText("Info");

  // Pending: one row per section, so the four sampling notices are the Sampling Plan's one row,
  // its sizes listed; nothing needed before submit. The review and the export keep each notice in full.
  const pending = page.getByRole("button", { name: /^Pending/ });
  await expect(pending).toHaveAccessibleName(/^Pending\s*: 1 to do$/);
  await press(pending);
  const sheet = page.getByRole("dialog", { name: "Pending" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator("[data-task]")).toHaveCount(1);
  await expect(sheet.locator("[data-task][data-needed]")).toHaveCount(0);
  const below = EXPECTED.warnings.map((warning) => warning.size!);
  await expect(sheet.getByRole("button", { name: `Sampling Plan: Sample below plan: ${below.slice(0, -1).join(", ")} and ${below.at(-1)}.`, exact: true })).toBeVisible();
  await viewShot(page, "15-pending");
  await page.keyboard.press("Escape");
  await expect(sheet).toBeHidden();
});

test("submit: suggested Pass, the four warnings go into the report, and the review opens", async ({ page, baseURL }) => {
  await openCapture(page, baseURL);
  await press(page.getByRole("button", { name: "Submit", exact: true }));
  const dialog = page.getByRole("alertdialog", { name: `Submit ${refNo} for Review?` });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("definition").first()).toHaveText("Passed");
  await expect(dialog.locator('[data-slot="suggested-reasons"]')).toHaveText("Warnings: Sampling Plan.");
  await expect(dialog).toContainText(`${EXPECTED.warnings.length} warnings go into the report.`);
  await viewShot(page, "16-submit");
  await press(dialog.getByRole("button", { name: "Submit for Review" }));
  await expect(page).toHaveURL(new RegExp(`/inspections/${inspectionId}/review$`), { timeout: 60_000 });
  expect(await stored(admin, inspectionId!)).toMatchObject({ status: "submitted", suggested_result: "pass", result: "pass" });
});

/* ------------------------------------------------------------------ *
 * Review
 * ------------------------------------------------------------------ */

test("the review shows every expected result, as the inspector sees it", async ({ page, baseURL }) => {
  await asInspector(page, baseURL);
  await page.goto(`/inspections/${inspectionId}/review`);
  await expectReview(page, refNo, names);
  await expectNoPageScroll(page);
  await shot(page, "17-review-inspector", { parts: 8 });

  // The export carries the same results at full precision (BUILD_SPEC 9.1).
  const response = await page.request.get(`/api/inspections/${inspectionId}/export`);
  expect(response.status()).toBe(200);
  const exported = (await response.json()) as {
    modules: { key: string; computed: Record<string, unknown>; result: { status: string }; warnings: { message: string }[] }[];
    conclusion: { suggestedResult: string; finalResult: string };
  };
  // The sampling notices go into the export with the module (BUILD_SPEC 6.2: warnings go into the export).
  const samplingWarnings = exported.modules.find((entry) => entry.key === "sampling_plan")!.warnings.map((warning) => warning.message);
  expect(samplingWarnings).toHaveLength(EXPECTED.warnings.length);
  for (const [index, warning] of EXPECTED.warnings.entries()) expect(samplingWarnings[index]).toContain(warning.message);
  const computed = (key: string) => exported.modules.find((entry) => entry.key === key)!.computed as Record<string, never>;
  expect(exported.conclusion).toMatchObject({ suggestedResult: "pass", finalResult: "pass" });
  expect(computed("order_lots")).toMatchObject({ totalCartons: EXPECTED.totals.cartons, totalGloves: EXPECTED.totals.gloves });
  for (const size of SIZES) {
    const statistic = (computed("dimensions").statistic as Record<string, Record<string, number>>)[size];
    const expected = EXPECTED.dimensions[size]!;
    const at = (value: number, decimals: number) => Number(value.toFixed(decimals));
    expect(at(statistic.length, 2), `${size} length`).toBe(expected.average.length);
    expect(at(statistic.width, 2), `${size} width`).toBe(expected.average.width);
    // Thickness from the printed readings (docs/FIXTURES.md "Printed precision"), and the expected value at 2 decimals.
    expect(at(statistic.fingerThickness, 4), `${size} finger`).toBe(expected.averageOfPrintedReadings.finger);
    expect(at(statistic.palmThickness, 4), `${size} palm`).toBe(expected.averageOfPrintedReadings.palm);
    expect(at(statistic.fingerThickness, 2)).toBe(at(expected.average.finger!, 2));
    expect(at(statistic.palmThickness, 2)).toBe(at(expected.average.palm!, 2));
    const dispensing = (computed("dispensing_safedon").sizes as Record<string, { boxes: { boxNo: number; boxDefects: number; boxRatePct: number }[]; ratePct: number }>)[size];
    expect(dispensing.boxes.map((box) => ({ box: box.boxNo, defects: box.boxDefects, rate: Number((box.boxRatePct / 100).toFixed(6)) }))).toEqual(
      EXPECTED.dispensing[size]!.boxes,
    );
    expect(dispensing.ratePct).toBe(EXPECTED.dispensing[size]!.ratePct);
  }
});

test("the admin's review shows the same results, with approve and reopen", async ({ page, baseURL }) => {
  const cookies = await sessionCookies(TEST_ACCOUNTS.admin);
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
  await page.goto(`/inspections/${inspectionId}/review`);
  await expectReview(page, refNo, names);
  await expect(page.getByRole("button", { name: /^Approve/ })).toBeVisible();
  await expectNoPageScroll(page);
  await shot(page, "18-review-admin", { parts: 8 });
});
