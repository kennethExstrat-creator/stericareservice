// Colour tokens as hex, mirroring app/globals.css one for one.
// lib/design/contrast.test.ts proves the contrast claims below and that the
// CSS still matches this file, so change both together.

export type Hex = `#${string}`;
export type Step = 50 | 100 | 200 | 300 | 400 | 500 | 600 | 700 | 800 | 900 | 950;
export type Scale = Readonly<Record<Step, Hex>>;

export const STEPS: readonly Step[] = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

export const white: Hex = "#ffffff";

/** Logo blue, copied from the website. 600 is the exact logo blue. */
export const brand: Scale = {
  50: "#f4f7fb",
  100: "#e5eef8",
  200: "#c9ddf4",
  300: "#9bc5f6",
  400: "#3b9aff",
  500: "#0074d6",
  600: "#0157a2",
  700: "#084884",
  800: "#0a3867",
  900: "#08294c",
  950: "#051930",
};

/** Logo teal, copied from the website. Not a status colour. */
export const accent: Scale = {
  50: "#edfbf9",
  100: "#d0f9f1",
  200: "#7ff7e4",
  300: "#52e5d2",
  400: "#00beac",
  500: "#00a292",
  600: "#008779",
  700: "#007368",
  800: "#0c5d53",
  900: "#0e4740",
  950: "#092d28",
};

/** The page ground, copied from the website. */
export const mist: Hex = "#f5f9fc";

/** Tailwind 4's slate in sRGB hex (globals.css pins the same values). */
export const slate: Scale = {
  50: "#f8fafc",
  100: "#f1f5f9",
  200: "#e2e8f0",
  300: "#cad5e2",
  400: "#90a1b9",
  500: "#62748e",
  600: "#45556c",
  700: "#314158",
  800: "#1d293d",
  900: "#0f172b",
  950: "#020618",
};

/** Result states. Module results use all but hold; the final result uses pass, fail and hold. */
export const STATUSES = ["pass", "fail", "warn", "hold", "info", "not_done"] as const;
export type Status = (typeof STATUSES)[number];

export type StatusTokens = Readonly<{
  /** Text and icon colour on the tint, on white and on mist. */
  text: Hex;
  tint: Hex;
  border: Hex;
  solid: Hex;
  solidForeground: Hex;
}>;

export const status: Readonly<Record<Status, StatusTokens>> = {
  pass: {
    text: "#166534",
    tint: "#f0fdf4",
    border: "#86efac",
    solid: "#15803d",
    solidForeground: white,
  },
  fail: {
    text: "#b91c1c",
    tint: "#fef2f2",
    border: "#fca5a5",
    solid: "#b91c1c",
    solidForeground: white,
  },
  warn: {
    text: "#92400e",
    tint: "#fffbeb",
    border: "#fcd34d",
    solid: "#fbbf24",
    solidForeground: "#451a03",
  },
  hold: {
    text: "#78350f",
    tint: "#fef3c7",
    border: "#f59e0b",
    solid: "#f59e0b",
    solidForeground: "#451a03",
  },
  info: {
    text: slate[700],
    tint: slate[100],
    border: slate[300],
    solid: slate[600],
    solidForeground: white,
  },
  not_done: {
    text: slate[600],
    tint: slate[50],
    border: slate[400],
    solid: slate[500],
    solidForeground: white,
  },
};

/** shadcn/ui variables (`--background` etc.) and the tokens they resolve to. */
export const semantic = {
  background: mist,
  foreground: slate[900],
  card: white,
  "card-foreground": slate[900],
  popover: white,
  "popover-foreground": slate[900],
  primary: brand[500],
  "primary-foreground": white,
  secondary: brand[100],
  "secondary-foreground": brand[700],
  muted: slate[100],
  "muted-foreground": slate[600],
  accent: brand[50],
  "accent-foreground": brand[700],
  destructive: status.fail.text,
  border: slate[200],
  input: slate[300],
  ring: brand[500],
  "chart-1": brand[500],
  "chart-2": accent[500],
  "chart-3": brand[700],
  "chart-4": accent[700],
  "chart-5": brand[300],
  sidebar: white,
  "sidebar-foreground": slate[900],
  "sidebar-primary": brand[500],
  "sidebar-primary-foreground": white,
  "sidebar-accent": brand[50],
  "sidebar-accent-foreground": brand[700],
  "sidebar-border": slate[200],
  "sidebar-ring": brand[500],
} as const satisfies Record<string, Hex>;

export type SemanticToken = keyof typeof semantic;

/** CSS custom property name for a status token, e.g. `--color-not-done-tint`. */
export function statusVariable(key: Status, part: keyof StatusTokens): string {
  const base = `--color-${key.replace("_", "-")}`;
  switch (part) {
    case "text":
      return base;
    case "solidForeground":
      return `${base}-solid-foreground`;
    default:
      return `${base}-${part}`;
  }
}

/** Every colour custom property in globals.css with the hex it must resolve to. */
export function cssColorVariables(): Record<string, Hex> {
  const vars: Record<string, Hex> = { "--color-mist": mist };
  for (const step of STEPS) {
    vars[`--color-brand-${step}`] = brand[step];
    vars[`--color-accent-${step}`] = accent[step];
    vars[`--color-slate-${step}`] = slate[step];
  }
  for (const key of STATUSES) {
    for (const part of Object.keys(status[key]) as (keyof StatusTokens)[]) {
      vars[statusVariable(key, part)] = status[key][part];
    }
  }
  for (const [name, hex] of Object.entries(semantic)) {
    vars[`--${name}`] = hex;
  }
  return vars;
}
