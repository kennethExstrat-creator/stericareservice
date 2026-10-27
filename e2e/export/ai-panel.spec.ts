import { expect as baseExpect, test, type Locator, type Page } from "@playwright/test";
import { ExportSchema } from "../../lib/schemas/export";
import { sessions } from "../review/support";
import { createTestAdminClient } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";
import {
  activate,
  createExportFixture,
  createInactiveInspector,
  deleteAccount,
  EXCLUDED_MODULE,
  EXCLUDED_REASON,
  expectedAiMode,
  expectNoPageScroll,
  expectTouchTarget,
  FIXTURE_MODULES,
  GLOVE_INFO_COMMENT,
  GLOVE_TYPE,
  isTouch,
  makeImages,
  panelPath,
  press,
  requestAs,
  shot,
  VISUAL_COMMENT,
  watchConsole,
  type ExportFixture,
} from "./support";

/**
 * The AI second opinion (BUILD_SPEC 9.2) end to end on the review screen,
 * and the export it reads (9.1), against the live project, with the dev
 * server on the mock reviewer:
 *
 *   AI_REVIEW_PROVIDER=mock npx next dev -p <port>
 *   PLAYWRIGHT_BASE_URL=http://localhost:<port> npx playwright test e2e/export/ai-panel.spec.ts
 *
 * The panel is found on /inspections/{id}/review; E2E_AI_PANEL_PATH points
 * the specs at another page that renders it. No Steri-AI Report (Kenneth,
 * 27 October 2026: "we already have Client Report"): the panel has no
 * report card and no JSON download.
 *
 * On a temporary submitted inspection of the STD_EG example (real module
 * data, e2e/export/support.ts) an admin requests a second opinion, sees its
 * findings beside the system's results and the inspector's (BUILD_SPEC 12,
 * Phase 3: the AI review panel shows mock findings next to the inspector's
 * results), records agree, disagree (a note is required) and fixed, keeps a
 * half-made decision through a dropped connection and with its own opinion
 * when a newer one lands (in the history, never on the newer one); keyboard
 * focus follows each step; the inspector sees it
 * read-only; the export route's JSON validates with the real modules'
 * data; the export route answers the inspector and admins only.
 * Screenshots go to screenshots/export/.
 */

// A dev server compiles on first use and the database is shared: allow for slow pages
// and for each saved decision's round trip, which brings the whole page again (on a
// machine busy with other builds, that alone has taken half a minute).
test.describe.configure({ mode: "serial", timeout: 240_000 });
const expect = baseExpect.configure({ timeout: 60_000 });
test.skip(expectedAiMode() !== "mock", "E2E_EXPORT_AI=off runs not-connected.spec.ts instead");

const PANEL_CODE = "E2E_EXPORT_PANEL";
const DISAGREE_NOTE = "Checked on site: the module was filled in on paper and entered later.";
const OFFLINE_NOTE = "Written while the factory Wi-Fi was down.";
const HALF_NOTE = "Half-written note on the earlier opinion: never saved.";
const UNREACHABLE = "Could not reach the server. Check the connection, then try again.";

let fixture: ExportFixture;
// One sign-in per account and project: the shared project rate-limits sign-ins.
const as = sessions();

test.beforeAll(async ({ browser }) => {
  fixture = await createExportFixture({ code: PANEL_CODE, images: await makeImages(browser) });
});

test.afterAll(async () => {
  await fixture?.cleanup();
});

function panel(page: Page) {
  return page.getByTestId("ai-panel");
}

/** Findings in the comparison, not in the (closed) history. */
function currentFindings(page: Page) {
  return panel(page).getByTestId("ai-comparison").locator("article[data-finding]");
}

async function openPanel(page: Page) {
  await page.goto(panelPath(fixture.inspectionId));
  await expect(panel(page).getByRole("heading", { level: 2, name: "Steri-AI Second Opinion" })).toBeVisible();
}

async function decide(finding: Locator, choice: "Agree" | "Disagree" | "Fixed", note?: string) {
  await press(finding.getByRole("radio", { name: choice, exact: true }));
  if (note !== undefined) await finding.getByRole("textbox").fill(note);
  await press(finding.getByRole("button", { name: "Save Decision" }));
}

