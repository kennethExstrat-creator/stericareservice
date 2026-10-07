import { expect, test, type Page } from "@playwright/test";
import { signIn, TEST_ACCOUNTS } from "../support/session";
import {
  activeVersionOf,
  baseDefinition,
  childDefinition,
  chooseFile,
  clientExists,
  expectNoPageScroll,
  fixtureCode,
  insertClient,
  insertInspection,
  insertTemplate,
  insertUnresolvedTemplate,
  isTouch,
  openDialog,
  press,
  removeFixtures,
  resolveFixture,
  rootDefinition,
  shot,
  SOURCE_PDF,
  stdEgDefinition,
  storedFiles,
  templateRow,
  templatesOfCode,
  toast,
  touchTemplate,
  watchConsole,
  type FixtureClient,
  type FixtureTemplate,
} from "./support";

/**
 * /admin/templates and /admin/templates/[id] (BUILD_SPEC 4.2 rules 8 to 10,
 * 4.5, 10) against the live project, at the three sizes in
 * playwright.config.ts. Screenshots go to screenshots/templates/.
 *
 * A temporary client and four temporary templates per run: BASE, active
 * from the start, and ROOT, built on it (no field inventory: the checklist
 * is the last tick), both scoped to the client so neither ever applies to
 * an inspection someone else starts; CLIENT, a variant of STD_EG (its
 * checklist lists STD_EG's forms); and UNRESOLVED, a draft that never
 * resolved. The full life of a version (upload, confirm, frozen by use as a
 * draft, activate, retire, new version) runs on the desktop only, so each
 * run draws one number from the ref sequence.
 */

// A Server Action answers with the page re-rendered (refresh()), which a dev
// server on a busy machine can take seconds over.
const ACTION = { timeout: 30_000 };
test.describe.configure({ timeout: 120_000 });

let scopeClient: FixtureClient;
let base: FixtureTemplate;
let root: FixtureTemplate;
let client: FixtureTemplate;
let unresolved: FixtureTemplate;

test.beforeAll(async () => {
  await removeFixtures();
  scopeClient = await insertClient();
  const baseDefinitionValue = baseDefinition(fixtureCode("BASE"), scopeClient.id);
  base = await insertTemplate(baseDefinitionValue, resolveFixture(baseDefinitionValue), { status: "active" });
  const rootDefinitionValue = rootDefinition(fixtureCode("ROOT"), { baseCode: base.code, clientId: scopeClient.id });
  root = await insertTemplate(
    rootDefinitionValue,
    resolveFixture(rootDefinitionValue, [{ definition: baseDefinitionValue, version: 1 }]),
  );
  const clientDefinitionValue = childDefinition(fixtureCode("CLIENT"));
  client = await insertTemplate(
    clientDefinitionValue,
    resolveFixture(clientDefinitionValue, [{ definition: stdEgDefinition(), version: 1 }]),
  );
  unresolved = await insertUnresolvedTemplate(fixtureCode("UNRESOLVED"));
});

test.afterAll(async () => {
  await removeFixtures();
  // Nothing of this run is left behind: no rows, no files, no client.
  expect(await templatesOfCode(root.code)).toEqual([]);
  expect(await templatesOfCode(base.code)).toEqual([]);
  expect(await storedFiles(root.code)).toEqual([]);
  expect(await storedFiles(client.code)).toEqual([]);
  expect(await clientExists(scopeClient.id)).toBe(false);
});

async function asAdmin(page: Page, baseURL: string) {
  await signIn(page.context(), baseURL, TEST_ACCOUNTS.admin);
}

test("signed out, /admin/templates sends you to sign in and back", async ({ page }) => {
  await page.goto("/admin/templates");
  await expect(page).toHaveURL(/\/login\?next=%2Fadmin%2Ftemplates$/);
});

