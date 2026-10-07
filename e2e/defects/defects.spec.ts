import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import { chromeNames } from "../users/support";
import {
  changeCode,
  createDefectsFixture,
  inspectionData,
  LABELS,
  mappingEvents,
  NOT_A_CODE,
  ORDER,
  storedCode,
  TEMPLATE_CODE,
  type DefectsFixture,
} from "./fixtures";

/**
 * /admin/defects (BUILD_SPEC 4.2 rule 4, 10): the codes, label mapping and
 * one-off labels, against the live project at the three sizes in
 * playwright.config.ts. Screenshots go to screenshots/defects/.
 */

const TABS = ["/admin/defects", "/admin/defects/labels", "/admin/defects/unmapped"] as const;

/**
 * Every save is a Server Action that also re-renders the page with fresh
 * data. On a dev server sharing the machine that can take several seconds,
 * so outcomes get longer than Playwright's default 5 s to show.
 */
const expect = baseExpect.configure({ timeout: 20_000 });

function isTouch() {
  return Boolean(test.info().project.use.hasTouch);
}

/**
 * Full page on the desktop. A full-page capture drops touch emulation while
 * it resizes (e2e/README.md), so the iPads get viewport shots, scrolled:
 * name.png, or name-1.png, name-2.png ... for a longer page. With a dialog or
 * panel open, the viewport only.
 */
async function shot(page: Page, name: string, { scroll = true }: { scroll?: boolean } = {}) {
  const path = (part = "") => `screenshots/defects/${test.info().project.name}-${name}${part}.png`;
  const options = { animations: "disabled", caret: "initial" } as const;
  // Let toasts, panels and dialogs finish their 100-200 ms entrance.
  await page.waitForTimeout(300);
  if (!scroll) {
    await page.screenshot({ ...options, path: path() });
    return;
  }
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

/** 44 px on touch (docs/DESIGN.md, Density). */
async function expectTouchTarget(locator: Locator) {
  if (!isTouch()) return;
  const box = await locator.boundingBox();
  expect(box?.height ?? 0, "a touch target is shorter than 44 px").toBeGreaterThanOrEqual(44);
}

const toast = (page: Page, text: string | RegExp) => page.locator("[data-sonner-toast]").filter({ hasText: text });

test("signed out, the defects tabs send you to sign in and back", async ({ page }) => {
  await page.goto("/admin/defects/unmapped");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Fdefects%2Funmapped$/);
});

test("an inspector gets a 404 for every defects tab, and nothing names them", async ({ page, context, baseURL }) => {
  // Three pages; on a dev server each may compile first.
  test.slow();
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  for (const path of TABS) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByText(/page not found|could not be found/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Defects", level: 1 })).toHaveCount(0);
    const html = (await response?.text()) ?? "";
    for (const title of ["Defect codes", "Label mapping", "Unmapped labels"]) {
      expect(html, `${path} names "${title}"`).not.toContain(`${title} · SteriCare QC`);
    }
  }
  await shot(page, "inspector-404");
});