test("an admin requests a second opinion and compares it with the system and the inspector", async ({
  page,
  context,
  baseURL,
}) => {
  const hydration = watchConsole(page);
  await as.signIn(context, baseURL!, "admin");
  await openPanel(page);

  await expect(panel(page).getByTestId("ai-review-not-connected"), "start the dev server with AI_REVIEW_PROVIDER=mock").toHaveCount(0);
  await expect(panel(page).getByText("No Second Opinion Yet")).toBeVisible();
  await expect(panel(page).getByText("Test Data Only")).toBeVisible();
  await expectNoPageScroll(page);
  await shot(page, "admin-before-review");

  const request = panel(page).getByRole("button", { name: "Request Steri-AI Second Opinion" });
  await expectTouchTarget(request);
  await press(request);
  // The button gives way to the notice, which takes focus while the opinion is written.
  await expect(panel(page).getByTestId("ai-review-pending")).toBeFocused();
  // The mock answers at once; the panel polls and refreshes when the row is done.
  await expect(panel(page).getByTestId("ai-comparison")).toBeVisible({ timeout: 90_000 });
  await expect(panel(page).getByTestId("ai-review-pending")).toHaveCount(0);
  // The notice hands focus on to the opinion.
  await expect(panel(page).getByTestId("ai-review-meta")).toBeFocused();

  const overall = panel(page).locator("section[data-section$='-overall']");
  await expect(overall).toContainText("Suggested Result");
  await expect(overall).toContainText("Final Result");
  await expect(overall).toContainText("On Hold");
  // The mock asks about the empty remark.
  await expect(overall).toContainText("What should the client know about this result?");
  await expect(panel(page).getByTestId("ai-review-meta")).toContainText("Mock reviewer (test data only)");
  await expect(panel(page).getByTestId("ai-review-meta")).toContainText("(current)");

  // The mock's findings next to the system's results and the inspector's: the weight warning
  // (with the scale photo as evidence), labelling not done, and the final result of hold.
  const comparison = panel(page).getByTestId("ai-comparison");
  const weight = comparison.locator("section[data-section$='-weight']");
  await expect(weight).toContainText("Weight (g)");
  await expect(weight).toContainText("17.1% below the indicative 3.5 g");
  await expect(weight.locator("article[data-finding]")).toHaveCount(1);
  await expect(comparison.locator("section[data-section$='-labeling'] article[data-finding]")).toHaveCount(1);
  await expect(overall.locator("article[data-finding]")).toHaveCount(1);
  const evidence = weight.locator(`a[href*="${fixture.photoIds.scale}"]`).first();
  await expect(evidence).toBeVisible();
  await expect(evidence.locator("img")).toHaveJSProperty("complete", true);

  // The inspector's comments, and the module switched off with its reason.
  await expect(panel(page)).toContainText(GLOVE_INFO_COMMENT);
  await expect(panel(page)).toContainText(VISUAL_COMMENT);
  await expect(comparison.locator(`section[data-section$='-${EXCLUDED_MODULE}']`)).toContainText(EXCLUDED_REASON);

  await expect(currentFindings(page)).toHaveCount(3);
  await expectNoPageScroll(page);
  await shot(page, "admin-review");

  // Stored as the mock wrote it, for this version of the inspection: its save, and its
  // content once the database has the fingerprint column (migration 20261007113245).
  const admin = createTestAdminClient();
  const reviews = await storedReviews();
  const { data: inspection } = await admin.from("inspections").select("updated_at").eq("id", fixture.inspectionId).single();
  expect(reviews.map(({ status, model, inspection_updated_at }) => ({ status, model, inspection_updated_at }))).toEqual([
    { status: "done", model: "mock", inspection_updated_at: inspection?.updated_at },
  ]);
  const fingerprint = reviews[0].inspection_fingerprint;
  if (fingerprint !== undefined) expect(fingerprint).toMatch(/^[0-9a-f]{64}$/);
  expect(hydration()).toEqual([]);
});

/** The fixture's AI reviews, every column: `inspection_fingerprint` is undefined while the database has no such column. */
async function storedReviews() {
  const { data, error } = await createTestAdminClient()
    .from("ai_reviews")
    .select("*")
    .eq("inspection_id", fixture.inspectionId)
    .order("created_at");
  if (error) throw new Error(`Reading the AI reviews failed: ${error.message}`);
  return data as (Omit<(typeof data)[number], "inspection_fingerprint"> & { inspection_fingerprint?: string | null })[];
}

