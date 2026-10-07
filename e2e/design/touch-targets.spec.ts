import { expect, test, type Locator, type Page } from "@playwright/test";

/**
 * The 44 px hit areas of the small controls in components/ui (docs/DESIGN.md,
 * "Density"). On a touchscreen a checkbox, radio, switch or a field's button
 * is drawn smaller than 44 px, and an invisible ::after takes its target to
 * 44 × 44. The ::after is placed from inside the control's 1 px border, so
 * its insets make up for the border. Signed out and without Supabase: the
 * sign-in page's Show Password button, and the other three on /design (shown
 * outside production builds only, so those checks skip on a production
 * server). Touch projects only. Screenshots go to screenshots/design/.
 */

/** Half of 44 px, less a pixel: a tap this far from the centre still lands on the control. */
const REACH = 21;

test.beforeEach(({}, testInfo) => {
  test.skip(!testInfo.project.use.hasTouch, "the 44 px hit areas apply on touchscreens only");
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

/** The ::after's size, and the points REACH px from the centre (right, left, below, above) that miss the control. */
async function hitArea(control: Locator) {
  await control.scrollIntoViewIfNeeded();
  return control.evaluate((element, reach) => {
    const after = getComputedStyle(element, "::after");
    const box = element.getBoundingClientRect();
    const x = box.left + box.width / 2;
    const y = box.top + box.height / 2;
    const misses = (
      [
        ["right", reach, 0],
        ["left", -reach, 0],
        ["below", 0, reach],
        ["above", 0, -reach],
      ] as const
    )
      .filter(([, dx, dy]) => {
        const hit = document.elementFromPoint(x + dx, y + dy);
        return hit === null || !element.contains(hit);
      })
      .map(([side]) => side);
    return {
      box: { width: Math.round(box.width), height: Math.round(box.height) },
      width: Number.parseFloat(after.width),
      height: Number.parseFloat(after.height),
      misses,
    };
  }, REACH);
}

/** Taps REACH px from the control's centre, where only its invisible hit area is. */
async function tapBeside(page: Page, control: Locator, side: "right" | "below" | "above") {
  const box = await control.boundingBox();
  if (!box) throw new Error("the control is not on screen");
  const x = box.x + box.width / 2 + (side === "right" ? REACH : 0);
  const y = box.y + box.height / 2 + (side === "below" ? REACH : side === "above" ? -REACH : 0);
  await page.touchscreen.tap(x, y);
}

test("Show Password: a 36 px button with a 44 px hit area", async ({ page }) => {
  await page.goto("/login");
  await hydrated(page);
  const password = page.getByLabel("Password", { exact: true });
  const toggle = page.getByRole("button", { name: "Show Password" });

  const area = await hitArea(toggle);
  expect(area.box).toEqual({ width: 36, height: 36 });
  expect(area.width).toBeGreaterThanOrEqual(44);
  expect(area.height).toBeGreaterThanOrEqual(44);
  expect(area.misses, "taps that miss the button").toEqual([]);

  // 21 px right of the eye: on the hit area, not on the field around it.
  await password.fill("not-a-real-password-1");
  await tapBeside(page, toggle, "right");
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(password).toHaveAttribute("type", "text");
  await shot(page, "login-password-shown");
});

test("checkbox, radio and switch: 44 px hit areas", async ({ page }) => {
  const response = await page.goto("/design");
  test.skip(response?.status() === 404, "/design is hidden in production builds");
  await hydrated(page);

  const checkbox = page.getByRole("checkbox", { name: "Lot Number Verified" });
  const toggle = page.getByRole("switch", { name: "Record R and L Separately" });
  const radio = page.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio", { name: "FAILED" });

  for (const [control, size] of [
    [checkbox, { width: 24, height: 24 }],
    [radio, { width: 24, height: 24 }],
    [toggle, { width: 48, height: 28 }],
  ] as const) {
    const name = await control.evaluate((element) => element.getAttribute("role"));
    const area = await hitArea(control);
    expect(area.box, `${name}: drawn size`).toEqual(size);
    expect(area.width, `${name}: hit area width`).toBeGreaterThanOrEqual(44);
    expect(area.height, `${name}: hit area height`).toBeGreaterThanOrEqual(44);
    expect(area.misses, `${name}: taps that miss it`).toEqual([]);
  }

  // Taps beside each control, where only its hit area reaches, still work it.
  await expect(checkbox).toHaveAttribute("aria-checked", "true");
  await tapBeside(page, checkbox, "above");
  await expect(checkbox).toHaveAttribute("aria-checked", "false");
  await expect(toggle).toHaveAttribute("aria-checked", "false");
  await tapBeside(page, toggle, "below");
  await expect(toggle).toHaveAttribute("aria-checked", "true");
  await expect(radio).toHaveAttribute("aria-checked", "false");
  await tapBeside(page, radio, "below");
  await expect(radio).toHaveAttribute("aria-checked", "true");
  await shot(page, "design-choices");
});
