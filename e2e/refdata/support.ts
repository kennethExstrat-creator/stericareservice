import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { createTestAdminClient } from "../support/admin";
import { sessionCookies } from "../support/session";

/**
 * Test data for the /admin/manufacturers and /admin/clients specs. Every row
 * they make is named with PREFIX, and every template code starts with
 * TEMPLATE_PREFIX, so cleanUp() finds leftovers of a failed run too.
 */
export const PREFIX = "E2E_REFDATA";
export const TEMPLATE_PREFIX = "E2E_REFDATA_";

export type AdminClient = ReturnType<typeof createTestAdminClient>;

/** A tag unique to this run and size, e.g. "IPAD-PORTRAIT K3F9Q". */
export function runTag(): string {
  const project = test.info().project.name.toUpperCase();
  return `${project} ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
}

/** The desktop layout: 1280 px and wider with a mouse or trackpad; every touch size is the iPad layout (app/globals.css). */
export const isDesktop = (page: Page) => (page.viewportSize()?.width ?? 0) >= 1280 && test.info().project.use.hasTouch !== true;

/** The iPad sizes: touch, so (pointer: coarse) styles apply. */
export const hasTouch = () => test.info().project.use.hasTouch === true;

export async function shot(page: Page, name: string) {
  // Hide the dev-only Next.js indicator, and let toasts and dialogs settle.
  await page.addStyleTag({ content: "nextjs-portal { display: none !important; }" });
  await page.screenshot({
    path: `screenshots/refdata/${test.info().project.name}-${name}.png`,
    // A full-page capture drops touch emulation while it resizes (e2e/README.md),
    // which would show the iPad sizes at desktop density: they take the viewport.
    fullPage: !hasTouch(),
    animations: "disabled",
  });
}

type SessionCookie = Awaited<ReturnType<typeof sessionCookies>>[number];

/**
 * One sign-in per account and size, shared by that describe's tests: the
 * shared project rate-limits sign-ins per address, and other specs run too.
 */
export function useAccount(email: string) {
  let cookies: SessionCookie[] = [];
  test.beforeAll(async () => {
    cookies = await sessionCookies(email);
  });
  test.beforeEach(async ({ context, baseURL }) => {
    await addSession(context, baseURL!, cookies);
  });
}

function addSession(context: BrowserContext, baseURL: string, cookies: SessionCookie[]) {
  return context.addCookies(cookies.map((cookie) => ({ ...cookie, url: baseURL })));
}

/** React reports hydration mismatches as console errors; none are allowed. */
export function failOnHydrationErrors() {
  let errors: string[] = [];
  test.beforeEach(({ page }) => {
    errors = [];
    page.on("console", (message) => {
      if (message.type() === "error" && /hydrat/i.test(message.text())) errors.push(message.text());
    });
  });
  test.afterEach(() => {
    expect(errors).toEqual([]);
  });
}

/** A manufacturer and a client that a draft template uses, so neither can be deleted. */
export async function createInUseFixtures(admin: AdminClient, tag: string) {
  const name = `${PREFIX} in use ${tag}`;
  const { data: manufacturer, error: manufacturerError } = await admin
    .from("manufacturers")
    .insert({ name, factory_name: "Plant 1", country: "Malaysia" })
    .select("id, name")
    .single();
  if (manufacturerError) throw new Error(`Could not create the test manufacturer: ${manufacturerError.message}`);

  const { data: client, error: clientError } = await admin.from("clients").insert({ name }).select("id, name").single();
  if (clientError) throw new Error(`Could not create the test client: ${clientError.message}`);

  const code = `${TEMPLATE_PREFIX}${tag.replace(/[^A-Z0-9]+/g, "_")}`;
  const { error: templateError } = await admin.from("templates").insert({
    code,
    version: 1,
    product_type: "examination",
    standard: "EN455",
    status: "draft",
    client_id: client.id,
    manufacturer_id: manufacturer.id,
    definition: {
      code,
      name: "E2E reference data check",
      scope: { productType: "examination", standard: "EN455", clientId: client.id, manufacturerId: manufacturer.id },
      unit: "pcs",
      sizes: [{ value: "M" }],
      modules: [],
    },
  });
  if (templateError) throw new Error(`Could not create the test template: ${templateError.message}`);

  return { name, manufacturerId: manufacturer.id, clientId: client.id, templateCode: code };
}

/** The logo files in a client's folder. */
export async function logoFiles(admin: AdminClient, clientId: string): Promise<string[]> {
  const { data, error } = await admin.storage.from("client-logos").list(clientId, { limit: 100 });
  if (error) throw new Error(`Could not list the logo files of ${clientId}: ${error.message}`);
  return data.filter((item) => item.id !== null).map((item) => `${clientId}/${item.name}`);
}

/**
 * Deletes everything the specs made, leftovers of earlier runs included:
 * templates first (they restrict the rows), then logo files, then the rows.
 */
export async function cleanUp(admin: AdminClient) {
  const problems: string[] = [];

  const templates = await admin.from("templates").delete().like("code", `${TEMPLATE_PREFIX}%`);
  if (templates.error) problems.push(`templates: ${templates.error.message}`);

  const { data: clients, error: clientsError } = await admin
    .from("clients")
    .select("id, logo_path")
    .like("name", `${PREFIX}%`);
  if (clientsError) problems.push(`clients: ${clientsError.message}`);
  for (const client of clients ?? []) {
    const files = await logoFiles(admin, client.id);
    if (client.logo_path && !files.includes(client.logo_path)) files.push(client.logo_path);
    if (files.length > 0) {
      const { error } = await admin.storage.from("client-logos").remove(files);
      if (error) problems.push(`logo files of ${client.id}: ${error.message}`);
    }
  }
  const deletedClients = await admin.from("clients").delete().like("name", `${PREFIX}%`);
  if (deletedClients.error) problems.push(`clients: ${deletedClients.error.message}`);

  const deletedManufacturers = await admin.from("manufacturers").delete().like("name", `${PREFIX}%`);
  if (deletedManufacturers.error) problems.push(`manufacturers: ${deletedManufacturers.error.message}`);

  // Check, rather than trust, that nothing is left.
  for (const [table, column, pattern] of [
    ["templates", "code", `${TEMPLATE_PREFIX}%`],
    ["clients", "name", `${PREFIX}%`],
    ["manufacturers", "name", `${PREFIX}%`],
  ] as const) {
    const { count, error } = await admin.from(table).select("*", { count: "exact", head: true }).like(column, pattern);
    if (error || count) problems.push(`${table}: ${error?.message ?? `${count} left`}`);
  }
  for (const client of clients ?? []) {
    const files = await logoFiles(admin, client.id);
    if (files.length > 0) problems.push(`logo files left: ${files.join(", ")}`);
  }

  if (problems.length > 0) throw new Error(`Clean-up left test data behind: ${problems.join("; ")}`);
}

/** A small logo drawn in the browser, as PNG or JPEG bytes. */
export async function drawLogo(page: Page, type: "image/png" | "image/jpeg", label: string): Promise<Buffer> {
  const dataUrl = await page.evaluate(
    ({ type, label }) => {
      const canvas = document.createElement("canvas");
      canvas.width = 480;
      canvas.height = 160;
      const context = canvas.getContext("2d")!;
      context.fillStyle = "#ffffff";
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.fillStyle = type === "image/png" ? "#0157a2" : "#007368";
      context.beginPath();
      context.arc(80, 80, 56, 0, Math.PI * 2);
      context.fill();
      context.font = "bold 52px sans-serif";
      context.fillText(label, 160, 98);
      return canvas.toDataURL(type, 0.9);
    },
    { type, label },
  );
  return Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
}
