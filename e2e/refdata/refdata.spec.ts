import { expect, test, type Locator, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { TEST_ACCOUNTS } from "../support/session";
import {
  PREFIX,
  cleanUp,
  createInUseFixtures,
  drawLogo,
  failOnHydrationErrors,
  hasTouch,
  isDesktop,
  logoFiles,
  runTag,
  shot,
  useAccount,
  type AdminClient,
} from "./support";

/**
 * /admin/manufacturers and /admin/clients (BUILD_SPEC 3, 5 and 10) against
 * the live project, at the sizes in playwright.config.ts. Brands, companies
 * and clients are named E2E_REFDATA…; afterAll deletes them, their factories,
 * their logo files and the draft template that marks one factory and one
 * client as in use. Screenshots go to screenshots/refdata/ (git-ignored).
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

/** Height in CSS pixels. */
async function height(locator: Locator): Promise<number> {
  return (await locator.boundingBox())?.height ?? Number.NaN;
}

test.describe("manufacturers, as the admin", () => {
  useAccount(TEST_ACCOUNTS.admin);

  test("brands, companies and factories in one table, searched as you type", async ({ page }) => {
    await page.goto("/admin/manufacturers");
    await expect(page.getByRole("heading", { level: 1, name: "Manufacturers" })).toBeVisible();
    await expect(page).toHaveTitle("Manufacturers · SteriCare QC");

    // One row: the brand, its company and its factory, with the factory's usage.
    const inUseRow = row(page, inUse.companyName);
    await expect(inUseRow).toContainText(inUse.name);
    await expect(inUseRow).toContainText(inUse.factoryName);
    await expect(inUseRow).toContainText("1 template");
    // The pencils and pluses sit in the cells they act on.
    const controls = [
      inUseRow.getByRole("button", { name: `Edit ${inUse.name}`, exact: true }),
      inUseRow.getByRole("button", { name: `Add Company to ${inUse.name}` }),
      inUseRow.getByRole("button", { name: `Edit ${inUse.companyName}`, exact: true }),
      inUseRow.getByRole("button", { name: `Add Factory to ${inUse.companyName}` }),
      inUseRow.getByRole("button", { name: `Edit ${inUse.factoryName}` }),
    ];
    for (const control of controls) await expect(control).toBeVisible();
    if (isDesktop(page)) {
      // Compact rows with a mouse (docs/DESIGN.md, Density): about 36 px.
      expect(await height(inUseRow)).toBeLessThanOrEqual(37);
      await expect(inUseRow.getByRole("cell").nth(3)).toContainText("Malaysia");
    } else {
      // 44 px controls on any touchscreen, and no address column.
      for (const control of controls) expect(await height(control), String(control)).toBeGreaterThanOrEqual(44);
      await expect(page.getByRole("columnheader", { name: "Address" })).toBeHidden();
    }
    await shot(page, "manufacturers-list");

    // A factory's name with its brand's: just that factory, and the search in the address.
    await search(page, "Search manufacturers", `in use ${tag.toLowerCase()} plant 1`);
    await expect(page.getByRole("row")).toHaveCount(2); // the header and the match
    await expect(page.getByText(/^1 of \d+ factories$/)).toBeVisible();
    await expect(page).toHaveURL(/\?q=in\+use\+/);

    await page.reload();
    await expect(page.getByRole("searchbox", { name: "Search manufacturers" })).toHaveValue(
      `in use ${tag.toLowerCase()} plant 1`,
    );
    await expect(page.getByRole("row")).toHaveCount(2);

    await search(page, "Search manufacturers", "no factory is called this");
    await expect(page.getByText("No Manufacturers Match “no factory is called this”")).toBeVisible();
    await shot(page, "manufacturers-no-match");
    await page.getByRole("button", { name: "Clear Search" }).first().click();
    await expect(inUseRow).toBeVisible();
    await expect(page).not.toHaveURL(/\?q=/);
  });

  test("add a brand, its companies and factories, edit, move and delete them", async ({ page }) => {
    const brand = `${PREFIX} ${tag} Gloves`;
    const company = `${PREFIX} ${tag} Gloves Sdn. Bhd.`;
    // Sorts before `company`, so its row comes first under the brand.
    const otherCompany = `${PREFIX} ${tag} Gloves Medical`;
    const unnamed = `${company}'s Factory`;
    const button = (name: string) => page.getByRole("button", { name, exact: true });
    await page.goto("/admin/manufacturers");

    // Add a brand: the name is required.
    await button("Add Brand").click();
    const addBrand = panel(page, "Add Brand");
    await expect(addBrand).toBeVisible();
    await footerButton(addBrand, "Add Brand").click();
    await expect(addBrand.getByText("Enter the brand's name.")).toBeVisible();
    await expect(addBrand.getByLabel("Name", { exact: true })).toBeFocused();
    await expect(addBrand.getByLabel("Name", { exact: true })).toHaveAttribute("aria-invalid", "true");
    await addBrand.getByLabel("Name", { exact: true }).fill(`  ${brand}  `);
    await footerButton(addBrand, "Add Brand").click();
    await expect(page.getByText(`${brand} added.`)).toBeVisible();
    await expect(addBrand).toBeHidden();
    await expect(button("Add Brand")).toBeFocused();

    // The same name again, in another case, is a duplicate.
    await button("Add Brand").click();
    const again = panel(page, "Add Brand");
    await again.getByLabel("Name", { exact: true }).fill(brand.toLowerCase());
    await footerButton(again, "Add Brand").click();
    await expect(again.getByText("There is already a brand with this name.")).toBeVisible();
    await footerButton(again, "Cancel").click();
    await expect(again).toBeHidden();

    // A brand with no company offers Add Company in the company's cell, with the brand chosen.
    await row(page, brand).getByRole("button", { name: `Add Company to ${brand}` }).click();
    const addCompany = panel(page, "Add Company");
    await expect(addCompany.getByLabel("Brand")).toHaveText(brand);
    await addCompany.getByLabel("Name", { exact: true }).fill(company);
    await shot(page, "company-add");
    await footerButton(addCompany, "Add Company").click();
    await expect(page.getByText(`${company} added.`)).toBeVisible();
    // That button went with its row; the brand's plus took its place, and the focus.
    await expect(button(`Add Company to ${brand}`)).toBeFocused();

    // A company with no factory offers Add Factory in the factory's cell, with the company chosen.
    await row(page, company).getByRole("button", { name: `Add Factory to ${company}` }).click();
    const addFactory = panel(page, "Add Factory");
    await expect(addFactory.getByLabel("Company")).toHaveText(company);
    await addFactory.getByLabel("Factory (Optional)").fill("Plant 7");
    await addFactory.getByLabel("Address").fill("Lot 1, Jalan Contoh   \n43900 Sepang, Selangor\n\n");
    await addFactory.getByLabel("Country").fill("Malaysia");
    await addFactory.getByLabel("Notes").fill("Created by the reference data e2e spec.");
    await shot(page, "factory-add");
    await footerButton(addFactory, "Add Factory").click();
    await expect(page.getByText("Plant 7 added.")).toBeVisible();
    await expect(button(`Add Factory to ${company}`)).toBeFocused();

    const { data: companyRow } = await admin.from("manufacturer_companies").select("id, brand_id").eq("name", company).single();
    const { data: plant } = await admin
      .from("manufacturers")
      .select("id, factory_name, address, country, notes")
      .eq("company_id", companyRow!.id)
      .single();
    expect(plant).toMatchObject({
      factory_name: "Plant 7",
      address: "Lot 1, Jalan Contoh\n43900 Sepang, Selangor",
      country: "Malaysia",
      notes: "Created by the reference data e2e spec.",
    });

    // A second factory needs no name; a company has one such factory at most, and each name once.
    await button(`Add Factory to ${company}`).click();
    const second = panel(page, "Add Factory");
    await footerButton(second, "Add Factory").click();
    await expect(page.getByText(`${company}'s factory added.`)).toBeVisible();
    await button(`Add Factory to ${company}`).click();
    const duplicate = panel(page, "Add Factory");
    await footerButton(duplicate, "Add Factory").click();
    await expect(duplicate.getByText("This company already has a factory without a name.")).toBeVisible();
    await duplicate.getByLabel("Factory (Optional)").fill("plant 7");
    await footerButton(duplicate, "Add Factory").click();
    await expect(duplicate.getByText("This company already has a factory with this name.")).toBeVisible();
    await expect(duplicate.getByLabel("Factory (Optional)")).toBeFocused();
    await shot(page, "factory-duplicate");
    await footerButton(duplicate, "Cancel").click();
    await expect(duplicate).toBeHidden();

    // The brand's and the company's cells span the company's two rows, the unnamed factory first.
    await expect(page.locator('td[rowspan="2"]', { hasText: brand }).first()).toBeVisible();
    await expect(page.locator('td[rowspan="2"]', { hasText: company })).toBeVisible();
    await expect(row(page, company)).toContainText("—");
    await shot(page, "manufacturers-branch");

    // From the keyboard: Enter on a pencil opens its panel, Escape closes it with the focus back.
    const editPlant = button("Edit Plant 7");
    await editPlant.focus();
    await page.keyboard.press("Enter");
    const edit = panel(page, "Edit Factory");
    await expect(edit.getByLabel("Factory (Optional)")).toHaveValue("Plant 7");
    await expect(edit.getByLabel("Company")).toHaveText(company);
    // With a mouse the first text field takes the focus; on touch the panel does, so no keyboard pops up.
    if (!hasTouch()) await expect(edit.getByLabel("Factory (Optional)")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(edit).toBeHidden();
    await expect(editPlant).toBeFocused();

    // A second company, from the brand's plus.
    await button(`Add Company to ${brand}`).click();
    const addOther = panel(page, "Add Company");
    await addOther.getByLabel("Name", { exact: true }).fill(otherCompany);
    await footerButton(addOther, "Add Company").click();
    await expect(page.getByText(`${otherCompany} added.`)).toBeVisible();

    // Rename Plant 7 and move it to the other company.
    await button("Edit Plant 7").click();
    const move = panel(page, "Edit Factory");
    await move.getByLabel("Factory (Optional)").fill("Plant 8");
    await move.getByLabel("Company").click();
    await page.getByRole("option", { name: otherCompany }).click();
    await expect(move.getByLabel("Company")).toHaveText(otherCompany);
    await expect(footerButton(move, "Cancel")).toBeVisible();
    await shot(page, "factory-edit");
    await footerButton(move, "Save Changes").click();
    await expect(page.getByText("Plant 8 saved.")).toBeVisible();
    await expect(move).toBeHidden();
    await expect(row(page, otherCompany)).toContainText("Plant 8");
    await expect(button("Edit Plant 8")).toBeFocused();
    const { data: other } = await admin.from("manufacturer_companies").select("id").eq("name", otherCompany).single();
    const { data: moved } = await admin.from("manufacturers").select("company_id, factory_name").eq("id", plant!.id).single();
    expect(moved).toEqual({ company_id: other!.id, factory_name: "Plant 8" });

    // A brand with companies and a company with factories cannot be deleted.
    await button(`Edit ${brand}`).click();
    const editBrand = panel(page, "Edit Brand");
    await expect(editBrand.getByLabel("Name", { exact: true })).toHaveValue(brand);
    await expect(editBrand.getByText("Has 2 companies, so it cannot be deleted.")).toBeVisible();
    await expect(editBrand.getByRole("button", { name: "Delete Brand" })).toBeDisabled();
    await shot(page, "brand-edit");
    await footerButton(editBrand, "Close").click();
    await expect(editBrand).toBeHidden();
    await button(`Edit ${company}`).click();
    const editCompany = panel(page, "Edit Company");
    await expect(editCompany.getByText("Has 1 factory, so it cannot be deleted.")).toBeVisible();
    await expect(editCompany.getByRole("button", { name: "Delete Company" })).toBeDisabled();
    await footerButton(editCompany, "Close").click();
    await expect(editCompany).toBeHidden();

    // Delete the unnamed factory. Cancelling the confirmation keeps the panel, with the focus on its Delete button.
    await button(`Edit ${unnamed}`).click();
    const editUnnamed = panel(page, "Edit Factory");
    await expect(editUnnamed.getByText("Not used by any template or inspection, so it can be deleted.")).toBeVisible();
    const deleteFactory = editUnnamed.getByRole("button", { name: "Delete Factory" });
    await deleteFactory.click();
    const confirm = page.getByRole("alertdialog", { name: `Delete ${unnamed}?` });
    await expect(confirm).toBeVisible();
    await shot(page, "factory-delete-confirm");
    await confirm.getByRole("button", { name: "Cancel" }).click();
    await expect(confirm).toBeHidden();
    await expect(deleteFactory).toBeFocused();
    await deleteFactory.click();
    await confirm.getByRole("button", { name: "Delete Factory" }).click();
    await expect(page.getByText(`${company}'s factory deleted.`)).toBeVisible();
    await expect(editUnnamed).toBeHidden();
    // Its pencil has gone: the focus goes to its company's, whose row offers Add Factory again.
    await expect(button(`Edit ${company}`)).toBeFocused();
    await expect(row(page, company).getByRole("button", { name: `Add Factory to ${company}` })).toBeVisible();

    // Delete that company, now with no factory: the focus goes to its brand.
    await button(`Edit ${company}`).click();
    const emptyCompany = panel(page, "Edit Company");
    await expect(emptyCompany.getByText("Has no factories, so it can be deleted.")).toBeVisible();
    await emptyCompany.getByRole("button", { name: "Delete Company" }).click();
    await page.getByRole("alertdialog", { name: `Delete ${company}?` }).getByRole("button", { name: "Delete Company" }).click();
    await expect(page.getByText(`${company} deleted.`)).toBeVisible();
    await expect(button(`Edit ${brand}`)).toBeFocused();

    // Plant 8, its company, then the brand.
    await button("Edit Plant 8").click();
    await panel(page, "Edit Factory").getByRole("button", { name: "Delete Factory" }).click();
    await page.getByRole("alertdialog", { name: "Delete Plant 8?" }).getByRole("button", { name: "Delete Factory" }).click();
    await expect(page.getByText("Plant 8 deleted.")).toBeVisible();
    await button(`Edit ${otherCompany}`).click();
    await panel(page, "Edit Company").getByRole("button", { name: "Delete Company" }).click();
    await page
      .getByRole("alertdialog", { name: `Delete ${otherCompany}?` })
      .getByRole("button", { name: "Delete Company" })
      .click();
    await expect(page.getByText(`${otherCompany} deleted.`)).toBeVisible();
    await expect(row(page, brand).getByRole("button", { name: `Add Company to ${brand}` })).toBeVisible();

    await button(`Edit ${brand}`).click();
    const emptyBrand = panel(page, "Edit Brand");
    await expect(emptyBrand.getByText("Has no companies, so it can be deleted.")).toBeVisible();
    await emptyBrand.getByRole("button", { name: "Delete Brand" }).click();
    await page.getByRole("alertdialog", { name: `Delete ${brand}?` }).getByRole("button", { name: "Delete Brand" }).click();
    await expect(page.getByText(`${brand} deleted.`)).toBeVisible();
    await expect(emptyBrand).toBeHidden();
    await expect(row(page, brand)).toHaveCount(0);
    // Its row, and the pencil the panel opened from, have gone: the focus goes to Add Brand.
    await expect(button("Add Brand")).toBeFocused();

    const { data: left } = await admin.from("manufacturer_brands").select("id").eq("id", companyRow!.brand_id);
    expect(left).toEqual([]);
  });

  test("a factory a template uses cannot be deleted", async ({ page }) => {
    await page.goto(`/admin/manufacturers?q=${encodeURIComponent(inUse.companyName)}`);
    await row(page, inUse.companyName).getByRole("button", { name: `Edit ${inUse.factoryName}` }).click();
    const edit = panel(page, "Edit Factory");
    await expect(edit.getByText("Used by 1 template, so it cannot be deleted.")).toBeVisible();
    await expect(edit.getByRole("button", { name: "Delete Factory" })).toBeDisabled();
    if (isDesktop(page)) {
      expect(await height(footerButton(edit, "Save Changes"))).toBeLessThan(44);
    } else {
      for (const control of [
        edit.getByLabel("Company"),
        edit.getByLabel("Factory (Optional)"),
        footerButton(edit, "Save Changes"),
        footerButton(edit, "Close"),
      ]) {
        expect(await height(control), String(control)).toBeGreaterThanOrEqual(44);
      }
    }
    await edit.getByRole("button", { name: "Delete Factory" }).scrollIntoViewIfNeeded();
    await shot(page, "factory-in-use");
  });
});

test.describe("clients, as the admin", () => {
  useAccount(TEST_ACCOUNTS.admin);

  test("add a client, upload, replace and remove its logo, then delete it", async ({ page }) => {
    const name = `${PREFIX} ${tag} Healthcare`;
    await page.goto("/admin/clients");
    await expect(page.getByRole("heading", { level: 1, name: "Clients" })).toBeVisible();
    await expect(page).toHaveTitle("Clients · SteriCare QC");

    await page.getByRole("button", { name: "Add Client" }).click();
    const add = panel(page, "Add Client");
    await add.getByLabel("Name", { exact: true }).fill(name);
    await add.getByLabel("Notes").fill("Created by the reference data e2e spec.");
    await shot(page, "client-add");
    await add.getByRole("button", { name: "Add Client" }).click();
    await expect(page.getByText(`${name} added. You can add their logo now.`)).toBeVisible();

    // The panel stays open on the new client, ready for its logo.
    const edit = panel(page, "Edit Client");
    await expect(edit).toBeVisible();
    await expect(edit.getByText("No Logo", { exact: true })).toBeVisible();
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
    await expect(edit.getByRole("button", { name: "Replace Logo" })).toBeVisible();
    await shot(page, "client-logo");

    const pngFiles = await logoFiles(admin, clientId);
    expect(pngFiles).toHaveLength(1);
    expect(pngFiles[0]).toMatch(new RegExp(`^${clientId}/[0-9a-f-]{36}\\.png$`));
    const { data: withPng } = await admin.from("clients").select("logo_path").eq("id", clientId).single();
    expect(withPng!.logo_path).toBe(pngFiles[0]);

    // Replace, from the keyboard: the new file becomes the logo and the old
    // one goes. The button is busy while it uploads, then has the focus again.
    const replace = edit.getByRole("button", { name: "Replace Logo" });
    await replace.focus();
    await fileInput.setInputFiles({
      name: "logo.jpg",
      mimeType: "image/jpeg",
      buffer: await drawLogo(page, "image/jpeg", "JPEG"),
    });
    await expect(page.getByText("Logo replaced.")).toBeVisible();
    await expect(replace).toBeFocused();
    await expect.poll(() => logoFiles(admin, clientId)).toEqual([expect.stringMatching(/\.jpg$/)]);
    const { data: withJpeg } = await admin.from("clients").select("logo_path").eq("id", clientId).single();
    expect(withJpeg!.logo_path).toMatch(/\.jpg$/);
    await expect(preview).toHaveAttribute("src", /\.jpg\?token=/);

    // Edit the client's own fields; the logo stays as it is. The panel's own
    // uploads moved the row's version on, and the save still goes through.
    await edit.getByLabel("Notes").fill("Logo checked by the reference data e2e spec.");
    await footerButton(edit, "Save Changes").click();
    await expect(page.getByText(`${name} saved.`)).toBeVisible();
    await expect(edit).toBeHidden();
    await expect(page.getByRole("button", { name: "Add Client" })).toBeFocused();
    const { data: edited } = await admin.from("clients").select("notes, logo_path").eq("id", clientId).single();
    expect(edited).toEqual({ notes: "Logo checked by the reference data e2e spec.", logo_path: withJpeg!.logo_path });

    // The list shows the logo too.
    const listed = row(page, name);
    await expect.poll(() => listed.locator("img").evaluate((image: HTMLImageElement) => image.naturalWidth)).toBeGreaterThan(0);
    if (isDesktop(page)) expect(await height(listed)).toBeLessThanOrEqual(36);
    await shot(page, "clients-list");

    // Remove the logo. Cancelling keeps it, with the focus back on Remove Logo.
    await listed.getByRole("button", { name: `Edit ${name}` }).click();
    const reopened = panel(page, "Edit Client");
    const removeButton = reopened.getByRole("button", { name: "Remove Logo" });
    await removeButton.click();
    const confirmRemove = page.getByRole("alertdialog", { name: "Remove the Logo?" });
    await expect(confirmRemove).toBeVisible();
    await shot(page, "client-logo-remove-confirm");
    await confirmRemove.getByRole("button", { name: "Cancel" }).click();
    await expect(confirmRemove).toBeHidden();
    await expect(removeButton).toBeFocused();
    await removeButton.click();
    await confirmRemove.getByRole("button", { name: "Remove Logo" }).click();
    await expect(page.getByText("Logo removed.")).toBeVisible();
    await expect(reopened.getByText("No Logo", { exact: true })).toBeVisible();
    // Remove Logo went with the logo, so the focus is on Upload Logo.
    await expect(reopened.getByRole("button", { name: "Upload Logo" })).toBeFocused();
    await expect.poll(() => logoFiles(admin, clientId)).toEqual([]);
    const { data: withoutLogo } = await admin.from("clients").select("logo_path").eq("id", clientId).single();
    expect(withoutLogo!.logo_path).toBeNull();

    // Delete the client.
    await reopened.getByRole("button", { name: "Delete Client" }).click();
    const confirmDelete = page.getByRole("alertdialog", { name: `Delete ${name}?` });
    await confirmDelete.getByRole("button", { name: "Delete Client" }).click();
    await expect(page.getByText(`${name} deleted.`)).toBeVisible();
    await expect(reopened).toBeHidden();
    await expect(row(page, name)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add Client" })).toBeFocused();
    const { data: left } = await admin.from("clients").select("id").eq("id", clientId);
    expect(left).toEqual([]);
  });

  test("a save over someone else's change is refused, even after a logo upload in the panel", async ({ page }) => {
    test.skip(test.info().project.name !== "desktop", "The same at every size: once spares the shared database.");
    const name = `${PREFIX} ${tag} Concurrency`;
    const { data: created, error } = await admin
      .from("clients")
      .insert({ name, notes: "Their notes, before." })
      .select("id")
      .single();
    if (error) throw new Error(`Could not create the test client: ${error.message}`);

    await page.goto(`/admin/clients?q=${encodeURIComponent(name)}`);
    await row(page, name).getByRole("button", { name: `Edit ${name}` }).click();
    const edit = panel(page, "Edit Client");
    await expect(edit.getByLabel("Name", { exact: true })).toHaveValue(name);

    // Another admin renames the client while this panel is open...
    const theirs = { name: `${name} renamed`, notes: "Their notes, after." };
    const renamed = await admin.from("clients").update(theirs).eq("id", created.id);
    expect(renamed.error).toBeNull();

    // ...and a logo upload here refreshes the page with their version underneath.
    await edit
      .locator('input[type="file"][name="logo"]')
      .setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: await drawLogo(page, "image/png", "PNG") });
    await expect(page.getByText("Logo added.")).toBeVisible();
    await expect(edit.getByLabel("Name", { exact: true })).toHaveValue(name);
    // Their change is not something typed here.
    await expect(footerButton(edit, "Close")).toBeVisible();

    await edit.getByLabel("Notes").fill("Notes from this panel.");
    await footerButton(edit, "Save Changes").click();
    await expect(edit.getByText(/^Someone else changed this client while you were editing\./)).toBeVisible();
    await shot(page, "client-save-conflict");
    const { data: kept } = await admin.from("clients").select("name, notes").eq("id", created.id).single();
    expect(kept).toEqual(theirs);

    // Saving again replaces their change, as the message says.
    await footerButton(edit, "Save Changes").click();
    await expect(page.getByText(`${name} saved.`)).toBeVisible();
    await expect(edit).toBeHidden();
    const { data: replaced } = await admin.from("clients").select("name, notes").eq("id", created.id).single();
    expect(replaced).toEqual({ name, notes: "Notes from this panel." });
  });

  test("a client a template uses cannot be deleted, and its logo can still change", async ({ page }) => {
    await page.goto("/admin/clients");
    await search(page, "Search clients", inUse.name);
    await expect(page.getByText(/^1 of \d+ clients?$/)).toBeVisible();
    await row(page, inUse.name).getByRole("button", { name: `Edit ${inUse.name}` }).click();
    const edit = panel(page, "Edit Client");
    await expect(edit.getByText("Used by 1 template, so it cannot be deleted.")).toBeVisible();
    await expect(edit.getByRole("button", { name: "Delete Client" })).toBeDisabled();
    await expect(edit.getByRole("button", { name: "Upload Logo" })).toBeEnabled();
    if (isDesktop(page)) {
      // Touch sizes are checked on iPad below; on desktop the controls are compact.
      expect((await edit.getByRole("button", { name: "Upload Logo" }).boundingBox())?.height).toBeLessThan(44);
    } else {
      for (const button of [
        edit.getByRole("button", { name: "Upload Logo" }),
        footerButton(edit, "Save Changes"),
        footerButton(edit, "Close"),
        edit.getByRole("button", { name: "Close", exact: true }).last(),
      ]) {
        expect((await button.boundingBox())?.height, String(button)).toBeGreaterThanOrEqual(44);
      }
      expect((await edit.getByLabel("Name", { exact: true }).boundingBox())?.height).toBeGreaterThanOrEqual(44);
    }
    await edit.getByRole("button", { name: "Delete Client" }).scrollIntoViewIfNeeded();
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
      expect(html).not.toContain("Add Brand");
      expect(html).not.toContain("Add Client");
      await expect(page.getByRole("heading", { name: /Manufacturers|Clients/ })).toHaveCount(0);
      await shot(page, `inspector${path.replaceAll("/", "-")}`);
    });
  }
});
