import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";
import {
  PREFIX,
  cleanUp,
  createInUseFixtures,
  drawLogo,
  failOnHydrationErrors,
  isDesktop,
  logoFiles,
  runTag,
  shot,
  useAccount,
  type AdminClient,
} from "./support";

/**
 * /admin/manufacturers and /admin/clients (BUILD_SPEC 3, 5 and 10) against
 * the live project, at the three sizes in playwright.config.ts. Rows are
 * named E2E_REFDATA…; afterAll deletes them, their logo files and the draft
 * template that marks one manufacturer and one client as in use.
 * Screenshots go to screenshots/refdata/ (git-ignored).
 */

let admin: AdminClient;
let tag: string;
let inUse: Awaited<ReturnType<typeof createInUseFixtures>>;

test.beforeAll(async () => {
  admin = createTestAdminClient();
  tag = runTag();
  await cleanUp(admin);
  inUse = await createInUseFixtures(admin, tag);
});

test.afterAll(async () => {
  await cleanUp(admin);
});

failOnHydrationErrors();

/** The panel (a dialog) with this title. */
function panel(page: Page, title: string): Locator {
  return page.getByRole("dialog", { name: title });
}

/** A button in the panel's footer (the panel's corner X is also called Close). */
function footerButton(panel: Locator, name: string): Locator {
  return panel.locator('[data-slot="sheet-footer"]').getByRole("button", { name, exact: true });
}

/** The table row that names `text`. */
function row(page: Page, text: string): Locator {
  return page.getByRole("row").filter({ hasText: text });
}

async function search(page: Page, label: string, query: string) {
  await page.getByRole("searchbox", { name: label }).fill(query);
}

