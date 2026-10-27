import { devices, expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient, deleteTestInspection } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";
import { drawImage, labReportPdf } from "../photos/support";
import { Auditor, isTouch, press, settle, type ScreenOptions } from "./ux/audit";
import { stdEgData } from "./ux/example-data";
import { createUxFixture, removeUxFixture, type UxFixture } from "./ux/fixtures";
import { addSession, open, signInOnce } from "./ux/session";

/**
 * Final acceptance: design, touch and accessibility (BUILD_SPEC 2.1, 8, 10;
 * docs/DESIGN.md; Kenneth's preferences), every screen and state at the four
 * sizes in playwright.config.ts, as the inspector, the admin and a throwaway
 * lead inspector with a team. For each: screenshots (scrolled viewport shots
 * on touch, e2e/README.md), the layout measurements of ux/measure.ts (page
 * overflow, 44 px targets and 16 px field text on touch, clipped, spilling
 * and squeezed text, names), axe-core, a keyboard walk and the console.
 * Records go to screenshots/acceptance-ux/<project>/<account>/; gather them
 * with `node e2e/acceptance/ux/report.mts [project] [screen]`.
 *
 * It records rather than fails: the run is the evidence for the audit. Set
 * UX_AUDIT_STRICT=1 to fail on page overflow, small touch targets, small
 * field text, serious axe violations and console errors (less what the final
 * audit judged acceptable, ACCEPTED below), on a step that could not run,
 * and on the final audit's findings UX-01 to UX-14 coming back.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3900 npx playwright test e2e/acceptance/ux-audit.spec.ts --project=desktop
 *   node e2e/acceptance/ux/report.mts desktop          # what broke a rule, screen by screen
 *
 * Rows: ./ux/fixtures.ts (five inspections and three throwaway accounts per
 * project, deleted at the end). Admin > Templates, with its editor, is gone
 * (Kenneth, 26 October 2026), so it is not audited. Switches:
 *
 *   UX_AUDIT_KEEP=1      keep the rows for the next run (no new ref numbers);
 *                        UX_AUDIT_CLEANUP=1 deletes them afterwards
 *   UX_AUDIT_WEBKIT=1    WebKit, the iPad's engine, at the project's size
 *   UX_AUDIT_VIEWPORT=WxH  another size, e.g. 1024x1366 (13 inch iPad portrait)
 *
 * Keyboard: `tabs` walks forward from the top of a page, `tabsBack` walks
 * Shift+Tab from its end, where a sticky bar can cover the field focus
 * scrolls to (WCAG 2.4.11).
 */

const STRICT = process.env.UX_AUDIT_STRICT === "1";

/**
 * UX_AUDIT_WEBKIT=1 runs the same audit in WebKit, the engine of Chrome and
 * Safari on the iPad, at the project's size: with --project=ipad-pro-landscape
 * that is Kenneth's 13 inch iPad. Records go to <project>-webkit/.
 */
if (process.env.UX_AUDIT_WEBKIT === "1") {
  test.use({
    browserName: "webkit",
    userAgent: devices["iPad Pro 11"].userAgent,
    deviceScaleFactor: 2,
    isMobile: true,
    hasTouch: true,
  });
}

/**
 * UX_AUDIT_VIEWPORT=1024x1366 runs the project at another size, e.g. a 13 inch
 * iPad in portrait with --project=ipad-portrait. Records go to <project>-<size>/.
 */
const VIEWPORT = /^(\d+)x(\d+)$/.exec(process.env.UX_AUDIT_VIEWPORT ?? "");
if (VIEWPORT) test.use({ viewport: { width: Number(VIEWPORT[1]), height: Number(VIEWPORT[2]) } });

// Not serial: a screen that cannot be reached must not hide the screens after it.
test.describe.configure({ timeout: 20 * 60_000 });

/** UX_AUDIT_CLEANUP=1: only delete the project's rows (after runs with UX_AUDIT_KEEP=1); every test skips. */
const CLEANUP_ONLY = process.env.UX_AUDIT_CLEANUP === "1";

let fixture: UxFixture;

test.beforeAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  if (CLEANUP_ONLY) {
    await removeUxFixture(testInfo.project.name);
    return;
  }
  fixture = await createUxFixture(testInfo.project.name);
});

test.beforeEach(() => {
  test.skip(CLEANUP_ONLY, "UX_AUDIT_CLEANUP=1: rows deleted, nothing audited");
});

test.afterAll(async ({}, testInfo) => {
  testInfo.setTimeout(240_000);
  await fixture?.cleanup();
});

/* ------------------------------------------------------------------ *
 * Helpers
 * ------------------------------------------------------------------ */

type ScreenRecord = Awaited<ReturnType<Auditor["screen"]>>;
type AxeNode = ScreenRecord["axe"][number]["nodes"][number];

/** Lower case, one space: names compared as a speech user says them. */
function spoken(text: string | null): string {
  return (text ?? "").toLowerCase().replace(/\s+/g, " ").trim();
}

