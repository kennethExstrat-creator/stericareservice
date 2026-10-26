import { expect, test, type Page } from "@playwright/test";
import { sessionCookies, TEST_ACCOUNTS } from "../support/session";

/**
 * Keyboard focus is never hidden under a sticky bar (WCAG 2.4.11; the page's
 * scroll padding in app/globals.css, docs/DESIGN.md "Focus"): the shell's top
 * bar below 1280 px and on every touchscreen. The check walks back up a form
 * with Shift+Tab and, before every step, scrolls the control it reaches under
 * the bar; the page must bring it back into view below it, focus ring
 * included. The bar's own controls must not scroll the page when they take
 * focus. (The template editor's tab bar, checked here before, went with
 * Admin > Templates: Kenneth, 26 October 2026.)
 *
 * One admin sign-in per size; nothing is saved or created through the app.
 * Screenshots go to screenshots/design/.
 */

// A walk is two dozen Shift+Tabs, each with a scroll and a measurement: slow on a dev server.
test.describe.configure({ mode: "serial", timeout: 120_000 });

type SessionCookie = Awaited<ReturnType<typeof sessionCookies>>[number];

let cookies: SessionCookie[] = [];

/** The bar that can cover the top of the page: the shell's. */
const BARS = '[data-testid="shell-top-bar"]';

/** The room the page keeps between the bars and a control it scrolls up to them (1rem, app/globals.css). */
const ROOM_PX = 16;

/** The focus ring reaches 4 px outside a control (2 px out, 2 px wide): at least that much room below the bars. */
const RING_PX = 4;

test.beforeAll(async () => {
  cookies = await sessionCookies(TEST_ACCOUNTS.admin);
});

test.beforeEach(async ({ context, baseURL }) => {
  await context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
});

async function hydrated(page: Page) {
  await page.waitForFunction(() => {
    const main = document.querySelector("main");
    return main !== null && Object.keys(main).some((key) => key.startsWith("__reactFiber"));
  });
}

async function shot(page: Page, name: string) {
  await page.screenshot({
    path: `screenshots/design/${test.info().project.name}-${name}.png`,
    animations: "disabled",
    caret: "initial",
    style: "nextjs-portal { display: none !important; }",
  });
}

/** Two frames and a beat: a focus scroll has landed. */
async function settle(page: Page) {
  await page.evaluate(
    () => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 50)),
  );
}

/** Room below the content, so any control can be scrolled up under the bars. */
async function roomToScroll(page: Page) {
  await page.evaluate(() => {
    document.body.style.paddingBottom = "3000px";
  });
}

type Step = { name: string; top: number; bars: number; covered: number };

/** Where the bars stuck at the top of the window end, in px. */
function barsBottom(page: Page) {
  return page.evaluate((bars) => {
    let bottom = 0;
    for (const bar of document.querySelectorAll(bars)) {
      if (bar.getClientRects().length === 0) continue;
      const box = bar.getBoundingClientRect();
      if (box.top <= bottom + 1) bottom = Math.max(bottom, box.bottom);
    }
    return bottom;
  }, BARS);
}

/**
 * One Shift+Tab from the focused control, after the control it reaches has
 * been scrolled under the bars: wholly (`under` 1) or half way (0.5). Null
 * once focus would leave `scope`.
 */
async function shiftTabFromUnderTheBars(page: Page, scope: string, under: number): Promise<Step | null> {
  // Which control does Shift+Tab reach from here? Mark it, and come back.
  await page.evaluate(() => {
    for (const element of document.querySelectorAll("[data-e2e-from], [data-e2e-to]")) {
      element.removeAttribute("data-e2e-from");
      element.removeAttribute("data-e2e-to");
    }
    document.activeElement?.setAttribute("data-e2e-from", "");
  });
  await page.keyboard.press("Shift+Tab");
  const inScope = await page.evaluate((scope) => {
    const target = document.activeElement;
    if (!target || !target.closest(scope)) return false;
    target.setAttribute("data-e2e-to", "");
    return true;
  }, scope);
  if (!inScope) return null;
  await page.keyboard.press("Tab");
  await expect(page.locator("[data-e2e-from]")).toBeFocused();

  // Under the bars (above the window where there are none), its bottom edge or its middle where they end.
  const before = await barsBottom(page);
  await page.evaluate(
    ([bottom, under]) => {
      const target = document.querySelector("[data-e2e-to]")!.getBoundingClientRect();
      window.scrollBy(0, target.top + target.height * under - bottom);
    },
    [before, under],
  );
  await settle(page);

  await page.keyboard.press("Shift+Tab");
  await expect(page.locator("[data-e2e-to]")).toBeFocused();
  await settle(page);
  const bars = await barsBottom(page);
  return page.evaluate(
    ([selector, bars]) => {
      const target = document.activeElement as HTMLElement;
      const box = target.getBoundingClientRect();
      // Nine points of the control: none may hit a bar, or fall off the window.
      let covered = 0;
      for (const fx of [0.1, 0.5, 0.9]) {
        for (const fy of [0.1, 0.5, 0.9]) {
          const x = box.left + box.width * fx;
          const y = box.top + box.height * fy;
          const hit = y >= 0 && y < window.innerHeight ? document.elementFromPoint(x, y) : null;
          if (hit === null || hit.closest(selector)) covered += 1;
        }
      }
      const label =
        target.getAttribute("aria-label") ??
        (target.id ? document.querySelector(`label[for="${CSS.escape(target.id)}"]`)?.textContent : null) ??
        target.textContent ??
        target.tagName;
      return {
        name: `${target.getAttribute("role") ?? target.tagName.toLowerCase()} "${label.trim().replace(/\s+/g, " ").slice(0, 40)}"`,
        top: Math.round(box.top),
        bars: Math.round(bars),
        covered,
      };
    },
    [BARS, bars] as const,
  );
}

