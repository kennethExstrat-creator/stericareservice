import { randomUUID } from "node:crypto";
import { devices, expect, test, webkit } from "@playwright/test";
import { createDataFixture, readyData, todayInMalaysia, type DataFixture, type FixtureInspection } from "./data-fixtures";
import {
  callFormAction,
  callServerAction,
  device,
  localCopy,
  localCopyKeys,
  onlyDesktopProject,
  openCapture,
  press,
  recordWrites,
  savePill,
  serverActionId,
  shot,
  SHOTS,
  typeInto,
} from "./data-support";

/**
 * Final acceptance: data integrity and the inspection life cycle, live
 * (BUILD_SPEC 5, 8 and 10; docs/OFFLINE.md; docs/DATABASE.md). Runs once, in
 * the desktop project; the two-device checks open an iPad (1366 x 1024,
 * touch, Chromium and WebKit) and a desktop side by side. Throwaway accounts,
 * client, template and inspections only (data-fixtures.ts), removed
 * afterwards. Screenshots go to screenshots/acceptance-data/.
 *
 *   PLAYWRIGHT_BASE_URL=http://localhost:3900 npx playwright test e2e/acceptance/data-integrity.spec.ts --project=desktop
 *
 * The audit's findings are tested as they stand now, each named by its id
 * (D1, L1, ...) from the audit report: fixed ones (D1, L1, M2, M3, S1, S2)
 * check the fix; those judged by design (C1, M1, T2) check the designed
 * behaviour. A new finding gets a test marked test.fail() with its evidence
 * attached as an annotation; once it is fixed the test fails as "expected to
 * fail, but passed": remove its test.fail() line then.
 */

test.describe.configure({ mode: "serial", timeout: 240_000 });

let fx: DataFixture;

test.beforeAll(async () => {
  test.setTimeout(180_000);
  if (test.info().project.name !== "desktop") return;
  fx = await createDataFixture();
});

test.afterAll(async () => {
  test.setTimeout(180_000);
  await fx?.cleanup();
});

test.beforeEach(() => onlyDesktopProject());

/* ------------------------------------------------------------------ *
 * Two devices, one inspection
 * ------------------------------------------------------------------ */

test("two devices on one draft: the second device's edit is never lost silently", async ({ browser, baseURL }) => {
  const draft = await fx.createInspection("inspector", { data: readyData(`TWO${fx.suffix}`) });
  const session = await fx.session("inspector");
  const ipad = await device(browser, baseURL!, session, "ipad", "ipad");
  const desk = await device(browser, baseURL!, session, "desktop", "desktop");
  try {
    await Promise.all([openCapture(ipad.page, draft.id, "glove_info"), openCapture(desk.page, draft.id, "glove_info")]);

    // The iPad changes the colour and saves.
    await typeInto(ipad.page.getByLabel("Glove Colour"), "Blue from the iPad");
    await expect.poll(async () => (await fx.row(draft.id))?.data.modules.glove_info.colour, { timeout: 20_000 }).toBe(
      "Blue from the iPad",
    );
    await expect(savePill(ipad.page)).toHaveAttribute("data-state", "saved");

    // The desktop, opened before that save, changes the texture: its save finds a version it never saw.
    await typeInto(desk.page.getByLabel("Glove Surface Texture"), "Textured on the desktop");
    const question = desk.page.getByRole("alertdialog", { name: "This Inspection Was Changed on Another Device" });
    await expect(question).toBeVisible({ timeout: 20_000 });
    await expect(question).toContainText("Choose which version to keep. The other one is replaced.");
    await shot(desk.page, "two-devices-desktop-question");

    // Nothing was merged or overwritten meanwhile: the server keeps the iPad's version, the desktop's edit waits in its local copy.
    const meanwhile = await fx.row(draft.id);
    expect(meanwhile?.data.modules.glove_info).toMatchObject({ colour: "Blue from the iPad", surfaceTexture: "Finger-textured" });
    const deskCopy = await localCopy(desk.page, session.userId, draft.id);
    expect(deskCopy?.data.modules.glove_info.surfaceTexture).toBe("Textured on the desktop");
    expect(deskCopy!.revision).toBeGreaterThan(deskCopy!.syncedRevision);

    // The desktop keeps its version: the server takes it whole (the iPad's colour is replaced, as the question said).
    await press(question.getByRole("button", { name: "Keep the Changes on This Device" }), false);
    await expect(question).toBeHidden();
    await expect
      .poll(async () => (await fx.row(draft.id))?.data.modules.glove_info, { timeout: 20_000 })
      .toMatchObject({ surfaceTexture: "Textured on the desktop", colour: "Original blue" });
    await expect(savePill(desk.page)).toHaveAttribute("data-state", "saved");
    // Meanwhile the iPad still shows its colour as saved: nothing tells it the server replaced it
    // until its next save asks (by design, C1: the question offers whole versions, no field merge).
    await expect(ipad.page.getByLabel("Glove Colour")).toHaveValue("Blue from the iPad");
    await expect(savePill(ipad.page)).toHaveAttribute("data-state", "saved");
    await shot(ipad.page, "two-devices-ipad-still-saved-after-replace");

    // The iPad, still showing its own colour, edits again: it is asked too, and does not overwrite the desktop's version.
    await typeInto(ipad.page.getByLabel("Glove Length"), "250 mm on the iPad");
    const ipadQuestion = ipad.page.getByRole("alertdialog", { name: "This Inspection Was Changed on Another Device" });
    await expect(ipadQuestion).toBeVisible({ timeout: 20_000 });
    expect((await fx.row(draft.id))?.data.modules.glove_info).toMatchObject({
      surfaceTexture: "Textured on the desktop",
      length: "240 mm",
    });
    await shot(ipad.page, "two-devices-ipad-question");

    // The iPad takes the desktop's version: its screen shows it, and saving goes on from there.
    await press(ipadQuestion.getByRole("button", { name: "Use the Version From the Other Device" }), true);
    await expect(ipadQuestion).toBeHidden();
    await expect(ipad.page.getByLabel("Glove Surface Texture")).toHaveValue("Textured on the desktop");
    await expect(ipad.page.getByLabel("Glove Colour")).toHaveValue("Original blue");
    await typeInto(ipad.page.getByLabel("Glove Length"), "245 mm, agreed");
    await expect
      .poll(async () => (await fx.row(draft.id))?.data.modules.glove_info, { timeout: 20_000 })
      .toMatchObject({ surfaceTexture: "Textured on the desktop", length: "245 mm, agreed" });
  } finally {
    await ipad.context.close();
    await desk.context.close();
  }
});

test("two devices with the iPad on WebKit (Chrome for iPad's engine): the question appears on the iPad too", async ({
  browser,
  baseURL,
}) => {
  const draft = await fx.createInspection("inspector", { data: readyData(`WK${fx.suffix}`) });
  const session = await fx.session("inspector");
  let engine: Awaited<ReturnType<typeof webkit.launch>>;
  try {
    engine = await webkit.launch();
  } catch (error) {
    test.skip(true, `WebKit is not installed (npx playwright install webkit): ${String(error).slice(0, 120)}`);
    return;
  }
  const ipadContext = await engine.newContext({ ...devices["iPad Pro 11"], viewport: { width: 1366, height: 1024 }, baseURL });
  await ipadContext.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: baseURL! })));
  const ipad = await ipadContext.newPage();
  const desk = await device(browser, baseURL!, session, "desktop", "desktop");
  try {
    await Promise.all([openCapture(ipad, draft.id, "glove_info"), openCapture(desk.page, draft.id, "glove_info")]);

    // The desktop saves first; the iPad, which never saw that version, is asked.
    await typeInto(desk.page.getByLabel("Glove Colour"), "Desktop colour");
    await expect.poll(async () => (await fx.row(draft.id))?.data.modules.glove_info.colour, { timeout: 20_000 }).toBe("Desktop colour");
    await typeInto(ipad.getByLabel("Glove Length"), "WebKit iPad length");
    const question = ipad.getByRole("alertdialog", { name: "This Inspection Was Changed on Another Device" });
    await expect(question).toBeVisible({ timeout: 20_000 });
    await shot(ipad, "webkit-ipad-question");
    expect((await fx.row(draft.id))?.data.modules.glove_info).toMatchObject({ colour: "Desktop colour", length: "240 mm" });

    // Keeping the iPad's version replaces the desktop's colour; the desktop's next edit is asked about in turn.
    await question.getByRole("button", { name: "Keep the Changes on This Device" }).tap();
    await expect
      .poll(async () => (await fx.row(draft.id))?.data.modules.glove_info, { timeout: 20_000 })
      .toMatchObject({ colour: "Original blue", length: "WebKit iPad length" });
    await typeInto(desk.page.getByLabel("Glove Surface Texture"), "Desktop texture");
    await expect(desk.page.getByRole("alertdialog", { name: "This Inspection Was Changed on Another Device" })).toBeVisible({
      timeout: 20_000,
    });
    expect((await fx.row(draft.id))?.data.modules.glove_info.surfaceTexture).toBe("Finger-textured");
  } finally {
    await ipadContext.close();
    await engine.close();
    await desk.context.close();
  }
});

