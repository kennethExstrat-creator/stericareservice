import { expect, test, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import { createKitFixture, CUSTOM_GRID, SAFEDON_BOXES, type KitFixture } from "./fixtures";

/**
 * The capture kit's browser-only behaviour on real module screens
 * (docs/CAPTURE_KIT.md), at the three sizes in playwright.config.ts: what a
 * paste leaves out, said on screen (across a table's foot, never in a
 * cell); a box/carton number field reporting its box
 * as it takes the focus; Safedon's box switcher at its ends; the focus after a one-off row
 * comes off; the tag lines of documents and loading; and a read-only grid
 * refusing pastes and typing while its keys still move. The rules behind
 * them have unit tests in components/qc. One temporary template and
 * inspection per project (fixtures.ts); the tests run in order on it.
 * Screenshots go to screenshots/glue/.
 */

// The Mac running these is shared with other builds: generous waits, never sleeps.
test.describe.configure({ mode: "serial", timeout: 120_000 });

let fixture: KitFixture;

test.beforeAll(async () => {
  fixture = await createKitFixture();
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

function isDesktop() {
  return test.info().project.name === "desktop";
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled to `at`.
 */
async function shot(page: Page, name: string, at?: Locator) {
  const path = `screenshots/glue/${test.info().project.name}-kit-${name}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  if (!isTouch()) {
    await page.screenshot({ ...options, path, fullPage: true });
    return;
  }
  if (at) await at.evaluate((element) => element.scrollIntoView({ block: "center" }));
  await page.screenshot({ ...options, path });
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

let session: { name: string; value: string }[] | null = null;

/** Signs in once per project, then reuses the session (the sign-in limit: e2e/README.md). */
async function signInAs(context: BrowserContext, baseURL: string) {
  await context.clearCookies();
  session ??= await sessionCookies(TEST_ACCOUNTS.inspector);
  await context.addCookies(session.map((cookie) => ({ ...cookie, url: baseURL })));
}

/**
 * The section's frame by its key, once its module's code has loaded and the screen can be changed. By
 * its key: a page can show two frames (packing configuration below the order, e2e/README.md).
 */
async function openModule(page: Page, key: string, { editable = true }: { editable?: boolean } = {}) {
  await page.goto(`/inspections/${fixture.inspectionId}?module=${key}`);
  const frame = page.locator(`[data-section-key="${key}"]`);
  await expect(frame.getByText("Loading the form…")).toHaveCount(0);
  // Saving has started (the controls take changes) before anything is typed or tapped.
  if (editable) await expect(frame.locator('[data-slot="photo-add"]')).toBeVisible();
  return frame;
}

/** What new photos in the open section are tagged with (the photo slot's line). */
function nextTags(frame: Locator) {
  return frame.locator('[data-slot="next-tags"]');
}

/** Pastes text into an input as a spreadsheet would (a paste event with its clipboard data). */
async function paste(input: Locator, text: string): Promise<{ prevented: boolean; value: string }> {
  return input.evaluate((element, pasted) => {
    const data = new DataTransfer();
    data.setData("text/plain", pasted);
    const event = new ClipboardEvent("paste", { clipboardData: data, bubbles: true, cancelable: true });
    element.dispatchEvent(event);
    return { prevented: event.defaultPrevented, value: (element as HTMLInputElement).value };
  }, text);
}

/** Size M on the module's size tabs (dimensions and labelling keep tabs at every width). */
async function showSizeM(frame: Locator) {
  const tab = frame.getByRole("tab", { name: /^Size M\b/ });
  await press(tab);
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

const FIFTEEN_LENGTHS = ["244", "246", "243", "245", "247", "244", "245", "243", "246", "244", "245", "243", "246", "251", "252"];

test("a pasted column longer than the grid lists, under it, the values that did not fit", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "dimensions");
  await showSizeM(frame);
  const grid = frame.locator('[data-slot="measurement-grid"]:visible').first();
  const first = grid.getByRole("textbox", { name: "Length, No. 1", exact: true });
  await expect(first).toBeEditable();
  const rows = await grid.getByRole("textbox", { name: /^Length, No\. \d+$/ }).count();
  expect(rows).toBe(13);

  await first.focus();
  await paste(first, FIFTEEN_LENGTHS.join("\n"));
  const notice = grid.locator('[data-slot="paste-notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("2 pasted values did not fit and were not stored: “251” and “252”.");
  await expect(grid.getByRole("textbox", { name: "Length, No. 13", exact: true })).toHaveValue("246");
  if (isTouch()) expect((await notice.getByRole("button", { name: "Dismiss" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "grid-paste-did-not-fit", notice);

  // The 13 that fit are saved; the two left out are not, anywhere.
  await expect
    .poll(async () => {
      const dimensions = (await fixture.modules()).dimensions as { sizes?: Record<string, { gloves?: { length: number | null }[] }> };
      return (dimensions?.sizes?.M?.gloves ?? []).map((glove) => glove.length);
    }, { timeout: 15_000 })
    .toEqual(FIFTEEN_LENGTHS.slice(0, 13).map(Number));

  // Dismiss takes it away and puts the focus back where the paste was made.
  await press(notice.getByRole("button", { name: "Dismiss" }));
  await expect(notice).toHaveCount(0);
  await expect(first).toBeFocused();
  expect(hydration()).toEqual([]);
});

test("a grid whose module keeps a paste's overflow leaves it to the module: force at break lists the readings past its gloves", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "force_at_break");
  await showSizeM(frame);
  const grid = frame.locator('[data-slot="measurement-grid"]:visible').first();
  const first = grid.getByRole("textbox", { name: "Force at Break (N), No. 1", exact: true });
  await expect(first).toBeEditable();
  const rows = await grid.getByRole("textbox", { name: /^Force at Break \(N\), No\. \d+$/ }).count();
  const readings = Array.from({ length: rows + 2 }, (_, index) => (6.1 + index / 10).toFixed(1));
  await first.focus();
  await paste(first, readings.join("\n"));

  // Kept past the gloves tested, and said so by the module, with a way to clear them: the grid lists nothing.
  const clear = frame.getByRole("button", { name: "Clear the 2 Extra Readings" });
  await expect(clear).toBeVisible();
  await expect(frame.locator('[data-slot="size-notice"]').first()).toBeVisible();
  await expect(grid.locator('[data-slot="paste-notice"]')).toHaveCount(0);
  await shot(page, "force-at-break-kept", clear);
  const savedReadings = async () => {
    const force = (await fixture.modules()).force_at_break as { sizes?: Record<string, { values?: number[] }> };
    return force?.sizes?.M?.values?.length ?? 0;
  };
  // Saves wait for the one before them, and the shared Mac and database can be slow: generous, never sleeps.
  await expect.poll(savedReadings, { timeout: 30_000 }).toBe(rows + 2);

  // Cleared on purpose: they were stored, so the grid never lists them as values the paste lost.
  await press(clear);
  await expect(clear).toHaveCount(0);
  await expect(grid.locator('[data-slot="paste-notice"]')).toHaveCount(0);
  await expect.poll(savedReadings, { timeout: 30_000 }).toBe(rows);
  await expect(grid.locator('[data-slot="paste-notice"]')).toHaveCount(0);
  await shot(page, "force-at-break-cleared", grid);
});

test("a pasted column longer than a table of fields lists what did not fit across the table's foot", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "order_lots");
  const first = frame.getByRole("textbox", { name: "Qty (Cases), Size S", exact: true });
  await expect(first).toBeEditable();
  await first.focus();
  // Three sizes, five values: S and M, nothing for L (a blank line), and two more.
  await paste(first, "100\n200\n\n400\n500");
  const notice = frame.locator('[data-slot="enter-group"] > [data-slot="paste-notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-variant", "strip");
  await expect(notice).toContainText("2 pasted values did not fit and were not stored: “400” and “500”.");
  await shot(page, "table-paste-did-not-fit", notice);
  await press(notice.getByRole("button", { name: "Dismiss" }));
  await expect(notice).toHaveCount(0);
  await expect(first).toBeFocused();
});

test("a pasted row longer than a custom grid lists what did not fit across the table's foot, not in a cell", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!);
  const frame = await openModule(page, CUSTOM_GRID.key);
  const first = frame.getByRole("textbox", { name: "Box weight, Box 1", exact: true });
  await expect(first).toBeEditable();
  // The inner locator is looked for inside each cell.
  const cell = frame.locator("td").filter({ has: page.getByRole("textbox", { name: "Box weight, Box 1", exact: true }) });
  await expect(cell).toHaveCount(1);
  const before = (await cell.boundingBox())!;
  await first.focus();
  // Three boxes, eight values: five left out.
  await paste(first, "5.1\n5.2\n5.3\n5.4\n5.5\n5.6\n5.7\n5.8");
  const notice = frame.locator('[data-slot="enter-group"] > [data-slot="paste-notice"]');
  await expect(notice).toBeVisible();
  await expect(notice).toHaveAttribute("data-variant", "strip");
  await expect(notice).toContainText(
    "5 pasted values did not fit and were not stored: “5.4”, “5.5”, “5.6”, “5.7” and “5.8”.",
  );
  // Nothing under the field in its cell: the box's column and the row keep their size.
  await expect(frame.locator('td [data-slot="paste-notice"]')).toHaveCount(0);
  const after = (await cell.boundingBox())!;
  expect(Math.abs(after.width - before.width)).toBeLessThanOrEqual(1);
  expect(Math.abs(after.height - before.height)).toBeLessThanOrEqual(1);
  if (isTouch()) expect((await notice.getByRole("button", { name: "Dismiss" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "custom-grid-paste-did-not-fit", notice);

  // The three that fit are saved.
  await expect
    .poll(async () => ((await fixture.custom())[CUSTOM_GRID.key] as { boxWeight?: unknown[] } | undefined)?.boxWeight, {
      timeout: 15_000,
    })
    .toEqual([5.1, 5.2, 5.3]);
  await press(notice.getByRole("button", { name: "Dismiss" }));
  await expect(notice).toHaveCount(0);
  await expect(first).toBeFocused();
});

test("a box/carton number field reports its box as it takes the focus, so photos are tagged with it", async ({
  page,
  context,
  baseURL,
}) => {
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "labeling");
  await showSizeM(frame);
  // Something else in focus first: a dispenser box check.
  await frame.getByRole("spinbutton", { name: /Dispenser Box, Size M$/ }).first().focus();
  await expect(nextTags(frame)).toContainText("Dispenser Box");
  await expect(nextTags(frame)).not.toContainText("Box/Carton #253");

  // Typed (BUILD_SPEC 6.2 rule 7): a tapped input takes the focus, on the iPad too. The kit's inspection
  // has no carton list, so the field is a plain text box with no suggestions.
  const field = frame.getByRole("textbox", { name: "Box/Carton #, No. 1, Carton Box, Size M" });
  await press(field);
  await expect(field).toBeFocused();
  await expect(field).toHaveAttribute("inputmode", "numeric");
  // The labelling level comes last in the tag line, in the template's words.
  await expect(nextTags(frame)).toHaveText("New photos are tagged Size M · Box/Carton #253 · Carton Box.");
  await shot(page, "box-number-focused", field);
});

test("Safedon's box switcher holds at either end and keeps the focus", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "dispensing_safedon");
  const switcher = frame.locator('[data-slot="column-switcher"]');
  if (isDesktop()) {
    // The desktop layout (1280 px and wider with a mouse) shows every box side by side: no switcher.
    await expect(switcher).toBeHidden();
    return;
  }
  await expect(switcher).toBeVisible();
  const previous = switcher.getByRole("button", { name: "Previous Box" });
  const next = switcher.getByRole("button", { name: "Next Box" });
  await expect(switcher).toContainText(`1 / ${SAFEDON_BOXES}`);
  await expect(previous).toHaveAttribute("aria-disabled", "true");
  await previous.focus();
  await page.keyboard.press("Enter");
  await expect(switcher).toContainText(`1 / ${SAFEDON_BOXES}`);
  await expect(previous).toBeFocused();

  await next.focus();
  for (let step = 1; step < SAFEDON_BOXES; step++) await page.keyboard.press("Enter");
  await expect(switcher).toContainText(`${SAFEDON_BOXES} / ${SAFEDON_BOXES}`);
  await expect(next).toHaveAttribute("aria-disabled", "true");
  // Past the last box: nothing moves, and the focus stays on Next.
  await page.keyboard.press("Enter");
  await expect(switcher).toContainText(`${SAFEDON_BOXES} / ${SAFEDON_BOXES}`);
  await expect(next).toBeFocused();
  await expect(previous).not.toHaveAttribute("aria-disabled", "true");
  if (isTouch()) expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(44);
  await shot(page, "switcher-at-end", switcher);
});

test("a one-off defect row taken off leaves the focus in its table", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "visual");
  // The first class's "Defect Not in the List"; while its form is open the button gives way to it.
  const add = frame.getByRole("button", { name: "Defect Not in the List" }).first();
  for (const label of ["Seam", "Tear"]) {
    await press(add);
    const field = frame.getByPlaceholder("Describe the defect");
    await field.fill(label);
    await field.press("Enter");
    await expect(frame.getByRole("button", { name: `Remove ${label}` }).first()).toBeVisible();
  }

  // With the form open (a draft in it), the row taking the removed one's place gets the focus, and the draft stays.
  await press(add);
  await frame.getByPlaceholder("Describe the defect").fill("Sea");
  await press(frame.getByRole("button", { name: "Remove Seam" }).first());
  await expect(frame.getByRole("button", { name: "Remove Seam" })).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Tear, Size [SM]$/);
  await expect(frame.getByPlaceholder("Describe the defect")).toHaveValue("Sea");
  await press(frame.getByRole("button", { name: "Cancel" }));
  await expect(frame.getByPlaceholder("Describe the defect")).toHaveCount(0);

  // With the form closed, the focus goes to its button.
  await press(frame.getByRole("button", { name: "Remove Tear" }).first());
  await expect(frame.getByRole("button", { name: "Remove Tear" })).toHaveCount(0);
  await expect(add).toBeFocused();
  await shot(page, "one-off-removed", add);
  await expect
    .poll(async () => JSON.stringify((await fixture.modules()).visual ?? {}), { timeout: 15_000 })
    .not.toMatch(/Seam|Tear/);
});

test("documents and loading say what new photos are tagged with", async ({ page, context, baseURL }) => {
  await signInAs(context, baseURL!);
  let frame = await openModule(page, "documents");
  const line = frame.locator('[data-slot="document-tags"]');
  await expect(line).toHaveText("Choose a document above first: its photos are then tagged with it, and its file filed under it.");
  const row = frame.locator("li[data-issue-path]").first();
  const name = (await row.locator("p").first().innerText()).trim();
  await press(row.getByRole("radio").first());
  await expect(line).toHaveText(`New photos are tagged “${name}”, and new files are filed under it.`);
  await expect(nextTags(frame)).toHaveText(`New photos are tagged ${name}.`);
  await shot(page, "documents-tag-line", line);

  frame = await openModule(page, "loading");
  const stages = frame.getByRole("radiogroup", { name: "Loading Stage" });
  const section = frame.getByRole("region", { name: "Loading Stage" });
  await expect(section).toContainText("Pick the stage before taking its photos, so each photo is tagged with it.");
  await press(stages.getByRole("radio", { name: "Doors Closed" }));
  await expect(section).toContainText("Photos taken now are tagged “Doors Closed”.");
  await expect(nextTags(frame)).toHaveText("New photos are tagged Doors Closed.");
  await shot(page, "loading-tag-line", section);
});

test("a read-only grid refuses a paste and typing, and its keys still move", async ({ page, context, baseURL }) => {
  await fixture.setStatus("submitted");
  await signInAs(context, baseURL!);
  const frame = await openModule(page, "dimensions", { editable: false });
  await expect(page.getByText("Submitted for review: read-only.")).toBeVisible();
  await showSizeM(frame);
  const grid = frame.locator('[data-slot="measurement-grid"]:visible').first();
  await expect(grid).toHaveAttribute("data-readonly", "true");
  const first = grid.getByRole("textbox", { name: "Length, No. 1", exact: true });
  const before = JSON.stringify((await fixture.modules()).dimensions);

  await first.focus();
  await page.keyboard.type("9");
  await expect(first).toHaveValue("244");
  const pasted = await paste(first, "1\n2\n3");
  expect(pasted).toEqual({ prevented: true, value: "244" });
  await expect(grid.locator('[data-slot="paste-notice"]')).toHaveCount(0);
  await page.keyboard.press("ArrowDown");
  await expect(grid.getByRole("textbox", { name: "Length, No. 2", exact: true })).toBeFocused();
  await expect(grid.getByRole("textbox", { name: "Length, No. 2", exact: true })).toHaveValue("246");
  await shot(page, "read-only-grid", grid);
  expect(JSON.stringify((await fixture.modules()).dimensions)).toBe(before);
});