/** What the final audit judged acceptable (its verdicts of 7 October 2026), left out of the strict rules. */
const ACCEPTED = {
  /**
   * DESIGN.md (Do/Don't, UX-10): a control's accessible name starts with the
   * words it shows, so a speech user can say what they see (WCAG 2.5.3). axe's
   * label-content-name-mismatch also wants the rest of what it shows in the
   * name. UX-10's verdict judged that a best-practice cleanup for two
   * controls: the account menu (the email under its name, "Test Admin,
   * account menu") and the template editor's module buttons, gone with
   * Admin > Templates (Kenneth, 26 October 2026). The Pending rows ([data-task], a
   * row's status and sizes) are this spec's addition under DESIGN.md's rule,
   * not part of that verdict. Only these controls are accepted, and only when
   * the name starts with the first words they show: any other control, or a
   * name in other words, still fails.
   */
  axeNode: (rule: string, node: AxeNode) =>
    rule === "label-content-name-mismatch" &&
    (/^\["(button|div)\[data-task=/.test(node.target) || /, account menu$/.test(node.label ?? "")) &&
    spoken(node.shows) !== "" &&
    spoken(node.label).startsWith(spoken(node.shows)),
  /** A stepper's value sits between its 44 px − and + as a keyboard stop; the buttons are the touch targets. */
  smallTarget: (target: ScreenRecord["layout"]["smallTargets"][number]) =>
    target.role === "spinbutton" && target.path.includes("[data-slot=stepper]"),
  /** A screen meant to be missing answers 404, which the browser logs. */
  console: (record: ScreenRecord, line: string) => record.screen.includes("not-found") && /status of 404/.test(line),
};

/** The capture screen's own address (not its photos or review). */
function isCaptureScreen(record: ScreenRecord): boolean {
  return /^\/inspections\/[0-9a-f-]{36}(\?|$)/.test(record.url);
}

/** In strict mode the hard rules fail the test; otherwise the records are the result. */
function checkStrict(record: ScreenRecord) {
  if (!STRICT) return;
  // UX-01: the page never scrolls sideways.
  expect.soft(record.layout.pageOverflowX, `${record.screen}: the page scrolls sideways`).toBeLessThanOrEqual(0);
  // UX-07: 44 px hit areas, counting the border.
  expect
    .soft(
      record.layout.smallTargets.filter((target) => !target.inline && !ACCEPTED.smallTarget(target)),
      `${record.screen}: touch targets under 44 px`,
    )
    .toEqual([]);
  expect.soft(record.layout.smallFieldText, `${record.screen}: field text under 16 px`).toEqual([]);
  // UX-03 (radios without a name: button-name) and UX-10 (label-content-name-mismatch) among them.
  const axe = record.axe
    .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
    .map((violation) => ({ ...violation, nodes: violation.nodes.filter((node) => !ACCEPTED.axeNode(violation.id, node)) }))
    .filter((violation) => violation.nodes.length > 0);
  expect.soft(axe, `${record.screen}: axe`).toEqual([]);
  // UX-13: no heading level skipped (a best-practice rule axe rates moderate).
  expect.soft(record.axe.filter((violation) => violation.id === "heading-order"), `${record.screen}: heading levels`).toEqual([]);
  expect
    .soft(
      record.console.filter((line) => /^(error|pageerror)/.test(line) && !ACCEPTED.console(record, line)),
      `${record.screen}: console`,
    )
    .toEqual([]);
  // UX-02: going down or back up, no control lands under a sticky bar or column. A focusable panel
  // taller than half the screen (a tab panel, the list's table) cannot come into view whole: the walk
  // samples only its top edge, so it is left out.
  expect
    .soft(
      [...record.focus, ...record.focusBack].filter((stop) => stop.obscuredBy && stop.rect.height <= record.layout.viewport.height / 2),
      `${record.screen}: focus under a sticky bar or column`,
    )
    .toEqual([]);
  if (isCaptureScreen(record) && !record.touch) {
    // UX-11: a section title the desktop sidebar cuts short can still be read, in full, on hover.
    expect
      .soft(
        record.layout.clipped.filter((text) => !text.title && /progress-tracker|^li > button/.test(text.path)),
        `${record.screen}: sidebar titles cut with no way to read them`,
      )
      .toEqual([]);
  }
  if (record.screen.endsWith("dispensing_safedon")) {
    // UX-12: the defect labels keep their column however many boxes sit beside them.
    expect.soft(record.layout.squeezed, `${record.screen}: text squeezed into a narrow column`).toEqual([]);
  }
}

async function audit(auditor: Auditor, name: string, options: ScreenOptions = {}) {
  const record = await auditor.screen(name, options);
  checkStrict(record);
  return record;
}

/**
 * Runs a step; a failure is recorded as a note and the walk goes on to the
 * next screen. In strict mode it also fails the test: a screen went unaudited.
 */
async function step(auditor: Auditor, name: string, body: () => Promise<void>) {
  try {
    await body();
  } catch (error) {
    const message = String(error).split("\n").slice(0, 6).join(" ");
    await auditor.screen(`step-failed-${name}`, { axe: false, shot: "viewport", notes: [message] }).catch(() => undefined);
    test.info().annotations.push({ type: "step failed", description: `${name}: ${message}` });
    if (STRICT) {
      expect
        .soft(() => {
          throw error;
        }, `step ${name} could not run`)
        .not.toThrow();
    }
  }
}

/** Signed in for each test: one sign-in per account and worker, renewed only when its token runs low (ux/session.ts). */
function useAccount(email: () => string, password?: () => string) {
  test.beforeEach(async ({ context, baseURL }) => {
    if (CLEANUP_ONLY) return;
    await addSession(context, baseURL!, await signInOnce(email(), password?.()));
  });
}

/**
 * Typed text that a reload must bring back (Kenneth: nothing typed is ever
 * lost): a tab's draft comes back after hydration, so it gets a moment.
 */
async function valueAfterReload(field: Locator, typed: string): Promise<string> {
  await expect(field).toHaveValue(typed, { timeout: 10_000 }).catch(() => undefined);
  return (await field.count()) > 0 ? field.inputValue() : "";
}

/** UX-04 and UX-08 in strict mode: what was typed before the reload is back. */
function checkKept(kept: string, typed: string, what: string) {
  if (STRICT) expect.soft(kept, `${what} survives a reload`).toBe(typed);
}

/** UX-09 in strict mode: Ref, Status and Result lead the list, in view before any sideways scroll. */
async function checkListColumns(page: Page) {
  if (!STRICT) return;
  const columns = await page.evaluate(() => {
    const box = document.querySelector<HTMLElement>("[data-slot=table-scroller]")?.getBoundingClientRect();
    return [...document.querySelectorAll("thead th")].slice(0, 3).map((th) => {
      const rect = th.getBoundingClientRect();
      return { name: (th.textContent ?? "").trim(), inView: !!box && rect.left >= box.left - 1 && rect.right <= box.right + 1 };
    });
  });
  expect.soft(columns, "the list's first columns").toEqual(["Ref", "Status", "Result"].map((name) => ({ name, inView: true })));
}

/** UX-05 in strict mode: a read-only capture screen has no Pending list. */
async function checkNoPending(page: Page) {
  if (STRICT) await expect.soft(page.locator("[data-action=issues]"), "Pending on a read-only screen").toHaveCount(0);
}

/** The visible one of a pair (the iPad header's and the desktop sidebar's). */
function visibleOf(page: Page, selector: string): Locator {
  return page.locator(`${selector}:visible`).first();
}

async function captureReady(page: Page) {
  await expect(page.locator("[data-slot=capture-screen]")).toBeVisible({ timeout: 30_000 });
  await page.waitForLoadState("networkidle").catch(() => undefined);
}

async function closeOverlay(page: Page) {
  await page.keyboard.press("Escape");
  await page.waitForTimeout(250);
}

/**
 * Kenneth's list: one line per row, the table (not the page) scrolls
 * sideways, Ref and the actions pinned. Measured, as notes on the record.
 */
async function listFacts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll<HTMLTableRowElement>("tbody tr")];
    if (rows.length === 0) return ["no rows"];
    const heights = rows.map((row) => Math.round(row.getBoundingClientRect().height));
    const wrapped = rows.flatMap((row) =>
      [...row.cells].flatMap((cell) => {
        const lineHeight = Number.parseFloat(getComputedStyle(cell).lineHeight) || 24;
        const texts = [...cell.querySelectorAll("span, time")].filter(
          (el) => !el.closest(".sr-only") && el.children.length === 0 && (el.textContent ?? "").trim() !== "",
        );
        return texts.some((el) => el.getBoundingClientRect().height > lineHeight * 1.5)
          ? [`${row.dataset.ref}: "${cell.textContent?.trim().slice(0, 30)}"`]
          : [];
      }),
    );
    const first = rows[0].cells[0];
    const last = rows[0].cells[rows[0].cells.length - 1];
    const scroller = document.querySelector<HTMLElement>("[data-slot=table-scroller]");
    const headers = [...document.querySelectorAll("thead th")].map((th) => {
      const rect = th.getBoundingClientRect();
      const box = scroller?.getBoundingClientRect();
      const shown = box ? rect.left >= box.left - 1 && rect.right <= box.right + 1 : true;
      return `${(th.textContent ?? "").trim() || "(actions)"}${shown ? "" : " [scrolled out]"}`;
    });
    return [
      `rows ${rows.length}, heights ${Math.min(...heights)}-${Math.max(...heights)} px`,
      `wrapped cells: ${wrapped.length ? wrapped.join("; ") : "none"}`,
      `ref cell ${getComputedStyle(first).position}, actions cell ${getComputedStyle(last).position}`,
      `table scroller ${scroller ? `${scroller.scrollWidth} in ${scroller.clientWidth}` : "missing"}, page ${document.documentElement.scrollWidth} in ${document.documentElement.clientWidth}`,
      `columns in view: ${headers.join(", ")}`,
    ];
  });
}

