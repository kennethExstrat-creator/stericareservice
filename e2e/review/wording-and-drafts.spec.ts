import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { createExportFixture, makeImages, type ExportFixture } from "../export/support";
import { expectNoPageScroll, isTouch, press, reviewPath, sessions, shot, viewShot, watchConsole } from "./support";

/**
 * The review of a submitted STD_EG inspection (the example report on the
 * real modules, e2e/export/support.ts), as an admin with the mock reviewer:
 *
 *   AI_REVIEW_PROVIDER=mock npx next dev -p <port>
 *   PLAYWRIGHT_BASE_URL=http://localhost:<port> npx playwright test e2e/review/wording-and-drafts.spec.ts
 *
 * - each module's result says a sentence once: a summary that only strings
 *   the per-size lines together stays out, a note it adds stays;
 * - the inspector's HOLD reads "On Hold" in the conclusion's row, as in the
 *   final result, not "Warning";
 * - a labelling photo of the carton says so, on the report photos and as the
 *   AI's evidence, and the evidence names defects in words, not codes;
 * - a quoted sentence in a finding's evidence reads left aligned, on a line
 *   of its own;
 * - a half-made decision on a finding and a reason for reopening are still
 *   there after a reload, and go once sent or cancelled.
 *
 * Its template's code starts E2E_FINAL_; the fixture removes it, the
 * inspection, its photos and its files afterwards. Screenshots go to
 * screenshots/review/.
 */

test.describe.configure({ mode: "serial", timeout: 180_000 });
const expect = baseExpect.configure({ timeout: 30_000 });

const CODE = "E2E_FINAL_REVIEW";
const NOTE = "Labels were checked on site; the sheet was filled in later.";
const REASON = "Labelling: enter the carton and dispenser box checks.\nAdd a photo of the inner box label.";

let fixture: ExportFixture;
const as = sessions();

