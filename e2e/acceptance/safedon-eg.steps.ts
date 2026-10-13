import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  cartonList,
  intendedValue,
  isTextCell,
  SAFEDON_DEFECTS,
  SAFEDON_EG_EXAMPLE as REPORT,
  SAFEDON_EG_EXPECTED as EXPECTED,
  type NumberCell,
  type ReportSize,
} from "../../tests/fixtures/examples";
import { labReportPdf } from "../photos/support";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";

/**
 * The SAFEDON_EG example report (tests/fixtures/examples, anonymised) typed
 * into the capture screen the way an inspector does on the iPad: numbers on
 * the keypad (box/carton numbers too, the size's sampled ones suggested),
 * counts by tapping steppers, dates from pickers, the lab report attached. Each step checks what
 * the screen shows for the rows of the expected results it can see, and
 * that the autosave stored exactly what was typed. Used by
 * safedon-eg.spec.ts; screenshots go to screenshots/acceptance/.
 */

export type AdminClient = ReturnType<typeof createTestAdminClient>;

/** The sizes the example orders, in the report's order. */
export const SIZES = REPORT.sizesOrdered as readonly ReportSize[];

const BUCKETS = ["inspection-photos", "inspection-files"] as const;

/* ------------------------------------------------------------------ *
 * Screen helpers
 * ------------------------------------------------------------------ */

export function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

/** A tap on the iPads, a click on the desktop. */
export async function press(locator: Locator): Promise<void> {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

/**
 * Viewport screenshots, scrolled down the page: a full-page capture drops
 * touch emulation while it resizes (e2e/README.md). name.png, or name-1.png,
 * name-2.png ... for a longer page, at most `parts`.
 */
export async function shot(page: Page, name: string, { parts: most = 6 }: { parts?: number } = {}): Promise<string> {
  const base = `screenshots/acceptance/${test.info().project.name}-safedon-${name}`;
  const options = { animations: "disabled", caret: "initial" } as const;
  await page.waitForTimeout(250);
  const { height, viewport, start } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    start: window.scrollY,
  }));
  const parts = Math.min(most, Math.max(1, Math.ceil(height / viewport)));
  for (let part = 0; part < parts; part++) {
    if (parts > 1) await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.screenshot({ ...options, path: parts > 1 ? `${base}-${part + 1}.png` : `${base}.png` });
  }
  if (parts > 1) await page.evaluate((top) => window.scrollTo(0, top), start);
  return parts > 1 ? `${base}-1.png ... -${parts}.png` : `${base}.png`;
}

/** A screenshot of what is on screen now, for a dialog or one table in view. */
export async function viewShot(page: Page, name: string): Promise<string> {
  const path = `screenshots/acceptance/${test.info().project.name}-safedon-${name}.png`;
  await page.waitForTimeout(250);
  await page.screenshot({ path, animations: "disabled", caret: "initial" });
  return path;
}

/**
 * A section's frame by its module key; without one, the open page's frame.
 * The order's page shows two (packing configuration below the order,
 * lib/inspections/capture/sections.ts SHOWN_WITH): a frame there is found by
 * its key (e2e/README.md).
 */
export function frame(page: Page, key?: string): Locator {
  return page.locator(key ? `[data-section-key="${key}"]` : '[data-slot="section-frame"]');
}

/** The save pill on screen: the section bar's below 1280 px. */
export function savePill(page: Page): Locator {
  return page.locator('[data-slot="save-status"]:visible');
}

/** Text matched literally inside a RegExp. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * An accessible name that is exactly `text`, whatever its case: the
 * template's wording. The seed SAFEDON_EG words its titles and labels in
 * Title Case (lib/templates/definitions); the live one may still have the
 * report's case until it is seeded again.
 */
export function named(text: string): RegExp {
  return new RegExp(`^${escapeRegExp(text)}$`, "i");
}

/** Opens the page a section is on from the tab bar, by the section's key, and waits for its form. */
export async function openSection(page: Page, key: string): Promise<void> {
  const tab = sectionTab(page, key);
  if ((await tab.getAttribute("aria-selected")) !== "true") await press(tab);
  await expect(tab).toHaveAttribute("aria-selected", "true");
  await expect(frame(page, key).getByText("Loading the form…")).toHaveCount(0);
  await expect(frame(page, key).locator("h2")).toBeVisible();
}

