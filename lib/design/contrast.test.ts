import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { AA_LARGE, AA_TEXT, composite, contrastRatio, formatRatio, hexToRgb } from "./contrast";
import { declarations, parseCustomProperties, resolveCustomProperty, utilityBody } from "./css-variables";
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
  type Hex,
} from "./tokens";

const read = (relative: string) =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");

const appCssText = read("../../app/globals.css");
const appCss = parseCustomProperties(appCssText);
// The website scopes some variables per selector (--reveal-delay); its theme tokens are unique.
const websiteCss = parseCustomProperties(read("../../docs/design-reference/globals.css"), {
  strict: false,
});

/** Every component and page source, as shipped (tests excluded). */
const sources: [file: string, text: string][] = ["components", "app"].flatMap((dir) =>
  readdirSync(fileURLToPath(new URL(`../../${dir}/`, import.meta.url)), { recursive: true, encoding: "utf8" })
    .filter((file) => /\.tsx?$/.test(file) && !/\.test\.tsx?$/.test(file))
    .map((file): [string, string] => [`${dir}/${file}`, read(`../../${dir}/${file}`)]),
);

/** Class-like tokens in a source file, split into variants and the utility (`focus-visible:ring-3` → ["focus-visible"], "ring-3"). */
function classTokens(text: string): { token: string; variants: string[]; utility: string }[] {
  return text
    .split(/[\s"'`{},()]+/)
    .filter((token) => /^[\w[\]&>*@!:=./%#-]+$/.test(token))
    .map((token) => {
      const parts: string[] = [];
      let depth = 0;
      let current = "";
      for (const char of token) {
        if (char === "[") depth += 1;
        if (char === "]") depth -= 1;
        if (char === ":" && depth === 0) {
          parts.push(current);
          current = "";
        } else {
          current += char;
        }
      }
      return { token, variants: parts, utility: current };
    });
}

/** A theme colour as hex, e.g. "muted-foreground" → slate-600; undefined for anything else. */
function themeColour(name: string): Hex | undefined {
  if (name === "white") return white;
  if (name === "black") return "#000000";
  if (!appCss.has(`--color-${name}`)) return undefined;
  const value = resolveCustomProperty(`--color-${name}`, appCss).toLowerCase();
  return /^#[0-9a-f]{6}$/.test(value) ? (value as Hex) : undefined;
}

/** Grounds that text and focus rings sit on: cards, page, table heads, quiet surfaces. */
const GROUNDS: [string, Hex][] = [
  ["white", white],
  ["mist", mist],
  ["slate-50", slate[50]],
  ["slate-100 (muted, tab list)", slate[100]],
];

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

  it("composites a translucent colour over its ground, as the browser paints it", () => {
    expect(composite("#000000", 0.5, "#ffffff")).toBe("#808080");
    expect(composite(brand[500], 1, mist)).toBe(brand[500]);
    expect(composite(brand[500], 0, mist)).toBe(mist);
    // The review's measurements (D3, D5): the old focus halo and inactive tab text.
    expect(composite(brand[500], 0.5, white)).toBe("#80baeb");
    expect(composite(slate[900], 0.6, slate[100])).toBe("#69707d");
    expect(() => composite(white, 1.5, mist)).toThrow(RangeError);
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

  it("secondary text is never lighter than slate-600", () => {
    expect(semantic["muted-foreground"]).toBe(slate[600]);
  });
});

describe("keyboard focus (WCAG 1.4.11, design review D3)", () => {
  // What ships: the outline the two utilities draw, not the bare token.
  const FOCUS_UTILITIES: [name: string, offset: string][] = [
    ["focus-ring", "2px"],
    ["focus-ring-inset", "-2px"],
  ];

  it.each(FOCUS_UTILITIES)("%s draws an opaque 2 px ring-colour outline on :focus-visible", (name, offset) => {
    const body = utilityBody(appCssText, name);
    expect(body, `@utility ${name} in app/globals.css`).toBeDefined();
    expect(body).toMatch(/&:focus-visible\s*\{/);
    const rules = declarations(body ?? "");
    // A bare var() of an opaque hex: no alpha, color-mix or /50 to composite.
    expect(rules.get("outline")).toBe("2px solid var(--color-ring)");
    expect(rules.get("outline-offset")).toBe(offset);
  });

  it("the ring colour is an opaque brand-500", () => {
    expect(themeColour("ring")).toBe(brand[500]);
    expect(semantic.ring).toBe(brand[500]);
  });

  it.each([
    ...GROUNDS,
    ["brand-50 (accent: hover, active rows and chips)", brand[50]],
    ["brand-100 (secondary: the stepper's plus)", brand[100]],
    ["fail tint (the grid's error list)", status.fail.tint],
  ] as [string, Hex][])("the ring holds 3:1 against %s", (_, ground) => {
    expect(contrastRatio(semantic.ring, ground)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("a translucent halo would not: brand-500 at 50% is about 2:1", () => {
    for (const [, ground] of GROUNDS) {
      expect(contrastRatio(composite(semantic.ring, 0.5, ground), ground)).toBeLessThan(AA_LARGE);
    }
  });

  it("the base outline colour is opaque", () => {
    expect(appCssText).toMatch(/@apply border-border outline-ring;/);
  });

  it("no component draws focus with a box-shadow ring or a translucent colour", () => {
    const offenders = sources.flatMap(([file, text]) =>
      classTokens(text)
        .filter(({ token, variants, utility }) => {
          const onFocus = variants.some((variant) => variant.includes("focus"));
          const ringShadow = /^ring-(?!0$)/.test(utility) || /^ring-\[/.test(utility);
          const translucent = /^(ring|outline)-[a-z][\w-]*\/\d+$/.test(utility);
          return (onFocus && (ringShadow || translucent)) || /(^|:)outline-ring\//.test(token);
        })
        .map(({ token }) => `${file}: ${token}`),
    );
    expect(offenders, "use focus-ring or focus-ring-inset (app/globals.css)").toEqual([]);
  });
});

describe("checkbox, radio and switch edges (WCAG 1.4.11, design review D4)", () => {
  it.each(GROUNDS)("--control holds 3:1 on %s", (_, ground) => {
    expect(contrastRatio(semantic.control, ground)).toBeGreaterThanOrEqual(AA_LARGE);
  });

  it("text fields keep the website's light edge, which a toggle cannot use", () => {
    expect(semantic.input).toBe(slate[300]);
    expect(contrastRatio(semantic.input, white)).toBeLessThan(AA_LARGE);
  });

  it.each<[string, string, string[]]>([
    ["checkbox", "components/ui/checkbox.tsx", ["border-control"]],
    ["radio", "components/ui/radio-group.tsx", ["border-control"]],
    ["switch", "components/ui/switch.tsx", ["data-unchecked:border-control", "data-unchecked:bg-control"]],
  ])("the unchecked %s is drawn with --control", (_, file, required) => {
    const text = sources.find(([name]) => name === file)?.[1] ?? "";
    const utilities = classTokens(text).map(({ token }) => token);
    for (const name of required) expect(utilities, `${file} uses ${name}`).toContain(name);
    expect(utilities.filter((token) => /(^|:)(border|bg)-input$/.test(token)), file).toEqual([]);
  });
});

describe("translucent text, measured as it renders (design review D5)", () => {
  const FONT_SIZES = new Set(["xs", "sm", "base", "lg", "xl", ...Array.from({ length: 8 }, (_, i) => `${i + 2}xl`)]);
  const translucentText = sources.flatMap(([file, text]) =>
    classTokens(text).flatMap(({ token, utility }) => {
      const match = /^text-([a-z][\w-]*)\/(\d+)$/.exec(utility);
      return match && !FONT_SIZES.has(match[1]) ? [{ file, token, colour: match[1], alpha: Number(match[2]) / 100 }] : [];
    }),
  );

  it("can measure every translucent text colour in the source", () => {
    const unknown = translucentText.filter(({ colour }) => themeColour(colour) === undefined);
    expect(unknown.map(({ file, token }) => `${file}: ${token}`)).toEqual([]);
  });

  it("holds 4.5:1 on every ground, and neutral text stays at least as dark as slate-600", () => {
    const neutrals = new Set<string>(Object.values(slate));
    const failures: string[] = [];
    for (const { file, token, colour, alpha } of translucentText) {
      const base = themeColour(colour);
      if (!base) continue;
      for (const [groundName, ground] of GROUNDS) {
        const ratio = contrastRatio(composite(base, alpha, ground), ground);
        const floor = neutrals.has(base) ? Math.max(AA_TEXT, contrastRatio(slate[600], ground)) : AA_TEXT;
        if (ratio < floor) failures.push(`${file}: ${token} on ${groundName} is ${formatRatio(ratio)}`);
      }
    }
    expect(failures).toEqual([]);
  });

  it("would have caught the inactive tab label", () => {
    const ratio = contrastRatio(composite(slate[900], 0.6, slate[100]), slate[100]);
    expect(ratio).toBeGreaterThanOrEqual(AA_TEXT);
    expect(ratio).toBeLessThan(contrastRatio(slate[600], slate[100]));
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
