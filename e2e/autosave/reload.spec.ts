import { expect, test, type Locator, type Page } from "@playwright/test";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";
import { createAutosaveFixture, type AutosaveFixture } from "./fixtures";

/**
 * An accidental reload of the capture screen (a pull to refresh on the
 * iPad) loses nothing completed, reopens the same section and lands on the
 * last field that stored a value: in view, ringed for a moment and
 * announced, not focused (use-landing-spot.ts); a tap or scroll by the
 * inspector cancels it. While the screen is open the page asks the browser
 * not to pull to refresh (use-no-pull-to-refresh.ts). One
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

/** WebKit, the engine of Chrome and Safari on the iPad: no Chromium DevTools protocol there. */
function isWebKit() {
  return test.info().project.use.browserName === "webkit";
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
  // The pill is in the server's HTML: an editable field (the section comment at least) means the page has hydrated and the autosave runs.
  await expect(page.locator('[data-slot="section-frame"] :is(input, textarea):visible').first()).toBeEditable();
}

async function expectStored(match: Record<string, unknown>) {
  await expect.poll(() => fixture.stored(), { timeout: 20_000 }).toMatchObject(match);
}

/**
 * The screen landed on `field`: its ring is on (it fades after 2.4 s), it is
 * on screen below the sticky bars (scrolled to the middle when it was out of
 * view: `middle`), it is announced by its label, and it is not focused: no
 * keyboard on the iPad, and no selected value for the next key to replace.
 */
async function expectLandedOn(page: Page, field: Locator, { middle = false, label }: { middle?: boolean; label?: string } = {}) {
  await expect(field).toHaveAttribute("data-landed", "", { timeout: 15_000 });
  await expect(field).toBeInViewport();
  if (label) await expect(announcement(page)).toHaveText(`Back where you stopped: ${label}`);
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
  if (middle && where.scrollY < where.maxScroll - 1) {
    const centre = (where.stickyTop + where.viewport) / 2;
    expect(Math.abs(where.centre - centre), "the field is near the middle").toBeLessThan(where.viewport * 0.2);
  }
  expect(where.focused, "not focused").toBe(false);
}

function announcement(page: Page) {
  return page.locator('[data-slot="landing-announcement"]');
}

/** Nothing landed: no ring and nothing announced, a moment after the screen could have. */
async function expectNoLanding(page: Page) {
  // A landing waits for the form and the local copy, a moment at most: give it that, then none may show.
  await page.waitForTimeout(1_500);
  await expect(page.locator("[data-landed]")).toHaveCount(0);
  await expect(announcement(page)).toHaveText("");
}

/** The screen's React tree is on the page: from here its code sees every tap and scroll. */
async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const screen = document.querySelector('[data-slot="capture-screen"]');
    return screen !== null && Object.keys(screen).some((key) => key.startsWith("__reactFiber"));
  });
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
    await expectLandedOn(page, page.getByLabel("Indicative weight (size M)"), { label: "Indicative weight (size M)" });
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

test("a count in box 3 of a one-box-at-a-time module lands on box 3 again", async ({ page, baseURL }) => {
  await fixture.setModules({ order_lots: { sizes: { S: { qtyCases: 10 } } } });
  await open(page, baseURL, "dispensing_safedon");
  const count = page.getByRole("button", { name: "Increase No cuff, column 3", exact: true });
  // On the iPads one box shows at a time: step to the third. From 1280 px without a touchscreen every box is side by side.
  if (!isDesktop()) {
    await press(page.getByRole("button", { name: "Next Box" }));
    await press(page.getByRole("button", { name: "Next Box" }));
  }
  await press(count);
  await page.reload();

  // The module turns back to box 3 itself (its reveal, as an issue link would), without focusing it.
  const again = page.getByRole("button", { name: "Increase No cuff, column 3", exact: true });
  await expectLandedOn(page, again, { label: "Increase No cuff, column 3" });
  if (!isDesktop()) await expect(page.locator('[data-slot="section-frame"]')).toContainText(/· 3 \/ \d+/);
  await shot(page, "landed-safedon-box-3");
  await expect
    .poll(async () => {
      const safedon = (await fixture.stored()).modules?.dispensing_safedon as
        | { sizes?: Record<string, { boxes?: { counts?: Record<string, number> }[] }> }
        | undefined;
      return safedon?.sizes?.S?.boxes?.[2]?.counts?.no_cuff;
    }, { timeout: 20_000 })
    .toBe(1);
});