test("the admin records agree, disagree with a note, and fixed", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await as.signIn(context, baseURL!, "admin");
  await openPanel(page);
  const [first, second, third] = [0, 1, 2].map((index) => currentFindings(page).nth(index));

  await expectTouchTarget(first.getByRole("radio", { name: "Agree", exact: true }));
  await decide(first, "Agree");
  await expect(decisionOf(first)).toContainText("Agreed");
  // The form gives way to the decision: focus goes to its "Change".
  await expect(first.getByRole("button", { name: /Change your decision/ })).toBeFocused();

  // A disagreement needs a note, and focus goes to the note.
  await decide(second, "Disagree");
  const noteError = second.getByText("Add a note explaining why you disagree.");
  await expect(noteError).toBeVisible();
  await expect(second.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  await expect(second.getByRole("textbox")).toBeFocused();
  await shot(page, "admin-disagree-needs-note");
  await second.getByRole("textbox").fill(DISAGREE_NOTE);
  await press(second.getByRole("button", { name: "Save Decision" }));
  await expect(decisionOf(second)).toContainText("Disagreed");
  await expect(decisionOf(second)).toContainText(DISAGREE_NOTE);

  await decide(third, "Fixed", "Inspector added the missing values.");
  await expect(decisionOf(third)).toContainText("Fixed");
  await expect(decisionOf(third)).toContainText("Inspector added the missing values.");
  await shot(page, "admin-decisions");

  // Each decision is a row in the admin's name, and in the audit log.
  const admin = createTestAdminClient();
  const { data: review } = await admin.from("ai_reviews").select("id").eq("inspection_id", fixture.inspectionId).single();
  const { data: actions } = await admin
    .from("ai_review_actions")
    .select("action, note, actor_id")
    .eq("ai_review_id", review!.id)
    .order("at");
  expect(actions).toEqual([
    { action: "agree", note: null, actor_id: fixture.adminId },
    { action: "disagree", note: DISAGREE_NOTE, actor_id: fixture.adminId },
    { action: "fixed", note: "Inspector added the missing values.", actor_id: fixture.adminId },
  ]);
  const { data: events } = await admin
    .from("audit_log")
    .select("action")
    .eq("inspection_id", fixture.inspectionId)
    .like("action", "ai_review.%");
  expect(events?.map((event) => event.action).sort()).toEqual([
    "ai_review.decision",
    "ai_review.decision",
    "ai_review.decision",
    "ai_review.done",
    "ai_review.requested",
  ]);

  // Changing one's mind keeps the earlier decision.
  await press(first.getByRole("button", { name: /Change your decision/ }));
  await decide(first, "Fixed");
  await expect(decisionOf(first)).toContainText("Fixed");
  await expect(first.getByText("Earlier Decisions (1)")).toBeVisible();
  expect(hydration()).toEqual([]);
});

/** The recorded decision of a finding, shown once it is saved. */
function decisionOf(finding: Locator) {
  return finding.locator('[data-testid^="decision-"]');
}

test("a dropped connection leaves the decision form and its note in place", async ({ page, context, baseURL }) => {
  await as.signIn(context, baseURL!, "admin");
  await openPanel(page);
  const first = currentFindings(page).first();
  await press(first.getByRole("button", { name: /Change your decision/ }));
  await press(first.getByRole("radio", { name: "Disagree", exact: true }));
  await first.getByRole("textbox").fill(OFFLINE_NOTE);

  await context.setOffline(true);
  try {
    await press(first.getByRole("button", { name: "Save Decision" }));
    await expect(first.getByRole("alert")).toHaveText(UNREACHABLE);
  } finally {
    await context.setOffline(false);
  }
  // The error is on the form, not the page: the note is still there, and so is focus.
  await expect(page.getByText("This Page Did Not Load")).toHaveCount(0);
  await expect(first.getByRole("textbox")).toHaveValue(OFFLINE_NOTE);
  await expect(first.getByRole("button", { name: "Save Decision" })).toBeFocused();
  await shot(page, "admin-decision-offline");

  // Back online, the same form saves.
  await press(first.getByRole("button", { name: "Save Decision" }));
  await expect(decisionOf(first)).toContainText(OFFLINE_NOTE);
  await expect(first.getByRole("button", { name: /Change your decision/ })).toBeFocused();
});