test.describe("as an admin", () => {
  // Each test walks a whole flow, with a server round trip per step.
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let fixture: DefectsFixture;

  test.beforeAll(async () => {
    fixture = await createDefectsFixture();
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test.beforeEach(async ({ context, baseURL }) => {
    await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  });

  test("adds, checks, edits, deactivates and deletes a code", async ({ page }) => {
    const hydration = watchConsole(page);
    const response = await page.goto("/admin/defects");
    expect(response?.status()).toBe(200);
    await expect(page).toHaveTitle("Defect codes · SteriCare QC");
    await expect(page.getByRole("heading", { name: "Defects", level: 1 })).toBeVisible();
    await expect(page.getByRole("link", { name: /^Codes/ })).toHaveAttribute("aria-current", "page");
    // The seeded master list (BUILD_SPEC 11).
    const stain = page.locator('tbody tr[data-code="stain"]');
    await expect(stain).toContainText("Stain");
    await expect(stain.locator('[data-slot="code-status"]')).toHaveText("Active");
    await expectNoPageScroll(page);
    await expectTouchTarget(stain.getByRole("button", { name: "Edit stain" }));
    if (test.info().project.name === "desktop") {
      // Compact rows with a mouse.
      const height = (await page.locator('tbody tr[data-code="glove_burst"]').boundingBox())?.height ?? 0;
      expect(height).toBeLessThanOrEqual(40);
    }
    await shot(page, "codes");

    // Add: the code is checked as typed, and a duplicate is refused next to its field.
    await press(page.getByRole("button", { name: "Add code" }));
    const panel = page.getByRole("dialog", { name: "Add defect code" });
    await expect(panel).toBeVisible();
    await panel.getByLabel("Code", { exact: true }).fill("2 bad");
    await panel.getByLabel("Name", { exact: true }).fill("E2E defect X (temporary)");
    await press(panel.getByRole("button", { name: "Add code" }));
    await expect(panel.getByText("Start the code with a letter, e.g. torn_cuff.")).toBeVisible();
    await shot(page, "code-add-invalid", { scroll: false });

    await panel.getByLabel("Code", { exact: true }).fill("stain");
    await press(panel.getByRole("button", { name: "Add code" }));
    await expect(panel.getByText("There is already a code stain.")).toBeVisible();

    await panel.getByLabel("Code", { exact: true }).fill("E2E defect x");
    await panel.getByLabel("Description", { exact: true }).fill("Created by e2e/defects. Safe to delete.");
    await press(panel.getByRole("button", { name: "Add code" }));
    await expect(toast(page, "Code e2e_defect_x added.")).toBeVisible();
    await expect(panel).toBeHidden();
    const row = page.locator('tbody tr[data-code="e2e_defect_x"]');
    await expect(row).toContainText("E2E defect X (temporary)");
    expect(await storedCode("e2e_defect_x")).toEqual({
      code: "e2e_defect_x",
      name: "E2E defect X (temporary)",
      description: "Created by e2e/defects. Safe to delete.",
      active: true,
    });

    // Search narrows the list (by code, name, description or template) and keeps the query in the address.
    await page.getByRole("searchbox", { name: "Search codes" }).fill("e2e/defects");
    await expect(row).toBeVisible();
    await expect(stain).toHaveCount(0);
    await expect(page).toHaveURL(/\?q=e2e%2Fdefects$/);
    await expect(page.getByText(/^\d+ of \d+ codes$/)).toBeVisible();
    await shot(page, "codes-search");

    // Edit: the code itself is read-only; the name and description change.
    await press(row.getByRole("button", { name: "Edit e2e_defect_x" }));
    const edit = page.getByRole("dialog", { name: "Edit defect code" });
    await expect(edit).toBeVisible();
    await expect(edit.getByLabel("Code", { exact: true })).toHaveCount(0);
    await expect(edit.getByText("e2e_defect_x", { exact: true })).toBeVisible();
    await edit.getByLabel("Name", { exact: true }).fill("E2E defect X, edited");
    await shot(page, "code-edit", { scroll: false });
    await press(edit.getByRole("button", { name: "Save changes" }));
    await expect(toast(page, "Code e2e_defect_x saved.")).toBeVisible();
    await expect(row).toContainText("E2E defect X, edited");
    expect((await storedCode("e2e_defect_x"))?.name).toBe("E2E defect X, edited");

    // Deactivate, with a confirmation; the code stays, marked inactive. Meanwhile another admin
    // changes the description: the page refreshes after the status change, and a save is then
    // refused instead of quietly writing over their change; a second save replaces it, as offered.
    await press(row.getByRole("button", { name: "Edit e2e_defect_x" }));
    await expect(edit).toBeVisible();
    await edit.getByLabel("Name", { exact: true }).fill("E2E defect X, typed here");
    // Still found by the search above, so the row stays in the list.
    await changeCode("e2e_defect_x", { description: "Changed by another admin in e2e/defects." });
    await press(edit.getByRole("button", { name: "Deactivate code" }));
    const confirm = page.getByRole("alertdialog", { name: "Deactivate e2e_defect_x?" });
    await expect(confirm).toBeVisible();
    await shot(page, "code-deactivate", { scroll: false });
    await press(confirm.getByRole("button", { name: "Deactivate" }));
    await expect(toast(page, /^e2e_defect_x is inactive\./)).toBeVisible();
    // The same button, now Reactivate, keeps the keyboard.
    await expect(edit.getByRole("button", { name: "Reactivate code" })).toBeFocused();
    expect((await storedCode("e2e_defect_x"))?.active).toBe(false);
    await shot(page, "code-inactive-panel", { scroll: false });

    await press(edit.getByRole("button", { name: "Save changes" }));
    await expect(edit.getByText(/^Someone else changed this code while you were editing\./)).toBeVisible();
    expect(await storedCode("e2e_defect_x")).toMatchObject({
      name: "E2E defect X, edited",
      description: "Changed by another admin in e2e/defects.",
    });
    await shot(page, "code-save-refused", { scroll: false });
    await press(edit.getByRole("button", { name: "Save changes" }));
    await expect(edit).toBeHidden();
    expect(await storedCode("e2e_defect_x")).toEqual({
      code: "e2e_defect_x",
      name: "E2E defect X, typed here",
      description: "Created by e2e/defects. Safe to delete.",
      active: false,
    });
    // Back on the Edit button the panel opened from.
    await expect(row.getByRole("button", { name: "Edit e2e_defect_x" })).toBeFocused();
    await expect(row.locator('[data-slot="code-status"]')).toHaveText("Inactive");
    await expect(row).toContainText("E2E defect X, typed here");
    await shot(page, "codes-inactive");

    // A code the seeded templates mention cannot be deleted; this unused one can.
    await press(row.getByRole("button", { name: "Edit e2e_defect_x" }));
    await press(edit.getByRole("button", { name: "Delete code" }));
    const remove = page.getByRole("alertdialog", { name: "Delete e2e_defect_x?" });
    await press(remove.getByRole("button", { name: "Delete code" }));
    await expect(toast(page, "Code e2e_defect_x deleted.")).toBeVisible();
    await expect(row).toHaveCount(0);
    // Its row went with the Edit button, so the keyboard goes to Add code.
    await expect(page.getByRole("button", { name: "Add code" })).toBeFocused();
    expect(await storedCode("e2e_defect_x")).toBeNull();
    expect(hydration()).toEqual([]);
  });

  test("shows each template's labels with their code and severity, and flags a label without a code", async ({ page }) => {
    const hydration = watchConsole(page);
    await page.goto("/admin/defects");
    await press(page.getByRole("link", { name: /^Label mapping/ }));
    await expect(page).toHaveURL(/\/admin\/defects\/labels$/);
    await expect(page).toHaveTitle("Label mapping · SteriCare QC");

    const card = page.locator(`section[data-template="${TEMPLATE_CODE}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator('[data-slot="template-status"]')).toHaveText("Draft");
    // Named by the words it shows first, then the version it opens (WCAG 2.5.3).
    const editorLink = card.getByRole("link", { name: `Open in template editor: ${TEMPLATE_CODE} v1`, exact: true });
    await expect(editorLink).toHaveAttribute("href", `/admin/templates/${fixture.templateId}/edit`);
    // Severity is the class: "Defective bead" is major, "Defective beads" minor, both bead_defective.
    const visual = card.locator('[data-section="visual"]');
    await expect(visual.locator('tbody[data-class="major"]')).toContainText("Major defects · AQL 2.5");
    await expect(visual.locator('tbody[data-class="major"] tr[data-code="bead_defective"]')).toContainText("Defective bead");
    await expect(visual.locator('tbody[data-class="minor"] tr[data-code="bead_defective"]')).toContainText(
      "Defective beads",
    );
    await expect(visual.locator('tr[data-code="stain"]')).toContainText("Oil stain");
    await expect(card.locator('[data-section="watertight"] tr[data-code="hole_other"]')).toContainText("Other :");
    // The template rewords this location: its wording, not its list's, as the module shows it.
    await expect(card.locator('[data-section="watertight"] tr[data-code="hole_crotch"]')).toContainText(
      "Crotch (between fingers)",
    );
    // A label whose code is not a defect code.
    const unknown = visual.locator(`tr[data-code="${NOT_A_CODE}"]`);
    await expect(unknown).toContainText("Not a defect code");
    await expect(card).toContainText("1 label needs attention");
    await expectNoPageScroll(page);

    await page.getByRole("searchbox", { name: "Search labels" }).fill(TEMPLATE_CODE);
    await expect(page.locator("section[data-template]")).toHaveCount(1);
    await shot(page, "labels");

    // The flag links to the codes tab with the add panel filled in.
    const addThisCode = unknown.getByRole("link", { name: `Add this code: ${NOT_A_CODE}` });
    await expectTouchTarget(addThisCode);
    await press(addThisCode);
    const panel = page.getByRole("dialog", { name: "Add defect code" });
    await expect(panel).toBeVisible();
    await expect(panel.getByLabel("Code", { exact: true })).toHaveValue(NOT_A_CODE);
    await expect(panel.getByLabel("Name", { exact: true })).toHaveValue("E2E label without a code");
    await expect(page).toHaveURL(/\/admin\/defects$/);
    await shot(page, "code-add-prefilled", { scroll: false });
    await press(panel.getByRole("button", { name: "Close", exact: true }).first());
    // Opened by the link, not a button on this page: the keyboard goes to Add code.
    await expect(page.getByRole("button", { name: "Add code" })).toBeFocused();
    expect(hydration()).toEqual([]);
  });

  test("maps one-off labels to a code, to a new code, and an Other : hole; a draft waits", async ({ page }) => {
    const hydration = watchConsole(page);
    await page.goto("/admin/defects/unmapped");
    await expect(page).toHaveTitle("Unmapped labels · SteriCare QC");

    const submitted = page.locator(`section[data-ref="${fixture.submitted.refNo}"]`);
    const draft = page.locator(`section[data-ref="${fixture.draft.refNo}"]`);
    await expect(submitted).toBeVisible();
    await expect(submitted.getByRole("link", { name: fixture.submitted.refNo })).toHaveAttribute(
      "href",
      `/inspections/${fixture.submitted.id}/review`,
    );
    // One row for the label, whatever size it was counted in, with each size's count.
    const tornCuff = submitted.locator(`tr[data-label="${LABELS.tornCuff}"]`);
    await expect(tornCuff).toHaveCount(1);
    await expect(tornCuff).toContainText("Visual · Major");
    await expect(tornCuff).toContainText("Unmapped");
    await expect(tornCuff.locator("[data-found] li")).toHaveText(["Size M: 2", "Size L: 1", "3 found in all"]);
    await expect(submitted.locator(`tr[data-label="${LABELS.thumbTip}"]`)).toContainText("Watertight · Other");
    // Only what the inspection counts: not a size outside the order, nor a label counted 0.
    await expect(submitted.locator(`tr[data-label="${LABELS.unordered}"]`)).toHaveCount(0);
    await expect(submitted.locator(`tr[data-label="${LABELS.nothingFound}"]`)).toHaveCount(0);
    await expect(submitted.locator("tbody tr")).toHaveCount(3);
    // The draft is listed, but waits for the inspector.
    await expect(draft).toContainText(LABELS.draft);
    await expect(draft).toContainText("A draft: the inspector may still change these labels.");
    await expect(draft.getByRole("button", { name: /^Map/ })).toHaveCount(0);
    await expectNoPageScroll(page);
    await expectTouchTarget(tornCuff.getByRole("button", { name: /^Map/ }));
    await expectTouchTarget(submitted.getByRole("link", { name: fixture.submitted.refNo }));
    await shot(page, "unmapped");

    // 1. To an existing code: in each size its count joins stain's, in the same class.
    await press(tornCuff.getByRole("button", { name: `Map “${LABELS.tornCuff}” on ${fixture.submitted.refNo}` }));
    let dialog = page.getByRole("dialog", { name: `Map “${LABELS.tornCuff}”` });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("Size M: 2; Size L: 1 (3 found in all)");
    // "Map to" named and described as a screen reader hears it, in Chrome's own tree: getByRole finds
    // the names even where Chrome has none.
    expect(await chromeNames(dialog, "radio")).toEqual([
      { name: "An existing code", description: "One of the active codes." },
      { name: "A new code", description: "Add a code for this label first." },
    ]);
    await press(dialog.getByRole("button", { name: "Map label" }));
    await expect(dialog.getByText("Choose a code.")).toBeVisible();
    // Never a hole location or a Safedon dispensing fault for a visual defect: they would count where
    // no visual list has them. They stay on the full list.
    const elsewhere = /Faulty cuff|Hole in cuff|No cuff|Finger out/;
    await expect(dialog.locator('[id$="-code-description"]')).not.toContainText(elsewhere);
    await press(dialog.getByRole("combobox", { name: "Defect code" }));
    await expect(page.getByRole("group", { name: "Suggested" }).getByRole("option", { name: elsewhere })).toHaveCount(0);
    await shot(page, "map-choose", { scroll: false });
    // A code the template does not list in the class still counts; the dialog says so.
    await press(page.getByRole("option", { name: /^Faulty cuff\b/ }));
    await expect(dialog.getByText(/^Faulty cuff \(faulty_cuff\) is not one of E2E_DEFECTS v1’s major defects\./)).toBeVisible();
    await shot(page, "map-off-list", { scroll: false });
    await press(dialog.getByRole("combobox", { name: "Defect code" }));
    await press(page.getByRole("option", { name: /^Stain\b/ }));
    await expect(dialog.locator("[data-note]")).toHaveCount(0);
    await press(dialog.getByRole("button", { name: "Map label" }));
    await expect(toast(page, `“${LABELS.tornCuff}” on ${fixture.submitted.refNo} now counts as Stain (stain).`)).toBeVisible();
    await expect(tornCuff).toHaveCount(0);
    // Its row has gone: the keyboard waits on the inspection's heading.
    await expect(submitted.getByRole("heading", { level: 2 })).toBeFocused();

    // 2. To a new code, added from the label.
    const stickyEdge = submitted.locator(`tr[data-label="${LABELS.stickyEdge}"]`);
    await press(stickyEdge.getByRole("button", { name: /^Map/ }));
    dialog = page.getByRole("dialog", { name: `Map “${LABELS.stickyEdge}”` });
    await press(dialog.getByRole("radio", { name: /A new code/ }));
    await expect(dialog.getByLabel("Code", { exact: true })).toHaveValue("e2e_sticky_edge");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(LABELS.stickyEdge);
    await expect(dialog.locator("[data-note]")).toContainText("A new code is not one of E2E_DEFECTS v1’s minor defects.");
    // A refused code keeps every choice: React resets a form after its action, which must not flip
    // "Map to" back to an existing code nor clear what was typed.
    await dialog.getByLabel("Code", { exact: true }).fill("9_sticky");
    await press(dialog.getByRole("button", { name: "Add code and map" }));
    await expect(dialog.getByText("Start the code with a letter, e.g. torn_cuff.")).toBeVisible();
    await expect(dialog.getByRole("radio", { name: /A new code/ })).toBeChecked();
    await expect(dialog.getByLabel("Code", { exact: true })).toHaveValue("9_sticky");
    await expect(dialog.getByLabel("Name", { exact: true })).toHaveValue(LABELS.stickyEdge);
    await dialog.getByLabel("Code", { exact: true }).fill("e2e_defect_y");
    await shot(page, "map-new-code", { scroll: false });
    await press(dialog.getByRole("button", { name: "Add code and map" }));
    await expect(toast(page, `Code e2e_defect_y added. “${LABELS.stickyEdge}” on ${fixture.submitted.refNo} now counts as`)).toBeVisible();
    await expect(stickyEdge).toHaveCount(0);
    expect(await storedCode("e2e_defect_y")).toMatchObject({ name: LABELS.stickyEdge, active: true });

    // 3. The Other : hole moves from hole_other to the location chosen.
    const thumbTip = submitted.locator(`tr[data-label="${LABELS.thumbTip}"]`);
    await press(thumbTip.getByRole("button", { name: /^Map/ }));
    dialog = page.getByRole("dialog", { name: `Map “${LABELS.thumbTip}”` });
    await press(dialog.getByRole("combobox", { name: "Defect code" }));
    await press(page.getByRole("option", { name: /^Hole in finger\b/ }));
    await press(dialog.getByRole("button", { name: "Map label" }));
    await expect(toast(page, /now counts as Hole in finger \(hole_finger\)\.$/)).toBeVisible();

    // Nothing left to map on the submitted inspection: only the draft remains, and has the keyboard.
    await expect(submitted).toHaveCount(0);
    await expect(draft).toBeVisible();
    await expect(draft.getByRole("heading", { level: 2 })).toBeFocused();
    await shot(page, "unmapped-done");

    // Recorded on the inspection's data, in every size, so each counts with its code from now on.
    const { data } = await inspectionData(fixture.submitted.id);
    expect(data).toEqual({
      modules: {
        order_lots: ORDER,
        watertight: {
          sizes: {
            M: { tested: 80, holes: { hole_finger: 1 }, otherDescription: null, unmapped: [] },
            L: { tested: 80, holes: {}, otherDescription: null, unmapped: [] },
          },
        },
        visual: {
          sizes: {
            M: {
              critical: { inspected: 80, counts: {}, unmapped: [] },
              // The label counted 0 stays as saved: nothing was found, so nothing was mapped.
              major: { inspected: 80, counts: { stain: 3 }, unmapped: [{ label: LABELS.nothingFound, count: 0 }] },
              minor: { inspected: 80, counts: { e2e_defect_y: 1 }, unmapped: [] },
            },
            L: {
              critical: { inspected: 80, counts: {}, unmapped: [] },
              major: { inspected: 80, counts: { stain: 1 }, unmapped: [] },
              minor: { inspected: 80, counts: {}, unmapped: [] },
            },
            // Not in the order: untouched.
            XL: { major: { inspected: 80, counts: {}, unmapped: [{ label: LABELS.unordered, count: 3 }] } },
          },
        },
      },
      custom: {},
    });
    // And in its audit trail, in the admin's name, with each size.
    const events = await mappingEvents(fixture.submitted.id);
    expect(events.map((event) => event.changes)).toEqual([
      expect.objectContaining({
        label: LABELS.tornCuff,
        code: "stain",
        count: 3,
        class: "major",
        places: [
          { size: "M", hand: null, count: 2 },
          { size: "L", hand: null, count: 1 },
        ],
        new_code: false,
      }),
      expect.objectContaining({ label: LABELS.stickyEdge, code: "e2e_defect_y", count: 1, class: "minor", new_code: true }),
      expect.objectContaining({ label: LABELS.thumbTip, code: "hole_finger", count: 1, kind: "other", new_code: false }),
    ]);
    expect(events.every((event) => event.actor_id !== null)).toBe(true);
    expect(hydration()).toEqual([]);
  });
});
