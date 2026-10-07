import { expect, test, type Locator, type Page } from "@playwright/test";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import { createAutosaveFixture, type AutosaveFixture } from "./fixtures";

/**
 * An accidental reload of the capture screen (a pull to refresh on the
 * iPad) loses nothing completed, reopens the same section and lands on the
 * last field that stored a value: in view and ringed for a moment, not
 * focused (use-landing-spot.ts). The page itself does not pull
 * to refresh while the screen is open (use-no-pull-to-refresh.ts). One
 * temporary template and inspection per project (fixtures.ts); the tests run
 * in order on it. Every reload here comes straight after the last action,
 * well inside the autosave's 800 ms wait.
 */

// The Mac running these is shared with other builds: generous waits.
test.describe.configure({ mode: "serial", timeout: 120_000 });

let fixture: AutosaveFixture;
// One sign-in per project, reused by every test: Supabase limits sign-ins per address.
let cookies: { name: string; value: string }[];

test.beforeAll(async () => {
  fixture = await createAutosaveFixture();
  cookies = await sessionCookies(TEST_ACCOUNTS.inspector);
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

/** A tap on the iPads, a click on the desktop. */
async function press(locator: Locator) {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `screenshots/autosave/${test.info().project.name}-${name}.png`,
    animations: "allow",
    caret: "initial",
  });
}

async function open(page: Page, baseURL: string | undefined, module: string) {
  await page.context().addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
  await page.goto(`/inspections/${fixture.inspectionId}?module=${module}`);
  await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute("data-state", "saved");
  // The pill is in the server's HTML: an editable field means the page has hydrated and the autosave runs.
  await expect(page.locator('[data-slot="section-frame"] input:visible').first()).toBeEditable();
}

async function expectStored(match: Record<string, unknown>) {
  await expect.poll(() => fixture.stored(), { timeout: 20_000 }).toMatchObject(match);
}

/**
 * The screen landed on `field`: its ring is on (it fades after 2.4 s), it is
 * on screen below the sticky bars and near the middle (unless the page
 * cannot scroll that far), and it is not focused: no keyboard on the iPad,
 * and no selected value for the next key to replace.
 */
async function expectLandedOn(page: Page, field: Locator) {
  await expect(field).toHaveAttribute("data-landed", "", { timeout: 15_000 });
  await expect(field).toBeInViewport();
  const where = await field.evaluate((element) => {
    const root = document.querySelector<HTMLElement>('[data-slot="capture-screen"]');
    const box = element.getBoundingClientRect();
    return {
      top: box.top,
      centre: box.top + box.height / 2,
      stickyTop: Number.parseFloat(root?.style.getPropertyValue("--capture-sticky-top") ?? "") || 0,
      viewport: window.innerHeight,
      scrollY: window.scrollY,
      maxScroll: document.documentElement.scrollHeight - window.innerHeight,
      focused: element.contains(document.activeElement),
    };
  });
  expect(where.top, "the field is under the sticky bars").toBeGreaterThanOrEqual(where.stickyTop - 1);
  const atLimit = where.scrollY <= 1 || where.scrollY >= where.maxScroll - 1;
  if (!atLimit) {
    const middle = (where.stickyTop + where.viewport) / 2;
    expect(Math.abs(where.centre - middle), "the field is near the middle").toBeLessThan(where.viewport * 0.2);
  }
  expect(where.focused, "not focused").toBe(false);
}

/* ------------------------------------------------------------------ *
 * Completed fields
 * ------------------------------------------------------------------ */

const WAYS = [
  { way: "Tab", grams: 3.1, complete: (field: Locator) => field.press("Tab") },
  { way: "Enter", grams: 3.2, complete: (field: Locator) => field.press("Enter") },
  {
    way: "a tap elsewhere",
    grams: 3.3,
    complete: (field: Locator) => press(field.page().getByRole("heading", { level: 2, name: "Glove Information" })),
  },
] as const;

