// The UX audit's recorder: for each screen and state, screenshots you look
// at, the layout measurements of ./measure.ts, an axe-core accessibility run,
// a keyboard walk (focus visible, order, nothing covering it) and the
// console. Each record is written to
// screenshots/acceptance-ux/<project>/<account>/<screen>.json beside its
// shots (git-ignored), for e2e/acceptance/ux/report.mts to gather.
//
// axe-core comes from node_modules (eslint-plugin-jsx-a11y depends on it);
// the audit injects it into the page and adds no package.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { test, type ConsoleMessage, type Page } from "@playwright/test";
import { focusSnapshot, measureLayout, rememberUnfocusedLooks, type LayoutReport } from "./measure";

export const OUT_DIR = "screenshots/acceptance-ux";

const require_ = createRequire(join(process.cwd(), "package.json"));
const AXE_PATH = (() => {
  try {
    return require_.resolve("axe-core/axe.min.js");
  } catch {
    return null;
  }
})();

export type AxeViolation = {
  id: string;
  impact: string | null;
  help: string;
  /**
   * label: the element's accessible name from aria-label or aria-labelledby, whole (axe cuts
   * it short in html). shows: the first words it shows, aria-hidden decoration (an avatar's
   * initials) passed over when it shows other text.
   */
  nodes: { target: string; html: string; summary: string; label: string | null; shows: string | null }[];
};

export type FocusRecord = {
  index: number;
  name: string;
  tag: string;
  role: string | null;
  slot: string | null;
  rect: { x: number; y: number; width: number; height: number };
  focusVisible: boolean;
  changed: string[] | null;
  outline: string;
  obscuredBy: string | null;
  offscreen: boolean;
};

export type ScreenRecord = {
  project: string;
  account: string;
  screen: string;
  url: string;
  touch: boolean;
  shots: string[];
  layout: LayoutReport;
  axe: AxeViolation[];
  axeIncomplete: { id: string; count: number }[];
  focus: FocusRecord[];
  /** The Shift+Tab walk from the end of the page (tabsBack). */
  focusBack: FocusRecord[];
  console: string[];
  notes: string[];
};

export type ScreenOptions = {
  /** Tab presses to walk (0: no walk). The walk starts from the top of the document. */
  tabs?: number;
  /** Shift+Tab presses to walk back from the end of the document: what a sticky bar covers shows going up. */
  tabsBack?: number;
  /** Run axe (default true). */
  axe?: boolean;
  /** Screenshot (default true). "viewport" takes the view as it is (a dialog, a menu). */
  shot?: boolean | "viewport";
  /** Most viewport shots for a long page on touch (default 6). */
  maxParts?: number;
  /** Limit axe to this selector (a dialog). */
  within?: string;
  notes?: string[];
};

function isTouch(): boolean {
  return Boolean(test.info().project.use.hasTouch);
}

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Console errors and warnings, page errors and failed requests, per screen. */
export class ConsoleWatch {
  private lines: string[] = [];
  constructor(page: Page) {
    page.on("console", (message: ConsoleMessage) => {
      const type = message.type();
      if (type !== "error" && type !== "warning") return;
      const text = message.text();
      // The dev-only React DevTools hint and Chrome's own preload notes are noise.
      if (/Download the React DevTools|was preloaded using link preload/.test(text)) return;
      this.lines.push(`${type}: ${text.slice(0, 600)}`);
    });
    page.on("pageerror", (error) => this.lines.push(`pageerror: ${error.message.slice(0, 600)}`));
    page.on("requestfailed", (request) => {
      const failure = request.failure()?.errorText ?? "";
      // Navigations cancelled by the next one, and prefetches, are not failures the user sees.
      if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(failure)) return;
      this.lines.push(`requestfailed: ${request.method()} ${request.url().slice(0, 160)} ${failure}`);
    });
    page.on("response", (response) => {
      if (response.status() >= 500) this.lines.push(`http ${response.status()}: ${response.url().slice(0, 160)}`);
    });
  }
  take(): string[] {
    const lines = this.lines;
    this.lines = [];
    return lines;
  }
}

/**
 * Lets menus, dialogs and sheets finish their open animation. Spinners and
 * pulses run forever, so only finite animations count, for 2 s at most.
 */
export async function settle(page: Page) {
  await page.evaluate(() =>
    Promise.race([
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => {
            const timing = animation.effect?.getComputedTiming();
            return timing !== undefined && timing.iterations !== Infinity && Number(timing.endTime) !== Infinity;
          })
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
      new Promise((resolve) => setTimeout(resolve, 2_000)),
    ]),
  );
  await page.waitForTimeout(120);
}

