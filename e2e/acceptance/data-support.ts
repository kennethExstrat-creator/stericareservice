import { devices, expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import type { Session } from "./data-fixtures";

/**
 * Helpers for the data-integrity acceptance audit (data-integrity.spec.ts): devices, screenshots,
 * the capture screen's save pill, the device's local copy in IndexedDB, and
 * Server Actions called the way a crafted request would (to check that the
 * server, not only the screen, refuses).
 */

export const SHOTS = "screenshots/acceptance-data";

/** Kenneth's 13 inch iPad (1366 x 1024, touch: the iPad layout) as Chromium emulates it. */
export const IPAD_PRO_13 = {
  userAgent: devices["iPad Pro 11"].userAgent,
  viewport: { width: 1366, height: 1024 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
} as const;

export const DESKTOP = { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } as const;

export type Device = { context: BrowserContext; page: Page; touch: boolean; name: string };

/** A separate browser context, as a separate device, signed in with `session` (no new sign-in). */
export async function device(
  browser: Browser,
  baseURL: string,
  session: Session,
  kind: "ipad" | "desktop",
  name: string,
): Promise<Device> {
  const context = await browser.newContext({ ...(kind === "ipad" ? IPAD_PRO_13 : DESKTOP), baseURL });
  await context.addCookies(session.cookies.map((cookie) => ({ ...cookie, url: baseURL })));
  const page = await context.newPage();
  return { context, page, touch: kind === "ipad", name };
}

/** A tap on touch devices, a click elsewhere. */
export async function press(target: Locator, touch: boolean): Promise<void> {
  if (touch) await target.tap();
  else await target.click();
}

export async function shot(page: Page, name: string): Promise<string> {
  const path = `${SHOTS}/${name}.png`;
  await page.waitForTimeout(250);
  await page.screenshot({ path, animations: "disabled", caret: "initial" });
  return path;
}

/** The save pill on screen (the bar below 1280 px or on touch, the sidebar on a desktop). */
export function savePill(page: Page): Locator {
  return page.locator('[data-slot="save-status"]:visible');
}

/** Opens the capture screen on a section and waits until it is hydrated and its autosave runs. */
export async function openCapture(page: Page, inspectionId: string, module: string, { editable = true } = {}): Promise<void> {
  await page.goto(`/inspections/${inspectionId}?module=${module}`);
  await expect(page.locator('[data-slot="capture-screen"]')).toBeVisible();
  await page.waitForFunction(() => {
    const screen = document.querySelector('[data-slot="capture-screen"]');
    return screen !== null && Object.keys(screen).some((key) => key.startsWith("__reactFiber"));
  });
  await expect(page.locator('[data-slot="section-frame"]').getByText("Loading the form…")).toHaveCount(0);
  if (editable) {
    await expect(savePill(page)).toHaveAttribute("data-state", "saved", { timeout: 20_000 });
    await expect(page.locator('[data-slot="section-frame"] :is(input, textarea):visible').first()).toBeEditable();
  }
}

/** Types a value into a text field and leaves it, the way an inspector finishes a field. */
export async function typeInto(field: Locator, value: string): Promise<void> {
  await field.fill(value);
  await field.press("Tab");
}

/**
 * This device's local copy of an inspection (docs/OFFLINE.md, "The local
 * database"), or null when there is none. Never creates the database: only
 * reads it once the app has opened it.
 */
export async function localCopy(
  page: Page,
  userId: string,
  inspectionId: string,
): Promise<{ revision: number; syncedRevision: number; data: { modules: Record<string, Record<string, unknown>> } } | null> {
  return page.evaluate(async (key) => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    if (!names.includes("stericare-offline")) return null;
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("stericare-offline");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("drafts")) return null;
      return await new Promise((resolve, reject) => {
        const request = db.transaction("drafts", "readonly").objectStore("drafts").get(key);
        request.onsuccess = () => resolve(request.result ?? null);
        request.onerror = () => reject(request.error);
      });
    } finally {
      db.close();
    }
  }, `draft:${userId}:${inspectionId}`) as never;
}

