import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  countVisibleInspections,
  createDraftWithEvidence,
  createListFixture,
  DELETE_MIGRATION,
  deleteFunctionIsLive,
  deletionRecord,
  FIXTURE_CLIENT_NAME,
  HOSTILE_PO,
  storedObjects,
  type ListFixture,
} from "./fixtures";

/**
 * /inspections (BUILD_SPEC 10) against the live project, at the four sizes
 * in playwright.config.ts. Screenshots go to screenshots/listactions/.
 *
 * Each row ends with its actions (Kenneth, 7 October 2026): Continue,
 * Review or View, and Delete on a draft. Deleting needs the database
 * function of migration 20261007151500; until a project has it, the test
 * that deletes skips and says so.
 */

/** The empty list's pointer to the button above it. */
const START_HINT = "Start one with New inspection.";
/** B's seeded manufacturer, with the factory that tells the company's plants apart. */
const TERANG_NUSA_LABEL = "Terang Nusa Sdn. Bhd. · TG Factory 40";

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page. caret "initial"
 * leaves the inputs alone: Playwright's caret hiding writes a style attribute,
 * which React would report as a hydration mismatch if it landed first.
 */
async function shot(page: Page, name: string) {
  const path = (part = "") => `screenshots/listactions/${test.info().project.name}-${name}${part}.png`;
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

function row(page: Page, ref: string) {
  return page.locator(`tbody tr[data-ref="${ref}"]`);
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

/** A name shown in full on its one line: not cut with an ellipsis. */
async function expectShownInFull(text: Locator) {
  await expect(text).toHaveCount(1);
  const cut = await text.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
  expect(cut, `${await text.textContent()} is cut off`).toBe(false);
}

/** These names show whole on their one line (24rem fits them all). */
async function expectNamesWhole(entries: [row: Locator, name: string][]) {
  for (const [inRow, name] of entries) await expectShownInFull(inRow.locator(`[title="${name}"]`));
}

/**
 * One line per row (Kenneth: one neat row each): every row as tall as the
 * line and its buttons, 36 px with a mouse and 65 px on touch (the 44 px
 * buttons and their padding), so a wrapped value (a second 24 px line)
 * would show; and no cell's text runs onto a second line.
 */
async function expectOneLineRows(page: Page) {
  const heights = await page.locator("tbody tr").evaluateAll((rows) => rows.map((tr) => tr.getBoundingClientRect().height));
  expect(heights.length).toBeGreaterThan(0);
  expect(Math.max(...heights), "the tallest row").toBeLessThanOrEqual(isTouch() ? 65 : 37);
  const wrapped = await page.locator("tbody tr").evaluateAll((rows) =>
    rows.flatMap((tr) =>
      [...tr.children].flatMap((cell) => {
        const lineHeight = Number.parseFloat(getComputedStyle(cell).lineHeight);
        const text = [...cell.querySelectorAll("span, time")].filter((el) => !el.closest(".sr-only") && el.children.length === 0);
        return text.some((el) => el.getBoundingClientRect().height > lineHeight * 1.5)
          ? [`${(tr as HTMLElement).dataset.ref} "${cell.textContent?.slice(0, 24)}"`]
          : [];
      }),
    ),
  );
  expect(wrapped, "cells whose text wraps").toEqual([]);
}

/**
 * The table scrolls inside its card, never the page, and no action's words
 * are cut. Returns the card's sideways overflow in px (0 when it all fits).
 */
async function expectScrollsInItsCard(page: Page): Promise<number> {
  await expectNoPageScroll(page);
  const cut = await page
    .locator("[data-row-action]")
    .evaluateAll((els) => els.filter((el) => el.scrollWidth > el.clientWidth + 1).map((el) => el.getAttribute("aria-label")));
  expect(cut, "actions whose words are cut").toEqual([]);
  return page.locator('[data-slot="table-scroller"]').evaluate((el) => el.scrollWidth - el.clientWidth);
}

/** A row's main action (Continue, Review or View), by its name. */
function mainAction(page: Page, ref: string, label: "Continue" | "Review" | "View") {
  return row(page, ref).getByRole("link", { name: `${label} ${ref}`, exact: true });
}

function deleteButton(page: Page, ref: string) {
  return row(page, ref).getByRole("button", { name: `Delete ${ref}`, exact: true });
}

/** 44 px and 16 px text on touch; compact 32 px with a mouse. */
async function expectActionSize(action: Locator) {
  const box = (await action.boundingBox())!;
  const fontSize = await action.evaluate((el) => getComputedStyle(el).fontSize);
  if (isTouch()) {
    expect(box.height, "touch target").toBeGreaterThanOrEqual(44);
    expect(box.width, "touch target").toBeGreaterThanOrEqual(44);
  } else {
    expect(box.height).toBe(32);
  }
  // The trash button carries an icon only; its name is for screen readers.
  if ((await action.getAttribute("data-row-action")) === "primary") expect(fontSize).toBe(isTouch() ? "16px" : "14px");
}

test("signed out, the list sends you to sign in and back", async ({ page }) => {
  await page.goto("/inspections?status=draft");
  await expect(page).toHaveURL(/\/login\?next=%2Finspections%3Fstatus%3Ddraft$/);
  await shot(page, "signed-out");
});

test.describe("before there are any inspections", () => {
  test("the inspector sees an empty list that says who sees what", async ({ page, context, baseURL }) => {
    test.skip((await countVisibleInspections("inspector")) > 0, "the shared database has inspections for this account");
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections");

    await expect(page.getByRole("heading", { level: 1, name: "Inspections" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "No inspections yet" })).toBeVisible();
    await expect(page.getByText("You see only your own; admins see everyone's.")).toBeVisible();
    await expect(page.getByText(START_HINT)).toBeVisible();
    await expect(page.getByRole("link", { name: "New inspection" })).toHaveAttribute("href", "/inspections/new");
    // Nothing to search yet, so no filter bar.
    await expect(page.getByRole("search")).toHaveCount(0);
    await expectNoPageScroll(page);
    await shot(page, "inspector-empty");
    expect(hydration()).toEqual([]);
  });

  test("the admin sees an empty list that says who sees what", async ({ page, context, baseURL }) => {
    test.skip((await countVisibleInspections("admin")) > 0, "the shared database already has inspections");
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");

    await expect(page.getByRole("heading", { name: "No inspections yet" })).toBeVisible();
    await expect(page.getByText("Inspectors see only their own.")).toBeVisible();
    await expect(page.getByText("All inspectors")).toBeVisible();
    await shot(page, "admin-empty");
  });
});

test.describe("with inspections", () => {
  let fixture: ListFixture;

  test.beforeAll(async () => {
    fixture = await createListFixture();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test("the inspector sees only their own, newest first, without an Inspector column", async ({
    page,
    context,
    baseURL,
  }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections");
    const { refs } = fixture;

    await expect(row(page, refs.B)).toBeVisible();
    await expect(row(page, refs.A)).toBeVisible();
    await expect(row(page, refs.D)).toBeVisible();
    await expect(row(page, refs.C)).toHaveCount(0);
    await expect(page.getByRole("columnheader", { name: "Inspector in charge", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(row(page, refs.A)).not.toContainText("Test Inspector");
    await expect(page.getByText("Your inspections", { exact: true })).toBeVisible();

    // Newest inspection date first: B (3 Oct), A (1 Oct), D (30 Sep).
    const order = await page.locator("tbody tr[data-ref]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-ref")));
    expect(order.indexOf(refs.B)).toBeLessThan(order.indexOf(refs.A));
    expect(order.indexOf(refs.A)).toBeLessThan(order.indexOf(refs.D));

    // The result is in its own column on the desktop and under the status on the iPad: one of them shows.
    const result = (ref: string, text: string) => row(page, ref).getByText(text, { exact: true }).filter({ visible: true });
    await expect(row(page, refs.A).getByText("Draft")).toBeVisible();
    await expect(result(refs.A, "Not done")).toBeVisible();
    await expect(row(page, refs.B).getByText("Submitted")).toBeVisible();
    await expect(result(refs.B, "Passed")).toBeVisible();
    // Approved and failed: the workflow badge never borrows the result's colour.
    await expect(row(page, refs.D).getByText("Approved")).toBeVisible();
    await expect(result(refs.D, "Failed")).toBeVisible();
    // The ref heads the row as plain text: the actions at the end open it.
    await expect(row(page, refs.B).getByRole("rowheader")).toHaveText(new RegExp(`^${refs.B}`));
    await expect(row(page, refs.B).getByRole("rowheader").getByRole("link")).toHaveCount(0);
    await expect(row(page, refs.B)).toContainText(FIXTURE_CLIENT_NAME);
    await expect(row(page, refs.B)).toContainText("3 Oct 2026", { useInnerText: true });
    // Every value in its own column at every size (the list scrolls sideways for them).
    await expect(row(page, refs.A)).toContainText("Nitrile examination gloves, blue", { useInnerText: true });
    await expect(row(page, refs.A)).toContainText("Hartalega NGC", { useInnerText: true });
    await expect(row(page, refs.A)).toContainText("E2E-LIST-PO-100", { useInnerText: true });
    await expect(row(page, refs.A)).toContainText("1 Oct 2026", { useInnerText: true });

    if (isTouch()) {
      // 44 px rows and controls, 16 px field text.
      expect((await row(page, refs.A).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await page.getByRole("combobox", { name: "Status" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await page.getByRole("link", { name: "New inspection" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const fontSize = await page.getByRole("searchbox", { name: "Search" }).evaluate((input) => getComputedStyle(input).fontSize);
      expect(fontSize).toBe("16px");
    }
    // Names show whole on one line, a long manufacturer with its factory included, at every size.
    await expectNamesWhole([
      [row(page, refs.A), FIXTURE_CLIENT_NAME],
      [row(page, refs.A), "Hartalega NGC"],
      [row(page, refs.D), "Polyco Healthline"],
      [row(page, refs.B), TERANG_NUSA_LABEL],
    ]);
    await expectOneLineRows(page);
    for (const action of [mainAction(page, refs.A, "Continue"), deleteButton(page, refs.A), mainAction(page, refs.D, "View")]) {
      await expectActionSize(action);
    }

    // Every column at every size, the PO, product and result included; the actions' column is named for screen readers.
    for (const name of ["Ref", "Date", "Client", "Manufacturer", "Product", "PO", "Status", "Result", "Actions"]) {
      await expect(page.getByRole("columnheader", { name, exact: true }), name).toHaveCount(1);
    }
    await expect(row(page, refs.A)).not.toContainText("PO E2E-LIST-PO-100", { useInnerText: true });

    await expectScrollsInItsCard(page);
    await shot(page, "inspector-list");
    expect(hydration()).toEqual([]);
  });

  test("the admin sees every inspection with the Inspector column", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");
    const { refs } = fixture;

    for (const ref of [refs.A, refs.B, refs.C, refs.D]) await expect(row(page, ref)).toBeVisible();
    // A column of its own at every size.
    await expect(page.getByRole("columnheader", { name: "Inspector in charge", exact: true })).toHaveCount(1);
    await expect(row(page, refs.A)).toContainText("Test Inspector", { useInnerText: true });
    await expect(row(page, refs.C)).toContainText("Test Admin", { useInnerText: true });
    await expect(row(page, refs.C).getByText("Reopened")).toBeVisible();
    await expect(row(page, refs.C).getByText("On hold", { exact: true }).filter({ visible: true })).toBeVisible();
    await expect(page.getByText("All inspectors")).toBeVisible();
    await expect(row(page, refs.C)).toContainText("Safedon nitrile examination gloves", { useInnerText: true });
    await expectNamesWhole([
      [row(page, refs.D), "Polyco Healthline"],
      [row(page, refs.D), "Hartalega NGC"],
      [row(page, refs.A), "Test Inspector"],
      [row(page, refs.C), "Safedon nitrile examination gloves"],
    ]);
    await expectOneLineRows(page);
    await expectScrollsInItsCard(page);
    await shot(page, "admin-list");
    expect(hydration()).toEqual([]);
  });

  test("the list scrolls sideways in its card, by touch, wheel or keys, with the ref and the actions pinned", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");
    const { refs } = fixture;
    await expect(row(page, refs.A)).toBeVisible();
    const scroller = page.locator('[data-slot="table-scroller"]');
    const hidden = await expectScrollsInItsCard(page);
    // Admins' ten columns are wider than every screen here, the 1440 px desktop with its sidebar included.
    expect(hidden, "the table is wider than its card").toBeGreaterThan(0);

    /** Where the pinned cells and a column that scrolls sit, against the card's edges. */
    const positions = () =>
      page.evaluate((ref) => {
        const card = document.querySelector('[data-slot="table-scroller"]')!.getBoundingClientRect();
        const tr = document.querySelector(`tr[data-ref="${ref}"]`)!;
        const left = tr.querySelector("th")!.getBoundingClientRect();
        const right = tr.lastElementChild!.getBoundingClientRect();
        const client = tr.children[2].getBoundingClientRect();
        return {
          refAtLeft: Math.abs(left.left - card.left) <= 2,
          actionsAtRight: Math.abs(right.right - card.right) <= 2,
          clientLeft: client.left - card.left,
        };
      }, refs.A);
    const start = await positions();
    expect(start).toMatchObject({ refAtLeft: true, actionsAtRight: true });
    await expect(scroller).toHaveAttribute("data-more", "true");
    await expect(scroller).not.toHaveAttribute("data-scrolled");
    await shot(page, "list-scroll-start");

    // Touch on the iPads (a sideways swipe on the table), the wheel with a mouse.
    const box = (await scroller.boundingBox())!;
    if (isTouch()) {
      const cdp = await page.context().newCDPSession(page);
      await cdp.send("Input.synthesizeScrollGesture", {
        x: Math.round(box.x + box.width / 2),
        y: Math.round(box.y + Math.min(box.height / 2, 120)),
        xDistance: -400,
        gestureSourceType: "touch",
        speed: 1500,
      });
    } else {
      await page.mouse.move(box.x + box.width / 2, box.y + Math.min(box.height / 2, 120));
      await page.mouse.wheel(400, 0);
    }
    await expect.poll(() => scroller.evaluate((el) => el.scrollLeft)).toBeGreaterThan(100);
    // Still on the list: a sideways swipe never turns into the browser's Back.
    await expect(page).toHaveURL(/\/inspections$/);
    const scrolled = await positions();
    expect(scrolled).toMatchObject({ refAtLeft: true, actionsAtRight: true });
    expect(scrolled.clientLeft, "the client column moved under the pinned ref").toBeLessThan(start.clientLeft - 50);
    await expect(scroller).toHaveAttribute("data-scrolled", "true");
    await shot(page, "list-scrolled");

    // The keyboard: the card takes the focus (tabindex 0), then the arrow keys scroll it both ways.
    await scroller.evaluate((el) => (el as HTMLElement).focus());
    await expect(scroller).toBeFocused();
    // Each press scrolls a little, smoothly: press until the edge is reached.
    const at = () => scroller.evaluate((el) => el.scrollLeft);
    const left = () => scroller.evaluate((el) => el.scrollWidth - el.clientWidth - el.scrollLeft);
    await expect(async () => {
      await page.keyboard.press("ArrowLeft");
      expect(await at()).toBe(0);
    }).toPass({ timeout: 20_000, intervals: [50] });
    await expect(scroller).not.toHaveAttribute("data-scrolled");
    await page.keyboard.press("ArrowRight");
    await expect.poll(at).toBeGreaterThan(0);
    await expect(async () => {
      await page.keyboard.press("ArrowRight");
      expect(await left()).toBeLessThanOrEqual(1);
    }).toPass({ timeout: 20_000, intervals: [50] });
    await expect(scroller).not.toHaveAttribute("data-more");
    expect(await positions()).toMatchObject({ refAtLeft: true, actionsAtRight: true });
    // The pinned actions still work after scrolling: Continue on A.
    await expect(mainAction(page, refs.A, "Continue")).toBeInViewport();
  });

  test("status, client and manufacturer filters narrow the list and live in the URL", async ({
    page,
    context,
    baseURL,
  }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");
    const { refs } = fixture;

    // Picked in the filter bar.
    await press(page.getByRole("combobox", { name: "Status" }));
    await press(page.getByRole("option", { name: "Reopened" }));
    await expect(page).toHaveURL(/\/inspections\?status=reopened$/);
    await expect(row(page, refs.C)).toBeVisible();
    await expect(row(page, refs.A)).toHaveCount(0);
    await expect(row(page, refs.B)).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveText("Reopened");
    // Screen readers hear the new count.
    await expect(page.locator('section[aria-label="Inspections"] [role="status"]')).toHaveText("1 inspection matches");

    await press(page.getByRole("combobox", { name: "Client" }));
    await press(page.getByRole("option", { name: FIXTURE_CLIENT_NAME }));
    await expect(page).toHaveURL(new RegExp(`status=reopened&client=${fixture.clientId}$`));
    await expect(page.getByRole("heading", { name: "No inspections match" })).toBeVisible();
    await expect(page.getByText(`status Reopened, client ${FIXTURE_CLIENT_NAME}`)).toBeVisible();
    await expect(page.locator('section[aria-label="Inspections"] [role="status"]')).toHaveText("No inspections match.");

    // A shared link opens the same view.
    await page.goto(`/inspections?client=${fixture.clientId}&manufacturer=${fixture.manufacturers.terangNusa}`);
    await expect(row(page, refs.B)).toBeVisible();
    await expect(row(page, refs.A)).toHaveCount(0);
    await expect(row(page, refs.C)).toHaveCount(0);
    await expect(page.getByRole("combobox", { name: "Client" })).toHaveText(FIXTURE_CLIENT_NAME);
    await expect(page.getByRole("combobox", { name: "Manufacturer" })).toHaveText(/Terang Nusa/);
    await shot(page, "admin-filtered");

    await press(page.getByRole("link", { name: "Clear filters" }));
    await expect(page).toHaveURL(/\/inspections$/);
    for (const ref of [refs.A, refs.B, refs.C]) await expect(row(page, ref)).toBeVisible();
  });

  test("search finds a ref, part of a PO or a whole lot number", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");
    const { refs } = fixture;
    const search = page.getByRole("searchbox", { name: "Search" });

    await search.fill(refs.A);
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`\\?q=${refs.A}$`));
    await expect(row(page, refs.A)).toBeVisible();
    await expect(row(page, refs.B)).toHaveCount(0);
    await expect(search).toHaveValue(refs.A);

    // Part of a PO, any case.
    await search.fill("list-po-3");
    await search.press("Enter");
    await expect(row(page, refs.C)).toBeVisible();
    await expect(row(page, refs.A)).toHaveCount(0);

    // A whole lot number, as typed or in lower case.
    for (const lot of ["E2E-LOT-A2", "e2e-lot-a2"]) {
      await page.goto(`/inspections?q=${lot}`);
      await expect(row(page, refs.A)).toBeVisible();
      await expect(row(page, refs.B)).toHaveCount(0);
    }
    await shot(page, "admin-search");

    // Part of a lot number is not a match: lots are matched whole.
    await page.goto("/inspections?q=E2E-LOT-A");
    await expect(page.getByRole("heading", { name: "No inspections match" })).toBeVisible();
    await expect(page.getByText("Search matches part of a ref or PO number, or a whole lot number.")).toBeVisible();
    await shot(page, "no-matches");

    await press(page.getByRole("link", { name: "Clear filters" }));
    await expect(page).toHaveURL(/\/inspections$/);
    await expect(search).toHaveValue("");
    await expect(row(page, refs.A)).toBeVisible();
  });

  test("search text with PostgREST filter syntax in it stays literal", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    const { refs } = fixture;

    // Characters in HOSTILE_PO: found literally, and only there.
    for (const text of ["%", "*", ",", "(rev.1)*%", HOSTILE_PO, HOSTILE_PO.toLowerCase()]) {
      await page.goto(`/inspections?${new URLSearchParams({ q: text })}`);
      await expect(row(page, refs.B), `search ${text}`).toBeVisible();
      await expect(row(page, refs.A), `search ${text}`).toHaveCount(0);
      await expect(row(page, refs.C), `search ${text}`).toHaveCount(0);
    }

    // Syntax that would widen or break the query if it were interpolated. The
    // last two would match C's lot if the array literal were built raw.
    for (const text of [
      "a,b",
      "),(",
      ".or(",
      "_",
      "x),status.eq.reopened,(y",
      '"),or(id.neq.0',
      "\\",
      "{E2E-LOT-C3}",
      'E2E-LOT-C3","x',
    ]) {
      await page.goto(`/inspections?${new URLSearchParams({ q: text })}`);
      await expect(page.getByRole("heading", { name: "No inspections match" }), `search ${text}`).toBeVisible();
      await expect(page.locator('[data-list-state="error"]')).toHaveCount(0);
    }
  });

  test("keyboard focus stays in the list when the control that had it goes away", async ({
    page,
    context,
    baseURL,
  }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    const { refs } = fixture;
    const search = page.getByRole("searchbox", { name: "Search" });
    const clearSearch = page.getByRole("button", { name: "Clear search" });

    // Clear search on text that never ran: the button goes, focus stays in the box.
    await page.goto("/inspections");
    await search.fill("ABC");
    await clearSearch.press("Enter");
    await expect(search).toBeFocused();
    await expect(search).toHaveValue("");
    await expect(clearSearch).toHaveCount(0);

    // Clear search after a search ran: the whole list comes back, focus stays in the box.
    await search.fill(refs.A);
    await search.press("Enter");
    await expect(page).toHaveURL(new RegExp(`\\?q=${refs.A}$`));
    await clearSearch.press("Enter");
    await expect(page).toHaveURL(/\/inspections$/);
    await expect(row(page, refs.B)).toBeVisible();
    await expect(search).toBeFocused();

    // Clear filters, above the table and in "No inspections match": ready for the next search.
    for (const filtered of ["/inspections?status=submitted", "/inspections?q=NOPE-XYZ"]) {
      await page.goto(filtered);
      await page.getByRole("link", { name: "Clear filters" }).press("Enter");
      await expect(page).toHaveURL(/\/inspections$/);
      await expect(search, filtered).toBeFocused();
    }

    // Past the end: the link goes, focus lands on the count above the table.
    await page.goto("/inspections?page=999");
    await page.getByRole("link", { name: /^Go to (the list|page \d+)$/ }).press("Enter");
    await expect(page).toHaveURL(/\/inspections(\?page=\d+)?$/);
    const count = page.locator('section[aria-label="Inspections"] [data-list-focus="results"]');
    await expect(count).toBeFocused();
    await expect(count).toHaveText(/^\d+ inspections?\b/);
    expect(hydration()).toEqual([]);
  });

  test("Clear filters also clears a search that was typed but never run", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections?status=submitted");
    const search = page.getByRole("searchbox", { name: "Search" });

    await search.fill("ABC");
    await press(page.getByRole("link", { name: "Clear filters" }));
    await expect(page).toHaveURL(/\/inspections$/);
    await expect(row(page, fixture.refs.A)).toBeVisible();
    // The box shows what the list applies: nothing.
    await expect(search).toHaveValue("");
    await expect(page.getByRole("button", { name: "Clear search" })).toHaveCount(0);
  });

  test("a link to a page past the end says so", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections?page=9");
    await expect(page.getByRole("heading", { name: "There is no page 9" })).toBeVisible();
    await shot(page, "past-the-end");

    await press(page.getByRole("link", { name: "Go to the list" }));
    await expect(page).toHaveURL(/\/inspections$/);
    await expect(row(page, fixture.refs.A)).toBeVisible();
  });

  test("invalid filters in the URL are ignored", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto(
      "/inspections?status=bogus&client=not-an-id&manufacturer=00000000-0000-4000-8000-000000000000&page=-1&q=",
    );
    await expect(row(page, fixture.refs.A)).toBeVisible();
    await expect(row(page, fixture.refs.B)).toBeVisible();
    await expect(page.getByRole("combobox", { name: "Status" })).toHaveText("All statuses");
    await expect(page.getByRole("combobox", { name: "Manufacturer" })).toHaveText("All manufacturers");
    await expect(page.getByRole("link", { name: "Clear filters" })).toHaveCount(0);
  });

  test("New inspection opens the new inspection screen", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections");
    const link = page.getByRole("link", { name: "New inspection" });

    await expect(link).toHaveAttribute("href", "/inspections/new");
    await expect(link).not.toHaveAttribute("aria-disabled");
    await press(link);
    await expect(page).toHaveURL(/\/inspections\/new$/);
    await expect(page.getByRole("heading", { level: 1, name: "New inspection" })).toBeVisible();
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  });

  test("the inspector continues a draft, views a submitted or approved one, and may delete only the draft", async ({
    page,
    context,
    baseURL,
  }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections");
    const { refs, ids } = fixture;

    // Named by what it does and the ref, for screen readers and the link list alike.
    const draft = mainAction(page, refs.A, "Continue");
    await expect(draft).toHaveAttribute("href", `/inspections/${ids.A}`);
    await expect(draft).toHaveText("Continue");
    await expect(mainAction(page, refs.B, "View")).toHaveAttribute("href", `/inspections/${ids.B}/review`);
    await expect(mainAction(page, refs.D, "View")).toHaveAttribute("href", `/inspections/${ids.D}/review`);
    // Delete on the draft only.
    await expect(deleteButton(page, refs.A)).toBeVisible();
    await expect(row(page, refs.B).getByRole("button", { name: /^Delete / })).toHaveCount(0);
    await expect(row(page, refs.D).getByRole("button", { name: /^Delete / })).toHaveCount(0);
    // One link per row, the main action; the ref is plain text.
    await expect(row(page, refs.A).getByRole("link")).toHaveCount(1);

    if (isTouch()) {
      await shot(page, "inspector-list-actions");
      await draft.tap();
    } else {
      // Keyboard: the main action, then Delete, take Tab; Enter follows the link.
      await draft.focus();
      await page.keyboard.press("Tab");
      await expect(deleteButton(page, refs.A)).toBeFocused();
      await page.keyboard.press("Shift+Tab");
      await expect(draft).toBeFocused();
      await shot(page, "inspector-list-actions");
      await page.keyboard.press("Enter");
    }
    await expect(page).toHaveURL(new RegExp(`/inspections/${ids.A}$`));
    await expect(page.getByRole("heading", { level: 1, name: refs.A })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`^${refs.A}\\b`));

    await page.goBack();
    await expect(page).toHaveURL(/\/inspections$/);
    await press(mainAction(page, refs.B, "View"));
    await expect(page).toHaveURL(new RegExp(`/inspections/${ids.B}/review$`));
    await expect(page.getByRole("heading", { level: 1, name: refs.B })).toBeVisible();
    await expect(page).toHaveTitle(new RegExp(`^Review ${refs.B}\\b`));
    expect(hydration()).toEqual([]);
  });

  test("the admin continues any open inspection, reviews a submitted one and views an approved one", async ({
    page,
    context,
    baseURL,
  }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");
    const { refs, ids } = fixture;

    // Another inspector's draft: Continue, as admins edit every open inspection, and Delete.
    await expect(mainAction(page, refs.A, "Continue")).toHaveAttribute("href", `/inspections/${ids.A}`);
    await expect(deleteButton(page, refs.A)).toBeVisible();
    await expect(mainAction(page, refs.B, "Review")).toHaveAttribute("href", `/inspections/${ids.B}/review`);
    await expect(mainAction(page, refs.C, "Continue")).toHaveAttribute("href", `/inspections/${ids.C}`);
    await expect(mainAction(page, refs.D, "View")).toHaveAttribute("href", `/inspections/${ids.D}/review`);
    // Submitted, reopened and approved inspections are records: no Delete.
    for (const ref of [refs.B, refs.C, refs.D]) {
      await expect(row(page, ref).getByRole("button", { name: /^Delete / }), ref).toHaveCount(0);
    }
    await expectActionSize(mainAction(page, refs.B, "Review"));
    await shot(page, "admin-list-actions");

    await press(mainAction(page, refs.B, "Review"));
    await expect(page).toHaveURL(new RegExp(`/inspections/${ids.B}/review$`));
    await expect(page.getByRole("heading", { level: 1, name: refs.B })).toBeVisible();

    await page.goBack();
    await press(mainAction(page, refs.C, "Continue"));
    await expect(page).toHaveURL(new RegExp(`/inspections/${ids.C}$`));
    await expect(page.getByRole("heading", { level: 1, name: refs.C })).toBeVisible();

    await page.goBack();
    await press(mainAction(page, refs.D, "View"));
    await expect(page).toHaveURL(new RegExp(`/inspections/${ids.D}/review$`));
    await expect(page.getByRole("heading", { level: 1, name: refs.D })).toBeVisible();
    expect(hydration()).toEqual([]);
  });

  test("Delete asks first, and Cancel or Escape leave the draft where it was", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections");
    const { refs } = fixture;
    const trash = deleteButton(page, refs.A);
    const dialog = page.getByRole("alertdialog");

    if (isTouch()) await trash.tap();
    else {
      await trash.focus();
      await page.keyboard.press("Enter");
    }
    await expect(dialog).toBeVisible();
    // Measured once it has zoomed in (it opens from 95%).
    await dialog.evaluate((el) => Promise.all(el.getAnimations({ subtree: true }).map((animation) => animation.finished)));
    // It names the inspection and says what goes, and that it cannot be undone.
    await expect(dialog).toHaveAccessibleName(`Delete ${refs.A}?`);
    await expect(dialog).toContainText(`${FIXTURE_CLIENT_NAME} · 1 Oct 2026`);
    await expect(dialog).toContainText("The draft is deleted with all its photos and files. This cannot be undone.");
    const cancel = dialog.getByRole("button", { name: "Cancel" });
    const confirm = dialog.getByRole("button", { name: "Delete inspection" });
    // The safe choice has focus first.
    await expect(cancel).toBeFocused();
    for (const button of [cancel, confirm]) {
      const box = (await button.boundingBox())!;
      expect(box.height).toBeGreaterThanOrEqual(isTouch() ? 44 : 32);
      expect(await button.evaluate((el) => getComputedStyle(el).fontSize)).toBe(isTouch() ? "16px" : "14px");
    }
    await shot(page, "delete-dialog");

    await press(cancel);
    await expect(dialog).toHaveCount(0);
    await expect(row(page, refs.A)).toBeVisible();
    // Focus goes back to Delete, also after a tap (Safari never focuses a tapped button itself).
    await expect(trash).toBeFocused();

    if (!isTouch()) {
      await page.keyboard.press("Enter");
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
      await expect(trash).toBeFocused();
    }

    // A dropped connection: the request never reaches the server, and the dialog says so.
    await page.route("**/inspections", (route) =>
      route.request().method() === "POST" ? route.abort("internetdisconnected") : route.continue(),
    );
    await press(trash);
    await press(confirm);
    await expect(dialog.getByRole("alert")).toHaveText(
      "The inspection was not deleted: the server could not be reached. Check the connection, then try again.",
    );
    await shot(page, "delete-dialog-unreachable");
    await page.unroute("**/inspections");
    await press(cancel);
    await expect(dialog).toHaveCount(0);

    // Nothing was deleted.
    await page.reload();
    await expect(row(page, refs.A)).toBeVisible();
    expect(hydration()).toEqual([]);
  });

  test("Delete removes a draft with its photos and files, and focus moves to the next row", async ({
    page,
    context,
    baseURL,
  }) => {
    test.skip(
      !(await deleteFunctionIsLive()),
      `Needs ${DELETE_MIGRATION} on the project; the integrator applies it after review. Until then Delete answers "not set up on the database yet".`,
    );
    const hydration = watchConsole(page);
    const draft = await createDraftWithEvidence(fixture);
    try {
      expect(await storedObjects(draft.id)).toEqual({
        photos: [...draft.objects.photos].sort(),
        files: draft.objects.files,
      });
      await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
      await page.goto("/inspections");
      const target = row(page, draft.refNo);
      await expect(target).toBeVisible();
      // Dated 2 Oct, the draft sits above A (1 Oct), so some row follows it: focus moves there.
      const next = await target.evaluate((tr) => (tr.nextElementSibling as HTMLElement | null)?.dataset.ref ?? null);
      expect(next).not.toBeNull();

      const dialog = page.getByRole("alertdialog");
      if (isTouch()) {
        await deleteButton(page, draft.refNo).tap();
        await dialog.getByRole("button", { name: "Delete inspection" }).tap();
      } else {
        await deleteButton(page, draft.refNo).focus();
        await page.keyboard.press("Enter");
        await page.keyboard.press("Tab");
        await expect(dialog.getByRole("button", { name: "Delete inspection" })).toBeFocused();
        await page.keyboard.press("Enter");
      }

      await expect(page.getByText(`${draft.refNo} deleted.`)).toBeVisible();
      await expect(dialog).toHaveCount(0);
      await expect(target).toHaveCount(0);
      await expect(row(page, next!).locator('[data-row-action="primary"]')).toBeFocused();
      await shot(page, "deleted");

      // The rows, the Storage objects, and a record that outlives them.
      const { data: still } = await createTestAdminClient().from("inspections").select("id").eq("id", draft.id);
      expect(still).toEqual([]);
      expect(await storedObjects(draft.id)).toEqual({ photos: [], files: [] });
      expect(await deletionRecord(draft.id)).toEqual([
        {
          inspection_id: null,
          actor_id: fixture.inspectorId,
          changes: expect.objectContaining({
            ref_no: draft.refNo,
            status: "draft",
            inspector_id: fixture.inspectorId,
            photos: 1,
            files: 1,
            via: "delete_draft_inspection",
          }),
        },
      ]);
      expect(hydration()).toEqual([]);
    } finally {
      await draft.cleanup();
    }
  });
});