async function screenshots(page: Page, base: string, mode: true | "viewport", maxParts: number): Promise<string[]> {
  mkdirSync(dirname(base), { recursive: true });
  // caret "initial": hiding the caret writes a style attribute React could see as a mismatch.
  const options = { animations: "disabled", caret: "initial" } as const;
  if (mode === "viewport") {
    await page.screenshot({ ...options, path: `${base}.png` });
    return [`${base}.png`];
  }
  // Viewport shots, scrolled, at every size: a full-page capture drops touch
  // emulation while it resizes (e2e/README.md), and on the desktop it draws
  // sticky table footers where the first viewport ends, over the rows.
  const { height, viewport, start } = await page.evaluate(() => ({
    height: document.documentElement.scrollHeight,
    viewport: window.innerHeight,
    start: window.scrollY,
  }));
  const parts = Math.min(maxParts, Math.max(1, Math.ceil(height / viewport)));
  const paths: string[] = [];
  for (let part = 0; part < parts; part++) {
    await page.evaluate((top) => window.scrollTo(0, top), part * viewport);
    await page.waitForTimeout(60);
    const path = parts > 1 ? `${base}-${part + 1}.png` : `${base}.png`;
    await page.screenshot({ ...options, path });
    paths.push(path);
  }
  await page.evaluate((top) => window.scrollTo(0, top), start);
  return paths;
}

async function runAxe(page: Page, within?: string): Promise<{ violations: AxeViolation[]; incomplete: { id: string; count: number }[] }> {
  if (!AXE_PATH) return { violations: [], incomplete: [{ id: "axe-core not found", count: 0 }] };
  const loaded = await page.evaluate(() => typeof (window as unknown as { axe?: unknown }).axe !== "undefined");
  if (!loaded) await page.addScriptTag({ path: AXE_PATH });
  return page.evaluate(async (selector) => {
    const axe = (window as unknown as { axe: { run: (context: unknown, options: unknown) => Promise<{
      violations: { id: string; impact: string | null; help: string; nodes: { target: unknown[]; html: string; failureSummary?: string }[] }[];
      incomplete: { id: string; nodes: unknown[] }[];
    }> } }).axe;
    const result = await axe.run(selector ? { include: [selector] } : document, {
      runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa", "best-practice"] },
      resultTypes: ["violations", "incomplete"],
    });
    const elementOf = (target: unknown[]) => {
      try {
        return typeof target[0] === "string" ? document.querySelector(target[0]) : null;
      } catch {
        return null;
      }
    };
    const squash = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
    const labelOf = (element: Element | null) => {
      if (!element) return null;
      const label = element.getAttribute("aria-label");
      if (label) return squash(label);
      const ids = element.getAttribute("aria-labelledby");
      return ids ? squash(ids.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(" ")) || null : null;
    };
    const showsOf = (element: Element | null) => {
      if (!element) return null;
      const hidden = (node: Element) => {
        for (let at: Element | null = node; at; at = at === element ? null : at.parentElement) {
          if (at.getAttribute("aria-hidden") === "true") return true;
        }
        return false;
      };
      const first = (passHidden: boolean) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
          const parent = node.parentElement;
          const text = squash(node.textContent);
          if (!text || !parent || parent.closest(".sr-only") || (passHidden && hidden(parent))) continue;
          const style = getComputedStyle(parent);
          if (style.display !== "none" && style.visibility !== "hidden") return text;
        }
        return null;
      };
      return first(true) ?? first(false);
    };
    return {
      violations: result.violations.map((violation) => ({
        id: violation.id,
        impact: violation.impact,
        help: violation.help,
        nodes: violation.nodes.slice(0, 12).map((node) => {
          const element = elementOf(node.target);
          return {
            target: JSON.stringify(node.target),
            html: node.html.slice(0, 240),
            summary: (node.failureSummary ?? "").replace(/\s+/g, " ").slice(0, 300),
            label: labelOf(element),
            shows: showsOf(element),
          };
        }),
      })),
      incomplete: result.incomplete.map((entry) => ({ id: entry.id, count: entry.nodes.length })),
    };
  }, within ?? null);
}

/**
 * Tab from the top of the document (or Shift+Tab from its end, `backward`),
 * recording each stop. A stop that something covers (a sticky bar) or that
 * shows no focus is also shot, the first three of a screen, as
 * <base>-focus-covered-<n>.png or -focus-invisible-<n>.png. With a modal
 * dialog or sheet open, the walk starts where the dialog put the focus: its
 * focus trap is what is being walked.
 */
