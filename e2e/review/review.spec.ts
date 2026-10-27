import { randomUUID } from "node:crypto";
import { expect as baseExpect, test } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import {
  createReviewFixture,
  GLOVE_INFO_COMMENT,
  PHOTO_CAPTION,
  REMARK_A,
  WATERTIGHT_COMMENT,
  WEIGHT_OFF_REASON,
  type ReviewFixture,
} from "./fixtures";
import {
  expectNoPageScroll,
  expectTouchTarget,
  press,
  reviewPath,
  sessions,
  shot,
  viewShot,
  watchConsole,
} from "./support";

/**
 * /inspections/[id]/review against the live project, at the three sizes in
 * playwright.config.ts: the admin approves one submitted inspection and
 * reopens another, the inspector reads both and submits the reopened one
 * again, and the audit log records each step. A third, whose results cannot
 * be worked out, gets a caution before approving, not a clean confirmation.
 * Screenshots go to screenshots/review/.
 */

/** On two lines: the browser sends the line break as CRLF, the audit log keeps it as LF. */
const REOPEN_REASON = "Size M watertight: retest the two burst gloves with new samples.\nAdd the photos of the burst cuffs.";

/**
 * An approve or reopen answers with the refreshed page, which reads the
 * review again: on a Mac busy with other builds that takes several seconds.
 */
const expect = baseExpect.configure({ timeout: 20_000 });

test("signed out, the review sends you to sign in and back", async ({ page }) => {
  const path = reviewPath(randomUUID());
  await page.goto(path);
  await expect(page).toHaveURL(new RegExp(`/login\\?next=${encodeURIComponent(path)}$`));
});