test.beforeAll(async ({ browser }) => {
  fixture = await createExportFixture({
    code: CODE,
    images: await makeImages(browser),
    // A labelling photo of the carton, for the report: the mock reviewer cites it with its labelling finding.
    extraPhotos: [{ moduleKey: "labeling", target: "size:M/box:1324/level:carton", caption: null, includeInReport: true }],
  });
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

function moduleRow(page: Page, key: string): Locator {
  return page.getByRole("region", { name: "Module Results" }).locator(`li[data-module=${key}]`);
}

/** How often `sentence` occurs in the element's text. */
async function occurrences(locator: Locator, sentence: string): Promise<number> {
  const text = (await locator.textContent()) ?? "";
  return text.split(sentence).length - 1;
}

test("each module's result says a sentence once, and the inspector's HOLD reads On Hold", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await as.signIn(context, baseURL!, "admin");
  await page.goto(reviewPath(fixture.inspectionId));
  await expect(page.getByRole("heading", { level: 1, name: fixture.refNo })).toBeVisible();

  for (const [key, sentence] of [
    ["watertight", "1 / 500 (Finger 1), Defect Limit 14 / 15: Passed"],
    ["dispensing_packing", "Layering 88.3% (min. 70%), Dispensing 90.3% (min. 80%), Stickiness A: Passed"],
    ["carton_sampling", "50 carton numbers, unique and between 1 and 2,900"],
    ["sampling_plan", "inspection level I needs 500 (code N)"],
  ] as const) {
    const row = moduleRow(page, key);
    await expect(row.locator("li[data-size=M]")).toContainText(sentence);
    expect(await occurrences(row, sentence), `${key} says it once`).toBe(1);
  }
  // What a summary adds to its sizes' lines stays: force at break's spec, once, above the median.
  const force = moduleRow(page, "force_at_break");
  await expect(force).toContainText("Spec. ≥ 6 N.");
  expect(await occurrences(force, "Median 6.537 N")).toBe(1);
  // A headline of its own stays whole, above the size's own line.
  await expect(moduleRow(page, "weight").locator("p").first()).toHaveText(/^Average: M 2\.90 g \(17\.1% below the indicative 3\.5 g/);

  // The conclusion's pill matches the final result: On Hold, the pause icon, the hold tint.
  const conclusion = moduleRow(page, "conclusion");
  await expect(conclusion).toHaveAttribute("data-status", "hold");
  const pill = conclusion.locator("[data-slot=status-pill]").first();
  await expect(pill).toHaveAttribute("data-status", "hold");
  await expect(pill).toHaveText("On Hold");
  await expect(conclusion.getByText("Warning", { exact: true })).toHaveCount(0);
  // As the final result says it (the suggestion is on hold too).
  await expect(page.getByRole("region", { name: "Result" }).getByText("On Hold", { exact: true }).last()).toBeVisible();

  await conclusion.scrollIntoViewIfNeeded();
  await viewShot(page, "wording-conclusion-hold");
  await moduleRow(page, "watertight").scrollIntoViewIfNeeded();
  await viewShot(page, "wording-module-results");
  await expectNoPageScroll(page);
  expect(hydration()).toEqual([]);
});

test("a labelling photo of the carton says so on the report photos", async ({ page, context, baseURL }) => {
  await as.signIn(context, baseURL!, "admin");
  await page.goto(reviewPath(fixture.inspectionId));
  const [cartonPhoto] = fixture.extraPhotoIds;
  const tile = page.getByRole("region", { name: "Report Photos" }).locator(`li[data-photo="${cartonPhoto}"]`);
  await expect(tile).toContainText("Size M · Box 1324 · Carton Box");
  // Named by what it shows, then where it opens.
  await expect(tile.getByRole("link")).toHaveAttribute("aria-label", /Size M · Box 1324 · Carton Box \(opens full size in a new tab\)$/);
  await tile.scrollIntoViewIfNeeded();
  await viewShot(page, "wording-report-photos");
});

test("the AI second opinion words its evidence: photos in the template's words, sentences on a line of their own", async ({
  page,
  context,
  baseURL,
}) => {
  await as.signIn(context, baseURL!, "admin");
  await page.goto(reviewPath(fixture.inspectionId));
  const panel = page.getByTestId("ai-panel");
  await press(panel.getByRole("button", { name: "Request Steri-AI Second Opinion" }));
  const comparison = panel.getByTestId("ai-comparison");
  await expect(comparison).toBeVisible({ timeout: 90_000 });

  // Labelling is not done: the mock cites the carton photo, named as the gallery names it.
  const [cartonPhoto] = fixture.extraPhotoIds;
  const labeling = comparison.locator("section[data-section$='-labeling']");
  const evidence = labeling.locator(`a[href*="${cartonPhoto}"]`);
  await expect(evidence).toHaveAttribute("aria-label", /· Size M · Box 1324 · Carton Box \(opens in a new tab\)$/);
  await expect(evidence.locator("[title]")).toHaveAttribute("title", /· Size M · Box 1324 · Carton Box$/);

  // Weight has a warning: its result sits beside its label, the quoted warning on its own line, left aligned.
  const weight = comparison.locator("section[data-section$='-weight'] article[data-finding]");
  const short = weight.locator("[data-layout=inline] dd").first();
  const sentence = weight.locator("[data-layout=block] dd").first();
  await expect(short).toHaveText("warn");
  await expect(sentence).toContainText("below the indicative 3.5 g");
  expect(await short.evaluate((element) => getComputedStyle(element).textAlign)).toBe("right");
  expect(await sentence.evaluate((element) => getComputedStyle(element).textAlign)).toBe("left");
  const label = weight.locator("[data-layout=block] dt").first();
  const [labelBox, sentenceBox] = [await label.boundingBox(), await sentence.boundingBox()];
  expect(sentenceBox!.y, "the sentence starts under its label").toBeGreaterThanOrEqual(labelBox!.y + labelBox!.height - 1);
  expect(Math.abs(sentenceBox!.x - labelBox!.x), "and at its left edge").toBeLessThanOrEqual(1);

  await weight.scrollIntoViewIfNeeded();
  await viewShot(page, "wording-ai-evidence");
  await expectNoPageScroll(page);
});

test("a half-made decision and a reason for reopening are still there after a reload", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await as.signIn(context, baseURL!, "admin");
  await page.goto(reviewPath(fixture.inspectionId));
  const panel = page.getByTestId("ai-panel");
  const finding = panel.getByTestId("ai-comparison").locator("section[data-section$='-labeling'] article[data-finding]");

  // A disagreement with its note, not saved yet.
  await press(finding.getByRole("radio", { name: "Disagree", exact: true }));
  await finding.getByRole("textbox", { name: "Why Do You Disagree?" }).fill(NOTE);
  await page.reload();
  await expect(finding.getByRole("radio", { name: "Disagree", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(finding.getByRole("textbox", { name: "Why Do You Disagree?" })).toHaveValue(NOTE);
  await finding.scrollIntoViewIfNeeded();
  await viewShot(page, "wording-decision-after-reload");
  // Saved, it is a decision, and the half-made one is gone.
  await press(finding.getByRole("button", { name: "Save Decision" }));
  await expect(finding.locator('[data-testid^="decision-"]')).toContainText(NOTE);
  await page.reload();
  await expect(finding.locator('[data-testid^="decision-"]')).toContainText("Disagreed");
  await expect(finding.getByRole("button", { name: "Save Decision" })).toHaveCount(0);

  // The reason for reopening, typed and not sent.
  await press(page.getByRole("button", { name: "Reopen" }));
  const dialog = page.getByRole("alertdialog", { name: `Reopen ${fixture.refNo}?` });
  const reason = dialog.getByRole("textbox", { name: "What Should the Inspector Change?" });
  await reason.fill(REASON);
  await page.reload();
  await expect(dialog).toBeHidden();
  await press(page.getByRole("button", { name: "Reopen" }));
  await expect(reason).toHaveValue(REASON);
  if (!isTouch()) {
    // Focused where the admin stopped: the end of what they wrote.
    await expect(reason).toBeFocused();
    const caret = await reason.evaluate((field: HTMLTextAreaElement) => [field.selectionStart, field.value.length]);
    expect(caret[0]).toBe(caret[1]);
  }
  await viewShot(page, "wording-reopen-after-reload");
  // Cancelled, it goes.
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await expect(dialog).toBeHidden();
  await press(page.getByRole("button", { name: "Reopen" }));
  await expect(reason).toHaveValue("");
  await press(dialog.getByRole("button", { name: "Cancel" }));
  await shot(page, "wording-review");
  expect(hydration()).toEqual([]);
});
