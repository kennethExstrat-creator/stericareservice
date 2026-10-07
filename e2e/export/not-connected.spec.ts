import { expect as baseExpect, test } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  createExportFixture,
  expectedAiMode,
  expectNoPageScroll,
  makeImages,
  panelPath,
  shot,
  watchConsole,
  type ExportFixture,
} from "./support";

/**
 * The panel on the review screen with nothing connected (BUILD_SPEC 9.1,
 * 9.2): "AI second opinion not connected", and "AI not connected" with the
 * JSON download. Run against a dev server with the second opinion switched
 * off and no report service (an empty variable counts as not set):
 *
 *   AI_REVIEW_PROVIDER=off AI_REPORT_WEBHOOK_URL= npx next dev -p <port>
 *   E2E_EXPORT_AI=off PLAYWRIGHT_BASE_URL=http://localhost:<port> npx playwright test e2e/export/not-connected.spec.ts
 *
 * The panel is found on /inspections/{id}/review; E2E_AI_PANEL_PATH points
 * the specs at another page that renders it, e.g. /some-page/{id}.
 */

// A dev server compiles on first use and the database is shared: allow for slow pages.
test.describe.configure({ mode: "serial", timeout: 120_000 });
const expect = baseExpect.configure({ timeout: 30_000 });
test.skip(expectedAiMode() !== "off", "Set E2E_EXPORT_AI=off with a dev server that has no AI connected");

let fixture: ExportFixture;

test.beforeAll(async ({ browser }) => {
  fixture = await createExportFixture({ code: "E2E_EXPORT_OFF", images: await makeImages(browser) });
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

test("an admin sees that neither hand-off is connected, and can still download the export", async ({
  page,
  context,
  baseURL,
}) => {
  const hydration = watchConsole(page);
  await signIn(context, baseURL!, TEST_ACCOUNTS.admin);
  await page.goto(panelPath(fixture.inspectionId));
  const panel = page.getByTestId("ai-panel");

  await expect(panel.getByTestId("ai-review-not-connected")).toContainText("AI second opinion not connected");
  // This dev server runs AI_REVIEW_PROVIDER=off: the hint says it is switched off, and how to switch it on.
  await expect(panel.getByTestId("ai-review-not-connected")).toContainText(
    "It is switched off on the server: AI_REVIEW_PROVIDER is set to off.",
  );
  await expect(panel.getByRole("button", { name: /second opinion/ })).toHaveCount(0);
  const report = panel.getByTestId("ai-report");
  await expect(report).toContainText("AI not connected");
  await expect(report.getByRole("button", { name: /Send to AI report/ })).toHaveCount(0);
  await expect(report.getByRole("link", { name: "Download JSON" })).toHaveAttribute(
    "href",
    `/api/inspections/${fixture.inspectionId}/export`,
  );
  await expectNoPageScroll(page);
  await shot(page, "admin-not-connected");
  expect(hydration()).toEqual([]);
});

test("the inspector sees the same, without the set-up hints", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);
  await page.goto(panelPath(fixture.inspectionId));
  const panel = page.getByTestId("ai-panel");
  await expect(panel.getByTestId("ai-review-not-connected")).toContainText("An admin can connect it.");
  await expect(panel).not.toContainText("ANTHROPIC_API_KEY");
  await shot(page, "inspector-not-connected");
});