test("a field out of view after the reload is scrolled to the middle of the screen", async ({ page, baseURL }) => {
  // A short screen, so the section comment at the bottom of glove information is out of view at the top of the page.
  await page.setViewportSize({ width: page.viewportSize()!.width, height: 560 });
  await open(page, baseURL, "glove_info");
  const comment = page.getByRole("textbox", { name: "Inspector Comment" });
  await comment.fill("Checked at the line");
  await comment.press("Tab");
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.evaluate(() => {
    history.scrollRestoration = "manual";
  });
  await page.reload();
  const again = page.getByRole("textbox", { name: "Inspector Comment" });
  await expect(again).toHaveValue("Checked at the line");
  await expectLandedOn(page, again, { middle: true, label: "Inspector Comment" });
});

test("with reduced motion the ring stays still for its moment instead of fading", async ({ page, baseURL }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(page, baseURL, "glove_info");
  const colour = page.getByLabel("Glove colour");
  await colour.fill("Navy");
  await page.reload();
  const again = page.getByLabel("Glove colour");
  await expectLandedOn(page, again, { label: "Glove colour" });
  const frames = await again.evaluate((element) =>
    element.getAnimations().flatMap((animation) => (animation.effect as KeyframeEffect).getKeyframes().map((frame) => frame.boxShadow)),
  );
  expect(frames.length).toBeGreaterThanOrEqual(2);
  expect(new Set(frames).size, "every frame the same ring").toBe(1);
  expect(String(frames[0])).not.toContain("transparent");
});

/* ------------------------------------------------------------------ *
 * Never under the inspector's finger
 * ------------------------------------------------------------------ */

for (const act of ["a tap", "a scroll"] as const) {
  test(`${act} while the page is still starting cancels the landing`, async ({ page, baseURL }) => {
    test.skip(act === "a scroll" && isWebKit(), "Playwright cannot scroll mobile WebKit by wheel or touch; the tap covers it there.");
    await open(page, baseURL, "glove_info");
    const weight = page.getByLabel("Indicative weight (size M)");
    await weight.fill("3.7");
    await weight.press("Tab");
    // Saved before the reload: this test is about input while the page starts, not a save still on its way,
    // which could land after the reloaded page has read the inspection and ask which version to keep.
    await expectStored({ modules: { glove_info: { indicativeWeight: 3.7 } } });
    await expect(page.locator('[data-slot="save-status"]:visible')).toHaveAttribute("data-state", "saved");

    // A second tab holds the inspection's writer lock for 2.5 s once this page lets go of it at the reload:
    // the reloaded screen is on the page, its saving not started yet (fields read-only), for that long.
    const holder = await page.context().newPage();
    await holder.goto("/login");
    await holder.evaluate((name) => {
      void navigator.locks.request(name, () => new Promise((resolve) => setTimeout(resolve, 2_500)));
    }, `stericare-autosave:${fixture.inspectorId}:${fixture.inspectionId}`);
    await page.reload();
    await hydrated(page);
    const again = page.getByLabel("Indicative weight (size M)");
    expect(await again.isEditable(), "saving has not started yet").toBe(false);
    if (act === "a tap") {
      await press(page.getByRole("heading", { level: 1 }));
    } else {
      await page.mouse.move(400, 400);
      await page.mouse.wheel(0, 120);
    }

    // Saving starts once the other tab lets go; the inspector moved first, so nothing lands.
    await expect(again).toBeEditable({ timeout: 15_000 });
    await expect(again).toHaveValue("3.7");
    await expectNoLanding(page);
    await holder.close();
  });
}

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
  await expectNoLanding(page);

  // Opened afresh (a link, the address bar): no landing either.
  await page.goto(`/inspections/${fixture.inspectionId}?module=glove_info`);
  await expect(page.getByLabel("Indicative weight (size M)")).toHaveValue("3.9");
  await expectNoLanding(page);
  await expect(page.getByLabel("Indicative weight (size M)")).not.toBeFocused();
});

/* ------------------------------------------------------------------ *
 * Pull to refresh
 * ------------------------------------------------------------------ */

test("while the screen is open the page asks the browser not to pull to refresh, and still scrolls under its sticky bars", async ({
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
  if (isTouch() && !isWebKit()) {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Input.synthesizeScrollGesture", {
      x: 400,
      y: 700,
      yDistance: -600,
      gestureSourceType: "touch",
      speed: 1500,
    });
  } else if (isWebKit()) {
    // Mobile WebKit has no wheel in Playwright: the keyboard scrolls the page there.
    await page.locator("body").press("PageDown");
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
