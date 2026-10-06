import { expect, test, type Locator, type Page } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import { countVisibleInspections, createListFixture, FIXTURE_CLIENT_NAME, HOSTILE_PO, type ListFixture } from "./fixtures";

/**
 * /inspections (BUILD_SPEC 10) against the live project, at the three sizes
 * in playwright.config.ts. Screenshots go to screenshots/list/.
 */

const HINT = "Inspection capture arrives in the next build";
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
  const path = (part = "") => `screenshots/list/${test.info().project.name}-${name}${part}.png`;
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

/** On touch nothing hovers, so a long name must show in full (up to two lines), not cut off. */
async function expectShownInFull(text: Locator) {
  await expect(text).toHaveCount(1);
  const cut = await text.evaluate((el) => el.scrollHeight > el.clientHeight + 1 || el.scrollWidth > el.clientWidth + 1);
  expect(cut, `${await text.textContent()} is cut off`).toBe(false);
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
    await expect(page.getByText(HINT)).toBeVisible();
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
    await expect(page.getByRole("columnheader", { name: "Inspector", exact: true, includeHidden: true })).toHaveCount(0);
    await expect(row(page, refs.A)).not.toContainText("Test Inspector");
    await expect(page.getByText("Your inspections", { exact: true })).toBeVisible();

    // Newest inspection date first: B (3 Oct), A (1 Oct), D (30 Sep).
    const order = await page.locator("tbody tr[data-ref]").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-ref")));
    expect(order.indexOf(refs.B)).toBeLessThan(order.indexOf(refs.A));
    expect(order.indexOf(refs.A)).toBeLessThan(order.indexOf(refs.D));

    await expect(row(page, refs.A).getByText("Draft")).toBeVisible();
    await expect(row(page, refs.A).getByText("Not done")).toBeVisible();
    await expect(row(page, refs.B).getByText("Submitted")).toBeVisible();
    await expect(row(page, refs.B).getByText("Passed")).toBeVisible();
    // Approved and failed: the workflow badge never borrows the result's colour.
    await expect(row(page, refs.D).getByText("Approved")).toBeVisible();
    await expect(row(page, refs.D).getByText("Failed")).toBeVisible();
    await expect(row(page, refs.B).getByRole("rowheader")).toContainText(refs.B);
    await expect(row(page, refs.B)).toContainText(FIXTURE_CLIENT_NAME);
    await expect(row(page, refs.B)).toContainText("3 Oct 2026");
    // Every value shows at every size: without a column of its own it sits under another.
    await expect(row(page, refs.A)).toContainText("Nitrile examination gloves, blue", { useInnerText: true });
    await expect(row(page, refs.A)).toContainText("Hartalega NGC", { useInnerText: true });
    await expect(row(page, refs.A)).toContainText("E2E-LIST-PO-100", { useInnerText: true });

    if (isTouch()) {
      // 44 px rows and controls, 16 px field text.
      expect((await row(page, refs.A).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await page.getByRole("combobox", { name: "Status" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      expect((await page.getByRole("button", { name: "New inspection" }).boundingBox())!.height).toBeGreaterThanOrEqual(44);
      const fontSize = await page.getByRole("searchbox", { name: "Search" }).evaluate((input) => getComputedStyle(input).fontSize);
      expect(fontSize).toBe("16px");
      // No tooltips on touch: a long manufacturer wraps rather than losing its factory.
      await expectShownInFull(row(page, refs.B).locator(`[title="${TERANG_NUSA_LABEL}"]`).filter({ visible: true }));
    } else {
      // Compact rows on the desktop.
      expect((await row(page, refs.A).boundingBox())!.height).toBeLessThanOrEqual(37);
    }

    const portrait = test.info().project.name === "ipad-portrait";
    await expect(page.getByRole("columnheader", { name: "PO", exact: true })).toBeVisible({ visible: !portrait });
    await expect(page.getByRole("columnheader", { name: "Product", exact: true })).toBeVisible({ visible: !isTouch() });
    if (portrait) await expect(row(page, refs.A)).toContainText("PO E2E-LIST-PO-100");

    await expectNoPageScroll(page);
    await shot(page, "inspector-list");
    expect(hydration()).toEqual([]);
  });

  test("the admin sees every inspection with the Inspector column", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
    await page.goto("/inspections");
    const { refs } = fixture;

    for (const ref of [refs.A, refs.B, refs.C, refs.D]) await expect(row(page, ref)).toBeVisible();
    // Its own column on the desktop; on the iPad the name sits under the date.
    await expect(page.getByRole("columnheader", { name: "Inspector", exact: true })).toBeVisible({ visible: !isTouch() });
    await expect(row(page, refs.A)).toContainText("Test Inspector", { useInnerText: true });
    await expect(row(page, refs.C)).toContainText("Test Admin", { useInnerText: true });
    await expect(row(page, refs.C).getByText("Reopened")).toBeVisible();
    await expect(row(page, refs.C).getByText("On hold")).toBeVisible();
    await expect(row(page, refs.C)).toContainText("Safedon nitrile examination gloves", { useInnerText: true });
    await expect(page.getByText("All inspectors")).toBeVisible();

    await expectNoPageScroll(page);
    await shot(page, "admin-list");
    expect(hydration()).toEqual([]);
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

  test("New inspection is switched off and says why", async ({ page, context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
    await page.goto("/inspections");
    const button = page.getByRole("button", { name: "New inspection" });

    await expect(button).toHaveAttribute("aria-disabled", "true");
    // aria-disabled, so Playwright only taps it when forced; a finger on an iPad just taps.
    if (isTouch()) await button.tap({ force: true });
    else await button.hover();
    await expect(page.getByRole("tooltip")).toHaveText(HINT);
    await button.click({ force: true });
    await expect(page).toHaveURL(/\/inspections$/);
    await shot(page, "new-inspection-hint");
  });
});