test.describe("manufacturers, as the admin", () => {
  useAccount(TEST_ACCOUNTS.admin);

  test("the list searches as you type and keeps the search in the address", async ({ page }) => {
    await page.goto("/admin/manufacturers");
    await expect(page.getByRole("heading", { level: 1, name: "Manufacturers" })).toBeVisible();
    await expect(page).toHaveTitle("Manufacturers · SteriCare QC");
    await expect(row(page, inUse.name)).toBeVisible();
    await expect(row(page, inUse.name)).toContainText("1 template");
    await shot(page, "manufacturers-list");

    await search(page, "Search manufacturers", `in use ${tag.toLowerCase()}`);
    await expect(page.getByRole("row")).toHaveCount(2); // the header and the match
    await expect(page.getByText(/^1 of \d+ manufacturers$/)).toBeVisible();
    await expect(page).toHaveURL(/\?q=in\+use\+/);

    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Search manufacturers" })).toHaveValue(
      `in use ${tag.toLowerCase()}`,
    );
    await expect(page.getByRole("row")).toHaveCount(2);

    await search(page, "Search manufacturers", "no factory is called this");
    await expect(page.getByText("No manufacturers match “no factory is called this”")).toBeVisible();
    await shot(page, "manufacturers-no-match");
    await page.getByRole("button", { name: "Clear search" }).first().click();
    await expect(row(page, inUse.name)).toBeVisible();
    await expect(page).not.toHaveURL(/\?q=/);
  });

  test("add, check, edit and delete a manufacturer", async ({ page }) => {
    const name = `${PREFIX} ${tag} Gloves`;
    await page.goto("/admin/manufacturers");

    // Add: the name is required.
    await page.getByRole("button", { name: "Add manufacturer" }).click();
    const add = panel(page, "Add manufacturer");
    await expect(add).toBeVisible();
    await shot(page, "manufacturer-add");
    await add.getByRole("button", { name: "Add manufacturer" }).click();
    await expect(add.getByText("Enter the manufacturer's name.")).toBeVisible();
    await expect(add.getByLabel("Name", { exact: true })).toBeFocused();
    await expect(add.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await shot(page, "manufacturer-add-error");

    await add.getByLabel("Name", { exact: true }).fill(`  ${name}  `);
    await add.getByLabel("Factory").fill("Plant 7");
    await add.getByLabel("Address").fill("Lot 1, Jalan Contoh   \n43900 Sepang, Selangor\n\n");
    await add.getByLabel("Country").fill("Malaysia");
    await add.getByLabel("Notes").fill("Created by the reference data e2e spec.");
    await add.getByRole("button", { name: "Add manufacturer" }).click();
    await expect(page.getByText(`${name}, Plant 7 added.`)).toBeVisible();
    await expect(add).toBeHidden();
    await expect(row(page, name)).toContainText("Plant 7");

    const { data: created } = await admin
      .from("manufacturers")
      .select("id, name, factory_name, address, country, notes")
      .eq("name", name)
      .single();
    expect(created).toMatchObject({
      name,
      factory_name: "Plant 7",
      address: "Lot 1, Jalan Contoh\n43900 Sepang, Selangor",
      country: "Malaysia",
    });

    // The same name and factory again is a duplicate, shown at the name.
    await page.getByRole("button", { name: "Add manufacturer" }).click();
    const again = panel(page, "Add manufacturer");
    await again.getByLabel("Name", { exact: true }).fill(name.toLowerCase());
    await again.getByLabel("Factory").fill("plant 7");
    await again.getByRole("button", { name: "Add manufacturer" }).click();
    await expect(again.getByText("There is already a manufacturer with this name and factory.")).toBeVisible();
    await shot(page, "manufacturer-duplicate");
    await footerButton(again, "Cancel").click();
    await expect(again).toBeHidden();

    // Edit.
    await row(page, name).getByRole("button", { name: `Edit ${name}, Plant 7` }).click();
    const edit = panel(page, "Edit manufacturer");
    await expect(edit.getByLabel("Name", { exact: true })).toHaveValue(name);
    await expect(edit.getByText("Not used by any template or inspection, so it can be deleted.")).toBeVisible();
    await shot(page, "manufacturer-edit");
    await edit.getByLabel("Factory").fill("Plant 8");
    await expect(footerButton(edit, "Cancel")).toBeVisible();
    await edit.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByText(`${name}, Plant 8 saved.`)).toBeVisible();
    await expect(edit).toBeHidden();
    await expect(row(page, name)).toContainText("Plant 8");

    // Delete.
    await row(page, name).getByRole("button", { name: /^Edit / }).click();
    const reopened = panel(page, "Edit manufacturer");
    await reopened.getByRole("button", { name: "Delete manufacturer" }).click();
    const confirm = page.getByRole("alertdialog", { name: `Delete ${name}, Plant 8?` });
    await expect(confirm).toBeVisible();
    await shot(page, "manufacturer-delete-confirm");
    await confirm.getByRole("button", { name: "Delete manufacturer" }).click();
    await expect(page.getByText(`${name}, Plant 8 deleted.`)).toBeVisible();
    await expect(confirm).toBeHidden();
    await expect(reopened).toBeHidden();
    await expect(row(page, name)).toHaveCount(0);

    const { data: left } = await admin.from("manufacturers").select("id").eq("id", created!.id);
    expect(left).toEqual([]);
  });

  test("a manufacturer a template uses cannot be deleted", async ({ page }) => {
    await page.goto(`/admin/manufacturers?q=${encodeURIComponent(inUse.name)}`);
    await row(page, inUse.name).click();
    const edit = panel(page, "Edit manufacturer");
    await expect(edit.getByText("Used by 1 template, so it cannot be deleted.")).toBeVisible();
    await expect(edit.getByRole("button", { name: "Delete manufacturer" })).toBeDisabled();
    await edit.getByRole("button", { name: "Delete manufacturer" }).scrollIntoViewIfNeeded();
    await shot(page, "manufacturer-in-use");
  });
});

