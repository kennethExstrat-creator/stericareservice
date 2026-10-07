// The 44 px touch hit areas of the small controls (docs/DESIGN.md, Density),
// worked out from the classes each one renders, the way the browser lays them
// out: the ::after that widens the target is placed from the padding box,
// inside the 1 px border, so the border counts against it (the final audit
// measured 42 px when it did not). e2e/design/touch-targets.spec.ts measures
// the same controls in a browser.
import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Checkbox } from "./checkbox";
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from "./input-group";
import { RadioGroup, RadioGroupItem } from "./radio-group";
import { Switch } from "./switch";

const TARGET_PX = 44;

/** Variants that hold for a default-size control on a touchscreen; classes under any other are left out. */
const ON_TOUCH = new Set(["touch", "after", "data-[size=default]"]);

type Token = { variants: string[]; utility: string };
type Level = "touch" | "plain";

/** A class split at its colons into the variants and the utility after them, brackets kept whole. */
function parse(token: string): Token {
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
  return { variants: parts, utility: current };
}

/** A Tailwind length: a spacing step (0.25rem, 4 px) or an arbitrary [Npx]. */
function px(value: string): number {
  const arbitrary = /^\[(\d+(?:\.\d+)?)px\]$/.exec(value);
  if (arbitrary) return Number(arbitrary[1]);
  const steps = Number(value);
  if (!Number.isFinite(steps)) throw new Error(`not a length: ${value}`);
  return steps * 4;
}

/** The classes of the element with this data-slot, as rendered. */
function classesOf(element: ReactElement, slot: string): Token[] {
  const html = renderToStaticMarkup(element);
  const tag = new RegExp(`<[a-z]+[^>]*data-slot="${slot}"[^>]*>`).exec(html)?.[0];
  const classes = tag ? /class="([^"]*)"/.exec(tag)?.[1] : undefined;
  if (!classes) throw new Error(`no data-slot="${slot}" with classes in ${html}`);
  return classes.split(/\s+/).map(parse);
}

/** Whether a class applies on a touchscreen, to the element itself or to its ::after. */
function applies({ variants }: Token, pseudo: boolean, level?: Level): boolean {
  if (!variants.every((variant) => ON_TOUCH.has(variant)) || variants.includes("after") !== pseudo) return false;
  return level === undefined || variants.includes("touch") === (level === "touch");
}

/**
 * A length on a touchscreen. A touch: class wins over a plain one (it comes
 * later in the stylesheet); at one level the first pattern that matches wins,
 * so give the more specific first. Two different lengths at one level would be
 * left to stylesheet order, so they fail the test.
 */
function touchLength(tokens: Token[], pseudo: boolean, ...patterns: RegExp[]): number | undefined {
  for (const level of ["touch", "plain"] as const) {
    for (const pattern of patterns) {
      const lengths = tokens.flatMap((token) => {
        const match = applies(token, pseudo, level) ? pattern.exec(token.utility) : null;
        return match ? [px(match[1])] : [];
      });
      if (new Set(lengths).size > 1) throw new Error(`${pattern} is set twice: ${lengths.join(", ")}`);
      if (lengths.length > 0) return lengths[0];
    }
  }
  return undefined;
}

/** The control's box and its hit area on a touchscreen, in px. */
function touchTarget(tokens: Token[]) {
  const has = (utility: string, pseudo: boolean) => tokens.some((token) => token.utility === utility && applies(token, pseudo));
  const box = {
    width: touchLength(tokens, false, /^w-(.+)$/, /^size-(.+)$/),
    height: touchLength(tokens, false, /^h-(.+)$/, /^size-(.+)$/),
  };
  const allSides = /^-inset-(\d[\d.]*|\[[^\]]+\])$/;
  const reach = {
    x: touchLength(tokens, true, /^-inset-x-(.+)$/, allSides) ?? 0,
    y: touchLength(tokens, true, /^-inset-y-(.+)$/, allSides) ?? 0,
  };
  const border = has("border", false) ? 1 : 0;
  const hit = (side: number | undefined, out: number) => (side === undefined ? undefined : side - 2 * border + 2 * out);
  return {
    // The ::after is placed from the control's padding box only when the control is positioned.
    placed: has("relative", false) && has("absolute", true),
    box,
    hit: { width: hit(box.width, reach.x), height: hit(box.height, reach.y) },
  };
}

describe("touch hit areas", () => {
  it.each([
    ["checkbox", <Checkbox key="checkbox" aria-label="Lot verified" />, "checkbox", { width: 24, height: 24 }],
    [
      "radio",
      <RadioGroup key="radio" aria-label="Conclusion">
        <RadioGroupItem value="pass" aria-label="PASSED" />
      </RadioGroup>,
      "radio-group-item",
      { width: 24, height: 24 },
    ],
    ["switch", <Switch key="switch" aria-label="Include" />, "switch", { width: 48, height: 28 }],
    [
      "a field's icon button",
      <InputGroup key="field">
        <InputGroupInput aria-label="Password" />
        <InputGroupAddon align="inline-end">
          <InputGroupButton size="icon-xs" aria-label="Show password">
            eye
          </InputGroupButton>
        </InputGroupAddon>
      </InputGroup>,
      "button",
      { width: 36, height: 36 },
    ],
  ] as const)("%s: drawn smaller, with a hit area of at least 44 × 44", (_, element, slot, box) => {
    const target = touchTarget(classesOf(element, slot));
    expect(target.placed, "a positioned ::after on a positioned control").toBe(true);
    expect(target.box).toEqual(box);
    expect(target.hit.width).toBeGreaterThanOrEqual(TARGET_PX);
    expect(target.hit.height).toBeGreaterThanOrEqual(TARGET_PX);
  });

  it.each(["xs", "sm"] as const)("a field's %s text button: 36 px tall, with a 44 px tall hit area", (size) => {
    const target = touchTarget(
      classesOf(
        <InputGroup>
          <InputGroupInput aria-label="Search" />
          <InputGroupAddon align="inline-end">
            <InputGroupButton size={size}>Clear</InputGroupButton>
          </InputGroupAddon>
        </InputGroup>,
        "button",
      ),
    );
    expect(target.placed).toBe(true);
    expect(target.box.height).toBe(36);
    expect(target.hit.height).toBeGreaterThanOrEqual(TARGET_PX);
  });
});