/** Kenneth's capture header: short, Back on the right; Pending with a blue dot; the iPad layout on every touchscreen. */
async function captureFacts(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const visible = (el: Element | null) => !!el && (el as HTMLElement).offsetParent !== null && el.getBoundingClientRect().width > 0;
    const header = document.querySelector("[data-slot=capture-screen] [data-slot=page-header]");
    const actions = header ? [...header.querySelectorAll("a, button")].filter(visible) : [];
    const named = actions.map((el) => {
      const rect = el.getBoundingClientRect();
      return { name: (el.textContent ?? "").replace(/\s+/g, " ").trim(), right: Math.round(rect.right), top: Math.round(rect.top), height: Math.round(rect.height) };
    });
    const back = named.find((action) => action.name.startsWith("Back"));
    const rightmost = named.reduce((max, action) => (action.right > (max?.right ?? -1) ? action : max), named[0]);
    const pending = [...document.querySelectorAll("[data-action=issues]")].find(visible);
    const dot = pending?.querySelector("[data-slot=pending-dot]");
    const headerRect = header?.getBoundingClientRect();
    return [
      `layout: ${visible(document.querySelector("[data-testid=shell-sidebar]")) ? "desktop sidebar" : "iPad top bar"}, sections as ${visible(document.querySelector("[data-slot=section-tabs]")) ? "tabs" : "a sidebar list"}`,
      `header ${headerRect ? Math.round(headerRect.height) : "?"} px tall; actions: ${named.map((action) => `${action.name} (${action.height}px, right ${action.right}, top ${action.top})`).join(", ")}`,
      `Back is ${back && rightmost && back.name === rightmost.name ? "rightmost" : `not rightmost (rightmost: ${rightmost?.name})`}`,
      `Pending: "${(pending?.textContent ?? "").replace(/\s+/g, " ").trim()}", dot ${dot ? getComputedStyle(dot).backgroundColor : "none"}`,
    ];
  });
}

/** Every section of the capture screen, in order: [data-section] on the tabs and the sidebar list. */
async function sectionKeys(page: Page): Promise<string[]> {
  return page.locator("[data-section]").evaluateAll((elements) => [
    ...new Set(elements.map((element) => (element as HTMLElement).dataset.section!).filter(Boolean)),
  ]);
}

/**
 * Opens a section: a tap on its tab in the iPad layout. The desktop sidebar's
 * list carries no keys, so there the screen opens on it (?module=).
 */