test("an inspector gets a 404 for the list and for a version, with nothing named", async ({ page, context, baseURL }) => {
  await signIn(context, baseURL!, TEST_ACCOUNTS.inspector);

  for (const path of ["/admin/templates", `/admin/templates/${root.id}`]) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByText(/page not found|could not be found/i).first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toHaveCount(0);
    const html = (await response?.text()) ?? "";
    expect(html).not.toContain("Templates · SteriCare QC");
    expect(html).not.toContain(root.code);
  }
  await shot(page, "inspector-404");
});

test("the list shows every code with its versions, status, scope, base and use", async ({ page, baseURL }) => {
  const hydration = watchConsole(page);
  await asAdmin(page, baseURL!);
  const response = await page.goto("/admin/templates");
  expect(response?.status()).toBe(200);
  await expect(page).toHaveTitle("Templates · SteriCare QC");
  await expect(page.getByRole("heading", { name: "Templates", level: 1 })).toBeVisible();

  const rootCard = page.locator(`section[data-code="${root.code}"]`);
  await expect(rootCard.getByRole("heading", { name: root.code })).toBeVisible();
  await expect(rootCard).toContainText("No active version · 1 version");
  const rootRow = rootCard.locator("tbody tr[data-version='1']");
  await expect(rootRow.locator('[data-slot="template-status"]')).toHaveText("Draft");
  await expect(rootRow).toContainText("Examination · Custom standard");
  // In a column of its own from 1280 px, under the product type below that.
  await expect(rootRow.getByText(scopeClient.name).filter({ visible: true })).toHaveCount(1);
  await expect(rootRow).toContainText("Not used yet");
  await expect(page.locator(`section[data-code="${base.code}"]`)).toContainText("Version 1 active · 1 version");

  const clientCard = page.locator(`section[data-code="${client.code}"]`);
  await expect(clientCard).toContainText("Hartalega NGC");
  if (page.viewportSize()!.width >= 1024) {
    await expect(clientCard.getByRole("cell", { name: "STD_EG", exact: true })).toBeVisible();
  } else {
    await expect(clientCard.getByText("Extends STD_EG")).toBeVisible();
  }

  // Compact rows with a mouse; 44 px targets on touch (docs/DESIGN.md).
  const link = rootRow.getByRole("link", { name: `${root.code} Version 1` });
  if (isTouch()) {
    expect((await link.boundingBox())?.height).toBeGreaterThanOrEqual(44);
  } else {
    const height = (await rootRow.boundingBox())?.height ?? 0;
    expect(height).toBeGreaterThanOrEqual(32);
    expect(height).toBeLessThanOrEqual(40);
  }
  await expectNoPageScroll(page);
  await shot(page, "list");

  await press(link);
  await expect(page).toHaveURL(new RegExp(`/admin/templates/${root.id}$`), ACTION);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${root.code} Version 1`);
  expect(hydration()).toEqual([]);
});

test("a version shows its modules in order, with wording, switches and custom modules", async ({ page, baseURL }) => {
  const hydration = watchConsole(page);
  await asAdmin(page, baseURL!);
  await page.goto(`/admin/templates/${root.id}`);
  await expect(page).toHaveTitle(`${root.code} Version 1 · SteriCare QC`);

  const modules = page.locator("section", { has: page.getByRole("heading", { name: "Modules", level: 2 }) });
  const items = modules.locator("li[data-module], li[data-custom]");
  // Header first, the custom module right after it, conclusion last.
  await expect(items.first()).toHaveAttribute("data-module", "header");
  await expect(items.nth(1)).toHaveAttribute("data-custom", "glove_type");
  await expect(items.last()).toHaveAttribute("data-module", "conclusion");
  await expect(modules.locator("li[data-module='glove_info']")).toContainText("Off");
  await expect(modules.locator("li[data-module='header']")).toContainText("Always On");
  await expect(modules.locator("li[data-module='watertight']")).toContainText("Watertight test");

  const labels = modules.locator("li[data-module='header'] details");
  await press(labels.locator("summary"));
  await expect(labels.getByText("PO / SO Number")).toBeVisible();

  // Its scope and the template it is built on, which is active: a link to that version.
  const details = page.getByRole("region", { name: "Details" });
  await expect(details).toContainText(scopeClient.name);
  const extendsLink = details.getByRole("link", { name: base.code });
  await expect(extendsLink).toHaveAttribute("href", `/admin/templates/${base.id}`);
  await expect(details).toContainText(`${base.code}: built on version 1`);

  // Draft: edit it in the editor; nothing to activate until the file is in and the checklist confirmed.
  await expect(page.getByRole("link", { name: "Edit Draft" })).toHaveAttribute("href", `/admin/templates/${root.id}/edit`);
  await expect(page.getByRole("button", { name: "New Version" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Activate" })).toBeDisabled();
  await expect(page.getByRole("note").filter({ hasText: "Before this version can be activated" })).toContainText(
    "Upload the source form or report first",
  );
  await expect(page.getByRole("button", { name: "Confirm Coverage" })).toBeDisabled();
  if (isTouch()) {
    const targets = [page.getByRole("button", { name: "Upload Source File" }), labels.locator("summary"), extendsLink];
    for (const target of targets) {
      expect((await target.boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
  }
  await expectNoPageScroll(page);
  await shot(page, "version-draft");
  expect(hydration()).toEqual([]);
});

test("a template on top of STD_EG checks STD_EG's forms field by field", async ({ page, baseURL }) => {
  const hydration = watchConsole(page);
  await asAdmin(page, baseURL!);
  await page.goto(`/admin/templates/${client.id}`);

  const checklist = page.locator("#coverage");
  await expect(checklist.getByRole("tab", { name: /Report · STD_EG/ })).toBeVisible();
  await expect(checklist.getByRole("tab", { name: /Onsite Form · EG/ })).toBeVisible();
  // Force at break is off here: its fields are left out, and say why.
  const forceAtBreak = checklist.locator("tr[data-covered='false']").filter({ hasText: "Force At Break" }).first();
  await expect(forceAtBreak).toContainText("Left Out");
  await expect(forceAtBreak).toContainText("switched off in this version");
  // The header's PO row reads in this template's wording.
  await expect(checklist.getByText("Manufacturer Information › PO Number").first()).toBeVisible();
  // It was built on STD_EG version 1: the page compares that with STD_EG's active version in this project.
  const stdEgActive = await activeVersionOf("STD_EG");
  const notActive = page.getByRole("note").filter({ hasText: "STD_EG has no active version" });
  const movedOn = page.getByRole("note").filter({ hasText: "STD_EG has moved on" });
  if (stdEgActive === null) {
    await expect(notActive).toContainText("built on STD_EG version 1, which is not active now");
  } else if (stdEgActive !== 1) {
    await expect(movedOn).toContainText(`STD_EG’s active version is now ${stdEgActive}`);
  } else {
    await expect(notActive.or(movedOn)).toHaveCount(0);
  }

  if (isTouch()) {
    const tick = checklist.getByRole("checkbox").first();
    const box = await tick.evaluate((element) => {
      const after = getComputedStyle(element, "::after");
      const rect = element.getBoundingClientRect();
      return { height: rect.height + parseFloat(after.top) * -2, width: rect.width + parseFloat(after.left) * -2 };
    });
    expect(box.height).toBeGreaterThanOrEqual(44);
  }
  await expectNoPageScroll(page);
  await shot(page, "checklist-base");
  expect(hydration()).toEqual([]);
});

test("a draft that never resolved explains itself and cannot be activated", async ({ page, baseURL }) => {
  const hydration = watchConsole(page);
  await asAdmin(page, baseURL!);
  const response = await page.goto(`/admin/templates/${unresolved.id}`);
  expect(response?.status()).toBe(200);

  // By its title: the list of what blocks activation says "has not resolved" too.
  await expect(page.getByRole("note").filter({ has: page.getByText("Not resolved", { exact: true }) })).toBeVisible();
  await expect(page.getByRole("note").filter({ hasText: "The definition has problems" })).toBeVisible();
  await expect(page.getByText("Nothing to show until this version resolves.")).toBeVisible();
  await expect(page.locator("#coverage")).toContainText("This version has not resolved");
  await expect(page.getByRole("button", { name: "Activate" })).toBeDisabled();
  await expect(page.getByRole("note").filter({ hasText: "Before this version can be activated" })).toContainText(
    "has not resolved",
  );
  await expectNoPageScroll(page);
  await shot(page, "version-unresolved");

  // A malformed or unknown id shows the not-found screen, not an error. The page
  // looks the id up inside the app's loading boundary (app/(app)/loading.tsx),
  // after the response has started streaming, so Next answers 200 and marks the
  // page noindex (Next docs: loading.js, Status Codes); 404 is fine too.
  for (const path of ["/admin/templates/not-an-id", "/admin/templates/00000000-0000-4000-8000-00000000dead"]) {
    const response = await page.goto(path);
    expect([200, 404], path).toContain(response?.status());
    await expect(page.getByRole("heading", { name: "Page not found", level: 1 })).toBeVisible();
    await expect(page.locator('meta[name="robots"][content*="noindex"]').first()).toBeAttached();
    await expect(page).toHaveTitle(/Page not found/);
  }
  expect(hydration()).toEqual([]);
});

test("the checklist is ticked section by section, then confirmed", async ({ page, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "Writes to the shared project: the desktop run covers it.");
  test.setTimeout(300_000);
  await asAdmin(page, baseURL!);
  await page.goto(`/admin/templates/${client.id}`);

  await chooseFile(page, page.getByRole("button", { name: "Upload Source File" }), {
    name: "Client variant form.pdf",
    mimeType: "application/pdf",
    buffer: SOURCE_PDF,
  });
  await expect(toast(page, "Source file added.")).toBeVisible(ACTION);
  await expect(page.getByTestId("source-file-name")).toHaveText("Client-variant-form.pdf", ACTION);

  const checklist = page.locator("#coverage");
  for (const tab of await checklist.getByRole("tab").all()) {
    await tab.click();
    const panel = checklist.getByRole("tabpanel");
    for (const box of await panel.getByRole("checkbox").all()) await box.check();
  }
  await expect(checklist.getByRole("button", { name: "Confirm Coverage" })).toBeDisabled();
  const attest = checklist.getByRole("checkbox", { name: /I have checked Client-variant-form\.pdf/ });
  await attest.check();
  await expect(checklist.getByText("Ready to confirm.")).toBeVisible();
  await shot(page, "checklist-ticked");

  // Refused (someone saved the version since the page was read): every tick stays, the last one too.
  // React resets a form after its action, which must not clear the Checkbox.
  await touchTemplate(client.id);
  await checklist.getByRole("button", { name: "Confirm Coverage" }).click();
  await expect(checklist.getByRole("alert").filter({ hasText: "Someone changed this version" })).toBeVisible(ACTION);
  await expect(attest).toBeChecked();
  await expect(checklist.getByText("Ready to confirm.")).toBeVisible();
  expect((await templateRow(client.id)).coverage_confirmed_at).toBeNull();
  await shot(page, "checklist-refused");

  // The page took in the newer version (refresh()): confirming again goes through.
  await checklist.getByRole("button", { name: "Confirm Coverage" }).click();
  await expect(toast(page, /Coverage confirmed for .* It can be activated now\./)).toBeVisible(ACTION);
  await expect(checklist.getByText("Coverage Confirmed")).toBeVisible(ACTION);
  const row = await templateRow(client.id);
  expect(row.coverage_confirmed_at).not.toBeNull();
  expect(row.coverage_confirmed_by).not.toBeNull();
  await shot(page, "checklist-confirmed");
});

test("a version's life: source file, coverage, frozen by use, activate, retire, new version", async ({ page, baseURL }) => {
  test.skip(test.info().project.name !== "desktop", "Writes to the shared project: the desktop run covers it.");
  test.setTimeout(300_000);
  const hydration = watchConsole(page);
  await asAdmin(page, baseURL!);
  await page.goto(`/admin/templates/${root.id}`);

  await test.step("upload the source form", async () => {
    await chooseFile(page, page.getByRole("button", { name: "Upload Source File" }), {
      name: "E2E source form (v1).pdf",
      mimeType: "application/pdf",
      buffer: SOURCE_PDF,
    });
    await expect(toast(page, "Source file added.")).toBeVisible(ACTION);
    await expect(page.getByTestId("source-file-name")).toHaveText("E2E-source-form-v1.pdf", ACTION);
    const row = await templateRow(root.id);
    expect(row.source_file_path).toMatch(new RegExp(`^${root.code}/v1/[0-9a-f-]{36}/E2E-source-form-v1\\.pdf$`));
    // The definition and the resolved template name the same file.
    expect((row.definition as { sourceFile?: string }).sourceFile).toBe(row.source_file_path);
    expect((row.resolved as { sourceFile?: string }).sourceFile).toBe(row.source_file_path);
  });

  await test.step("download it through a signed link", async () => {
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Download" }).click();
    expect((await download).suggestedFilename()).toBe("E2E-source-form-v1.pdf");
  });

  await test.step("a wrong file is refused before it is sent", async () => {
    await chooseFile(page, page.getByRole("button", { name: "Replace File" }), {
      name: "notes.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("x"),
    });
    await expect(page.getByRole("alert").filter({ hasText: "Choose a PDF, Excel or Word file, or a photo" })).toBeVisible();
  });

  await test.step("confirm the coverage checklist", async () => {
    const checklist = page.locator("#coverage");
    await checklist.getByRole("checkbox", { name: /I have checked E2E-source-form-v1\.pdf/ }).check();
    await shot(page, "version-ready");
    await checklist.getByRole("button", { name: "Confirm Coverage" }).click();
    await expect(toast(page, /Coverage confirmed/)).toBeVisible(ACTION);
    await expect(page.getByRole("button", { name: "Activate" })).toBeEnabled(ACTION);
  });

  await test.step("a draft an inspection uses is frozen: a new version is the way to change it", async () => {
    // An admin may start an inspection from a draft (lib/templates selectTemplate).
    await insertInspection(root.id);
    await page.reload();
    await expect(page.getByRole("note").filter({ hasText: "Frozen: used by 1 inspection" })).toContainText(
      `To change ${root.code}, make a new version.`,
    );
    await expect(page.getByRole("link", { name: "Edit Draft" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Replace File|Upload Source File/ })).toHaveCount(0);
    await expect(page.getByText("Version 1 is used by inspections, so its source file stays as it is.")).toBeVisible();
    // Its file and checklist are in, so it can still be activated as it is.
    await expect(page.getByRole("button", { name: "Activate" })).toBeEnabled();
    await shot(page, "version-draft-in-use");

    const dialog = await openDialog(page, page.getByRole("button", { name: "New Version" }));
    await expect(dialog).toContainText(`Make Version 2 of ${root.code}?`);
    await expect(dialog).toContainText("starts as a draft copy of version 1, with the same source file,");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
  });

  await test.step("activate it", async () => {
    const dialog = await openDialog(page, page.getByRole("button", { name: "Activate" }));
    await expect(dialog).toContainText(`Activate ${root.code} Version 1?`);
    await shot(page, "activate-dialog");
    await dialog.getByRole("button", { name: "Activate" }).click();
    await expect(toast(page, `${root.code} version 1 is active.`)).toBeVisible(ACTION);
    await expect(page.locator('[data-slot="page-header"] [data-slot="template-status"]')).toHaveText("Active", ACTION);
    expect((await templateRow(root.id)).status).toBe("active");
    await shot(page, "version-active");
  });

  await test.step("active and in use, it stays frozen", async () => {
    await page.reload();
    await expect(page.getByRole("note").filter({ hasText: "Frozen: used by 1 inspection" })).toContainText(
      "the database refuses any edit to a version an inspection uses",
    );
    await expect(page.getByRole("button", { name: /Replace File|Upload Source File/ })).toHaveCount(0);
    await expect(page.getByText("so its source file stays as it was checked")).toHaveCount(0);
    await expect(page.getByText("Version 1 is used by inspections, so its source file stays as it is.", { exact: false })).toBeVisible();
    await shot(page, "version-frozen");
  });

  await test.step("retire it", async () => {
    const dialog = await openDialog(page, page.getByRole("button", { name: "Retire" }));
    await expect(dialog).toContainText("The inspection that uses it keeps it.");
    await shot(page, "retire-dialog");
    await dialog.getByRole("button", { name: "Retire" }).click();
    await expect(toast(page, `${root.code} version 1 is retired.`)).toBeVisible(ACTION);
    await expect(page.locator('[data-slot="page-header"] [data-slot="template-status"]')).toHaveText("Retired", ACTION);
    await expect(page.getByRole("button", { name: "Activate Again" })).toBeEnabled(ACTION);
  });

  let draftId = "";
  await test.step("make a new version: a draft copy that opens in the editor", async () => {
    const dialog = await openDialog(page, page.getByRole("button", { name: "New Version" }));
    await expect(dialog).toContainText(`Make Version 2 of ${root.code}?`);
    await shot(page, "new-version-dialog");
    await dialog.getByRole("button", { name: "Make New Version" }).click();
    await expect(page).toHaveURL(/\/admin\/templates\/[0-9a-f-]{36}\/edit$/, ACTION);

    const versions = await templatesOfCode(root.code);
    expect(versions.map((entry) => [entry.version, entry.status])).toEqual([
      [1, "retired"],
      [2, "draft"],
    ]);
    const [first, second] = versions;
    draftId = second.id;
    expect(page.url()).toContain(`/admin/templates/${second.id}/edit`);
    // Same definition and source file; coverage is checked again for the new version.
    expect(second.source_file_path).toBe(first.source_file_path);
    expect(second.coverage_confirmed_at).toBeNull();
    expect((second.definition as { name: string }).name).toBe((first.definition as { name: string }).name);
    // Resolved against the base's active version (never a draft of it).
    expect((await templateRow(second.id)).resolved).toMatchObject({ bases: [{ code: base.code, version: 1 }] });
  });

  await test.step("another new version first points to the open draft", async () => {
    await page.goto(`/admin/templates/${root.id}`);
    const dialog = await openDialog(page, page.getByRole("button", { name: "New Version" }));
    await expect(dialog).toContainText(`Make Version 3 of ${root.code}?`);
    await expect(dialog).toContainText(`Version 2 is already a draft of ${root.code}`);
    await expect(dialog.getByRole("link", { name: "open version 2" })).toHaveAttribute("href", `/admin/templates/${draftId}`);
    await shot(page, "new-version-dialog-draft");
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toHaveCount(0);
    // Focus goes back to the button that opened it.
    await expect(page.getByRole("button", { name: "New Version" })).toBeFocused();
  });

  await test.step("the list shows both versions and what uses them", async () => {
    await page.goto("/admin/templates");
    const card = page.locator(`section[data-code="${root.code}"]`);
    await expect(card).toContainText("No active version · 2 versions");
    await expect(card.locator("tbody tr[data-version='2'] [data-slot='template-status']")).toHaveText("Draft");
    await expect(card.locator("tbody tr[data-version='1'] [data-slot='template-status']")).toHaveText("Retired");
    await expect(card.locator("tbody tr[data-version='1']")).toContainText("1 inspection");
    await shot(page, "list-after");
  });
  expect(hydration()).toEqual([]);
});