test.describe("reviewing inspections", () => {
  // In order: each test moves the shared inspections on (approve, then reopen).
  test.describe.configure({ mode: "serial", timeout: 120_000 });

  let fixture: ReviewFixture;
  const as = sessions();

  test.beforeAll(async ({ browser }) => {
    fixture = await createReviewFixture(browser);
  });

  test.afterAll(async () => {
    await fixture?.cleanup();
  });

  test("the admin sees the facts, results, comments, issues, photos and history", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.A.id));

    await expect(page).toHaveTitle(`Review ${fixture.A.refNo} · SteriCare QC`);
    await expect(page.getByRole("heading", { level: 1, name: fixture.A.refNo })).toBeVisible();
    // Waiting for this admin: the header says Submitted, with Approve beside it (layout A: no notice).
    await expect(page.locator("[data-slot=review-header] [data-slot=inspection-status]")).toHaveText("Submitted");

    const facts = page.locator("[data-slot=inspection-facts]");
    await expect(facts).toContainText("Polyco Healthline");
    await expect(facts).toContainText("Hartalega NGC");
    await expect(facts).toContainText("E2E-REVIEW-PO-A");
    await expect(facts).toContainText("E2E-LOT-A1, E2E-LOT-A2");
    await expect(facts).toContainText("Test Inspector");
    await expect(facts).toContainText("5 Oct 2026");
    await expect(facts).toContainText("E2E_REVIEW Version 1");

    // The inspector's decision beside the app's suggestion; the remark from the conclusion, the row has none yet.
    const result = page.getByRole("region", { name: "Result" });
    await expect(result.getByText("Passed")).toBeVisible();
    await expect(result.getByText(REMARK_A)).toBeVisible();

    // Every included module's computed result, in template order, with its comment.
    const modules = page.getByRole("region", { name: "Module Results" });
    // Rows open on demand (layout A): open them all to read every comment.
    await modules.getByRole("button", { name: "Expand All" }).click();
    const gloveInfo = modules.locator("[data-module=glove_info]");
    await expect(gloveInfo.getByRole("heading", { name: "Glove Information" })).toBeVisible();
    await expect(gloveInfo).toHaveAttribute("data-status", "info");
    await expect(gloveInfo.getByText(GLOVE_INFO_COMMENT)).toBeVisible();
    await expect(modules.locator("[data-module=watertight]").getByText(WATERTIGHT_COMMENT)).toBeVisible();
    await expect(modules.locator("[data-custom=glove_type]")).toContainText("Powder-free");
    const order = await modules.locator("li[data-module], li[data-custom]").evaluateAll((rows) =>
      rows.map((row) => row.getAttribute("data-module") ?? row.getAttribute("data-custom")),
    );
    expect(order).toEqual(["header", "glove_type", "glove_info", "order_lots", "packing_config", "sampling_plan", "watertight", "visual", "conclusion"]);
    // The conclusion has no final result in its own data yet: submit would have waited for it.
    await expect(modules.locator("[data-module=conclusion] [data-level=error]")).toHaveCount(1);

    // Weight is switched off for this inspection, with the reason.
    const switchedOff = page.getByRole("region", { name: "Switched Off for This Inspection" });
    await expect(switchedOff).toContainText(WEIGHT_OFF_REASON);
    await expect(switchedOff).toContainText("Test Admin");
    await expect(modules.locator("[data-module=weight]")).toHaveCount(0);

    // Report photos through signed links, and the way to all of them.
    const photos = page.getByRole("region", { name: "Report Photos" });
    await expect(photos.getByText("2 of 3", { exact: true })).toBeVisible();
    await expect(photos.locator("li[data-photo]")).toHaveCount(2);
    await expect(photos.getByText(PHOTO_CAPTION)).toBeVisible();
    await expect(photos.getByRole("link", { name: "All Photos (3)" })).toHaveAttribute(
      "href",
      `/inspections/${fixture.A.id}/photos`,
    );
    for (const image of await photos.locator("img").all()) {
      await expect(image).toHaveJSProperty("complete", true);
      expect(await image.evaluate((img: HTMLImageElement) => img.naturalWidth)).toBeGreaterThan(0);
    }

    // The AI second opinion between the result and the module results (what it offers depends on the server's
    // AI set-up: e2e/export covers it). No Steri-AI Report (Kenneth, 27 October 2026: "we already have Client Report").
    const ai = page.getByTestId("ai-panel");
    await expect(ai.getByRole("heading", { level: 2, name: "Steri-AI Second Opinion" })).toBeVisible();
    await expect(ai.getByTestId("ai-report")).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Download JSON" })).toHaveCount(0);
    const placed = await page.evaluate(() => {
      const at = (selector: string) => document.querySelector(selector);
      const before = (a: Element | null, b: Element | null) =>
        Boolean(a && b && a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return before(at("#result"), at("[data-testid=ai-panel]")) && before(at("[data-testid=ai-panel]"), at("#modules"));
    });
    expect(placed, "the AI panel sits between the result and the module results").toBe(true);
    const history = page.getByRole("region", { name: "History" });
    await expect(history.locator("li[data-kind=submitted]")).toHaveCount(1);

    await expectTouchTarget(page.getByRole("button", { name: "Approve" }));
    await expectTouchTarget(page.getByRole("button", { name: "Reopen" }));
    await expectNoPageScroll(page);
    await shot(page, "admin-submitted");
    expect(hydration()).toEqual([]);
  });

  test("the admin approves after confirming, and the inspection becomes final", async ({ page, context, baseURL }) => {
    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.A.id));

    await press(page.getByRole("button", { name: "Approve" }));
    const dialog = page.getByRole("alertdialog", { name: `Approve ${fixture.A.refNo}?` });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("An approved inspection is final")).toBeVisible();
    await expect(dialog.getByText("The checks found 1 error.", { exact: false })).toBeVisible();
    // Read out as the dialog opens, cautions included, while focus waits on Cancel.
    await expect(dialog).toHaveAccessibleDescription(/^An approved inspection is final: .*Final Result Passed .*The checks found 1 error\./);
    await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
    await viewShot(page, "admin-approve-dialog");

    await press(dialog.getByRole("button", { name: "Approve" }));
    await expect(page.getByText(`${fixture.A.refNo} is approved.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
    await expect(page.getByText("Test Admin approved it on")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    // Focus lands on the new status, not at the top of the page.
    await expect(page.getByRole("region", { name: "Approved" })).toBeFocused();
    await expect(page.getByRole("region", { name: "History" }).locator("li[data-kind=approved]")).toContainText("Test Admin");
    await viewShot(page, "admin-approved-toast");
    await shot(page, "admin-approved");

    // The database guard set the approver and wrote the audit row.
    const admin = createTestAdminClient();
    const { data: row } = await admin.from("inspections").select("status, approved_by, approved_at").eq("id", fixture.A.id).single();
    expect(row).toMatchObject({ status: "approved", approved_by: fixture.adminId });
    expect(row?.approved_at).toBeTruthy();
    const { data: audit } = await admin
      .from("audit_log")
      .select("action, changes, actor_id")
      .eq("inspection_id", fixture.A.id)
      .eq("action", "status_changed")
      .order("id");
    expect(audit?.at(-1)).toMatchObject({ actor_id: fixture.adminId, changes: { from: "submitted", to: "approved" } });
  });

  test("the inspector sees their approved inspection read-only", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await as.signIn(context, baseURL!, "inspector");
    await page.goto(reviewPath(fixture.A.id));

    await expect(page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
    // Row level security hides other people's profiles from inspectors.
    await expect(page.getByText("An admin approved it on")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Make Changes" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Open Inspection" })).toBeVisible();
    await page.getByRole("region", { name: "Module Results" }).getByRole("button", { name: "Expand All" }).click();
    await expect(page.getByText(GLOVE_INFO_COMMENT)).toBeVisible();
    await expect(page.getByRole("region", { name: "Switched Off for This Inspection" })).toContainText("an admin");
    await expect(page.getByRole("region", { name: "Report Photos" }).locator("li[data-photo]")).toHaveCount(2);
    await expectNoPageScroll(page);
    await shot(page, "inspector-approved");
    expect(hydration()).toEqual([]);
  });

  test("the inspector cannot approve: no button, and the database refuses", async ({ page, context, baseURL }) => {
    await as.signIn(context, baseURL!, "inspector");
    await page.goto(reviewPath(fixture.B.id));

    await expect(page.getByRole("heading", { name: "Waiting for Review" })).toBeVisible();
    await expect(page.getByText("You submitted it on")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    await shot(page, "inspector-submitted");

    // A crafted request with the inspector's own session changes nothing.
    const inspector = await as.client("inspector");
    const { data } = await inspector.from("inspections").update({ status: "approved" }).eq("id", fixture.B.id).select("id");
    expect(data ?? []).toEqual([]);
    const { data: row } = await createTestAdminClient().from("inspections").select("status").eq("id", fixture.B.id).single();
    expect(row?.status).toBe("submitted");
  });

  test("a version the admin has not seen is not approved", async ({ page, context, baseURL }) => {
    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.B.id));
    // Waiting for this admin: the header says Submitted, with Approve beside it (layout A: no notice).
    await expect(page.locator("[data-slot=review-header] [data-slot=inspection-status]")).toHaveText("Submitted");

    // Someone changes B while this admin looks at the old version.
    await fixture.touchB();
    await press(page.getByRole("button", { name: "Approve" }));
    const dialog = page.getByRole("alertdialog", { name: `Approve ${fixture.B.refNo}?` });
    await press(dialog.getByRole("button", { name: "Approve" }));

    await expect(page.getByText(`${fixture.B.refNo} changed after you opened it, so it was not approved.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    // The page now shows the latest version, still waiting for review.
    await expect(page.getByText("Updated by another admin.")).toBeVisible();
    // Waiting for this admin: the header says Submitted, with Approve beside it (layout A: no notice).
    await expect(page.locator("[data-slot=review-header] [data-slot=inspection-status]")).toHaveText("Submitted");
    await viewShot(page, "admin-stale-version");
    const { data: row } = await createTestAdminClient().from("inspections").select("status").eq("id", fixture.B.id).single();
    expect(row?.status).toBe("submitted");
  });

  test("the admin reopens with a reason, and the audit log records both", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.B.id));

    await press(page.getByRole("button", { name: "Reopen" }));
    const dialog = page.getByRole("alertdialog", { name: `Reopen ${fixture.B.refNo}?` });
    const reason = dialog.getByRole("textbox", { name: "What Should the Inspector Change?" });
    // Straight to the reason.
    await expect(reason).toBeFocused();
    await expectTouchTarget(reason);
    if (test.info().project.use.hasTouch) {
      expect(await reason.evaluate((element) => getComputedStyle(element).fontSize)).toBe("16px");
    }

    // A reason is required.
    await press(dialog.getByRole("button", { name: "Reopen" }));
    await expect(dialog.getByText("Say what the inspector should change.")).toBeVisible();
    await expect(reason).toHaveAttribute("aria-invalid", "true");
    await expect(reason).toBeFocused();
    await viewShot(page, "admin-reopen-required");

    await reason.fill(REOPEN_REASON);
    await viewShot(page, "admin-reopen-dialog");
    await press(dialog.getByRole("button", { name: "Reopen" }));
    await expect(page.getByText(`${fixture.B.refNo} is reopened.`)).toBeVisible();
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("heading", { name: "Reopened for Changes" })).toBeVisible();
    await expect(page.getByText(REOPEN_REASON).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    const reopened = page.getByRole("region", { name: "History" }).locator("li[data-kind=reopened]");
    await expect(reopened).toContainText("Test Admin");
    await expect(reopened).toContainText(REOPEN_REASON);
    await shot(page, "admin-reopened");

    const { data: audit } = await createTestAdminClient()
      .from("audit_log")
      .select("action, changes, actor_id")
      .eq("inspection_id", fixture.B.id)
      .order("id");
    const tail = audit?.slice(-2);
    expect(tail?.[0]).toMatchObject({ action: "status_changed", actor_id: fixture.adminId, changes: { from: "submitted", to: "reopened" } });
    expect(tail?.[1]).toMatchObject({ action: "review.reopened", actor_id: fixture.adminId, changes: { reason: REOPEN_REASON } });
    expect(hydration()).toEqual([]);
  });

  test("the inspector sees what to change", async ({ page, context, baseURL }) => {
    await as.signIn(context, baseURL!, "inspector");
    await page.goto(reviewPath(fixture.B.id));

    await expect(page.getByRole("heading", { name: "Reopened: Changes Needed" })).toBeVisible();
    await expect(page.getByText("An admin reopened it on")).toBeVisible();
    const status = page.locator("[data-slot=review-status]");
    await expect(status.getByText("What to Change")).toBeVisible();
    await expect(status.getByText(REOPEN_REASON)).toBeVisible();
    const makeChanges = page.getByRole("link", { name: "Make Changes" });
    await expect(makeChanges).toHaveAttribute("href", `/inspections/${fixture.B.id}`);
    await expectTouchTarget(makeChanges);
    await expectNoPageScroll(page);
    await shot(page, "inspector-reopened");
  });

  test("once the inspector submits it again, it waits for review again", async ({ page, context, baseURL }) => {
    // What the capture screen's submit does since inspectors write through the
    // app's functions (migration 20261007190000; an inspector's own session may
    // not update inspections directly): submit_inspection with the secret key,
    // for the inspector, which checks them again and names them in the history.
    const admin = createTestAdminClient();
    const { data: current, error: readError } = await admin.from("inspections").select("updated_at").eq("id", fixture.B.id).single();
    expect(readError).toBeNull();
    const { data: submittedAt, error } = await admin.rpc("submit_inspection", {
      inspection_id: fixture.B.id,
      actor_id: fixture.inspectorId,
      base_updated_at: current!.updated_at,
      mirrored_columns: {},
    });
    expect(error).toBeNull();
    expect(submittedAt).not.toBeNull();
    const { data: resubmitted } = await admin.from("inspections").select("status").eq("id", fixture.B.id).single();
    expect(resubmitted?.status).toBe("submitted");

    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.B.id));
    // Waiting for this admin: the header says Submitted, with Approve beside it (layout A: no notice).
    await expect(page.locator("[data-slot=review-header] [data-slot=inspection-status]")).toHaveText("Submitted");
    await expect(page.getByRole("button", { name: "Approve" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Reopen" })).toBeVisible();
    // The history keeps the reopen and its reason, then the new submit.
    const history = page.getByRole("region", { name: "History" });
    await expect(history.locator("li[data-kind=reopened]")).toContainText(REOPEN_REASON);
    await expect(history.locator("li[data-kind=resubmitted]")).toContainText("Submitted Again by Test Inspector");
    await shot(page, "admin-resubmitted");
  });

  test("results that cannot be worked out are a caution before approving, not a clean check", async ({ page, context, baseURL }) => {
    const hydration = watchConsole(page);
    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.D.id));

    // Waiting for this admin: the header says Submitted, with Approve beside it (layout A: no notice).
    await expect(page.locator("[data-slot=review-header] [data-slot=inspection-status]")).toHaveText("Submitted");
    await expect(page.getByText("The template version this inspection uses could not be read").first()).toBeVisible();

    // The second opinion needs the results: a quiet note in the panel's place, not an error. The checks above say why.
    const ai = page.getByTestId("ai-panel-no-results");
    await expect(ai.getByRole("heading", { level: 2, name: "Steri-AI Second Opinion" })).toBeVisible();
    await expect(ai.getByText("Not Available", { exact: true })).toBeVisible();
    await expect(page.getByTestId("ai-panel-unavailable")).toHaveCount(0);

    await press(page.getByRole("button", { name: "Approve" }));
    const dialog = page.getByRole("alertdialog", { name: `Approve ${fixture.D.refNo}?` });
    await expect(dialog.getByText("The results could not be worked out, so nothing was checked.", { exact: false })).toBeVisible();
    await expect(dialog).toHaveAccessibleDescription(
      /Suggested Result Could not be worked out The results could not be worked out, so nothing was checked\. Ask a developer before you approve it\.$/,
    );
    await viewShot(page, "admin-unreadable-approve-dialog");

    // Nothing is approved: Cancel closes it and gives focus back to Approve.
    await press(dialog.getByRole("button", { name: "Cancel" }));
    await expect(dialog).toBeHidden();
    await expect(page.getByRole("button", { name: "Approve" })).toBeFocused();
    await shot(page, "admin-unreadable");
    expect(hydration()).toEqual([]);
  });

  test("the admin's own draft says it is not submitted, and offers to go on with it", async ({ page, context, baseURL }) => {
    await as.signIn(context, baseURL!, "admin");
    await page.goto(reviewPath(fixture.C.id));

    await expect(page.getByRole("heading", { name: "Not Submitted Yet" })).toBeVisible();
    // The final result chosen in the conclusion stands in while the row has none.
    const finalResult = page.getByRole("region", { name: "Result" }).getByText("Failed", { exact: true });
    await expect(finalResult).toBeVisible();
    await expect(page.getByText("The results below show what you have saved so far.")).toBeVisible();
    await expect(page.getByRole("link", { name: "Continue Inspection" })).toHaveAttribute("href", `/inspections/${fixture.C.id}`);
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByText("No photos have been taken for this inspection.")).toBeVisible();
    await shot(page, "admin-draft");
  });

  test("someone else's inspection, a missing one or a malformed id is not found", async ({ page, context, baseURL }) => {
    await as.signIn(context, baseURL!, "inspector");
    // The page streams inside the app's loading boundary, so the 404 screen
    // replaces it in place (status 200, noindex), inside the shell. Every
    // case reads the same, and the ref never shows.
    for (const id of [fixture.C.id, randomUUID(), "not-an-id"]) {
      await page.goto(reviewPath(id));
      await expect(page.getByRole("heading", { level: 1, name: "Inspection Not Found" })).toBeVisible();
      await expect(page).toHaveTitle("Inspection Not Found · SteriCare QC");
      await expect(page.getByText(fixture.C.refNo)).toHaveCount(0);
      expect(await page.content()).not.toContain(fixture.C.refNo);
    }
    await expect(page.getByRole("link", { name: "Go to Inspections" })).toHaveAttribute("href", "/inspections");
    await shot(page, "not-found");
  });
});