async function openSection(page: Page, key: string) {
  if (isWide(page)) {
    const id = /\/inspections\/([0-9a-f-]{36})/.exec(page.url())?.[1];
    if (!id) throw new Error(`not on a capture screen: ${page.url()}`);
    await open(page, `/inspections/${id}?module=${key}`);
    await captureReady(page);
  } else {
    await press(page, visibleOf(page, `[data-section="${key}"]`));
    await page.waitForTimeout(350);
    await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** The desktop layout: 1280 px and wider without touch (app/globals.css). */
function isWide(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= 1280 && !isTouch();
}

/** Every section of an inspection: screenshots and measurements, a keyboard walk in a few. */
async function auditSections(page: Page, auditor: Auditor, prefix: string, walk: readonly string[] = []) {
  const keys = await sectionKeys(page);
  expect(keys.length, "the capture screen lists its sections").toBeGreaterThan(2);
  for (const key of keys) {
    await step(auditor, `${prefix}-${key}`, async () => {
      await openSection(page, key);
      await audit(auditor, `${prefix}-${key}`, { tabs: walk.includes(key) ? 70 : 0, maxParts: 8 });
    });
  }
  return keys;
}

/* ------------------------------------------------------------------ *
 * Signed out
 * ------------------------------------------------------------------ */

test("signed out: sign in, forgot password, link expired", async ({ page }) => {
  const auditor = new Auditor(page, "signed-out");
  await open(page, "/login");
  await audit(auditor, "login", { tabs: 12 });

  // Empty submit: the form's own errors.
  await press(page, page.getByRole("button", { name: "Sign In" }));
  await settle(page);
  await audit(auditor, "login-empty-submit");

  // A wrong password: one sign-in attempt against Supabase.
  await page.getByLabel("Email").fill(TEST_ACCOUNTS.inspector);
  await page.getByLabel("Password", { exact: true }).fill("not-the-password-1");
  await press(page, page.getByRole("button", { name: "Sign In" }));
  await expect(page.getByText(/incorrect/i)).toBeVisible({ timeout: 15_000 });
  await settle(page);
  await audit(auditor, "login-wrong-password");

  // Each notice the sign-in screen can open with.
  for (const code of ["deactivated", "link_invalid", "session_expired"]) {
    await open(page, `/login?error=${code}`);
    await audit(auditor, `login-notice-${code}`);
  }

  await open(page, "/forgot-password");
  await audit(auditor, "forgot-password", { tabs: 8 });
  // An address that is not one: refused before any email is sent.
  await page.getByLabel("Email").fill("not an email");
  await press(page, page.getByRole("button", { name: "Send Reset Link" }));
  await settle(page);
  await audit(auditor, "forgot-password-invalid");

  await open(page, "/reset-password");
  await audit(auditor, "reset-password-link-expired", { tabs: 6 });

  await open(page, "/no-such-page");
  await audit(auditor, "not-found-signed-out");
});

/* ------------------------------------------------------------------ *
 * The inspector
 * ------------------------------------------------------------------ */

test.describe("inspector", () => {
  useAccount(() => TEST_ACCOUNTS.inspector);

  test("the inspections list: rows, filters, search, sideways scroll, delete", async ({ page }) => {
    const auditor = new Auditor(page, "inspector");
    await open(page, "/inspections");
    await checkListColumns(page);
    await audit(auditor, "list", { tabs: 40, notes: await listFacts(page) });

    await step(auditor, "list-row-without-po", async () => {
      // A draft whose header has no PO yet (every new one): its "No PO yet" is
      // sr-only text in a cell. Unanchored, it escapes the table's scroller and
      // widens the page (docs/DESIGN.md, Do / Don't).
      const { id, ref } = fixture.inspections.stdSg;
      await fixture.setPo(id, null);
      try {
        await open(page, "/inspections");
        await expect(page.locator(`tbody tr[data-ref="${ref}"]`)).toBeVisible();
        const width = await page.evaluate(() => ({
          page: document.documentElement.scrollWidth,
          viewport: document.documentElement.clientWidth,
        }));
        await audit(auditor, "list-row-without-po", {
          axe: false,
          notes: [
            `page ${width.page} px wide in a ${width.viewport} px viewport (${width.page > width.viewport ? "scrolls sideways" : "fits"})`,
            ...(await listFacts(page)),
          ],
        });
      } finally {
        await fixture.setPo(id, `${fixture.poPrefix}-SG`);
      }
    });

    await step(auditor, "list-scrolled-to-end", async () => {
      // The table scrolled to its far end: Ref and the actions stay pinned.
      const scroller = page.locator("[data-slot=table-scroller]").first();
      await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await audit(auditor, "list-scrolled-to-end", { axe: false, shot: "viewport" });
      await scroller.evaluate((el) => el.scrollTo({ left: 0 }));
    });

    await step(auditor, "list-status-picker-open", async () => {
      await press(page, page.getByRole("combobox", { name: "Status" }));
      await expect(page.getByRole("listbox")).toBeVisible();
      await settle(page);
      await audit(auditor, "list-status-picker-open", { shot: "viewport", within: "[role=listbox]" });
      await closeOverlay(page);
    });

    await step(auditor, "list-client-picker-open", async () => {
      await press(page, page.getByRole("combobox", { name: "Client" }));
      await expect(page.getByRole("listbox")).toBeVisible();
      await settle(page);
      await audit(auditor, "list-client-picker-open", { shot: "viewport", within: "[role=listbox]" });
      await closeOverlay(page);
    });

    await step(auditor, "list-filtered-draft", async () => {
      await open(page, "/inspections?status=draft");
      await audit(auditor, "list-filtered-draft");
    });

    await step(auditor, "list-search-one", async () => {
      await open(page, "/inspections");
      const search = page.getByLabel("Search", { exact: true });
      await search.fill(fixture.inspections.stdEg.ref);
      await search.press("Enter");
      await expect(page).toHaveURL(/q=/);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await expect(page.locator("tbody tr")).toHaveCount(1);
      await audit(auditor, "list-search-one", { tabs: 20, notes: await listFacts(page) });
    });

    await step(auditor, "list-no-matches", async () => {
      await open(page, "/inspections?q=NO-SUCH-INSPECTION-999");
      await audit(auditor, "list-no-matches", { tabs: 20 });
    });

    await step(auditor, "list-past-the-end", async () => {
      await open(page, "/inspections?page=99");
      await audit(auditor, "list-past-the-end");
    });

    await step(auditor, "list-delete-dialog", async () => {
      // Delete on this run's STD_SG draft: the dialog, then Cancel.
      await open(page, `/inspections?q=${encodeURIComponent(fixture.inspections.stdSg.ref)}`);
      const row = page.locator(`tbody tr[data-ref="${fixture.inspections.stdSg.ref}"]`);
      await expect(row).toBeVisible();
      await press(page, row.getByRole("button", { name: /Delete/ }));
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "list-delete-dialog", { shot: "viewport", within: "[role=alertdialog]", tabs: 6 });
      await press(page, page.getByRole("button", { name: "Cancel" }));
      await expect(page.getByRole("alertdialog")).toBeHidden();
    });

    await step(auditor, "account-menu", async () => {
      await open(page, "/inspections");
      await press(page, page.getByRole("button", { name: /account menu/i }));
      await expect(page.getByRole("menu")).toBeVisible();
      await settle(page);
      await audit(auditor, "account-menu", { shot: "viewport", within: "[role=menu]" });
      await closeOverlay(page);
    });

    await step(auditor, "not-found", async () => {
      await open(page, "/inspections/00000000-0000-4000-8000-000000000999");
      await audit(auditor, "inspection-not-found");
      await open(page, "/admin");
      await audit(auditor, "admin-not-found-for-inspector");
    });
  });

  test("new inspection", async ({ page }) => {
    const auditor = new Auditor(page, "inspector");
    await open(page, "/inspections/new");
    await audit(auditor, "new-inspection", { tabs: 30 });

    await step(auditor, "new-inspection-client-open", async () => {
      await press(page, page.getByRole("combobox", { name: "Client" }));
      await expect(page.getByRole("listbox")).toBeVisible();
      await settle(page);
      await audit(auditor, "new-inspection-client-open", { shot: "viewport", within: "[role=listbox]" });
      await press(page, page.getByRole("option", { name: /Polyco/ }));
    });
    await step(auditor, "new-inspection-picked", async () => {
      await press(page, page.getByRole("combobox", { name: "Manufacturer" }));
      await expect(page.getByRole("listbox")).toBeVisible();
      await press(page, page.getByRole("option", { name: /Hartalega/ }));
      // The product type: the examination choice card.
      const exam = page.getByRole("radio", { name: /Examination/i });
      if (await exam.count()) await press(page, exam.first());
      await settle(page);
      await audit(auditor, "new-inspection-picked", { tabs: 40 });
    });
    await step(auditor, "new-inspection-reload", async () => {
      // Kenneth: nothing typed is ever lost on a reload. The form keeps its choices and the name in the tab (UX-04).
      const name = "Nitrile gloves typed before a reload (UX audit)";
      await page.locator("input[name=productName]").fill(name);
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const kept = await valueAfterReload(page.locator("input[name=productName]"), name);
      await audit(auditor, "new-inspection-after-reload", {
        axe: false,
        notes: [`typed product name after a reload: ${kept === name ? "kept" : `lost (field holds "${kept}")`}`],
      });
      checkKept(kept, name, "UX-04: the typed product name");
      if (STRICT) {
        await expect.soft(page.getByRole("combobox", { name: "Client" }), "UX-04: the client after a reload").toContainText("Polyco");
        await expect.soft(page.getByRole("combobox", { name: "Manufacturer" }), "UX-04: the manufacturer after a reload").toContainText("Hartalega");
      }
    });
    await step(auditor, "new-inspection-empty-submit", async () => {
      // The form keeps what was chosen in the tab until Create or Cancel (UX-04): drop the
      // draft the reload kept, so the form opens empty and Create is refused.
      await page.evaluate(() => {
        for (const key of Object.keys(sessionStorage)) {
          if (key.startsWith("stericare:new-inspection:")) sessionStorage.removeItem(key);
        }
      });
      await open(page, "/inspections/new");
      await press(page, page.getByRole("button", { name: "Create Inspection" }));
      await settle(page);
      // Nothing chosen: refused on the form. Should one ever be created, it goes again at once.
      const created = /\/inspections\/([0-9a-f-]{36})/.exec(page.url());
      if (created) await deleteTestInspection(createTestAdminClient(), created[1]);
      await audit(auditor, "new-inspection-empty-submit");
    });
  });

  test("capture: STD_EG, every section, Pending, submit, save states", async ({ page, context }) => {
    const auditor = new Auditor(page, "inspector");
    const { id } = fixture.inspections.stdEg;
    await open(page, `/inspections/${id}`);
    await captureReady(page);
    await audit(auditor, "capture-stdeg-start", { tabs: 40, notes: await captureFacts(page) });

    await auditSections(page, auditor, "capture-stdeg", ["header", "dimensions", "visual"]);

    await step(auditor, "capture-stdeg-pending", async () => {
      await press(page, visibleOf(page, "[data-action=issues]"));
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "capture-stdeg-pending-sheet", { shot: "viewport", within: "[role=dialog]", tabs: 20 });
      await closeOverlay(page);
    });

    await step(auditor, "capture-stdeg-submit-blocked", async () => {
      await press(page, visibleOf(page, "[data-action=submit]"));
      await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toBeVisible();
      await settle(page);
      await audit(auditor, "capture-stdeg-submit-blocked", { shot: "viewport" });
      await closeOverlay(page);
    });

    await step(auditor, "capture-stdeg-photo", async () => {
      await openSection(page, "glove_info");
      const photo = await drawImage(page, { name: "glove-surface.jpg", type: "image/jpeg", width: 1600, height: 1200, label: "Surface" });
      await page.locator('[data-slot="module-photos"] input[data-photo-input="library"]').first().setInputFiles(photo);
      await expect(page.locator('[data-slot="photo-card"][data-upload-state="uploaded"]').first()).toBeVisible({ timeout: 45_000 });
      await audit(auditor, "capture-stdeg-glove-info-with-photo");
    });

    await step(auditor, "capture-stdeg-lab-report", async () => {
      await openSection(page, "force_at_break");
      const slot = page.locator('[data-slot="file-slot"]').first();
      await slot.locator("input[data-file-input]").setInputFiles({
        name: "force-at-break-lab-report-with-a-long-file-name-2026-10-07.pdf",
        mimeType: "application/pdf",
        buffer: labReportPdf(),
      });
      await expect(slot.locator('[data-slot="file-row"][data-upload-state="uploaded"]')).toHaveCount(1, { timeout: 45_000 });
      await audit(auditor, "capture-stdeg-force-with-lab-report");
    });

    await step(auditor, "capture-stdeg-save-states", async () => {
      await openSection(page, "header");
      const field = page
        .locator("[data-slot=capture-screen] input[type=text]:not([readonly]):not([disabled]), [data-slot=capture-screen] textarea:not([readonly])")
        .first();
      await field.click();
      // Saving: hold the save so the pill stays.
      let release: () => void = () => undefined;
      const held = new Promise<void>((resolve) => (release = resolve));
      await page.route("**/*", async (route) => {
        const request = route.request();
        if (request.method() === "POST" && (await request.headerValue("next-action"))) {
          await held;
          return route.continue();
        }
        return route.fallback();
      });
      await field.pressSequentially(" A", { delay: 30 });
      await expect(page.locator('[data-slot=save-status][data-state="saving"]:visible')).toBeVisible({ timeout: 10_000 });
      await audit(auditor, "capture-save-saving", { shot: "viewport", axe: false });
      release();
      await page.unrouteAll({ behavior: "ignoreErrors" });
      await expect(page.locator('[data-slot=save-status][data-state="saved"]:visible')).toBeVisible({ timeout: 20_000 });
      await audit(auditor, "capture-save-saved", { shot: "viewport", axe: false });
      // Offline: the change waits on the device.
      await context.setOffline(true);
      await field.pressSequentially("B", { delay: 30 });
      await expect(page.locator('[data-slot=save-status][data-state="offline"]:visible')).toBeVisible({ timeout: 20_000 });
      await audit(auditor, "capture-save-offline", { shot: "viewport" });
      await context.setOffline(false);
      await expect(page.locator('[data-slot=save-status][data-state="saved"]:visible')).toBeVisible({ timeout: 30_000 });
    });

    await step(auditor, "capture-stdeg-submit-confirm", async () => {
      // The example corrected and finished: Submit asks for confirmation.
      await fixture.setData(id, stdEgData({ corrected: true, finished: true }));
      await open(page, `/inspections/${id}`);
      await captureReady(page);
      await press(page, visibleOf(page, "[data-action=submit]"));
      await expect(page.getByRole("alertdialog").or(page.getByRole("dialog"))).toBeVisible();
      await settle(page);
      await audit(auditor, "capture-stdeg-submit-confirm", { shot: "viewport", tabs: 6 });
      await closeOverlay(page);
    });

    await step(auditor, "photos-gallery", async () => {
      await open(page, `/inspections/${id}/photos`);
      await audit(auditor, "photos-gallery", { tabs: 30 });
      const card = page.locator('[data-slot="photo-card"]').first();
      const edit = card.getByRole("button", { name: /Edit tags and caption/ });
      if (await edit.count()) {
        await press(page, edit);
        await expect(page.getByRole("dialog")).toBeVisible();
        await settle(page);
        await audit(auditor, "photos-edit-dialog", { shot: "viewport", within: "[role=dialog]", tabs: 12 });
        await closeOverlay(page);
      }
      const remove = card.getByRole("button", { name: /Delete photo/ });
      if (await remove.count()) {
        await press(page, remove);
        await expect(page.getByRole("alertdialog")).toBeVisible();
        await settle(page);
        await audit(auditor, "photos-delete-dialog", { shot: "viewport", within: "[role=alertdialog]" });
        await closeOverlay(page);
      }
      const image = card.locator("button, a").first();
      await press(page, image);
      await page.waitForTimeout(500);
      await audit(auditor, "photos-viewer", { shot: "viewport" });
      await closeOverlay(page);
    });
  });

  test("capture: SAFEDON_EG, every section", async ({ page }) => {
    const auditor = new Auditor(page, "inspector");
    await open(page, `/inspections/${fixture.inspections.safedon.id}`);
    await captureReady(page);
    await auditSections(page, auditor, "capture-safedon", ["dispensing_safedon", "tensile"]);
  });

  test("capture: STD_SG, every section", async ({ page }) => {
    const auditor = new Auditor(page, "inspector");
    await open(page, `/inspections/${fixture.inspections.stdSg.id}`);
    await captureReady(page);
    await auditSections(page, auditor, "capture-stdsg", ["watertight", "dye_leak"]);
  });

  test("own submitted inspection: review and read-only capture", async ({ page }) => {
    const auditor = new Auditor(page, "inspector");
    const { id } = fixture.inspections.submitted;
    await open(page, `/inspections/${id}/review`);
    await audit(auditor, "review-own-submitted", { tabs: 40, maxParts: 10 });
    await open(page, `/inspections/${id}`);
    await captureReady(page);
    await audit(auditor, "capture-submitted-read-only", { tabs: 30, notes: await captureFacts(page) });
    await checkNoPending(page);
    await openSection(page, "dimensions");
    await audit(auditor, "capture-submitted-read-only-dimensions");
  });
});

