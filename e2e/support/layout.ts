import { expect, type Page } from "@playwright/test";

/**
 * The page itself never scrolls sideways (a table's card may). Measured
 * against the page's layout width and the window's, never window.innerWidth:
 * on touch the browser widens innerWidth to fit content that sticks out, so an
 * overflowing page would measure as fitting.
 */
export async function expectNoPageScroll(page: Page): Promise<void> {
  const { scrollWidth, clientWidth } = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  const viewport = page.viewportSize()?.width ?? clientWidth;
  expect(scrollWidth, "the page scrolls sideways").toBeLessThanOrEqual(Math.min(clientWidth, viewport));
}
