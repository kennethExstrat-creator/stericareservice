import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AA_LARGE, AA_TEXT, contrastRatio, formatRatio, hexToRgb } from "./contrast";
import { parseCustomProperties, resolveCustomProperty } from "./css-variables";
import {
  STATUSES,
  STEPS,
  accent,
  brand,
  cssColorVariables,
  mist,
  semantic,
  slate,
  status,
  white,
} from "./tokens";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const appCss = parseCustomProperties(read("../../app/globals.css"));
// The website scopes some variables per selector (--reveal-delay); its theme tokens are unique.
const websiteCss = parseCustomProperties(read("../../docs/design-reference/globals.css"), {
  strict: false,
});

describe("contrast maths", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBe(1);
    // The website's own notes: brand-500 holds white text at 4.7:1, accent-600 at 4.43:1.
    expect(contrastRatio(white, brand[500])).toBeCloseTo(4.7, 1);
    expect(contrastRatio(white, accent[600])).toBeCloseTo(4.43, 2);
  });

  it("parses short and long hex and rejects anything else", () => {
    expect(hexToRgb("#fff")).toEqual([255, 255, 255]);
    expect(hexToRgb("#0157A2")).toEqual([1, 87, 162]);
    expect(() => hexToRgb("rgb(0 0 0)")).toThrow();
  });

  it("rounds printed ratios down", () => {
    expect(formatRatio(4.4999)).toBe("4.49:1");
  });
});

describe("status colours", () => {
  it.each(STATUSES)("%s text holds 4.5:1 on its tint, on white and on mist", (key) => {
    const { text, tint } = status[key];
    expect(contrastRatio(text, tint)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(text, white)).toBeGreaterThanOrEqual(AA_TEXT);
    expect(contrastRatio(text, mist)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(STATUSES)("%s solid fill holds 4.5:1 with its foreground", (key) => {
    const { solid, solidForeground } = status[key];
    expect(contrastRatio(solidForeground, solid)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("never reuses the brand or accent scales", () => {
    const brandColours = new Set<string>([...Object.values(brand), ...Object.values(accent)]);
    for (const key of STATUSES) {
      for (const hex of Object.values(status[key])) {
        if (hex === white) continue;
        expect(brandColours.has(hex), `${key} uses ${hex}`).toBe(false);
      }
    }
  });

  it("keeps warn and hold distinct", () => {
    expect(status.hold.tint).not.toBe(status.warn.tint);
    expect(status.hold.border).not.toBe(status.warn.border);
    expect(status.hold.solid).not.toBe(status.warn.solid);
  });
});

describe("shadcn semantic pairs", () => {
  const textPairs: [keyof typeof semantic, keyof typeof semantic][] = [
    ["foreground", "background"],
    ["card-foreground", "card"],
    ["popover-foreground", "popover"],
    ["primary-foreground", "primary"],
    ["secondary-foreground", "secondary"],
    ["muted-foreground", "muted"],
    ["muted-foreground", "card"],
    ["muted-foreground", "background"],
    ["accent-foreground", "accent"],
    ["destructive", "card"],
    ["destructive", "background"],
    ["sidebar-foreground", "sidebar"],
    ["sidebar-primary-foreground", "sidebar-primary"],
    ["sidebar-accent-foreground", "sidebar-accent"],
  ];

  it.each(textPairs)("%s on %s holds 4.5:1", (fg, bg) => {
    expect(contrastRatio(semantic[fg], semantic[bg])).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("white text on the destructive fill holds 4.5:1", () => {
    expect(contrastRatio(white, semantic.destructive)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it("focus ring shows against white and mist (3:1)", () => {
    expect(contrastRatio(semantic.ring, white)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(semantic.ring, mist)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("secondary text is never lighter than slate-600", () => {
    expect(semantic["muted-foreground"]).toBe(slate[600]);
  });
});

describe("brand text rules (docs/DESIGN.md)", () => {
  it("brand-600 links hold 4.5:1 on white, mist and the brand-50 hover surface", () => {
    for (const ground of [white, mist, brand[50]]) {
      expect(contrastRatio(brand[600], ground)).toBeGreaterThanOrEqual(AA_TEXT);
    }
  });

  it("brand-500 text is for white surfaces only", () => {
    expect(contrastRatio(brand[500], white)).toBeGreaterThanOrEqual(AA_TEXT);
    // Why links and labels on mist use brand-600 instead.
    expect(contrastRatio(brand[500], mist)).toBeLessThan(AA_TEXT);
  });

  it("the signature gradient keeps large text above 3:1 at both stops", () => {
    expect(contrastRatio(brand[500], white)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(accent[600], white)).toBeGreaterThanOrEqual(AA_LARGE);
    expect(contrastRatio(accent[600], mist)).toBeGreaterThanOrEqual(AA_LARGE);
  });
});

describe("app/globals.css", () => {
  it.each(Object.entries(cssColorVariables()))("%s resolves to %s", (name, hex) => {
    expect(resolveCustomProperty(name, appCss).toLowerCase()).toBe(hex);
  });

  it("copies brand, accent and mist exactly from the website", () => {
    const copied = ["--color-mist", ...STEPS.flatMap((s) => [`--color-brand-${s}`, `--color-accent-${s}`])];
    for (const name of copied) {
      expect(appCss.get(name), name).toBe(websiteCss.get(name));
    }
  });

  it("copies ease-out-expo from the website and uses it for every default transition", () => {
    expect(appCss.get("--ease-out-expo")).toBe(websiteCss.get("--ease-out-expo"));
    expect(resolveCustomProperty("--default-transition-timing-function", appCss)).toBe(
      websiteCss.get("--ease-out-expo"),
    );
    expect(appCss.get("--default-transition-duration")).toBe("150ms");
  });
});