/* ------------------------------------------------------------------ *
 * Keyboard going back up: what the sticky bars cover
 * ------------------------------------------------------------------ */

test.describe("keyboard, going back up", () => {
  useAccount(() => TEST_ACCOUNTS.admin);

  // Shift+Tab from the end of each page: a field scrolled into view at the top
  // must not land under the shell's top bar (iPad layout) or a page's own sticky bar.
  test("Shift+Tab from the end of each page", async ({ page }) => {
    const auditor = new Auditor(page, "admin-keyboard");
    const pages: [string, string][] = [
      ["list", "/inspections"],
      ["new-inspection", "/inspections/new"],
      ["review", `/inspections/${fixture.inspections.memberSubmitted.id}/review`],
      ["capture-header", `/inspections/${fixture.inspections.stdSg.id}?module=header`],
      ["users", "/admin/users"],
    ];
    for (const [name, url] of pages) {
      await step(auditor, `back-${name}`, async () => {
        await open(page, url);
        await audit(auditor, `back-${name}`, { shot: false, axe: false, tabsBack: 40 });
      });
    }
  });
});

/* ------------------------------------------------------------------ *
 * A new inspector in a team: reset password, empty list
 * ------------------------------------------------------------------ */

test("newcomer: password screens from an email link, the empty list", async ({ page }) => {
  const auditor = new Auditor(page, "newcomer");
  // A reset link as Supabase would email it, without sending anything.
  const { data, error } = await createTestAdminClient().auth.admin.generateLink({ type: "recovery", email: fixture.newcomer.email });
  const tokenHash = data.properties?.hashed_token;
  expect(error, "generateLink").toBeNull();
  await open(page, `/auth/confirm?token_hash=${encodeURIComponent(tokenHash!)}&type=recovery`);
  await expect(page).toHaveURL(/\/reset-password/);
  await audit(auditor, "reset-password-recovery", { tabs: 10 });

  await step(auditor, "reset-password-mismatch", async () => {
    await page.getByLabel("New Password", { exact: true }).fill("Fresh-gloves-2027");
    await page.getByLabel("Confirm New Password", { exact: true }).fill("Fresh-gloves-2028");
    await press(page, page.getByRole("button", { name: "Save New Password" }));
    await settle(page);
    await audit(auditor, "reset-password-mismatch");
  });

  await open(page, "/inspections");
  await audit(auditor, "list-empty", { tabs: 12 });
});