test("a half-made decision stays with its own opinion when a newer one lands", async ({ page, context, baseURL }) => {
  await as.signIn(context, baseURL!, "admin");
  await openPanel(page);
  const comparison = panel(page).getByTestId("ai-comparison");
  const earlier = await comparison.getAttribute("data-review");
  expect(earlier).toBeTruthy();
  const first = currentFindings(page).first();
  const findingId = await first.getAttribute("data-finding");

  // Start a disagreement on the current opinion, then ask for a newer one.
  await press(first.getByRole("button", { name: /Change your decision/ }));
  await press(first.getByRole("radio", { name: "Disagree", exact: true }));
  await first.getByRole("textbox").fill(HALF_NOTE);
  await press(panel(page).getByRole("button", { name: "Request a New Second Opinion" }));
  await expect(comparison).not.toHaveAttribute("data-review", earlier!, { timeout: 90_000 });
  const newer = await comparison.getAttribute("data-review");
  // A click left focus on the request: it followed the request to the new opinion.
  if (!isTouch()) await expect(panel(page).getByTestId("ai-review-meta")).toBeFocused();

  // The same finding of the new opinion starts afresh, with the new opinion's id.
  const same = comparison.locator(`article[data-finding="${findingId}"]`);
  await expect(same.getByRole("radio", { name: "Disagree", exact: true })).toHaveAttribute("aria-checked", "false");
  await expect(same.getByRole("textbox")).toHaveCount(0);
  const reviewIds = await comparison
    .locator('input[name="reviewId"]')
    .evaluateAll((inputs) => inputs.map((input) => (input as HTMLInputElement).value));
  expect(reviewIds.length).toBeGreaterThan(0);
  expect(new Set(reviewIds)).toEqual(new Set([newer]));
  await expect(comparison).not.toContainText(HALF_NOTE);
  // The half-made decision stays with the earlier opinion, now in the history, for the admin to finish or drop.
  const history = panel(page).getByTestId("ai-review-history");
  await expect(history).toContainText("Earlier Second Opinions (1)");
  await press(history.getByText("Earlier Second Opinions (1)"));
  await press(history.getByText("Show This Opinion"));
  const kept = history.locator(`article[data-finding="${findingId}"]`);
  await expect(kept.getByRole("radio", { name: "Disagree", exact: true })).toHaveAttribute("aria-checked", "true");
  await expect(kept.getByRole("textbox")).toHaveValue(HALF_NOTE);
  await shot(page, "admin-newer-opinion");

  // Nothing was saved with the half-written note.
  const { data: saved } = await createTestAdminClient().from("ai_review_actions").select("id").eq("note", HALF_NOTE);
  expect(saved).toEqual([]);
});

test("the inspector sees the second opinion read-only", async ({ page, context, baseURL }) => {
  const hydration = watchConsole(page);
  await as.signIn(context, baseURL!, "inspector");
  await openPanel(page);
  await expect(panel(page).getByText("An admin decides on each finding.")).toBeVisible();
  await expect(currentFindings(page).first()).toBeVisible();
  await expect(panel(page).getByRole("button", { name: "Save Decision" })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /Change your decision/ })).toHaveCount(0);
  await expect(panel(page).getByRole("button", { name: /Second Opinion/ })).toHaveCount(0);
  // Decisions are for admins only (RLS): the inspector does not see them.
  await expect(panel(page).locator('[data-testid^="decision-"]')).toHaveCount(0);
  // No Steri-AI Report (Kenneth, 27 October 2026): no card, no JSON download.
  await expect(panel(page).getByTestId("ai-report")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Download JSON" })).toHaveCount(0);
  await expectNoPageScroll(page);
  await shot(page, "inspector-review");
  expect(hydration()).toEqual([]);
});