test("two devices: an edit made offline, a reload with it pending, and a stale screen's submit are never applied silently", async ({
  browser,
  baseURL,
}) => {
  // Complete, conclusion included, so Submit asks for confirmation rather than listing errors.
  const draft = await fx.createInspection("inspector", {
    data: readyData(`OFF${fx.suffix}`, { conclusion: { finalResult: "pass", date: todayInMalaysia() } }),
  });
  const session = await fx.session("inspector");
  const ipad = await device(browser, baseURL!, session, "ipad", "ipad");
  const desk = await device(browser, baseURL!, session, "desktop", "desktop");
  try {
    await Promise.all([openCapture(ipad.page, draft.id, "glove_info"), openCapture(desk.page, draft.id, "glove_info")]);

    // The iPad loses its connection and the inspector keeps typing: the pill says it will sync.
    await ipad.context.setOffline(true);
    await typeInto(ipad.page.getByLabel("Glove Colour"), "Typed offline on the iPad");
    await expect(savePill(ipad.page)).toHaveAttribute("data-state", "offline", { timeout: 30_000 });
    await shot(ipad.page, "offline-pill");
    const offlineCopy = await localCopy(ipad.page, session.userId, draft.id);
    expect(offlineCopy?.data.modules.glove_info.colour).toBe("Typed offline on the iPad");

    // Meanwhile the desktop saves another change.
    await typeInto(desk.page.getByLabel("Glove Length"), "260 mm on the desktop");
    await expect.poll(async () => (await fx.row(draft.id))?.data.modules.glove_info.length, { timeout: 20_000 }).toBe(
      "260 mm on the desktop",
    );

    // Back online, the iPad's save finds the desktop's version: it asks instead of overwriting.
    await ipad.context.setOffline(false);
    await ipad.page.evaluate(() => window.dispatchEvent(new Event("online")));
    const question = ipad.page.getByRole("alertdialog", { name: "This Inspection Was Changed on Another Device" });
    await expect(question).toBeVisible({ timeout: 45_000 });
    expect((await fx.row(draft.id))?.data.modules.glove_info).toMatchObject({ colour: "Original blue", length: "260 mm on the desktop" });

    // A reload with the question unanswered: the iPad's edit is still there, and so is the question.
    await ipad.page.reload();
    await expect(ipad.page.locator('[data-slot="capture-screen"]')).toBeVisible();
    await expect(question).toBeVisible({ timeout: 20_000 });
    await expect(ipad.page.getByLabel("Glove Colour")).toHaveValue("Typed offline on the iPad");
    await shot(ipad.page, "offline-reload-question");
    await press(question.getByRole("button", { name: "Keep the Changes on This Device" }), true);
    await expect
      .poll(async () => (await fx.row(draft.id))?.data.modules.glove_info, { timeout: 20_000 })
      .toMatchObject({ colour: "Typed offline on the iPad", length: "240 mm" });

    // The desktop still shows its own length, which the iPad's version replaced. Submitting from that stale screen is refused.
    await expect(desk.page.getByLabel("Glove Length")).toHaveValue("260 mm on the desktop");
    await press(desk.page.getByRole("button", { name: "Submit", exact: true }), false);
    const confirm = desk.page.getByRole("alertdialog", { name: `Submit ${draft.refNo} for Review?` });
    await press(confirm.getByRole("button", { name: "Submit for Review" }), false);
    await expect(confirm.getByRole("alert")).toContainText("This inspection changed on another device since this one last saved.", {
      timeout: 20_000,
    });
    await shot(desk.page, "stale-submit-refused");
    expect((await fx.row(draft.id))?.status).toBe("draft");
  } finally {
    await ipad.context.close();
    await desk.context.close();
  }
});

/* ------------------------------------------------------------------ *
 * The status flow
 * ------------------------------------------------------------------ */

/** The lifecycle test's inspection, approved at its end: the read-only checks use it. */
let approved: FixtureInspection | null = null;