/* ------------------------------------------------------------------ *
 * The lead inspector
 * ------------------------------------------------------------------ */

test.describe("lead inspector", () => {
  useAccount(
    () => fixture.lead.email,
    () => fixture.lead.password,
  );

  test("team list, a team member's review and capture", async ({ page }) => {
    const auditor = new Auditor(page, "lead");
    await open(page, "/inspections");
    await checkListColumns(page);
    await audit(auditor, "list-team", { tabs: 30, notes: await listFacts(page) });
    const { id } = fixture.inspections.memberSubmitted;
    await open(page, `/inspections/${id}/review`);
    await audit(auditor, "review-team-member", { tabs: 30, maxParts: 10 });
    await open(page, `/inspections/${id}`);
    await captureReady(page);
    await audit(auditor, "capture-team-member-read-only", { tabs: 20, notes: await captureFacts(page) });
    await checkNoPending(page);
    if (STRICT) {
      // UX-06: whose inspection it is, never "an admin can send it back to you".
      await expect
        .soft(page.locator('[data-notice="submitted"]'), "UX-06: the lead's notice")
        .toContainText(`Submitted for review by ${fixture.member.name}: read-only.`);
    }
    await open(page, `/inspections/${id}/photos`);
    await audit(auditor, "photos-team-member");
  });
});