test("the export validates, with working 24-hour links", async ({ page, context, baseURL }) => {
  test.skip(isTouch(), "The export is checked once, on the desktop");
  await as.signIn(context, baseURL!, "admin");

  // No screen links to it since the Steri-AI Report went (27 October 2026): the route answers directly.
  const response = await page.request.get(`/api/inspections/${fixture.inspectionId}/export`);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-disposition"]).toBe(`attachment; filename="${fixture.refNo}-export.json"`);
  const body = await response.json();
  const parsed = ExportSchema.safeParse(body);
  expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues.slice(0, 5))).toBe(true);
  if (!parsed.success) return;
  const doc = parsed.data;

  expect(doc.refNo).toBe(fixture.refNo);
  expect(doc.status).toBe("submitted");
  expect(doc.template.code).toBe(PANEL_CODE);
  // Every STD_EG module in template order, the one switched off listed apart with its reason.
  expect(doc.modules.map((module) => module.key)).toEqual([...FIXTURE_MODULES]);
  expect(doc.excludedModules).toEqual([{ key: EXCLUDED_MODULE, title: "Dimension", reason: EXCLUDED_REASON }]);
  expect(doc.custom).toEqual([expect.objectContaining({ key: "glove_type", values: { gloveType: GLOVE_TYPE } })]);
  const moduleOf = (key: string) => doc.modules.find((module) => module.key === key);
  expect(moduleOf("glove_info")?.comment).toBe(GLOVE_INFO_COMMENT);
  expect(doc.conclusion).toMatchObject({
    suggestedResult: "hold",
    finalResult: "hold",
    remark: null,
    inspector: { id: fixture.inspectorId },
    date: "2025-04-12",
  });

  // The real modules' data, computed values, results, issues and settings.
  expect(moduleOf("order_lots")?.data).toEqual({ sizes: { M: { qtyCases: 2900, lotNumbers: ["E2E-LOT-M-0001"], packingSite: null } } });
  expect(moduleOf("carton_sampling")?.result.status).toBe("pass");
  expect(moduleOf("weight")).toMatchObject({ result: { status: "warn" }, warnings: [{ code: "weight_deviation", size: "M" }] });
  expect(moduleOf("labeling")?.result.status).toBe("not_done");
  const forceAtBreak = moduleOf("force_at_break");
  expect(forceAtBreak?.computed).toMatchObject({ labReportAttached: true, sizes: { M: { median: 6.537, result: "pass" } } });
  expect(forceAtBreak?.config).toMatchObject({ specMin: 6 });
  // The lab report a module keeps by id is in the files, with a link a receiver can fetch.
  expect(forceAtBreak?.data.labReports).toEqual([{ fileId: fixture.fileId, sizes: ["M"] }]);
  expect(doc.files).toEqual([
    expect.objectContaining({ id: fixture.fileId, kind: "lab_report", moduleKey: "force_at_break", name: "Force at break lab report.pdf" }),
  ]);

  // Photos in module order: weight's report photo, then the untagged desktop upload.
  expect(doc.photos.map((photo) => photo.id)).toEqual([fixture.photoIds.scale, fixture.photoIds.untagged]);
  expect(doc.photos[0]).toMatchObject({ moduleKey: "weight", includeInReport: true, target: "size:M" });
  expect(doc.photos[1].moduleKey).toBeNull();

  // The signed links work, and expire after 24 hours.
  const photo = await page.request.get(doc.photos[0].url);
  expect(photo.status()).toBe(200);
  expect(photo.headers()["content-type"]).toContain("image/jpeg");
  const token = new URL(doc.photos[0].url).searchParams.get("token") ?? "";
  const claims = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
  expect(claims.exp - claims.iat).toBe(24 * 60 * 60);
  expect((await page.request.get(doc.files[0].url)).status()).toBe(200);
});

test("the export route answers the inspection's inspector and admins only", async ({ baseURL }) => {
  test.skip(isTouch(), "The route is checked once, on the desktop");
  const url = `/api/inspections/${fixture.inspectionId}/export`;

  const signedOut = await requestAs(baseURL!);
  const anonymous = await signedOut.get(url);
  expect(anonymous.status()).toBe(401);
  expect(await anonymous.json()).toEqual({ error: "unauthorized", message: "Sign in to download the export." });

  const owner = await requestAs(baseURL!, TEST_ACCOUNTS.inspector);
  const mine = await owner.get(url);
  expect(mine.status()).toBe(200);
  expect(mine.headers()["content-disposition"]).toBe(`attachment; filename="${fixture.refNo}-export.json"`);
  expect(mine.headers()["cache-control"]).toBe("private, no-store");
  expect(ExportSchema.safeParse(await mine.json()).success).toBe(true);

  const admin = await requestAs(baseURL!, TEST_ACCOUNTS.admin);
  expect((await admin.get(url)).status()).toBe(200);
  expect((await admin.get("/api/inspections/00000000-0000-4000-8000-000000000000/export")).status()).toBe(404);
  expect((await admin.get("/api/inspections/not-an-id/export")).status()).toBe(404);

  // A new account is inactive until activated: 403. Active, but not the inspector: 404.
  const stranger = await createInactiveInspector();
  try {
    const inactive = await requestAs(baseURL!, stranger.email, stranger.password);
    expect((await inactive.get(url)).status()).toBe(403);
    await activate(stranger);
    const other = await inactive.get(url);
    expect(other.status()).toBe(404);
    expect(await other.json()).toEqual({ error: "not_found", message: "Inspection not found." });
    await inactive.dispose();
  } finally {
    await deleteAccount(stranger);
  }
  await Promise.all([signedOut.dispose(), owner.dispose(), admin.dispose()]);
});