for (const { way, grams, complete } of WAYS) {
  test(`a number completed with ${way} and a text are there after an immediate reload, which lands on the number`, async ({
    page,
    baseURL,
  }) => {
    await open(page, baseURL, "glove_info");
    const texture = page.getByLabel("Glove surface texture");
    const weight = page.getByLabel("Indicative weight (size M)");
    await expect(texture).toBeEditable();
    await texture.fill(`Smooth (${way})`);
    await weight.fill(String(grams));
    await complete(weight);
    await page.reload();

    await expect(page).toHaveURL(/module=glove_info/);
    await expect(page.getByRole("heading", { level: 2, name: "Glove Information" })).toBeVisible();
    await expect(page.getByLabel("Glove surface texture")).toHaveValue(`Smooth (${way})`);
    await expect(page.getByLabel("Indicative weight (size M)")).toHaveValue(String(grams));
    await expectLandedOn(page, page.getByLabel("Indicative weight (size M)"));
    if (way === "Tab") await shot(page, "landed-glove-info");
    await expectStored({ modules: { glove_info: { surfaceTexture: `Smooth (${way})`, indicativeWeight: grams } } });
  });
}

test("a reload mid-typing keeps the half-typed number and text, and lands on the field being typed in", async ({ page, baseURL }) => {
  await open(page, baseURL, "glove_info");
  const colour = page.getByLabel("Glove colour");
  const weight = page.getByLabel("Indicative weight (size M)");
  await expect(colour).toBeEditable();
  await colour.fill("Nitr");
  // Not completed: the focus stays in the number, which keeps its text until it is left.
  await weight.fill("4.25");
  await expect(weight).toBeFocused();
  await page.reload();

  await expect(page.getByLabel("Glove colour")).toHaveValue("Nitr");
  await expect(page.getByLabel("Indicative weight (size M)")).toHaveValue("4.25");
  await expectLandedOn(page, page.getByLabel("Indicative weight (size M)"));
  await expectStored({ modules: { glove_info: { colour: "Nitr", indicativeWeight: 4.25 } } });
});

test("a custom section keeps a tapped Yes, a text and a number, and lands on the Yes", async ({ page, baseURL }) => {
  await open(page, baseURL, "e2e_site_notes");
  const weather = page.getByLabel("Weather at the site");
  await expect(weather).toBeEditable();
  await weather.fill("Dry, 31 °C");
  const cartons = page.getByLabel("Cartons on the pallet");
  await cartons.fill("12");
  await cartons.press("Tab");
  const seal = page.getByRole("radiogroup", { name: "Container seal intact" });
  await press(seal.getByRole("radio", { name: "Yes" }));
  await page.reload();

  await expect(page).toHaveURL(/module=e2e_site_notes/);
  await expect(page.getByLabel("Weather at the site")).toHaveValue("Dry, 31 °C");
  await expect(page.getByLabel("Cartons on the pallet")).toHaveValue("12");
  const sealAgain = page.getByRole("radiogroup", { name: "Container seal intact" });
  await expect(sealAgain.getByRole("radio", { name: "Yes" })).toHaveAttribute("aria-checked", "true");
  await expectLandedOn(page, sealAgain);
  await expectStored({ custom: { e2e_site_notes: { weather: "Dry, 31 °C", cartons: 12, sealIntact: true } } });
});

test("a value of one size lands on that size again", async ({ page, baseURL }) => {
  await fixture.setModules({ order_lots: { sizes: { S: { qtyCases: 10 }, M: { qtyCases: 20 }, L: { qtyCases: 5 } } } });
  await open(page, baseURL, "tensile");
  const frame = page.locator('[data-slot="section-frame"]');
  const strengthL = frame.locator('input[id$="-L-tensileStrength"]');
  // From 1280 px without a touchscreen every size is side by side; on the iPads size L is a tab.
  if (!isDesktop()) await press(page.getByRole("tab", { name: /^Size L\b/ }));
  await expect(strengthL).toBeEditable();
  await strengthL.fill("15.2");
  await strengthL.press("Enter");
  await page.reload();

  if (!isDesktop()) await expect(page.getByRole("tab", { name: /^Size L\b/ })).toHaveAttribute("aria-selected", "true");
  const again = page.locator('[data-slot="section-frame"] input[id$="-L-tensileStrength"]');
  await expect(again).toHaveValue("15.20");
  await expectLandedOn(page, again);
  await shot(page, "landed-tensile-l");
  await expectStored({ modules: { tensile: { sizes: { L: { tensileStrength: 15.2 } } } } });
});