/**
 * The tab of the page a section is on, found by the section's key: the tab
 * reads the page's short name (docs/DESIGN.md, Step Names) and result.
 * Packing configuration's is the order's ([data-sections] lists every
 * section on a page).
 */
export function sectionTab(page: Page, key: string): Locator {
  return page.getByRole("tablist", { name: "Sections" }).locator(`[role="tab"][data-sections~="${key}"]`);
}

/** Turns the open section's size tabs to `size`. */
export async function showSize(page: Page, size: string): Promise<void> {
  const tab = frame(page).locator(`[role="tab"][data-size="${size}"]`).first();
  if ((await tab.getAttribute("aria-selected")) !== "true") await press(tab);
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/** Types a number into a numeric field or cell and commits it with Enter (the keypad's Next). */
export async function typeNumber(field: Locator, value: number | string): Promise<void> {
  await expect(field).toBeEditable();
  await field.fill(String(value));
  await field.press("Enter");
}

/** Waits for the autosave to settle on Saved. */
export async function saved(page: Page): Promise<void> {
  await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
}

/** The inspection as stored, read with the secret key (setup and checks of storage only). */
export async function stored(admin: AdminClient, inspectionId: string) {
  const { data, error } = await admin
    .from("inspections")
    .select("status, data, po_no, product_name, lot_numbers, inspection_date, suggested_result, result, remarks, template_id, client_id, manufacturer_id")
    .eq("id", inspectionId)
    .single();
  if (error) throw new Error(error.message);
  return data as typeof data & { data: { modules: Record<string, unknown>; custom: Record<string, unknown> } };
}

/** Polls until the stored module data matches `expected` (a subset). */
export async function expectStoredModule(admin: AdminClient, inspectionId: string, key: string, expected: unknown): Promise<void> {
  await expect
    .poll(async () => (await stored(admin, inspectionId)).data.modules[key], { timeout: 30_000, message: `stored ${key}` })
    .toMatchObject(expected as Record<string, unknown>);
}

/* ------------------------------------------------------------------ *
 * What the example enters, as the modules store it
 * ------------------------------------------------------------------ */

/** A month the report prints as "Feb-25" is picked as month and year and stored as its first day. */
function firstOfMonth(iso: string): string {
  return iso.length === 7 ? `${iso}-01` : iso;
}

export const HEADER = {
  poNo: REPORT.header.po.printed,
  productName: REPORT.header.productName,
  inspectionDate: REPORT.header.inspectionDate.iso,
  mfgDate: firstOfMonth(REPORT.header.mfgDate.iso),
  expiryDate: firstOfMonth(REPORT.header.expiryDate.iso),
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Feb" and "2025" for 2025-02. */
function monthAndYear(iso: string): { month: string; year: string } {
  const [year, month] = iso.split("-");
  return { month: MONTHS[Number(month) - 1], year };
}

export const EXPECTED_DATA = {
  header: {
    poNo: HEADER.poNo,
    productName: HEADER.productName,
    inspectionDate: HEADER.inspectionDate,
    mfgDate: HEADER.mfgDate,
    expiryDate: HEADER.expiryDate,
  },
  glove_info: {
    surfaceTexture: REPORT.gloveInfo.surfaceTexture,
    indicativeWeight: REPORT.gloveInfo.indicativeWeightG,
    colour: REPORT.gloveInfo.colour,
    length: REPORT.gloveInfo.length,
  },
  order_lots: {
    sizes: Object.fromEntries(
      SIZES.map((size) => {
        const line = REPORT.order.lines[size]!;
        return [size, { qtyCases: line.qtyCases, lotNumbers: [...line.lots], packingSite: line.packingSite ?? null }];
      }),
    ),
  },
  packing_config: {
    glovesPerInner: REPORT.packing.glovesPerInner,
    innersPerCase: REPORT.packing.innersPerCase,
    glovesPerCase: REPORT.packing.printedGlovesPerCase,
  },
  sampling_plan: {
    sizes: Object.fromEntries(
      SIZES.map((size) => {
        const row = REPORT.sampling[size]!;
        return [
          size,
          {
            cases: row.cases,
            innerUnits: row.inners,
            gloves: row.gloves,
            glovesWatertightVisual: row.watertightVisualGloves,
            glovesDimensions: row.dimensionGloves,
            glovesPhysical: row.physicalTestGloves,
            innerUnitsDispensing: row.dispensingInners,
          },
        ];
      }),
    ),
  },
  carton_sampling: {
    sizes: Object.fromEntries(SIZES.map((size) => [size, { cartonNumbers: cartonList(REPORT.cartons[size]!) }])),
  },
  dimensions: {
    sizes: Object.fromEntries(
      SIZES.map((size) => [
        size,
        {
          gloves: REPORT.dimensions.perSize[size]!.gloves.map((row) => ({
            length: intendedValue(row[0]),
            width: intendedValue(row[1]),
            fingerThickness: intendedValue(row[2]),
            palmThickness: intendedValue(row[3]),
          })),
        },
      ]),
    ),
  },
  tensile: {
    sizes: Object.fromEntries(
      SIZES.map((size) => [
        size,
        { tensileStrength: REPORT.tensile[size]!.tensileMPa, elongationAtBreak: REPORT.tensile[size]!.elongationPct },
      ]),
    ),
  },
  weight: {
    sizes: Object.fromEntries(SIZES.map((size) => [size, { values: [...REPORT.weight[size]!.values!] }])),
  },
  watertight: {
    sizes: Object.fromEntries(
      SIZES.map((size) => {
        const entry = REPORT.watertight.perSize[size]!;
        const holes = Object.fromEntries(Object.entries(entry.holes).filter(([, count]) => (count ?? 0) > 0));
        return [size, { tested: entry.tested, holes }];
      }),
    ),
  },
  visual: {
    sizes: Object.fromEntries(
      SIZES.map((size) => [
        size,
        Object.fromEntries(
          (["critical", "major", "minor"] as const).map((cls) => [cls, { inspected: REPORT.visual[cls].perSize[size]!.inspected }]),
        ),
      ]),
    ),
  },
  dispensing_safedon: {
    sizes: Object.fromEntries(
      SIZES.map((size) => {
        const entry = REPORT.dispensingSafedon.perSize[size]!;
        return [
          size,
          {
            boxes: entry.boxes.map((boxNo, index) => ({
              boxNo,
              counts: Object.fromEntries(
                SAFEDON_DEFECTS.filter((code) => entry.counts[code][index] > 0).map((code) => [code, entry.counts[code][index]]),
              ),
            })),
          },
        ];
      }),
    ),
  },
  labeling: {
    sizes: Object.fromEntries(
      SIZES.map((size) => [
        size,
        {
          inner: { inspected: REPORT.labeling.inner.perSize[size]!.inspected },
          carton: { inspected: REPORT.labeling.carton.perSize[size]!.inspected },
        },
      ]),
    ),
  },
} as const;

/* ------------------------------------------------------------------ *
 * The sections, in report order
 * ------------------------------------------------------------------ */

/** Opens a Radix select by its trigger and picks an option. */
async function pick(page: Page, trigger: Locator, option: string): Promise<void> {
  await press(trigger);
  await press(page.getByRole("option", { name: option, exact: true }));
  await expect(trigger).toHaveText(option);
}

/** Manufacturer Information: the PO, the dates; the manufacturer and inspector come from the inspection. */
export async function enterHeader(page: Page): Promise<void> {
  await openSection(page, "header");
  const section = frame(page, "header");
  await section.getByRole("textbox", { name: "PO Number" }).fill(HEADER.poNo);
  await expect(section.getByRole("textbox", { name: "Product Name (Brand & Code)" })).toHaveValue(HEADER.productName);
  await section.getByRole("textbox", { name: "Inspection Date" }).fill(HEADER.inspectionDate);
  for (const [label, iso] of [
    ["Manufacturing Date", HEADER.mfgDate],
    ["Expiry Date", HEADER.expiryDate],
  ] as const) {
    const { month, year } = monthAndYear(iso);
    await pick(page, section.getByRole("combobox", { name: `${label}: month` }), month);
    await pick(page, section.getByRole("combobox", { name: `${label}: year` }), year);
  }
}

/** Glove Information: three texts and the indicative weight on the keypad. */
export async function enterGloveInfo(page: Page): Promise<void> {
  await openSection(page, "glove_info");
  const section = frame(page, "glove_info");
  await section.getByRole("textbox", { name: "Glove Surface Texture" }).fill(REPORT.gloveInfo.surfaceTexture);
  await typeNumber(section.getByRole("textbox", { name: "Indicative Weight (Size M)" }), REPORT.gloveInfo.indicativeWeightG);
  await section.getByRole("textbox", { name: "Glove Colour" }).fill(REPORT.gloveInfo.colour);
  await section.getByRole("textbox", { name: "Glove Length" }).fill(REPORT.gloveInfo.length);
  await section.getByRole("textbox", { name: "Glove Length" }).press("Tab");
}

/** Order: per size the quantity, its lot (added as a chip) and the packing site. */
export async function enterOrder(page: Page): Promise<void> {
  await openSection(page, "order_lots");
  const section = frame(page, "order_lots");
  for (const size of SIZES) {
    const line = REPORT.order.lines[size]!;
    await typeNumber(section.getByRole("textbox", { name: named(`Qty (Cases), Size ${size}`) }), line.qtyCases);
    for (const lot of line.lots) {
      const add = section.getByRole("textbox", { name: `Lot Number, Size ${size}: add`, exact: true });
      await add.fill(lot);
      await add.press("Enter");
      await expect(section.getByRole("button", { name: `Remove Lot Number ${lot}, Size ${size}` })).toBeVisible();
    }
    const site = section.getByRole("textbox", { name: `Packing Site, Size ${size}`, exact: true });
    await site.fill(line.packingSite ?? "");
    await site.press("Enter");
  }
}

/**
 * Packing configuration, on the order's page below the order (its tab is
 * the order's): 125 gloves per plastic pack, 16 packs per case, 2,000 per
 * case.
 */
export async function enterPacking(page: Page): Promise<void> {
  await openSection(page, "packing_config");
  const section = frame(page, "packing_config");
  await typeNumber(section.getByRole("textbox", { name: "# Glove per Plastic Pack" }), REPORT.packing.glovesPerInner);
  await typeNumber(section.getByRole("textbox", { name: "# Packs per Case" }), REPORT.packing.innersPerCase);
  await typeNumber(section.getByRole("textbox", { name: "# Gloves per Case" }), REPORT.packing.printedGlovesPerCase);
}

/** The Sampling Plan's columns in the template's wording, with the fixture's value for each. */
const SAMPLING_COLUMNS = [
  ["Case", "cases"],
  ["Inner Pack", "inners"],
  ["Gloves", "gloves"],
  ["# Gloves for Watertight & Visual", "watertightVisualGloves"],
  ["# Gloves for Dimension", "dimensionGloves"],
  ["# Gloves for Tensile", "physicalTestGloves"],
  ["# Inner Packs for Packaging & Dispensing Inspection", "dispensingInners"],
] as const;

/** Sampling Plan: per size tab, the seven counts. */
export async function enterSampling(page: Page): Promise<void> {
  await openSection(page, "sampling_plan");
  const section = frame(page, "sampling_plan");
  for (const size of SIZES) {
    await showSize(page, size);
    const row = REPORT.sampling[size]!;
    for (const [label, field] of SAMPLING_COLUMNS) {
      await typeNumber(section.getByRole("textbox", { name: named(`${label}, Size ${size}`) }), row[field]);
    }
  }
}

/**
 * Finished goods sampling: per size the box/carton numbers into the table's rows, in the order printed,
 * each stored with Enter, which turns the page after a page's 10th row (Kenneth, 13 October 2026).
 */
export async function enterCartons(page: Page): Promise<void> {
  await openSection(page, "carton_sampling");
  for (const size of SIZES) {
    await showSize(page, size);
    const cartons = cartonList(REPORT.cartons[size]!);
    for (const [index, carton] of cartons.entries()) {
      await typeNumber(page.locator(`#carton-sampling-${size}-${index}`), carton);
    }
  }
}

/** The dimension columns as the template names them, in the fixture's column order. */
export const MEASURES = [
  { label: "Length", key: "length" },
  { label: "Width", key: "width" },
  { label: "Finger Thickness", key: "fingerThickness" },
  { label: "Palm Thickness", key: "palmThickness" },
] as const;

/** A dimension cell of the size on screen: "Finger Thickness, No. 3". */
export function dimensionCell(page: Page, measure: string, glove: number): Locator {
  return frame(page).getByRole("textbox", { name: `${measure}, No. ${glove}`, exact: true });
}

/**
 * Dimension: 13 gloves per size, typed cell by cell. `textCells` "typed"
 * types the five size S cells as the report has them ("0 .18", "2 42"), which
 * the cells must refuse; "corrected" types the numbers meant.
 */
export async function enterDimensions(page: Page, sizes: readonly ReportSize[], textCells: "typed" | "corrected"): Promise<void> {
  await openSection(page, "dimensions");
  for (const size of sizes) {
    await showSize(page, size);
    const gloves = REPORT.dimensions.perSize[size]!.gloves;
    for (const [row, cells] of gloves.entries()) {
      for (const [column, measure] of MEASURES.entries()) {
        const cell: NumberCell = cells[column];
        const text = isTextCell(cell) ? (textCells === "typed" ? cell.raw : String(cell.intended)) : String(cell);
        await typeNumber(dimensionCell(page, measure.label, row + 1), text);
      }
    }
  }
}

/** The five text cells only, typed again as the numbers meant. */
export async function correctTextCells(page: Page): Promise<void> {
  await openSection(page, "dimensions");
  await showSize(page, "S");
  for (const [row, cells] of REPORT.dimensions.perSize.S!.gloves.entries()) {
    for (const [column, measure] of MEASURES.entries()) {
      const cell = cells[column];
      if (isTextCell(cell)) await typeNumber(dimensionCell(page, measure.label, row + 1), cell.intended);
    }
  }
}

/** Physical properties: the lab report attached, then per size its two averages. */
export async function enterTensile(page: Page): Promise<void> {
  await openSection(page, "tensile");
  const section = frame(page, "tensile");
  const slot = section.locator('[data-slot="file-slot"][data-module="tensile"]');
  await slot.locator("input[data-file-input]").setInputFiles({
    name: "safedon-tensile-lab-report.pdf",
    mimeType: "application/pdf",
    buffer: labReportPdf(),
  });
  await expect(slot.locator('[data-slot="file-row"][data-upload-state="uploaded"]')).toHaveCount(1, { timeout: 60_000 });
  await expect(section.locator('[data-slot="lab-report"]')).toContainText("Attached");
  for (const size of SIZES) {
    await showSize(page, size);
    const entry = REPORT.tensile[size]!;
    await typeNumber(section.getByRole("textbox", { name: "Tensile Strength (Average) (MPa)" }), entry.tensileMPa);
    await typeNumber(section.getByRole("textbox", { name: "Elongation at Break, Average (%)" }), entry.elongationPct);
  }
}

/** Weight: one value per size, a column of the sizes. */
export async function enterWeight(page: Page): Promise<void> {
  await openSection(page, "weight");
  for (const size of SIZES) {
    await typeNumber(frame(page, "weight").getByRole("textbox", { name: `Weight (g), Size ${size}`, exact: true }), REPORT.weight[size]!.values![0]);
  }
}

/** The watertight hole locations as the report prints them; the template words them in Title Case (named). */
const HOLE_LABEL = Object.fromEntries(REPORT.watertight.rows.map((row) => [row.code, row.label]));

/** Watertight: per size the gloves tested from the sampling plan (one tap), then the holes tapped in. */
export async function enterWatertight(page: Page): Promise<void> {
  await openSection(page, "watertight");
  const section = frame(page, "watertight");
  for (const size of SIZES) {
    await showSize(page, size);
    const entry = REPORT.watertight.perSize[size]!;
    await press(section.getByRole("button", { name: `Use ${entry.tested} for size ${size}`, exact: true }));
    // ", Size XS" is screen-reader text beside the label: Chromium names it with a space before the comma.
    await expect(section.getByRole("textbox", { name: new RegExp(`^No\\. of Sample Tested ?, Size ${size}$`, "i") })).toHaveValue(
      String(entry.tested),
    );
    for (const [code, count] of Object.entries(entry.holes)) {
      for (let tap = 0; tap < (count ?? 0); tap++) {
        await press(section.getByRole("button", { name: named(`Increase ${HOLE_LABEL[code]}, Size ${size}`) }));
      }
      await expect(section.getByRole("spinbutton", { name: named(`${HOLE_LABEL[code]}, Size ${size}`) })).toHaveAttribute(
        "aria-valuenow",
        String(count),
      );
    }
  }
}

/** Visual: per size the gloves inspected for every class from the sampling plan (one tap); no defects. */
export async function enterVisual(page: Page): Promise<void> {
  await openSection(page, "visual");
  const section = frame(page, "visual");
  for (const size of SIZES) {
    await showSize(page, size);
    const inspected = REPORT.visual.critical.perSize[size]!.inspected;
    await press(section.getByRole("button", { name: `Use ${inspected} for Every Class of size ${size}`, exact: true }));
  }
}

/** The Safedon dispensing defects as the report prints them; the template words them in Title Case (named). */
const SAFEDON_LABEL = Object.fromEntries(REPORT.dispensingSafedon.rows.map((row) => [row.code, row.label]));

/**
 * Glove dispensing: per size, each box's box/carton number typed on the
 * numeric keypad (one of the size's sampled carton numbers, suggested as it
 * is typed: BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026), then its
 * defects tapped in; on the iPad one box shows at a time. Enter with no
 * suggestion chosen stores what was typed.
 */
export async function enterDispensing(page: Page): Promise<void> {
  await openSection(page, "dispensing_safedon");
  const section = frame(page, "dispensing_safedon");
  for (const size of SIZES) {
    await showSize(page, size);
    const entry = REPORT.dispensingSafedon.perSize[size]!;
    for (const [index, boxNo] of entry.boxes.entries()) {
      // By its name: a combobox while the size has sampled numbers to suggest, else a text box.
      const field = section.getByLabel(`Box/Carton #, No. ${index + 1}`, { exact: true });
      await press(field);
      await page.keyboard.type(String(boxNo));
      await page.keyboard.press("Enter");
      await expect(field).toHaveValue(String(boxNo));
      for (const code of SAFEDON_DEFECTS) {
        const count = entry.counts[code][index];
        for (let tap = 0; tap < count; tap++) {
          await press(section.getByRole("button", { name: named(`Increase ${SAFEDON_LABEL[code]}, Box/Carton #${boxNo}`) }));
        }
        if (count > 0) {
          await expect(section.getByRole("spinbutton", { name: named(`${SAFEDON_LABEL[code]}, Box/Carton #${boxNo}`) })).toHaveAttribute(
            "aria-valuenow",
            String(count),
          );
        }
      }
    }
  }
}

/** Packaging labelling: per size, the planned boxes recorded at both levels (3 inner packs, 1 carton); no defects. */
export async function enterLabeling(page: Page): Promise<void> {
  await openSection(page, "labeling");
  const section = frame(page, "labeling");
  for (const size of SIZES) {
    await showSize(page, size);
    const inner = REPORT.labeling.inner.perSize[size]!.inspected;
    const carton = REPORT.labeling.carton.perSize[size]!.inspected;
    await press(section.getByRole("button", { name: `Record ${inner} boxes inspected: Inner Boxes/Packs, Size ${size}`, exact: true }));
    await press(section.getByRole("button", { name: `Record ${carton} box inspected: Carton Boxes, Size ${size}`, exact: true }));
    await expect(
      section.getByRole("spinbutton", { name: named(`No. of Sampled Boxes Inspected, Inner Boxes/Packs, Size ${size}`) }),
    ).toHaveAttribute("aria-valuenow", String(inner));
    await expect(
      section.getByRole("spinbutton", { name: named(`No. of Sampled Boxes Inspected, Carton Boxes, Size ${size}`) }),
    ).toHaveAttribute("aria-valuenow", String(carton));
  }
}

/** Draws a signature on the pad, as a finger would. */
export async function sign(page: Page): Promise<void> {
  const pad = frame(page, "conclusion").locator('[data-slot="signature-pad"] svg[role="img"]');
  await pad.scrollIntoViewIfNeeded();
  const box = (await pad.boundingBox())!;
  const at = (x: number, y: number) => ({ x: box.x + box.width * x, y: box.y + box.height * y });
  const strokes = [
    [at(0.1, 0.6), at(0.2, 0.3), at(0.3, 0.65), at(0.4, 0.35), at(0.5, 0.6)],
    [at(0.55, 0.5), at(0.7, 0.4), at(0.85, 0.55)],
  ];
  for (const stroke of strokes) {
    await page.mouse.move(stroke[0].x, stroke[0].y);
    await page.mouse.down();
    for (const point of stroke.slice(1)) await page.mouse.move(point.x, point.y, { steps: 6 });
    await page.mouse.up();
  }
}

/** Conclusion: PASSED as the report concluded, its date, and the signature. */
export async function enterConclusion(page: Page): Promise<void> {
  await openSection(page, "conclusion");
  const section = frame(page, "conclusion");
  await press(section.getByRole("radio", { name: "PASSED" }));
  await expect(section.getByRole("radio", { name: "PASSED" })).toBeChecked();
  await section.getByLabel("Date", { exact: true }).fill(REPORT.conclusion.date.iso);
  await sign(page);
  await expect(section.locator('[data-slot="signature-pad"]')).toContainText("Signed by");
}

/* ------------------------------------------------------------------ *
 * The review
 * ------------------------------------------------------------------ */

/** "1,700,000" as the screens group thousands. */
export function grouped(value: number): string {
  return value.toLocaleString("en-US");
}

/** The expected average at the precision the screen prints: whole mm, thickness to 2 decimals. */
export function shownAverage(value: number, measure: string): string {
  return measure === "length" || measure === "width" ? value.toFixed(0) : value.toFixed(2);
}

/** A module's row on the review: its result pill, summary and per-size lines. */
export function moduleRow(page: Page, key: string): Locator {
  return page.locator(`li[data-module="${key}"]`);
}

export function sizeLine(page: Page, key: string, size: ReportSize): Locator {
  return moduleRow(page, key).locator(`li[data-size="${size}"]`);
}

/** Every row of expected results part A on the review screen. */
export async function expectReview(page: Page, refNo: string, names: { client: string; manufacturer: string }) {
  await expect(page.getByRole("heading", { level: 1 })).toContainText(refNo);
  const facts = page.locator('[data-slot="inspection-facts"]');
  await expect(facts).toContainText(names.client);
  await expect(facts).toContainText(names.manufacturer);
  await expect(facts).toContainText(HEADER.poNo);
  await expect(facts).toContainText(HEADER.productName);
  await expect(facts).toContainText("LOT-B01, LOT-B02, LOT-B03, LOT-B04");
  await expect(facts).toContainText("Test Inspector");
  await expect(facts).toContainText(/SAFEDON_EG Version \d+/);

  // Conclusion: pass, suggested and final.
  const verdict = page.locator("#result");
  await expect(verdict).toContainText("Suggested by the App");
  // Why, under the pill: the reasons only, never the result again.
  await expect(verdict.locator("[data-slot='suggested-reasons']")).toHaveText("Warnings: Sampling Plan.");
  // Suggested by the App, then the inspector's final result.
  await expect(verdict.locator("[data-slot='status-pill']").nth(0)).toHaveText("Passed");
  await expect(verdict.locator("[data-slot='status-pill']").nth(1)).toHaveText("Passed");
  await expect(verdict).toContainText("No errors");
  await expect(verdict).toContainText(`${EXPECTED.warnings.length} warnings`);
  await expect(verdict).toContainText("Every module is done");

  // Totals, in the template's wording whatever its case (named).
  await expect(moduleRow(page, "order_lots")).toContainText(
    `Total # Carton ${grouped(EXPECTED.totals.cartons)}; Total # Gloves ${grouped(EXPECTED.totals.gloves)}.`,
    { ignoreCase: true },
  );
  for (const size of SIZES) {
    // Watertight: the holes by the report's labels, which the template words in Title Case.
    const watertight = EXPECTED.watertight[size]!;
    const holes = Object.entries(watertight.byLocation)
      .map(([code, count]) => ` (${REPORT.watertight.rows.find((entry) => entry.code === code)!.label} ${count})`)
      .join("");
    await expect(sizeLine(page, "watertight", size)).toContainText(
      `${watertight.found} / ${watertight.n}${holes}, Defect Limit ${watertight.accept} / ${watertight.reject}: Passed.`,
      { ignoreCase: true },
    );
    // Visual: critical, major and minor at their limits.
    const { critical, major, minor } = { critical: EXPECTED.visual.critical[size]!, major: EXPECTED.visual.major[size]!, minor: EXPECTED.visual.minor[size]! };
    await expect(sizeLine(page, "visual", size)).toContainText(
      `Critical Defects ${critical.found} / ${critical.n}, Defect Limit ${critical.accept} / ${critical.reject}: Passed; ` +
        `Major Defects ${major.found} / ${major.n}, Defect Limit ${major.accept} / ${major.reject}: Passed; ` +
        `Minor Defects ${minor.found} / ${minor.n}, Defect Limit ${minor.accept} / ${minor.reject}: Passed.`,
    );
    // Dispensing.
    const dispensing = EXPECTED.dispensing[size]!;
    await expect(sizeLine(page, "dispensing_safedon", size)).toContainText(
      `${dispensing.defects} / ${grouped(dispensing.gloves)} (${dispensing.ratePct}%), max. ${dispensing.maxRatePct}%: Passed.`,
    );
    // Dimension averages at the printed precision, each accepted.
    const dimensions = EXPECTED.dimensions[size]!;
    await expect(sizeLine(page, "dimensions", size)).toContainText(
      `Average: Length ${shownAverage(dimensions.average.length!, "length")} A (≥ 230), ` +
        `Width ${shownAverage(dimensions.average.width!, "width")} A (`,
    );
    await expect(sizeLine(page, "dimensions", size)).toContainText(
      `Finger Thickness ${shownAverage(dimensions.average.finger!, "finger")} A (0.18 ± 0.04), ` +
        `Palm Thickness ${shownAverage(dimensions.average.palm!, "palm")} A (0.14 ± 0.04).`,
    );
    // Tensile and elongation.
    const tensile = EXPECTED.tensile[size]!;
    await expect(sizeLine(page, "tensile", size)).toContainText(`${tensile.tensileMPa.toFixed(2)} MPa / ${tensile.elongationPct}%`);
    // Labelling.
    const labeling = EXPECTED.labeling[size]!;
    await expect(sizeLine(page, "labeling", size)).toContainText(
      `Inner Boxes/Packs: ${labeling.inner.defects} defects in ${labeling.inner.n}; Carton Boxes: ${labeling.carton.defects} defects in ${labeling.carton.n}.`,
    );
    // Sampling notice.
    const notice = EXPECTED.sampling[size]!;
    await expect(sizeLine(page, "sampling_plan", size)).toContainText(
      `${notice.sampled} sampled, inspection level ${notice.level} needs ${notice.required} (code ${notice.codeLetter}).`,
    );
    for (const key of ["watertight", "visual", "dispensing_safedon", "dimensions", "tensile", "labeling", "carton_sampling"]) {
      await expect(sizeLine(page, key, size).locator("[data-slot='status-pill']"), `${key} ${size}`).toHaveText("Passed");
    }
    await expect(sizeLine(page, "sampling_plan", size).locator("[data-slot='status-pill']")).toHaveText("Warning");
  }
  await expect(moduleRow(page, "tensile")).toContainText("Spec. (ASTM D6319) ≥ 14.00 MPa / ≥ 500%.");
  const warnings = moduleRow(page, "sampling_plan").locator('[data-level="warning"]');
  await expect(warnings).toHaveCount(EXPECTED.warnings.length);
  for (const [index, warning] of EXPECTED.warnings.entries()) await expect(warnings.nth(index)).toContainText(warning.message);
  await expect(page.locator('[data-level="error"]')).toHaveCount(0);
  for (const key of ["carton_sampling", "dimensions", "tensile", "watertight", "visual", "dispensing_safedon", "labeling", "conclusion"]) {
    await expect(moduleRow(page, key), key).toHaveAttribute("data-status", "pass");
  }
  await expect(moduleRow(page, "conclusion")).toContainText("Conclusion: PASSED. Suggested Result: PASSED (warnings: Sampling Plan).", {
    ignoreCase: true,
  });
  // XL was not ordered: no module reports it (6.2 rule 4).
  await expect(page.locator('li[data-module] li[data-size="XL"]')).toHaveCount(0);
}

/* ------------------------------------------------------------------ *
 * Teardown
 * ------------------------------------------------------------------ */

/** The inspection's photos and files in Storage, then the inspection (e2e/README.md). */
export async function removeInspection(admin: AdminClient, inspectionId: string): Promise<void> {
  for (const bucket of BUCKETS) {
    const paths: string[] = [];
    for (const folder of [inspectionId, `${inspectionId}/thumbs`]) {
      const { data, error } = await admin.storage.from(bucket).list(folder, { limit: 1000 });
      if (error) throw new Error(`Listing ${bucket}/${folder}: ${error.message}`);
      for (const entry of data) if (entry.id) paths.push(`${folder}/${entry.name}`);
    }
    if (paths.length === 0) continue;
    const { error } = await admin.storage.from(bucket).remove(paths);
    if (error) throw new Error(`Removing ${bucket} objects of ${inspectionId}: ${error.message}`);
  }
  await deleteTestInspection(admin, inspectionId);
}
