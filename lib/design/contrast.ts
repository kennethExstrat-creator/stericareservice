// WCAG 2.x contrast, computed from sRGB hex.

/** Minimum ratio for body text (WCAG AA 1.4.3). */
export const AA_TEXT = 4.5;
/** Minimum ratio for large text, icons and control boundaries (AA 1.4.3, 1.4.11). */
export const AA_LARGE = 3;

export function hexToRgb(hex: string): [number, number, number] {
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) throw new Error(`Not a hex colour: ${hex}`);
  const digits = match[1].length === 3 ? [...match[1]].map((d) => d + d).join("") : match[1];
  const n = Number.parseInt(digits, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/**
 * The colour a translucent foreground renders as over an opaque ground
 * (source-over in sRGB, as browsers paint), e.g. brand-500 at 50% on white.
 */
export function composite(foreground: string, alpha: number, ground: string): `#${string}` {
  if (!(alpha >= 0 && alpha <= 1)) throw new RangeError(`alpha must be from 0 to 1, got ${alpha}`);
  const top = hexToRgb(foreground);
  const bottom = hexToRgb(ground);
  const mixed = top.map((value, i) => Math.round(value * alpha + bottom[i] * (1 - alpha)));
  return `#${mixed.map((value) => value.toString(16).padStart(2, "0")).join("")}`;
}

/** Ratio rounded down to two decimals, so a printed 4.50 never hides a 4.499. */
export function formatRatio(ratio: number): string {
  return `${(Math.floor(ratio * 100) / 100).toFixed(2)}:1`;
}