test("the life cycle: draft, submitted, reopened, submitted again, approved, each step audited; only admins approve or reopen", async ({
  browser,
  baseURL,
}) => {
  const draft = await fx.createInspection("inspector", { data: readyData(`LC${fx.suffix}`) });
  const inspectorSession = await fx.session("inspector");
  const adminSession = await fx.session("admin");
  const leadSession = await fx.session("lead");
  const ipad = await device(browser, baseURL!, inspectorSession, "ipad", "inspector-ipad");
  const desk = await device(browser, baseURL!, adminSession, "desktop", "admin-desktop");
  const lead = await device(browser, baseURL!, leadSession, "desktop", "lead-desktop");
  try {
    // 1. The inspector completes the conclusion on the iPad and submits.
    await openCapture(ipad.page, draft.id, "conclusion");
    await press(ipad.page.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio", { name: /HOLD/ }), true);
    await typeInto(ipad.page.getByRole("textbox", { name: "Remark" }), "Lifecycle remark one");
    await expect
      .poll(
        async () => {
          const row = await fx.row(draft.id);
          return { result: row?.result, remarks: row?.remarks };
        },
        { timeout: 20_000 },
      )
      .toEqual({ result: "hold", remarks: "Lifecycle remark one" });
    await press(ipad.page.getByRole("button", { name: "Submit", exact: true }), true);
    const confirm = ipad.page.getByRole("alertdialog", { name: `Submit ${draft.refNo} for Review?` });
    await press(confirm.getByRole("button", { name: "Submit for Review" }), true);
    await expect(ipad.page).toHaveURL(new RegExp(`/inspections/${draft.id}/review$`), { timeout: 30_000 });
    let row = await fx.row(draft.id);
    expect(row).toMatchObject({ status: "submitted", result: "hold", remarks: "Lifecycle remark one" });
    expect(row?.submitted_at).not.toBeNull();
    const submittedVersion = row!.updated_at;

    // 2. Only admins approve or reopen. The inspector has no buttons, and the action and the database refuse a crafted request.
    await expect(ipad.page.getByRole("heading", { level: 1, name: draft.refNo })).toBeVisible();
    await expect(ipad.page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(ipad.page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    await desk.page.goto(`/inspections/${draft.id}/review`);
    await expect(desk.page.getByRole("button", { name: "Approve" })).toBeVisible();
    const approveAction = await serverActionId(desk.page, "approveInspection");
    const reopenAction = await serverActionId(desk.page, "reopenInspection");
    const byInspector = await callFormAction(ipad.page, approveAction, { status: "idle" }, { inspectionId: draft.id, version: submittedVersion });
    expect(byInspector.body).toContain("You do not have permission to do that.");
    const reopenByInspector = await callFormAction(ipad.page, reopenAction, { status: "idle" }, { inspectionId: draft.id, reason: "Crafted" });
    expect(reopenByInspector.body).toContain("You do not have permission to do that.");
    await lead.page.goto(`/inspections/${draft.id}/review`);
    await expect(lead.page.getByRole("heading", { level: 1, name: draft.refNo })).toBeVisible();
    const byLead = await callFormAction(lead.page, approveAction, { status: "idle" }, { inspectionId: draft.id, version: submittedVersion });
    expect(byLead.body).toContain("You do not have permission to do that.");
    for (const [who, session] of [
      ["inspector", inspectorSession],
      ["lead", leadSession],
    ] as const) {
      for (const status of ["approved", "reopened"] as const) {
        const { data, error } = await session.client.from("inspections").update({ status }).eq("id", draft.id).select("id");
        expect(data ?? [], `${who} -> ${status}: ${error?.code ?? ""} ${error?.message ?? ""}`).toEqual([]);
      }
    }
    row = await fx.row(draft.id);
    expect(row).toMatchObject({ status: "submitted", updated_at: submittedVersion, approved_by: null });

    // 3. An admin reopens it with a reason.
    await desk.page.reload();
    await press(desk.page.getByRole("button", { name: "Reopen" }), false);
    const reopen = desk.page.getByRole("alertdialog", { name: `Reopen ${draft.refNo}?` });
    await reopen.getByRole("textbox", { name: "What Should the Inspector Change?" }).fill("Lifecycle: say why it is on hold.");
    await press(reopen.getByRole("button", { name: "Reopen" }), false);
    await expect(desk.page.getByRole("heading", { name: "Reopened for Changes" })).toBeVisible({ timeout: 20_000 });
    expect((await fx.row(draft.id))?.status).toBe("reopened");

    // 4. The inspector sees why, changes it and submits again.
    await openCapture(ipad.page, draft.id, "conclusion");
    await expect(ipad.page.locator('[data-notice="reopened"]')).toContainText("Lifecycle: say why it is on hold.");
    await typeInto(ipad.page.getByRole("textbox", { name: "Remark" }), "Lifecycle remark two: lab report pending");
    await expect.poll(async () => (await fx.row(draft.id))?.remarks, { timeout: 20_000 }).toBe("Lifecycle remark two: lab report pending");
    await press(ipad.page.getByRole("button", { name: "Submit", exact: true }), true);
    await press(
      ipad.page.getByRole("alertdialog", { name: `Submit ${draft.refNo} for Review?` }).getByRole("button", { name: "Submit for Review" }),
      true,
    );
    await expect(ipad.page).toHaveURL(new RegExp(`/inspections/${draft.id}/review$`), { timeout: 30_000 });
    expect((await fx.row(draft.id))?.status).toBe("submitted");

    // 5. An approve from a page that shows an older version is refused: something changed after the admin opened it.
    await desk.page.goto(`/inspections/${draft.id}/review`);
    await expect(desk.page.getByRole("button", { name: "Approve" })).toBeVisible();
    const touched = await adminSession.client
      .from("inspections")
      .update({ report_url: `https://example.com/e2e-final-data/${fx.suffix}` })
      .eq("id", draft.id)
      .select("updated_at");
    expect(touched.error).toBeNull();
    await press(desk.page.getByRole("button", { name: "Approve" }), false);
    await press(desk.page.getByRole("alertdialog", { name: `Approve ${draft.refNo}?` }).getByRole("button", { name: "Approve" }), false);
    await expect(desk.page.getByText(/changed after you opened it, so it was not approved/)).toBeVisible({ timeout: 20_000 });
    expect((await fx.row(draft.id))?.status).toBe("submitted");

    // 6. Approved from the current version.
    await desk.page.reload();
    await press(desk.page.getByRole("button", { name: "Approve" }), false);
    await press(desk.page.getByRole("alertdialog", { name: `Approve ${draft.refNo}?` }).getByRole("button", { name: "Approve" }), false);
    await expect(desk.page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible({ timeout: 20_000 });
    row = await fx.row(draft.id);
    expect(row).toMatchObject({ status: "approved", approved_by: fx.adminId });
    expect(row?.approved_at).not.toBeNull();

    // 7. The trail: every step, in order, with who did it.
    const trail = (await fx.audit(draft.id)).map((entry) => ({ action: entry.action, changes: entry.changes, actor: entry.actor_id }));
    const steps = trail.filter((entry) => ["created", "status_changed", "review.reopened"].includes(entry.action));
    expect(steps).toEqual([
      { action: "created", changes: expect.objectContaining({ status: "draft", ref_no: draft.refNo }), actor: null },
      { action: "status_changed", changes: { from: "draft", to: "submitted" }, actor: fx.inspector.id },
      { action: "status_changed", changes: { from: "submitted", to: "reopened" }, actor: fx.adminId },
      { action: "review.reopened", changes: { reason: "Lifecycle: say why it is on hold." }, actor: fx.adminId },
      { action: "status_changed", changes: { from: "reopened", to: "submitted" }, actor: fx.inspector.id },
      { action: "status_changed", changes: { from: "submitted", to: "approved" }, actor: fx.adminId },
    ]);
    const kinds = await desk.page.locator("li[data-kind]").evaluateAll((items) => items.map((item) => item.getAttribute("data-kind")));
    expect(kinds).toEqual(["created", "submitted", "reopened", "resubmitted", "approved"]);
    await desk.page.screenshot({ path: `${SHOTS}/lifecycle-approved-review.png`, fullPage: true });
    approved = draft;
  } finally {
    await ipad.context.close();
    await desk.context.close();
    await lead.context.close();
  }
});

test("an approved inspection is read-only everywhere: capture, photos, review, list, the save action and the database", async ({
  browser,
  baseURL,
}) => {
  const target =
    approved ??
    (await fx.createInspection("inspector", {
      data: readyData(`AP${fx.suffix}`, { conclusion: { finalResult: "pass", date: todayInMalaysia() } }),
      status: "approved",
    }));
  const before = await fx.row(target.id);
  expect(before?.status).toBe("approved");
  const inspectorSession = await fx.session("inspector");
  const adminSession = await fx.session("admin");
  const ipad = await device(browser, baseURL!, inspectorSession, "ipad", "inspector-ipad");
  const desk = await device(browser, baseURL!, adminSession, "desktop", "admin-desktop");
  try {
    for (const who of [ipad, desk]) {
      const { writes } = recordWrites(who.page);
      await openCapture(who.page, target.id, "glove_info", { editable: false });
      await expect(who.page.locator('[data-notice="approved"]')).toContainText("Approved: this inspection is read-only.");
      const colour = who.page.getByLabel("Glove Colour");
      await expect(colour).not.toBeEditable();
      await colour.click();
      await who.page.keyboard.type("changed");
      await expect(colour).toHaveValue(before!.data.modules.glove_info.colour as string);
      await expect(who.page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
      await expect(who.page.getByRole("button", { name: "Switch Off" })).toHaveCount(0);
      await expect(savePill(who.page)).toHaveCount(0);
      await expect(who.page.locator('[data-slot="section-frame"] input[type="file"]')).toHaveCount(0);
      await who.page.goto(`/inspections/${target.id}?module=conclusion`);
      await expect(who.page.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio").first()).toBeDisabled();
      await expect(who.page.getByRole("textbox", { name: "Remark" })).not.toBeEditable();
      await shot(who.page, `approved-capture-${who.name}`);
      // Opening and leaving the capture screen sent nothing.
      expect(writes, `${who.name}: writes from the capture screen`).toEqual([]);

      await who.page.goto(`/inspections/${target.id}/photos`);
      await expect(who.page.getByRole("heading", { level: 1, name: "Photos and Files" })).toBeVisible();
      await expect(who.page.locator('input[type="file"]')).toHaveCount(0);
      await expect(who.page.getByRole("button", { name: /^Delete/ })).toHaveCount(0);

      await who.page.goto(`/inspections/${target.id}/review`);
      await expect(who.page.getByRole("heading", { name: "Approved", exact: true })).toBeVisible();
      await expect(who.page.getByRole("button", { name: "Approve" })).toHaveCount(0);
      await expect(who.page.getByRole("button", { name: "Reopen" })).toHaveCount(0);

      await who.page.goto(`/inspections?q=${encodeURIComponent(target.refNo)}`);
      const listed = who.page.locator(`tbody tr[data-ref="${target.refNo}"]`);
      await expect(listed).toBeVisible();
      await expect(listed.locator('[data-row-action="primary"]')).toHaveAttribute("data-action", "view");
      await expect(listed.getByRole("button", { name: `Delete ${target.refNo}` })).toHaveCount(0);
    }

    // A crafted save is refused by the action, for the inspector and for an admin.
    await openCapture(ipad.page, target.id, "glove_info", { editable: false });
    const saveAction = await serverActionId(ipad.page, "saveCaptureData");
    const forged = {
      ...before!.data,
      modules: { ...before!.data.modules, glove_info: { ...before!.data.modules.glove_info, colour: "Changed after approval" } },
    };
    for (const who of [ipad, desk]) {
      if (who === desk) await openCapture(desk.page, target.id, "glove_info", { editable: false });
      const answer = await callServerAction(who.page, saveAction, [{ inspectionId: target.id, data: forged, baseUpdatedAt: before!.updated_at }]);
      expect(answer.body, who.name).toContain('"reason":"forbidden"');
      expect(answer.body, who.name).toContain("This inspection is approved and can no longer be changed.");
    }

    // The database refuses an admin's change or delete, and the inspector's change. No signed-in
    // user deletes an inspection directly (migration 20261007193000): the delete matches no row.
    const adminUpdate = await adminSession.client.from("inspections").update({ remarks: "Changed after approval" }).eq("id", target.id).select("id");
    expect(adminUpdate.error?.code).toBe("42501");
    const adminDelete = await adminSession.client.from("inspections").delete().eq("id", target.id).select("id");
    expect(adminDelete.error).toBeNull();
    expect(adminDelete.data).toEqual([]);
    const adminRpc = await adminSession.client.rpc("delete_draft_inspection", { inspection_id: target.id });
    expect(adminRpc.error?.code).toBe("23514");
    const inspectorUpdate = await inspectorSession.client.from("inspections").update({ remarks: "Changed after approval" }).eq("id", target.id).select("id");
    expect(inspectorUpdate.data ?? []).toEqual([]);
    const photo = await adminSession.client
      .from("inspection_photos")
      .insert({ inspection_id: target.id, module_key: "glove_info", storage_path: `${target.id}/${randomUUID()}.jpg`, created_by: fx.adminId })
      .select("id");
    expect(photo.error?.code, "a photo added to an approved inspection").toBe("42501");

    const after = await fx.row(target.id);
    expect(after?.updated_at).toBe(before!.updated_at);
    expect(after?.data).toEqual(before!.data);
    expect(after?.remarks).toBe(before!.remarks);
  } finally {
    await ipad.context.close();
    await desk.context.close();
  }
});

/* ------------------------------------------------------------------ *
 * Delete
 * ------------------------------------------------------------------ */

test("Delete: a draft only, its owner's or by an admin; the deletion record stays; a device with it open is told", async ({
  browser,
  baseURL,
}) => {
  // The deletion itself is the admin's here: a deletion record names its actor for good, and an
  // account named in an audit row can never be deleted, so a throwaway account must not delete.
  // e2e/list covers an inspector deleting their own draft (inspector@test.local).
  const today = todayInMalaysia();
  const mine = await fx.createInspection("inspector", { data: readyData(`DEL${fx.suffix}`) });
  const submitted = await fx.createInspection("inspector", {
    data: readyData(`DSU${fx.suffix}`, { conclusion: { finalResult: "pass", date: today } }),
    status: "submitted",
  });
  const othersDraft = await fx.createInspection("other", { data: readyData(`DOT${fx.suffix}`) });
  const inspectorSession = await fx.session("inspector");
  const leadSession = await fx.session("lead");
  const adminSession = await fx.session("admin");
  const ipad = await device(browser, baseURL!, inspectorSession, "ipad", "inspector-ipad");
  const desk = await device(browser, baseURL!, inspectorSession, "desktop", "inspector-desktop");
  const adminDesk = await device(browser, baseURL!, adminSession, "desktop", "admin-desktop");
  const lead = await device(browser, baseURL!, leadSession, "desktop", "lead-desktop");
  try {
    // The iPad has the draft open while it is deleted elsewhere.
    await openCapture(ipad.page, mine.id, "glove_info");

    // The owner's list offers Delete on the draft only.
    await desk.page.goto("/inspections");
    const ownRow = desk.page.locator(`tbody tr[data-ref="${mine.refNo}"]`);
    await expect(ownRow).toBeVisible();
    await expect(ownRow.getByRole("button", { name: `Delete ${mine.refNo}` })).toBeVisible();
    await expect(desk.page.locator(`tbody tr[data-ref="${submitted.refNo}"]`).getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    await expect(desk.page.locator(`tbody tr[data-ref="${othersDraft.refNo}"]`)).toHaveCount(0);

    // A lead sees the team's drafts with no Delete.
    await lead.page.goto("/inspections");
    const teamRow = lead.page.locator(`tbody tr[data-ref="${mine.refNo}"]`);
    await expect(teamRow).toBeVisible();
    await expect(teamRow.locator('[data-row-action="primary"]')).toHaveAttribute("data-action", "view");
    await expect(teamRow.getByRole("button", { name: /^Delete/ })).toHaveCount(0);

    // An admin deletes the draft from the list.
    await adminDesk.page.goto(`/inspections?q=${encodeURIComponent(mine.refNo)}`);
    const draftRow = adminDesk.page.locator(`tbody tr[data-ref="${mine.refNo}"]`);
    await press(draftRow.getByRole("button", { name: `Delete ${mine.refNo}` }), false);
    const dialog = adminDesk.page.getByRole("alertdialog", { name: `Delete ${mine.refNo}?` });
    await expect(dialog).toContainText("The draft is deleted with all its photos and files. This cannot be undone.");
    await press(dialog.getByRole("button", { name: "Delete Inspection" }), false);
    await expect(adminDesk.page.getByText(`${mine.refNo} deleted.`)).toBeVisible({ timeout: 20_000 });
    await expect(draftRow).toHaveCount(0);
    expect(await fx.row(mine.id)).toBeNull();
    await adminDesk.page.goto(`/inspections?q=${encodeURIComponent(submitted.refNo)}`);
    await expect(adminDesk.page.locator(`tbody tr[data-ref="${submitted.refNo}"]`).getByRole("button", { name: /^Delete/ })).toHaveCount(0);

    // Its own audit rows went with it; the record of the deletion stays, naming who and what.
    expect(await fx.audit(mine.id)).toEqual([]);
    const records = await fx.deletionRecords(mine.id);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      inspection_id: null,
      actor_id: fx.adminId,
      changes: expect.objectContaining({ ref_no: mine.refNo, status: "draft", inspector_id: fx.inspector.id, via: "delete_draft_inspection" }),
    });

    // The iPad that still had it open is told its next change was not saved, and keeps it on the device.
    await typeInto(ipad.page.getByLabel("Glove Colour"), "Typed after the delete");
    await expect(ipad.page.locator('[data-notice="save-error"]')).toContainText("Not saved.", { timeout: 20_000 });
    const kept = await localCopy(ipad.page, inspectorSession.userId, mine.id);
    expect(kept?.data.modules.glove_info.colour).toBe("Typed after the delete");
    await shot(ipad.page, "deleted-elsewhere-not-saved");

    // Nothing but a draft is deleted, whoever asks the database.
    const bySubmitted = await inspectorSession.client.rpc("delete_draft_inspection", { inspection_id: submitted.id });
    expect(bySubmitted.error?.code).toBe("23514");
    const byOthers = await inspectorSession.client.rpc("delete_draft_inspection", { inspection_id: othersDraft.id });
    expect(byOthers).toMatchObject({ data: null, error: null });
    const leadRpc = await leadSession.client.rpc("delete_draft_inspection", { inspection_id: othersDraft.id });
    expect(leadRpc).toMatchObject({ data: null, error: null });
    const leadDirect = await leadSession.client.from("inspections").delete().eq("id", othersDraft.id).select("id");
    expect(leadDirect.data ?? []).toEqual([]);
    const inspectorDirect = await inspectorSession.client.from("inspections").delete().eq("id", submitted.id).select("id");
    expect(inspectorDirect.data ?? []).toEqual([]);
    const adminRpc = await adminSession.client.rpc("delete_draft_inspection", { inspection_id: submitted.id });
    expect(adminRpc.error?.code).toBe("23514");
    expect((await fx.row(submitted.id))?.status).toBe("submitted");
    expect((await fx.row(othersDraft.id))?.status).toBe("draft");
  } finally {
    await ipad.context.close();
    await desk.context.close();
    await adminDesk.context.close();
    await lead.context.close();
  }
});

test("an admin's own session cannot delete a submitted inspection (D1)", async () => {
  const submitted = await fx.createInspection("inspector", {
    data: readyData(`DAD${fx.suffix}`, { conclusion: { finalResult: "pass", date: todayInMalaysia() } }),
    status: "submitted",
  });
  const adminSession = await fx.session("admin");
  const { data, error } = await adminSession.client.from("inspections").delete().eq("id", submitted.id).select("id, ref_no, status");
  const records = await fx.deletionRecords(submitted.id);
  test.info().annotations.push({ type: "evidence", description: JSON.stringify({ data, error, records }) });
  // The rule (migrations 20261007151500 and 20261007193000): submitted, reopened and approved
  // inspections stay; no signed-in user deletes one directly, so the delete matches no row.
  expect(error).toBeNull();
  expect(data).toEqual([]);
  expect(records, "no deletion record").toEqual([]);
  expect(await fx.row(submitted.id), "the submitted inspection is still there").toMatchObject({ id: submitted.id, status: "submitted" });
});

/* ------------------------------------------------------------------ *
 * Template versions
 * ------------------------------------------------------------------ */

test("a template version in use cannot be edited: the editor is read-only, New version copies it, and inspections keep theirs", async ({
  browser,
  baseURL,
}) => {
  const onV1 = await fx.createInspection("inspector", { data: readyData(`TPL${fx.suffix}`) });
  const v1Before = await fx.template(fx.templateId);
  const adminSession = await fx.session("admin");
  const inspectorSession = await fx.session("inspector");
  const desk = await device(browser, baseURL!, adminSession, "desktop", "admin-desktop");
  const ipad = await device(browser, baseURL!, inspectorSession, "ipad", "inspector-ipad");
  try {
    // The editor of the used version is read-only and says why.
    await desk.page.goto(`/admin/templates/${fx.templateId}/edit`);
    const locked = desk.page.getByTestId("locked");
    await expect(locked).toContainText(/Version 1 cannot be changed: \d+ inspections? uses? it, and an inspection keeps the version it started with\./);
    await expect(desk.page.getByRole("switch", { name: "Include Glove Information" })).toBeDisabled();
    await expect(desk.page.getByRole("button", { name: "Save", exact: true })).toHaveCount(0);
    await shot(desk.page, "template-locked");

    // The database refuses a change to it whoever asks, as the admin's own session shows.
    const changed = await adminSession.client
      .from("templates")
      .update({ definition: { ...(v1Before!.definition as Record<string, unknown>), name: "Changed in place" } })
      .eq("id", fx.templateId)
      .select("id");
    expect(changed.error?.code).toBe("42501");
    expect(changed.error?.message).toContain("is in use: create a new version instead");
    const removed = await adminSession.client.from("templates").delete().eq("id", fx.templateId).select("id");
    expect(removed.error?.code, "a used version cannot be deleted either").toMatch(/^(23503|23001)$/);

    // New Version: a draft copy, opened in the editor.
    await press(locked.getByRole("button", { name: "New Version" }), false);
    await desk.page.waitForURL((url) => /\/admin\/templates\/[0-9a-f-]{36}\/edit$/.test(url.pathname) && !url.pathname.includes(fx.templateId), {
      timeout: 30_000,
    });
    const v2Id = desk.page.url().split("/").at(-2)!;
    const v2 = await fx.template(v2Id);
    expect(v2).toMatchObject({ code: fx.templateCode, version: 2, status: "draft" });
    expect(v2?.definition).toEqual(v1Before?.definition);

    // The draft is editable: Glove Information switched off and saved.
    const include = desk.page.getByRole("switch", { name: "Include Glove Information" });
    await expect(include).toBeEnabled();
    await press(include, false);
    await press(desk.page.getByRole("button", { name: "Save", exact: true }), false);
    await expect(desk.page.getByText(`Saved ${fx.templateCode} version 2.`)).toBeVisible({ timeout: 20_000 });
    const v2After = await fx.template(v2Id);
    const modulesOf = (definition: unknown) =>
      (definition as { modules: { key: string; include: boolean }[] }).modules.map(({ key, include: on }) => [key, on]);
    expect(modulesOf(v2After?.definition)).toContainEqual(["glove_info", false]);

    // Version 1 has not moved, and the inspection that uses it still shows Glove Information.
    const v1After = await fx.template(fx.templateId);
    expect(v1After?.definition).toEqual(v1Before?.definition);
    expect(v1After?.resolved).toEqual(v1Before?.resolved);
    expect(v1After?.updated_at).toBe(v1Before?.updated_at);
    expect((await fx.row(onV1.id))?.template_id).toBe(fx.templateId);
    await openCapture(ipad.page, onV1.id, "glove_info");
    await expect(ipad.page.getByRole("heading", { level: 2, name: "Glove Information", exact: true })).toBeVisible();

    // An inspector cannot start from the draft (it would freeze it), nor move an inspection to another version.
    const fromDraft = await inspectorSession.client
      .from("inspections")
      .insert({ template_id: v2Id, manufacturer_id: "10000000-0000-4000-8000-000000000001", client_id: fx.client.id })
      .select("id");
    expect(fromDraft.error?.code).toBe("23514");
    const moved = await adminSession.client.from("inspections").update({ template_id: v2Id }).eq("id", onV1.id).select("id");
    expect(moved.error?.code).toBe("42501");
  } finally {
    await desk.context.close();
    await ipad.context.close();
  }
});

test("an admin may still replace a used version's source file (by design, T2); what the version checks stays frozen", async () => {
  await fx.createInspection("inspector", { data: readyData(`TSF${fx.suffix}`) });
  const before = await fx.template(fx.templateId);
  const adminSession = await fx.session("admin");
  const replaced = `${fx.templateCode}/v1/replaced.pdf`;
  const answer = await adminSession.client
    .from("templates")
    .update({ source_file_path: replaced })
    .eq("id", fx.templateId)
    .select("source_file_path");
  test.info().annotations.push({ type: "evidence", description: JSON.stringify({ answer, definitionBefore: (before?.definition as { sourceFile?: string })?.sourceFile ?? null }) });
  // templates_guard freezes code, version, scope, definition and resolved of a used version; the
  // source file (the form it was built from) is not part of what an inspection checks.
  expect(answer.error).toBeNull();
  expect(answer.data).toEqual([{ source_file_path: replaced }]);
  const after = await fx.template(fx.templateId);
  expect(after).toMatchObject({ code: before?.code, version: before?.version, status: before?.status });
  expect(after?.definition).toEqual(before?.definition);
  expect(after?.resolved).toEqual(before?.resolved);
});

/* ------------------------------------------------------------------ *
 * Start From Previous
 * ------------------------------------------------------------------ */

test("start from previous copies the product's details and nothing else", async ({ browser, baseURL }) => {
  const today = todayInMalaysia();
  const tag = `PRV${fx.suffix}`;
  const previous = await fx.createInspection("inspector", {
    data: readyData(tag, {
      header: { comment: "Header comment (never copied)" },
      glove_info: { surfaceTexture: "Fully textured (previous)", colour: "Violet (previous)", comment: "Glove comment (never copied)" },
      packing_config: { glovesPerInner: 200, innersPerCase: 5, glovesPerCase: 1000, comment: "Packing comment (never copied)" },
      conclusion: { finalResult: "pass", date: today, remark: "Previous remark (never copied)" },
    }),
    status: "approved",
  });
  const productName = `E2E Final Glove ${tag}`;
  const inspectorSession = await fx.session("inspector");
  const ipad = await device(browser, baseURL!, inspectorSession, "ipad", "inspector-ipad");
  try {
    const page = ipad.page;
    await page.goto("/inspections/new");
    for (const [label, option] of [
      ["Client", fx.client.name],
      ["Manufacturer", "Hartalega NGC"],
    ] as const) {
      await press(page.getByRole("combobox", { name: label }), true);
      await press(page.getByRole("option", { name: option }), true);
    }
    await press(page.getByRole("radio", { name: /^Examination Gloves/ }), true);
    await expect(page.getByTestId("chosen-template")).toHaveAttribute("data-code", fx.templateCode);
    await press(page.getByRole("radio", { name: new RegExp(productName) }), true);
    const summary = page.getByTestId("copy-summary");
    await expect(summary).toContainText(`Copied From ${previous.refNo}`);
    await expect(summary).toContainText("Never copied: PO number, dates, lots, sampling, test results, comments and photos.");
    await shot(page, "start-from-previous");
    await press(page.getByRole("button", { name: "Create Inspection" }), true);
    await expect(page).toHaveURL(/\/inspections\/[0-9a-f-]{36}$/, { timeout: 60_000 });
    const id = page.url().split("/").at(-1)!;

    const created = await fx.row(id);
    const source = (await fx.row(previous.id))!;
    expect(created).toMatchObject({
      status: "draft",
      template_id: fx.templateId,
      product_name: productName,
      po_no: null,
      lot_numbers: [],
      result: null,
      remarks: null,
    });
    const nonEmpty = (entry: Record<string, unknown> | undefined) =>
      Object.fromEntries(Object.entries(entry ?? {}).filter(([, value]) => value !== null && !(Array.isArray(value) && value.length === 0)));
    const sourceHeader = source.data.modules.header;
    expect(nonEmpty(created!.data.modules.header)).toEqual({
      factoryAddress: sourceHeader.factoryAddress,
      productName,
      productCode: sourceHeader.productCode,
      factoryGloveCode: sourceHeader.factoryGloveCode,
      inspectionDate: today,
    });
    const withoutComment = (entry: Record<string, unknown>) => Object.fromEntries(Object.entries(entry).filter(([key]) => key !== "comment"));
    expect(nonEmpty(created!.data.modules.glove_info)).toEqual(withoutComment(source.data.modules.glove_info));
    expect(nonEmpty(created!.data.modules.packing_config)).toMatchObject(withoutComment(source.data.modules.packing_config));
    expect(created!.data.modules.glove_info.comment).toBeUndefined();
    expect(created!.data.modules.packing_config.comment).toBeUndefined();
    for (const key of ["order_lots", "sampling_plan", "carton_sampling", "conclusion"]) {
      expect(JSON.stringify(nonEmpty(created!.data.modules[key])), key).not.toMatch(/E2E-FD|7311|never copied|pass/);
    }
    expect(JSON.stringify(created!.data)).not.toContain("never copied");
    const trail = await fx.audit(id);
    expect(trail.map((entry) => entry.action)).toEqual(["created", "started_from_previous"]);
    expect(trail[1].changes).toEqual({
      from: { id: previous.id, ref_no: previous.refNo },
      copied: ["header", "glove_info", "packing_config"],
    });
  } finally {
    await ipad.context.close();
  }
});

/* ------------------------------------------------------------------ *
 * Lead inspectors: their team's inspections, read-only end to end
 * ------------------------------------------------------------------ */

test("a lead inspector reads a team draft and writes nothing: no autosave, no local copy, no photos, no crafted save", async ({
  browser,
  baseURL,
}) => {
  const team = await fx.createInspection("inspector", { data: readyData(`LEAD${fx.suffix}`) });
  const before = (await fx.row(team.id))!;
  const leadSession = await fx.session("lead");
  const ipad = await device(browser, baseURL!, leadSession, "ipad", "lead-ipad");
  try {
    const page = ipad.page;
    const { writes } = recordWrites(page);

    await page.goto("/inspections");
    const row = page.locator(`tbody tr[data-ref="${team.refNo}"]`);
    await expect(row).toBeVisible();
    await expect(row.locator('[data-row-action="primary"]')).toHaveAttribute("data-action", "view");
    await expect(row.getByRole("button", { name: /^Delete/ })).toHaveCount(0);

    await openCapture(page, team.id, "glove_info", { editable: false });
    await expect(page.locator('[data-notice="not-yours"]')).toContainText("This inspection belongs to another inspector: read-only.");
    const colour = page.getByLabel("Glove Colour");
    await expect(colour).not.toBeEditable();
    await colour.tap();
    await page.keyboard.type("Lead typing");
    await expect(colour).toHaveValue("Original blue");
    await expect(page.getByRole("button", { name: "Submit", exact: true })).toHaveCount(0);
    await expect(savePill(page)).toHaveCount(0);
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    for (const section of ["Manufacturer Information", "Order", "Conclusion"]) {
      await page.getByRole("tab", { name: new RegExp(`^${section}`) }).tap();
      await expect(page.getByRole("heading", { level: 2, name: section, exact: true })).toBeVisible();
    }
    await expect(page.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio").first()).toBeDisabled();
    await shot(page, "lead-team-draft-read-only");
    // Leaving the screen sends nothing either.
    await page.getByRole("link", { name: /Back/ }).first().tap();
    await expect(page).toHaveURL(/\/inspections$/);

    await page.goto(`/inspections/${team.id}/photos`);
    await expect(page.getByRole("heading", { level: 1, name: "Photos and Files" })).toBeVisible();
    await expect(page.locator('input[type="file"]')).toHaveCount(0);
    await page.goto(`/inspections/${team.id}/review`);
    await expect(page.getByRole("heading", { level: 1, name: team.refNo })).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reopen" })).toHaveCount(0);
    const exported = await page.request.get(`/api/inspections/${team.id}/export`);
    expect(exported.status(), "the export is for the inspector and admins").toBe(404);

    expect(writes, "requests that could write, from the lead's screens").toEqual([]);
    expect(await localCopyKeys(page, team.id), "no local copy of a team draft on the lead's device").toEqual([]);
    const unchanged = await fx.row(team.id);
    expect(unchanged?.updated_at).toBe(before.updated_at);
    expect(unchanged?.data).toEqual(before.data);

    // A crafted save through the capture screen's action is refused, and so is every direct write.
    await openCapture(page, team.id, "glove_info", { editable: false });
    const saveAction = await serverActionId(page, "saveCaptureData");
    const forged = { ...before.data, modules: { ...before.data.modules, glove_info: { ...before.data.modules.glove_info, colour: "Lead colour" } } };
    const answer = await callServerAction(page, saveAction, [{ inspectionId: team.id, data: forged, baseUpdatedAt: before.updated_at }]);
    expect(answer.body).toContain('"reason":"forbidden"');
    const patched = await leadSession.client.from("inspections").update({ po_no: "LEAD-PO" }).eq("id", team.id).select("id");
    expect(patched.data ?? []).toEqual([]);
    const photo = await leadSession.client
      .from("inspection_photos")
      .insert({ inspection_id: team.id, module_key: "glove_info", storage_path: `${team.id}/${randomUUID()}.jpg`, created_by: fx.lead.id })
      .select("id");
    expect(photo.error?.code).toBe("42501");
    const upload = await leadSession.client.storage
      .from("inspection-photos")
      .upload(`${team.id}/${randomUUID()}.jpg`, new Blob([new Uint8Array([0xff, 0xd8, 0xff, 0xd9])], { type: "image/jpeg" }));
    expect(upload.error?.message).toMatch(/row-level security/);
    const logged = await leadSession.client.rpc("log_inspection_event", { inspection_id: team.id, action: "e2e.lead", changes: {} });
    expect(logged.error?.code).toBe("42501");
    const forTeam = await leadSession.client
      .from("inspections")
      .insert({ template_id: fx.templateId, inspector_id: fx.inspector.id, manufacturer_id: "10000000-0000-4000-8000-000000000001" })
      .select("id");
    expect(forTeam.error?.code).toBe("42501");
    const after = await fx.row(team.id);
    expect(after?.updated_at).toBe(before.updated_at);
  } finally {
    await ipad.context.close();
  }
});

test("a lead's list names who each team inspection belongs to: the Inspector in Charge column (L1)", async ({ browser, baseURL }) => {
  const others = await fx.createInspection("other", { data: readyData(`LST${fx.suffix}`) });
  const leadSession = await fx.session("lead");
  const desk = await device(browser, baseURL!, leadSession, "desktop", "lead-desktop");
  try {
    await desk.page.goto("/inspections");
    await expect(desk.page.locator("tbody tr").first()).toBeVisible();
    await desk.page.screenshot({ path: `${SHOTS}/lead-list.png`, fullPage: true });
    const headers = (await desk.page.locator("thead th").allInnerTexts()).map((text) => text.trim());
    test.info().annotations.push({ type: "evidence", description: JSON.stringify(headers) });
    expect(headers).toContain("Inspector in Charge");
    await expect(desk.page.getByText("Your Team", { exact: true })).toBeVisible();
    await expect(desk.page.getByText("Your Inspections", { exact: true })).toHaveCount(0);
    // The team member's inspection names them.
    const row = desk.page.locator(`tbody tr[data-ref="${others.refNo}"]`);
    await expect(row).toBeVisible();
    await expect(row).toContainText(fx.other.name);
  } finally {
    await desk.context.close();
  }
});

/* ------------------------------------------------------------------ *
 * The row mirrors the data: conclusion, PO, lots, product, date
 * ------------------------------------------------------------------ */

/** The final result and remark the review shows (its "Final Result (Inspector)" card). */
async function reviewDecision(page: import("@playwright/test").Page, id: string) {
  await page.goto(`/inspections/${id}/review`);
  const card = page.locator("h3", { hasText: "Final Result (Inspector)" }).locator("xpath=..");
  await expect(card).toBeVisible();
  return {
    result: await card.locator('[data-slot="status-pill"]').first().getAttribute("data-status"),
    remark: (await card.locator("p").nth(1).innerText()).trim(),
  };
}

/** The Result column of the list for one inspection: its pill's status. */
async function listResult(page: import("@playwright/test").Page, refNo: string) {
  await page.goto(`/inspections?q=${encodeURIComponent(refNo)}`);
  const row = page.locator(`tbody tr[data-ref="${refNo}"]`);
  await expect(row).toBeVisible();
  return row.locator('[data-slot="status-pill"]').getAttribute("data-status");
}

test("the conclusion's final result and remark are mirrored onto the row: the list, the review and the export agree", async ({
  browser,
  baseURL,
}) => {
  const draft = await fx.createInspection("inspector", { data: readyData(`MIR${fx.suffix}`) });
  expect(await fx.row(draft.id)).toMatchObject({ result: null, remarks: null });
  const inspectorSession = await fx.session("inspector");
  const desk = await device(browser, baseURL!, inspectorSession, "desktop", "inspector-desktop");
  const viewer = await desk.context.newPage();
  try {
    const page = desk.page;
    await openCapture(page, draft.id, "conclusion");
    const choose = async (word: RegExp) => press(page.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio", { name: word }), false);
    const remark = page.getByRole("textbox", { name: "Remark" });
    const stored = async () => {
      const row = await fx.row(draft.id);
      return { result: row?.result, remarks: row?.remarks };
    };

    await choose(/FAILED/);
    await typeInto(remark, "  Mirror remark one  ");
    await expect.poll(stored, { timeout: 20_000 }).toEqual({ result: "fail", remarks: "Mirror remark one" });
    expect(await listResult(viewer, draft.refNo)).toBe("fail");
    expect(await reviewDecision(viewer, draft.id)).toEqual({ result: "fail", remark: "Mirror remark one" });

    await choose(/HOLD/);
    await typeInto(remark, "Mirror remark two");
    await expect.poll(stored, { timeout: 20_000 }).toEqual({ result: "hold", remarks: "Mirror remark two" });
    expect(await listResult(viewer, draft.refNo)).toBe("hold");
    expect(await reviewDecision(viewer, draft.id)).toEqual({ result: "hold", remark: "Mirror remark two" });
    const exported = await viewer.request.get(`/api/inspections/${draft.id}/export`);
    expect(exported.status()).toBe(200);
    expect((await exported.json()).conclusion).toMatchObject({ finalResult: "hold", remark: "Mirror remark two" });

    // A cleared remark clears the row's copy.
    await remark.fill("");
    await remark.press("Tab");
    await expect.poll(stored, { timeout: 20_000 }).toEqual({ result: "hold", remarks: null });
    expect(await reviewDecision(viewer, draft.id)).toEqual({ result: "hold", remark: "No remark" });
  } finally {
    await desk.context.close();
  }
});

test("with its date cleared, the chosen final result shows in the review, and the list's Result waits for the complete conclusion (by design, M1)", async ({
  browser,
  baseURL,
}) => {
  const draft = await fx.createInspection("inspector", { data: readyData(`MDT${fx.suffix}`) });
  const inspectorSession = await fx.session("inspector");
  const desk = await device(browser, baseURL!, inspectorSession, "desktop", "inspector-desktop");
  const viewer = await desk.context.newPage();
  try {
    const page = desk.page;
    await openCapture(page, draft.id, "conclusion");
    await press(page.getByRole("radiogroup", { name: "Conclusion" }).getByRole("radio", { name: /FAILED/ }), false);
    await expect.poll(async () => (await fx.row(draft.id))?.result, { timeout: 20_000 }).toBe("fail");
    // The date the result filled in is cleared (the inspector picks it again later).
    const date = page.getByLabel("Date", { exact: true });
    await date.fill("");
    await date.press("Tab");
    await expect.poll(async () => (await fx.row(draft.id))?.data.modules.conclusion.date, { timeout: 20_000 }).toBeNull();
    const row = await fx.row(draft.id);
    const inList = await listResult(viewer, draft.refNo);
    await viewer.screenshot({ path: `${SHOTS}/m1-list.png` });
    const inReview = (await reviewDecision(viewer, draft.id)).result;
    await viewer.screenshot({ path: `${SHOTS}/m1-review.png`, fullPage: true });
    test.info().annotations.push({
      type: "evidence",
      description: JSON.stringify({ data: row?.data.modules.conclusion, rowResult: row?.result, inList, inReview }),
    });
    // The row's result is the conclusion's, which is not done without its date: the list says
    // Not Done; the review shows what the inspector chose.
    expect(row?.data.modules.conclusion).toMatchObject({ finalResult: "fail", date: null });
    expect(row?.result).toBeNull();
    expect(inList, "the list's Result").toBe("not_done");
    expect(inReview, "the review's final result").toBe("fail");
  } finally {
    await desk.context.close();
  }
});

test("the list finds an inspection by a carton number it sampled (S1; BUILD_SPEC 10: search by ref, PO, lot or carton)", async ({ browser, baseURL }) => {
  const draft = await fx.createInspection("inspector", { data: readyData(`CTN${fx.suffix}`) });
  const stored = await fx.row(draft.id);
  expect(stored?.data.modules.carton_sampling).toMatchObject({ sizes: { M: { cartonNumbers: [7311, 7312] } } });
  const inspectorSession = await fx.session("inspector");
  const desk = await device(browser, baseURL!, inspectorSession, "desktop", "inspector-desktop");
  try {
    for (const carton of ["7311", "7312"]) {
      await desk.page.goto(`/inspections?q=${carton}`);
      await expect(desk.page.getByPlaceholder("Ref, PO, lot or carton")).toHaveValue(carton);
      await expect(desk.page.locator(`tbody tr[data-ref="${draft.refNo}"]`), `carton ${carton}`).toBeVisible();
    }
    await desk.page.screenshot({ path: `${SHOTS}/s1-carton-search.png` });
    // A number the inspection did not sample does not find it.
    await desk.page.goto("/inspections?q=7313");
    await expect(desk.page.getByRole("status").filter({ hasText: /inspection|match/ }).first()).toBeAttached();
    await expect(desk.page.locator(`tbody tr[data-ref="${draft.refNo}"]`)).toHaveCount(0);
  } finally {
    await desk.context.close();
  }
});

test("a lot stored with a capital first letter (iPadOS capitalises it) is found by the lot number in any case (S2)", async ({
  browser,
  baseURL,
}) => {
  const lot = `Lt${fx.suffix.toLowerCase()}9a`;
  const draft = await fx.createInspection("inspector", {
    data: readyData(`CAP${fx.suffix}`, { order_lots: { sizes: { M: { qtyCases: 8000, lotNumbers: [lot] } } } }),
  });
  expect((await fx.row(draft.id))?.lot_numbers).toEqual([lot]);
  const inspectorSession = await fx.session("inspector");
  const desk = await device(browser, baseURL!, inspectorSession, "desktop", "inspector-desktop");
  try {
    const found: Record<string, number> = {};
    for (const query of [lot, lot.toUpperCase(), lot.toLowerCase()]) {
      await desk.page.goto(`/inspections?q=${encodeURIComponent(query)}`);
      await expect(desk.page.getByRole("status").filter({ hasText: /inspection|match/ }).first()).toBeAttached();
      found[query] = await desk.page.locator(`tbody tr[data-ref="${draft.refNo}"]`).count();
    }
    await desk.page.screenshot({ path: `${SHOTS}/s2-lot-case.png` });
    test.info().annotations.push({ type: "evidence", description: JSON.stringify({ stored: lot, found }) });
    expect(found, "the printed (capital) and the lower-case lot number find it too").toEqual({
      [lot]: 1,
      [lot.toUpperCase()]: 1,
      [lot.toLowerCase()]: 1,
    });
  } finally {
    await desk.context.close();
  }
});

test("the database refuses an inspector's own write of the row's result, remarks, PO and lots apart from the data (M2)", async () => {
  const draft = await fx.createInspection("inspector", {
    data: readyData(`FRG${fx.suffix}`, { conclusion: { finalResult: "fail", date: todayInMalaysia(), remark: "Data says fail" } }),
  });
  const before = await fx.row(draft.id);
  expect(before).toMatchObject({ result: "fail", remarks: "Data says fail", po_no: `E2E-FD-PO-FRG${fx.suffix}` });
  const inspectorSession = await fx.session("inspector");
  const forged = await inspectorSession.client
    .from("inspections")
    .update({ result: "pass", remarks: "Row says pass", po_no: "FORGED-PO", lot_numbers: ["FORGED-LOT"], suggested_result: "pass" })
    .eq("id", draft.id)
    .select("result, remarks, po_no, lot_numbers, suggested_result");
  const row = await fx.row(draft.id);
  test.info().annotations.push({
    type: "evidence",
    description: JSON.stringify({ answer: forged, row: { result: row?.result, remarks: row?.remarks, po: row?.po_no, lots: row?.lot_numbers }, data: row?.data.modules.conclusion }),
  });
  // Inspectors save through the app (migration 20261007190000), which writes these columns from the data.
  expect([forged.error?.code, forged.error?.message]).toEqual(["42501", "inspectors save and submit inspections through the app"]);
  expect(row, "the row still says what the data says").toEqual(before);
});

test("the database refuses an inspector's own submit, so the checks that block submit cannot be skipped (M3)", async () => {
  const draft = await fx.createInspection("inspector", { data: readyData(`SUB${fx.suffix}`) });
  const inspectorSession = await fx.session("inspector");
  const answer = await inspectorSession.client.from("inspections").update({ status: "submitted" }).eq("id", draft.id).select("status");
  const row = await fx.row(draft.id);
  test.info().annotations.push({
    type: "evidence",
    description: JSON.stringify({ answer, status: row?.status, conclusion: row?.data.modules.conclusion }),
  });
  expect([answer.error?.code, answer.error?.message]).toEqual(["42501", "inspectors save and submit inspections through the app"]);
  expect(row?.status, "an inspection whose conclusion is empty stays a draft").toBe("draft");
  expect(row?.submitted_at).toBeNull();
  expect(await fx.audit(draft.id), "no status change recorded").not.toContainEqual(expect.objectContaining({ action: "status_changed" }));
});

test("the inspection's number and search columns follow the data: PO, lots, product and date, in the list and its search", async ({
  browser,
  baseURL,
}) => {
  const tag = `SRC${fx.suffix}`;
  const draft = await fx.createInspection("inspector", { data: readyData(tag) });
  const inspectorSession = await fx.session("inspector");
  const desk = await device(browser, baseURL!, inspectorSession, "desktop", "inspector-desktop");
  const viewer = await desk.context.newPage();
  const rowIn = (q: string) => {
    return viewer.goto(`/inspections?q=${encodeURIComponent(q)}`).then(async () => {
      await expect(viewer.getByRole("status").filter({ hasText: /inspection|match/ }).first()).toBeAttached();
      return viewer.locator(`tbody tr[data-ref="${draft.refNo}"]`).count();
    });
  };
  try {
    // The number: drawn by the database, the same on every screen and in the export.
    expect(draft.refNo).toMatch(/^INS-\d{4}-\d{4,}$/);
    const page = desk.page;
    await openCapture(page, draft.id, "header");
    await expect(page.getByRole("heading", { level: 1 })).toContainText(draft.refNo);
    await expect(page).toHaveTitle(new RegExp(draft.refNo));
    const exported = await viewer.request.get(`/api/inspections/${draft.id}/export`);
    expect((await exported.json()).refNo).toBe(draft.refNo);
    expect(await rowIn(draft.refNo)).toBe(1);

    // PO: the row follows the header, and the search with it.
    const oldPo = `E2E-FD-PO-${tag}`;
    const newPo = `E2E-FD-PO-${tag}-REV2 (SO-9)`;
    expect(await rowIn(oldPo)).toBe(1);
    await typeInto(page.getByLabel("PO / SO Number"), newPo);
    await expect.poll(async () => (await fx.row(draft.id))?.po_no, { timeout: 20_000 }).toBe(newPo);
    expect(await rowIn(`${tag}-REV2 (SO-9)`)).toBe(1);
    await viewer.goto(`/inspections?q=${encodeURIComponent(draft.refNo)}`);
    await expect(viewer.locator(`tbody tr[data-ref="${draft.refNo}"]`)).toContainText(newPo);

    // Product name and date.
    await typeInto(page.getByLabel("Product Name (Brand, Code & Description)"), `E2E Final Glove ${tag} renamed`);
    const date = page.getByLabel("Inspection Date", { exact: true });
    await date.fill("2026-10-05");
    await date.press("Tab");
    await expect
      .poll(async () => {
        const row = await fx.row(draft.id);
        return { product: row?.product_name, date: row?.inspection_date };
      }, { timeout: 20_000 })
      .toEqual({ product: `E2E Final Glove ${tag} renamed`, date: "2026-10-05" });
    await viewer.goto(`/inspections?q=${encodeURIComponent(draft.refNo)}`);
    const listed = viewer.locator(`tbody tr[data-ref="${draft.refNo}"]`);
    await expect(listed).toContainText(`E2E Final Glove ${tag} renamed`);
    await expect(listed.locator("time")).toHaveAttribute("datetime", "2026-10-05");

    // Lots: a lot added and one removed in the order, and the exact-lot search follows.
    await page.goto(`/inspections/${draft.id}?module=order_lots`);
    await expect(page.getByLabel(/^Lot Number, (Size )?M: add$/)).toBeEditable();
    const newLot = `E2E-FD-NEWLOT-${tag}`;
    const add = page.getByLabel(/^Lot Number, (Size )?M: add$/);
    await add.fill(newLot);
    await add.press("Enter");
    await page.getByRole("button", { name: new RegExp(`^Remove Lot Number E2E-FD-LOT-${tag}-M, (Size )?M$`) }).click();
    await expect
      .poll(async () => (await fx.row(draft.id))?.lot_numbers, { timeout: 20_000 })
      .toEqual([newLot, `E2E-FD-LOT-${tag}-L`]);
    expect(await rowIn(newLot)).toBe(1);
    expect(await rowIn(newLot.toLowerCase())).toBe(1);
    expect(await rowIn(`E2E-FD-LOT-${tag}-M`)).toBe(0);
    await shot(viewer, "search-by-new-lot");
  } finally {
    await desk.context.close();
  }
});