/* ------------------------------------------------------------------ *
 * The admin
 * ------------------------------------------------------------------ */

test.describe("admin", () => {
  useAccount(() => TEST_ACCOUNTS.admin);

  test("list, overview, new inspection", async ({ page }) => {
    const auditor = new Auditor(page, "admin");
    await open(page, "/inspections");
    await checkListColumns(page);
    await audit(auditor, "list-all", { tabs: 40, notes: await listFacts(page) });
    await step(auditor, "list-all-scrolled", async () => {
      const scroller = page.locator("[data-slot=table-scroller]").first();
      await scroller.evaluate((el) => el.scrollTo({ left: el.scrollWidth }));
      await audit(auditor, "list-all-scrolled-to-end", { axe: false, shot: "viewport" });
    });
    await open(page, "/admin");
    await audit(auditor, "admin-overview", { tabs: 30 });
    await open(page, "/inspections/new");
    await audit(auditor, "new-inspection-admin", { tabs: 30 });
  });

  test("users with teams", async ({ page }) => {
    const auditor = new Auditor(page, "admin");
    await open(page, "/admin/users");
    await audit(auditor, "users", { tabs: 40, maxParts: 8 });

    await step(auditor, "users-actions-menu", async () => {
      await press(page, page.getByRole("button", { name: `Actions for ${fixture.member.name}` }).first());
      await expect(page.getByRole("menu")).toBeVisible();
      await settle(page);
      await audit(auditor, "users-actions-menu", { shot: "viewport", within: "[role=menu]" });
      await closeOverlay(page);
    });

    await step(auditor, "users-team-filter", async () => {
      const showTeam = page.getByRole("button", { name: /Show Their Team/ }).or(page.getByRole("link", { name: /Show Their Team/ }));
      if (await showTeam.count()) {
        await press(page, showTeam.first());
        await page.waitForLoadState("networkidle").catch(() => undefined);
        await settle(page);
        await audit(auditor, "users-team-filtered");
      }
    });

    await step(auditor, "users-invite-dialog", async () => {
      await open(page, "/admin/users");
      await press(page, page.getByRole("button", { name: "Invite User" }));
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "users-invite-dialog", { shot: "viewport", within: "[role=dialog]", tabs: 14 });
      // Inspector chosen: the lead inspector picker.
      await closeOverlay(page);
    });
  });

  test("manufacturers and clients", async ({ page }) => {
    const auditor = new Auditor(page, "admin");
    await open(page, "/admin/manufacturers");
    await audit(auditor, "manufacturers", { tabs: 30 });
    await step(auditor, "manufacturers-add-panel", async () => {
      await press(page, page.getByRole("button", { name: "Add Manufacturer" }).first());
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "manufacturers-add-panel", { shot: "viewport", within: "[role=dialog]", tabs: 14 });
      await closeOverlay(page);
    });
    await step(auditor, "manufacturers-edit-panel", async () => {
      await press(page, page.getByRole("button", { name: /Hartalega/ }).or(page.getByRole("link", { name: /Hartalega/ })).first());
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "manufacturers-edit-panel", { shot: "viewport", within: "[role=dialog]" });
      await closeOverlay(page);
    });

    await open(page, "/admin/clients");
    await audit(auditor, "clients", { tabs: 30 });
    await step(auditor, "clients-add-panel", async () => {
      await press(page, page.getByRole("button", { name: "Add Client" }).first());
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "clients-add-panel", { shot: "viewport", within: "[role=dialog]", tabs: 14 });
      await closeOverlay(page);
    });
    await step(auditor, "clients-edit-panel", async () => {
      await press(page, page.getByRole("button", { name: /Polyco/ }).or(page.getByRole("link", { name: /Polyco/ })).first());
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "clients-edit-panel", { shot: "viewport", within: "[role=dialog]" });
      await closeOverlay(page);
    });
  });

  test("defects: codes, label mapping, unmapped labels", async ({ page }) => {
    const auditor = new Auditor(page, "admin");
    await open(page, "/admin/defects");
    await audit(auditor, "defects-codes", { tabs: 30, maxParts: 8 });
    await step(auditor, "defects-code-panel", async () => {
      await press(page, page.getByRole("button", { name: /Thin spot|thin_spot/ }).or(page.getByRole("link", { name: /Thin spot|thin_spot/ })).first());
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "defects-code-panel", { shot: "viewport", within: "[role=dialog]", tabs: 14 });
      await closeOverlay(page);
    });
    await open(page, "/admin/defects/labels");
    await audit(auditor, "defects-labels", { tabs: 30, maxParts: 8 });
    await open(page, "/admin/defects/unmapped");
    await audit(auditor, "defects-unmapped", { tabs: 20 });
    await step(auditor, "defects-map-dialog", async () => {
      // The team member's submitted inspection carries a defect in the inspector's own words.
      const row = page.locator("li, tr, article").filter({ hasText: "Cuff rolled inward" }).first();
      await press(page, row.getByRole("button", { name: /^Map/ }).first());
      await expect(page.getByRole("dialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "defects-map-dialog", { shot: "viewport", within: "[role=dialog]", tabs: 14 });
      await closeOverlay(page);
    });
  });

  test("capture as admin: switch a module off", async ({ page }) => {
    const auditor = new Auditor(page, "admin");
    await open(page, `/inspections/${fixture.inspections.stdSg.id}`);
    await captureReady(page);
    await audit(auditor, "capture-admin-stdsg", { tabs: 30, notes: await captureFacts(page) });
    await step(auditor, "capture-admin-switch-off-dialog", async () => {
      await openSection(page, "dye_leak");
      await press(page, page.getByRole("button", { name: /Switch Off/ }).first());
      await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toBeVisible();
      await settle(page);
      await audit(auditor, "capture-admin-switch-off-dialog", { shot: "viewport", tabs: 8 });
      // The reason, typed, then the page reloaded (the module stays on: nothing is sent).
      const reason = "Not part of this client's order (UX audit).";
      await page.getByLabel("Reason").fill(reason);
      await page.reload();
      await captureReady(page);
      await press(page, page.getByRole("button", { name: /Switch Off/ }).first());
      await expect(page.getByRole("dialog").or(page.getByRole("alertdialog"))).toBeVisible();
      const kept = await valueAfterReload(page.getByLabel("Reason"), reason);
      await audit(auditor, "capture-admin-switch-off-after-reload", {
        shot: false,
        axe: false,
        notes: [`typed switch-off reason after a reload: ${kept === reason ? "kept" : `lost (field holds "${kept}")`}`],
      });
      checkKept(kept, reason, "UX-08: the typed switch-off reason");
      // Cancelled: nothing is sent, and the kept reason goes.
      await closeOverlay(page);
    });
  });

  test("review: approve and reopen dialogs, AI second opinion, approved", async ({ page }) => {
    const auditor = new Auditor(page, "admin");
    const { id } = fixture.inspections.submitted;
    await open(page, `/inspections/${id}/review`);
    await audit(auditor, "review-submitted", { tabs: 50, maxParts: 10 });

    await step(auditor, "review-approve-dialog", async () => {
      await press(page, page.getByRole("button", { name: "Approve" }).first());
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "review-approve-dialog", { shot: "viewport", within: "[role=alertdialog]", tabs: 6 });
      await closeOverlay(page);
    });
    await step(auditor, "review-reopen-dialog", async () => {
      await press(page, page.getByRole("button", { name: "Reopen" }).first());
      await expect(page.getByRole("alertdialog")).toBeVisible();
      await settle(page);
      await audit(auditor, "review-reopen-dialog", { shot: "viewport", within: "[role=alertdialog]", tabs: 6 });
      // Kenneth: nothing typed is ever lost on a reload. The reason, typed, then the page reloaded.
      const reason = "Recount the carton list for size M (UX audit).";
      await page.getByLabel("What Should the Inspector Change?").fill(reason);
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await press(page, page.getByRole("button", { name: "Reopen" }).first());
      await expect(page.getByRole("alertdialog")).toBeVisible();
      const kept = await valueAfterReload(page.getByLabel("What Should the Inspector Change?"), reason);
      await audit(auditor, "review-reopen-after-reload", {
        shot: "viewport",
        axe: false,
        notes: [`typed reason after a reload: ${kept === reason ? "kept" : `lost (field holds "${kept}")`}`],
      });
      checkKept(kept, reason, "UX-08: the typed reason for reopening");
      await closeOverlay(page);
    });
    await step(auditor, "review-ai-opinion", async () => {
      // "Request a New Second Opinion" once one exists (a kept set from an earlier run).
      const request = page.getByRole("button", { name: /^Request (Steri-AI|a New) Second Opinion/ }).first();
      await press(page, request);
      // The mock answers within seconds; the panel polls until the comparison shows (its description
      // says "for each finding" from the start, so text alone does not tell the opinion is there).
      await expect(page.getByTestId("ai-comparison")).toBeVisible({ timeout: 90_000 });
      await expect(page.locator("[data-sonner-toast]")).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
      await page.waitForLoadState("networkidle").catch(() => undefined);
      // UX-14: a long evidence value (a quoted warning) reads on a line of its own, left aligned.
      const values = await page.locator("article[data-finding] dl > div").evaluateAll((rows) =>
        rows.map((row) => {
          const value = row.querySelector("dd");
          return {
            text: (value?.textContent ?? "").trim(),
            layout: row.getAttribute("data-layout"),
            align: value ? getComputedStyle(value).textAlign : "",
          };
        }),
      );
      const long = values.filter((value) => value.text.length > 24);
      const apart = long.filter((value) => value.layout === "block" && ["left", "start"].includes(value.align));
      await audit(auditor, "review-with-ai-opinion", {
        tabs: 60,
        maxParts: 12,
        notes: [`evidence values: ${values.length}; long ones on a line of their own, left aligned: ${apart.length} of ${long.length}`],
      });
      if (STRICT) {
        expect.soft(long.length, "UX-14: the mock's evidence has long values to check").toBeGreaterThan(0);
        expect.soft(long.filter((value) => !apart.includes(value)), "UX-14: long evidence values").toEqual([]);
      }
    });
    await step(auditor, "review-ai-disagree", async () => {
      const disagree = page.getByRole("button", { name: /^Disagree/ }).or(page.getByRole("radio", { name: /^Disagree/ })).first();
      await press(page, disagree);
      await settle(page);
      await audit(auditor, "review-ai-disagree-note", { maxParts: 12 });
      // The admin's note, typed, then the page reloaded: the choice and the note come back (UX-08).
      const note = "The sample plan follows the client's own level (UX audit).";
      await page.getByLabel("Why Do You Disagree?").first().fill(note);
      await page.reload();
      await page.waitForLoadState("networkidle").catch(() => undefined);
      const field = page.getByLabel("Why Do You Disagree?").first();
      const typed = await valueAfterReload(field, note);
      const kept = (await field.count()) ? typed : "(no note field: the choice is gone too)";
      await audit(auditor, "review-ai-note-after-reload", {
        shot: false,
        axe: false,
        notes: [`typed disagree note after a reload: ${kept === note ? "kept" : `lost (${kept || "empty"})`}`],
      });
      checkKept(kept, note, "UX-08: the choice to disagree and its note");
    });
    await step(auditor, "review-approved", async () => {
      await open(page, `/inspections/${id}/review`);
      await press(page, page.getByRole("button", { name: "Approve" }).first());
      const dialog = page.getByRole("alertdialog");
      await expect(dialog).toBeVisible();
      await press(page, dialog.getByRole("button", { name: "Approve" }));
      await expect(dialog).toBeHidden({ timeout: 30_000 });
      await page.waitForLoadState("networkidle").catch(() => undefined);
      await audit(auditor, "review-approved", { tabs: 30, maxParts: 10 });
      await open(page, `/inspections/${id}`);
      await captureReady(page);
      await audit(auditor, "capture-approved-read-only");
      await checkNoPending(page);
    });
  });
});
