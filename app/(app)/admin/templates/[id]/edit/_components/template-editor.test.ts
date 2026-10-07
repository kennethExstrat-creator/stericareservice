// The template editor's bar height, kept on <html> while the editor is open:
// the page's scroll padding (app/globals.css) counts it, so a focused field
// clears the bar on two rows too, in WebKit, which goes by that padding alone.
// <html> stays for the next page, so the height goes when the editor closes.
// e2e/design/focus-clearance.spec.ts checks the padding in a browser.
import { afterEach, describe, expect, it, vi } from "vitest";
import { trackEditorBarHeight } from "./template-editor";

/** What the bar's height touches on an element: its height, and its inline custom properties. */
function fakeElement(offsetHeight = 0) {
  const properties = new Map<string, string>();
  const style = {
    setProperty: (name: string, value: string) => void properties.set(name, value),
    removeProperty: (name: string) => {
      const value = properties.get(name) ?? "";
      properties.delete(name);
      return value;
    },
    getPropertyValue: (name: string) => properties.get(name) ?? "",
  };
  return { offsetHeight, style };
}

type FakeElement = ReturnType<typeof fakeElement>;

const asElement = (fake: FakeElement) => fake as unknown as HTMLElement;

type Observer = { report: () => void; targets: unknown[]; connected: boolean };

/** ResizeObservers that report when the test resizes the bar. */
function watchResizes() {
  const observers: Observer[] = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      readonly #observer: Observer;
      constructor(report: () => void) {
        this.#observer = { report, targets: [], connected: true };
        observers.push(this.#observer);
      }
      observe(target: unknown) {
        this.#observer.targets.push(target);
      }
      disconnect() {
        this.#observer.connected = false;
      }
    },
  );
  return {
    observers,
    resize(bar: FakeElement, height: number) {
      bar.offsetHeight = height;
      for (const observer of observers) if (observer.connected && observer.targets.includes(bar)) observer.report();
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("trackEditorBarHeight", () => {
  it("puts the bar's height on the editor and on <html>, and follows the bar onto two rows", () => {
    const resizes = watchResizes();
    const bar = fakeElement(67);
    const root = fakeElement();
    const page = fakeElement();
    trackEditorBarHeight(asElement(bar), asElement(root), asElement(page));
    expect(root.style.getPropertyValue("--editor-bar-height")).toBe("67px");
    expect(page.style.getPropertyValue("--editor-bar-height")).toBe("67px");

    // Unsaved changes put Discard in the bar, which wraps to two rows at 820 px.
    resizes.resize(bar, 119);
    expect(root.style.getPropertyValue("--editor-bar-height")).toBe("119px");
    expect(page.style.getPropertyValue("--editor-bar-height")).toBe("119px");
  });

  it("takes the height off <html> and stops watching the bar when the editor closes", () => {
    const resizes = watchResizes();
    const page = fakeElement();
    const close = trackEditorBarHeight(asElement(fakeElement(67)), asElement(fakeElement()), asElement(page));
    expect(resizes.observers).toHaveLength(1);

    close();
    expect(page.style.getPropertyValue("--editor-bar-height")).toBe("");
    expect(resizes.observers[0]!.connected).toBe(false);
  });
});