async function walkFocus(page: Page, tabs: number, base: string, backward = false): Promise<FocusRecord[]> {
  let coveredShots = 0;
  const modal = await page.evaluate(() =>
    [...document.querySelectorAll("[role=dialog], [role=alertdialog]")].some(
      (el) => (el as HTMLElement).offsetParent !== null || el.getBoundingClientRect().width > 0,
    ),
  );
  if (!modal) {
    // Start before the first element (after the last, backward), nothing focused, then note how everything looks unfocused.
    await page.evaluate((back) => {
      (document.activeElement as HTMLElement | null)?.blur?.();
      window.scrollTo(0, back ? document.documentElement.scrollHeight : 0);
    }, backward);
    await page.waitForTimeout(100);
  }
  await page.evaluate(rememberUnfocusedLooks);
  if (!modal) {
    // Blur leaves the browser's sequential focus starting point where focus was:
    // a marker at the top (or the end) of the body, out of the tab order, moves it.
    await page.evaluate((back) => {
      const marker = document.createElement("span");
      marker.id = "ux-walk-start";
      marker.tabIndex = -1;
      if (back) document.body.append(marker);
      else document.body.prepend(marker);
      marker.focus({ preventScroll: true });
    }, backward);
  }
  const steps: FocusRecord[] = [];
  const seen = new Map<string, number>();
  for (let index = 0; index < tabs; index++) {
    await page.keyboard.press(backward ? "Shift+Tab" : "Tab");
    // WebKit scrolls a newly focused element into view a frame later than Chromium.
    await page.waitForTimeout(test.info().project.use.browserName === "webkit" || process.env.UX_AUDIT_WEBKIT === "1" ? 120 : 0);
    const snapshot = await page.evaluate(focusSnapshot);
    if (!snapshot) continue;
    // Back where the walk started: the page's stops are done.
    const repeats = (seen.get(snapshot.key) ?? 0) + 1;
    seen.set(snapshot.key, repeats);
    if (repeats > 1) break;
    if ((snapshot.obscuredBy || !snapshot.changed) && coveredShots < 3) {
      coveredShots++;
      await page.screenshot({
        path: `${base}-focus${backward ? "-back" : ""}-${snapshot.obscuredBy ? "covered" : "invisible"}-${coveredShots}.png`,
        caret: "initial",
      });
    }
    steps.push({
      index,
      name: snapshot.info.name,
      tag: snapshot.info.tag,
      role: snapshot.info.role,
      slot: snapshot.info.slot,
      rect: snapshot.info.rect,
      focusVisible: snapshot.focusVisible,
      changed: snapshot.changed,
      outline: snapshot.outline,
      obscuredBy: snapshot.obscuredBy,
      offscreen: snapshot.offscreen,
    });
  }
  await page.evaluate(() => {
    (document.activeElement as HTMLElement | null)?.blur?.();
    document.getElementById("ux-walk-start")?.remove();
    window.scrollTo(0, 0);
  });
  return steps;
}

/** Records screens for one account in one project. */
export class Auditor {
  readonly watch: ConsoleWatch;
  constructor(
    readonly page: Page,
    readonly account: string,
  ) {
    this.watch = new ConsoleWatch(page);
    // A control that never shows fails its step in 30 s, not at the test's timeout.
    page.setDefaultTimeout(30_000);
  }

  /** Forget what the console said so far (a sign-in, a set-up step). */
  reset() {
    this.watch.take();
  }

  async screen(name: string, options: ScreenOptions = {}): Promise<ScreenRecord> {
    const { page } = this;
    const project =
      test.info().project.name +
      (process.env.UX_AUDIT_WEBKIT === "1" ? "-webkit" : "") +
      (process.env.UX_AUDIT_VIEWPORT ? `-${process.env.UX_AUDIT_VIEWPORT}` : "");
    const touch = isTouch();
    const base = join(OUT_DIR, project, this.account, slug(name));
    await settle(page);
    const layout = await page.evaluate(measureLayout, { touch });
    const shotMode = options.shot ?? true;
    const shots = shotMode ? await screenshots(page, base, shotMode, options.maxParts ?? 6) : [];
    const axe = options.axe === false ? { violations: [], incomplete: [] } : await runAxe(page, options.within);
    const focus = options.tabs ? await walkFocus(page, options.tabs, base) : [];
    const focusBack = options.tabsBack ? await walkFocus(page, options.tabsBack, base, true) : [];
    const record: ScreenRecord = {
      project,
      account: this.account,
      screen: name,
      url: page.url().replace(/^https?:\/\/[^/]+/, ""),
      touch,
      shots,
      layout,
      axe: axe.violations,
      axeIncomplete: axe.incomplete,
      focus,
      focusBack,
      console: this.watch.take(),
      notes: options.notes ?? [],
    };
    mkdirSync(dirname(base), { recursive: true });
    writeFileSync(`${base}.json`, JSON.stringify(record, null, 2));
    return record;
  }
}

/** A tap on touch projects, a click on the desktop. */
export async function press(page: Page, locator: ReturnType<Page["locator"]>) {
  if (isTouch()) await locator.tap();
  else await locator.click();
}

export { isTouch };