/**
 * Walks back up from the focused control, `steps` times at most, checking each
 * control comes out clear of the bars. Every other control starts wholly under
 * them (the browser centres it), the rest half under (it lines up just below
 * them): the first of those whose name matches `shotOf` is photographed.
 */
async function walkBack(page: Page, scope: string, steps: number, shotOf: RegExp, name: string): Promise<Step[]> {
  const walked: Step[] = [];
  let photographed = false;
  for (let index = 0; index < steps; index += 1) {
    const halfUnder = index % 2 === 1;
    const step = await shiftTabFromUnderTheBars(page, scope, halfUnder ? 0.5 : 1);
    if (!step) break;
    walked.push(step);
    expect(step.covered, `${step.name}: points under a bar`).toBe(0);
    expect(step.top, `${step.name}: top edge (the bars end at ${step.bars})`).toBeGreaterThanOrEqual(step.bars + RING_PX);
    if (halfUnder && !photographed && shotOf.test(step.name)) {
      await shot(page, name);
      photographed = true;
    }
  }
  expect(photographed, `a control matching ${shotOf} lined up below the bars`).toBe(true);
  test.info().annotations.push({
    type: "walked",
    description: walked.map((step) => `${step.name} at ${step.top} px (bars end at ${step.bars})`).join("; "),
  });
  return walked;
}

/** The page's scroll padding at the top, in px. */
function scrollPaddingTop(page: Page) {
  return page.evaluate(() => Number.parseFloat(getComputedStyle(document.documentElement).scrollPaddingTop) || 0);
}

/** scrollY after `focus()` on a control, with the page scrolled down first. */
async function scrollAfterFocus(page: Page, selector: string) {
  return page.evaluate(async (selector) => {
    const settled = () => new Promise((resolve) => setTimeout(() => requestAnimationFrame(() => requestAnimationFrame(resolve)), 50));
    (document.activeElement as HTMLElement | null)?.blur();
    window.scrollTo(0, 600);
    await settled();
    const before = window.scrollY;
    document.querySelector<HTMLElement>(selector)!.focus();
    await settled();
    return { before, after: window.scrollY };
  }, selector);
}

test("New inspection: Shift+Tab brings each field out from under the top bar", async ({ page }) => {
  await page.goto("/inspections/new");
  await hydrated(page);
  await roomToScroll(page);
  const touch = Boolean(test.info().project.use.hasTouch);
  const desktop = !touch && (page.viewportSize()?.width ?? 0) >= 1280;

  // The top bar is 65 px; the page keeps it and 16 px more clear above a control it scrolls to
  // (the 16 px alone on the desktop, which has no top bar).
  expect(await scrollPaddingTop(page)).toBe(desktop ? ROOM_PX : 65 + ROOM_PX);

  await page.getByRole("button", { name: "Create Inspection" }).focus();
  const walked = await walkBack(page, "main", 14, /Product name/i, "new-inspection-shift-tab");
  // Up through the product type to the manufacturer and client pickers.
  expect(walked.map((step) => step.name).join(" | ")).toMatch(/radio ".*\| combobox "Manufacturer" \| combobox "Client"$/);

  if (!desktop) {
    // A control in the top bar itself takes focus where it is: the page does not scroll.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const moved = await scrollAfterFocus(page, '[data-testid="shell-top-bar"] a[href]');
    expect(moved.after).toBe(moved.before);
  }
});