/** Every key in the drafts store that names this inspection (any user). */
export async function localCopyKeys(page: Page, inspectionId: string): Promise<string[]> {
  return page.evaluate(async (id) => {
    const names = (await indexedDB.databases()).map((db) => db.name);
    if (!names.includes("stericare-offline")) return [];
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("stericare-offline");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      if (!db.objectStoreNames.contains("drafts")) return [];
      const keys = await new Promise<IDBValidKey[]>((resolve, reject) => {
        const request = db.transaction("drafts", "readonly").objectStore("drafts").getAllKeys();
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      return keys.map(String).filter((key) => key.includes(id));
    } finally {
      db.close();
    }
  }, inspectionId);
}

/**
 * The id of a Server Action, read from the JavaScript the page loaded
 * (`createServerReference("<id>", ..., "<name>")` in the client chunks).
 */
export async function serverActionId(page: Page, name: string): Promise<string> {
  const scripts = await page.evaluate(() =>
    performance
      .getEntriesByType("resource")
      .map((entry) => entry.name)
      .filter((url) => url.includes("/_next/static/") && url.endsWith(".js")),
  );
  const pattern = new RegExp(`createServerReference\\)\\("([0-9a-f]{40,})",[^;]{0,200}?"${name}"\\)`);
  for (const url of scripts) {
    const text = await page.evaluate(async (src) => (await fetch(src)).text(), url);
    const match = pattern.exec(text);
    if (match) return match[1];
  }
  throw new Error(`Server Action ${name} not found in the page's scripts`);
}

/**
 * Calls a Server Action from inside the page (its cookies, its origin) with
 * JSON arguments, as a crafted request would, and returns the raw answer.
 */
export async function callServerAction(page: Page, actionId: string, args: unknown[]): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ id, body }) => {
      const response = await fetch(location.pathname, {
        method: "POST",
        headers: { "Next-Action": id, Accept: "text/x-component", "Content-Type": "text/plain;charset=UTF-8" },
        body,
      });
      return { status: response.status, body: await response.text() };
    },
    { id: actionId, body: JSON.stringify(args) },
  );
}

/**
 * Calls a form Server Action used with useActionState (previous state, form
 * data), encoded as React encodes the reply: field 0 holds the arguments,
 * with the form data as "$K1" and its fields prefixed "1_".
 */
export async function callFormAction(
  page: Page,
  actionId: string,
  previous: unknown,
  fields: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return page.evaluate(
    async ({ id, previousState, entries }) => {
      const form = new FormData();
      form.append("0", JSON.stringify([previousState, "$K1"]));
      for (const [key, value] of Object.entries(entries)) form.append(`1_${key}`, value);
      const response = await fetch(location.pathname, {
        method: "POST",
        headers: { "Next-Action": id, Accept: "text/x-component" },
        body: form,
      });
      return { status: response.status, body: await response.text() };
    },
    { id: actionId, previousState: previous, entries: fields },
  );
}

/** Database functions that only read (PostgREST calls every function with POST). */
const READ_ONLY_RPC = new Set(["can_edit_inspection", "can_read_inspection", "is_admin", "is_active", "is_lead", "my_profile_status", "my_team"]);

/**
 * Requests that could write, recorded while a page is open: Server Action
 * POSTs, PATCH, PUT and DELETE anywhere, inserts into Supabase tables,
 * Storage uploads, and database functions other than the read-only ones.
 */
export function recordWrites(page: Page): { writes: string[] } {
  const writes: string[] = [];
  page.on("request", (request) => {
    const method = request.method();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return;
    const url = new URL(request.url());
    const action = request.headers()["next-action"];
    const rpc = /\/rest\/v1\/rpc\/([a-z_]+)$/.exec(url.pathname)?.[1];
    if (method === "POST" && !action && rpc && READ_ONLY_RPC.has(rpc)) return;
    writes.push(`${method} ${url.pathname}${action ? ` [Server Action ${action.slice(0, 10)}]` : ""}`);
  });
  return { writes };
}

export function onlyDesktopProject(): void {
  test.skip(
    test.info().project.name !== "desktop",
    "Creates rows and signs in: runs once, in the desktop project, with an iPad context inside where it matters.",
  );
}