/* ------------------------------------------------------------------ *
 * Only after a reload
 * ------------------------------------------------------------------ */

test("opened again inside the app, or afresh, the screen starts at its section's top", async ({ page, baseURL }) => {
  await open(page, baseURL, "glove_info");
  const weight = page.getByLabel("Indicative weight (size M)");
  await expect(weight).toBeEditable();
  await weight.fill("3.9");
  await weight.press("Tab");
  await page.reload();
  await expectLandedOn(page, page.getByLabel("Indicative weight (size M)"));

  // Back to the list and in again, inside the app: no landing.
  await press(page.getByRole("link", { name: /^Back/ }));
  await expect(page).toHaveURL(/\/inspections$/);
  await expect(async () => {
    await page.evaluate(
      (href) => (window as unknown as { next: { router: { push: (href: string) => void } } }).next.router.push(href),
      `/inspections/${fixture.inspectionId}?module=glove_info`,
    );
    await expect(page).toHaveURL(/module=glove_info/, { timeout: 2_000 });
  }).toPass({ timeout: 15_000 });
  await expect(page.getByLabel("Indicative weight (size M)")).toHaveValue("3.9");
  // A landing waits for the form and the local copy, a moment at most: give it that, then none may show.
  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-landed]")).toHaveCount(0);

  // Opened afresh (a link, the address bar): no landing either.
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByLabel("Indicative weight (size M)")).toHaveValue("3.9");
  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-landed]")).toHaveCount(0);
  await expect(page.getByLabel("Indicative weight (size M)")).not.toBeFocused();
});

/* ------------------------------------------------------------------ *
 * Pull to refresh
 * ------------------------------------------------------------------ */

test("the page does not pull to refresh while the screen is open, and still scrolls under its sticky bars", async ({
  page,
  baseURL,
}) => {
  await open(page, baseURL, "glove_info");
  const overscroll = () =>
    page.evaluate(() => [getComputedStyle(document.documentElement), getComputedStyle(document.body)].map((style) => style.overscrollBehaviorY));
  await expect.poll(overscroll).toEqual(["none", "none"]);

  // Room to scroll inside the section, however short it is: the bars stick within the screen's columns.
  const section = page.locator('[data-slot="section-frame"]');
  await section.evaluate((element) => {
    element.style.paddingBottom = "2000px";
  });
  if (isTouch()) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: 400,
      y: 700,
      yDistance: -600,
      gestureSourceType: "touch",
      speed: 1500,
    });
  } else {
    await page.mouse.move(800, 600);
    await page.mouse.wheel(0, 600);
  }
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBeGreaterThan(200);

  // The bars are stuck: the section bar below 1280 px or on a touchscreen, the sidebar on the desktop.
  const stuck = page.locator(isDesktop() ? 'aside[aria-label="Sections and progress"]' : '[data-slot="capture-bar"]');
  const offsets = await stuck.evaluate((element) => ({
    top: Math.round(element.getBoundingClientRect().top),
    sticky: Math.round(Number.parseFloat(getComputedStyle(element).top) || 0),
  }));
  expect(offsets.top).toBe(offsets.sticky);
  await shot(page, "scrolled");

  await section.evaluate((element) => {
    element.style.paddingBottom = "";
  });
  // Gone with the screen: other pages pull to refresh as the browser does.
  await press(page.getByRole("link", { name: /^Back/ }));
  await expect(page).toHaveURL(/\/inspections$/);
  await expect.poll(overscroll).toEqual(["auto", "auto"]);
});