test.describe("clients, as the admin", () => {
  useAccount(TEST_ACCOUNTS.admin);

  test("add a client, upload, replace and remove its logo, then delete it", async ({ page }) => {
    const name = `${PREFIX} ${tag} Healthcare`;
    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
    await expect(page).toHaveTitle("Clients · SteriCare QC");

    await page.getByRole("button", { name: "Add client" }).click();
    const add = panel(page, "Add client");
    await add.getByLabel("Name", { exact: true }).fill(name);
    await add.getByLabel("Notes").fill("Created by the reference data e2e spec.");
    await shot(page, "client-add");
    await add.getByRole("button", { name: "Add client" }).click();
    await expect(page.getByText(`${name} added. You can add their logo now.`)).toBeVisible();

    // The panel stays open on the new client, ready for its logo.
    const edit = panel(page, "Edit client");
    await expect(edit).toBeVisible();
    await expect(edit.getByText("No logo yet")).toBeVisible();
    await expect(footerButton(edit, "Close")).toBeVisible();
    const { data: created } = await admin.from("clients").select("id").eq("name", name).single();
    const clientId = created!.id;
    const fileInput = edit.locator('input[type="file"][name="logo"]');

    // Files the bucket would refuse never leave the browser.
    await fileInput.setInputFiles({ name: "logo.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a") });
    await expect(edit.getByText("Choose a PNG, JPEG or WebP image.")).toBeVisible();
    await fileInput.setInputFiles({
      name: "huge.png",
      mimeType: "image/png",
      buffer: Buffer.alloc(Math.round(2.5 * 1024 * 1024)),
    });
    await expect(edit.getByText("That image is 2.5 MB. Choose one up to 2 MB.")).toBeVisible();
    await shot(page, "client-logo-too-large");
    expect(await logoFiles(admin, clientId)).toEqual([]);

    // Upload: straight to the private bucket, previewed through a signed URL.
    await fileInput.setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await drawLogo(page, "image/png", "PNG") });
    await expect(page.getByText("Logo added.")).toBeVisible();
    const preview = edit.getByRole("img", { name: `${name} logo` });
    await expect(preview).toBeVisible();
    await expect(preview).toHaveAttribute("src", /\/storage\/v1\/object\/sign\/client-logos\//);
    await expect.poll(() => preview.evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await expect(edit.getByRole("button", { name: "Replace logo" })).toBeVisible();
    await shot(page, "client-logo");

    const pngFiles = await logoFiles(admin, clientId);
    expect(pngFiles).toHaveLength(1);
    expect(pngFiles[0]).toMatch(new RegExp(`^${clientId}/[0-9a-f-]{36}\\.png$`));
    const { data: withPng } = await admin.from("clients").select("logo_path").eq("id", clientId).single();
    expect(withPng!.logo_path).toBe(pngFiles[0]);

    // Replace: the new file becomes the logo and the old one goes.
    await fileInput.setInputFiles({
      name: "logo.jpg",
      mimeType: "image/jpeg",
      buffer: await drawLogo(page, "image/jpeg", "JPEG"),
    });
    await expect(page.getByText("Logo replaced.")).toBeVisible();
    await expect.poll(() => logoFiles(admin, clientId)).toEqual([expect.stringMatching(/\.jpg$/)]);
    const { data: withJpeg } = await admin.from("clients").select("logo_path").eq("id", clientId).single();
    expect(withJpeg!.logo_path).toMatch(/\.jpg$/);
    await expect(preview).toHaveAttribute("src", /\.jpg\?token=/);

    // Edit the client's own fields; the logo stays as it is.
    await edit.getByLabel("Notes").fill("Logo checked by the reference data e2e spec.");
    await footerButton(edit, "Save changes").click();
    await expect(page.getByText(`${name} saved.`)).toBeVisible();
    await expect(edit).toBeHidden();
    const { data: edited } = await admin.from("clients").select("notes, logo_path").eq("id", clientId).single();
    expect(edited).toEqual({ notes: "Logo checked by the reference data e2e spec.", logo_path: withJpeg!.logo_path });

    // The list shows the logo too.
    const listed = row(page, name);
    await expect.poll(() => listed.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    await shot(page, "clients-list");

    // Remove the logo.
    await listed.getByRole("button", { name: `Edit ${name}` }).click();
    const reopened = panel(page, "Edit client");
    await reopened.getByRole("button", { name: "Remove logo" }).click();
    const confirmRemove = page.getByRole("alertdialog", { name: "Remove the logo?" });
    await expect(confirmRemove).toBeVisible();
    await shot(page, "client-logo-remove-confirm");
    await confirmRemove.getByRole("button", { name: "Remove logo" }).click();
    await expect(page.getByText("Logo removed.")).toBeVisible();
    await expect(reopened.getByText("No logo yet")).toBeVisible();
    await expect.poll(() => logoFiles(admin, clientId)).toEqual([]);
    const { data: withoutLogo } = await admin.from("clients").select("logo_path").eq("id", clientId).single();
    expect(withoutLogo!.logo_path).toBeNull();

    // Delete the client.
    await reopened.getByRole("button", { name: "Delete client" }).click();
    const confirmDelete = page.getByRole("alertdialog", { name: `Delete ${name}?` });
    await confirmDelete.getByRole("button", { name: "Delete client" }).click();
    await expect(page.getByText(`${name} deleted.`)).toBeVisible();
    await expect(reopened).toBeHidden();
    await expect(row(page, name)).toHaveCount(0);
    const { data: left } = await admin.from("clients").select("id").eq("id", clientId);
    expect(left).toEqual([]);
  });

  test("a client a template uses cannot be deleted, and its logo can still change", async ({ page }) => {
    await page.goto("/admin/clients");
    await search(page, "Search clients", inUse.name);
    await expect(page.getByText(/^1 of \d+ clients?$/)).toBeVisible();
    await row(page, inUse.name).getByRole("button", { name: `Edit ${inUse.name}` }).click();
    const edit = panel(page, "Edit client");
    await expect(edit.getByText("Used by 1 template, so it cannot be deleted.")).toBeVisible();
    await expect(edit.getByRole("button", { name: "Delete client" })).toBeDisabled();
    await expect(edit.getByRole("button", { name: "Upload logo" })).toBeEnabled();
    if (isDesktop(page)) {
      // Touch sizes are checked on iPad below; on desktop the controls are compact.
      expect((await edit.getByRole("button", { name: "Upload logo" }).boundingBox())?.height).toBeLessThan(44);
    } else {
      for (const button of [
        edit.getByRole("button", { name: "Upload logo" }),
        footerButton(edit, "Save changes"),
        footerButton(edit, "Close"),
        edit.getByRole("button", { name: "Close", exact: true }).last(),
      ]) {
        expect((await button.boundingBox())?.height, String(button)).toBeGreaterThanOrEqual(44);
      }
      expect((await edit.getByLabel("Name", { exact: true }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await edit.getByRole("button", { name: "Delete client" }).scrollIntoViewIfNeeded();
    await shot(page, "client-in-use");
  });
});

test.describe("as the inspector", () => {
  useAccount(TEST_ACCOUNTS.inspector);

  for (const path of ["/admin/manufacturers", "/admin/clients"]) {
    test(`${path} is a 404`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response?.status()).toBe(404);
      const html = (await response?.text()) ?? "";
      // Nothing gives the page away: not the title, not the list, not the HTML.
      await expect(page).not.toHaveTitle(/Manufacturers|Clients/);
      expect(html).not.toContain(inUse.name);
      expect(html).not.toContain("Add manufacturer");
      expect(html).not.toContain("Add client");
      await expect(page.getByRole("heading", { name: /Manufacturers|Clients/ })).toHaveCount(0);
      await shot(page, `inspector${path.replaceAll("/", "-")}`);
    });
  }
});
