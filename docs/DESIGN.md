# SteriCare QC: design rules

The light SteriCare theme for the inspection app, derived from the website snapshot in `docs/design-reference/` (BUILD_SPEC 2.1). Tokens live in `app/globals.css`; `lib/design/tokens.ts` mirrors them as hex, and `lib/design/contrast.test.ts` fails if the two drift, if the copied website tokens change, or if any status or text pair drops below 4.5:1. See every rule live at `/design` (hidden in production unless `ENABLE_DESIGN_PAGE=true`).

Source column: the website file a decision came from, or **app** (app-specific, with the reason).

## Tokens

| Token | Value | Use | Source |
|---|---|---|---|
| `brand-50…950` | `#f4f7fb` `#e5eef8` `#c9ddf4` `#9bc5f6` `#3b9aff` **`#0074d6`** `#0157a2` `#084884` `#0a3867` `#08294c` `#051930` | Logo blue; 600 is the exact logo blue. 500 is the primary (white text 4.69:1) | `globals.css`, copied exactly |
| `accent-50…950` | `#edfbf9` `#d0f9f1` `#7ff7e4` `#52e5d2` `#00beac` `#00a292` `#008779` `#007368` `#0c5d53` `#0e4740` `#092d28` | Logo teal: the brand, never a result. Teal text needs 700 (5.74:1); 600 is large text only (4.42:1) | `globals.css`, copied exactly |
| `mist` | `#f5f9fc` | Page ground | `globals.css` |
| `slate-50…950` | Tailwind 4 slate as sRGB hex (`600` `#45556c`, `900` `#0f172b`) | Text 900 (16.84:1 on mist); secondary text stops at 600 (7.16:1 on mist); 500 and lighter only for borders and icons | Tailwind, pinned as hex so the test measures what ships |
| `ease-out-expo` | `cubic-bezier(0.16, 1, 0.3, 1)` | Every transition | `globals.css` |
| Signature gradient | `brand-500 → accent-600` (`text-gradient-brand`, `bg-gradient-brand`) | Logo, login, an accent word in a large title, the active progress step. Never under body text | `globals.css` (text); fill is app |
| `::selection` | brand-500, white text | | `globals.css` |
| Radius | `--radius: 0.75rem` with shadcn's multipliers | Fields and menus md (≈10 px), tab lists lg (12 px), cards and dialogs xl (≈17 px; website cards 16 px). Buttons, chips, pills: full | `ui.tsx.txt` shapes; scale is app |
| Fonts | Outfit (`--font-sans`), Red Hat Display (`--font-display`, `--font-heading`) | Body; every h1–h6 and display text. Both have tabular figures | `layout.tsx.txt` |

**shadcn variables** (every component inherits them): `--background` mist · `--foreground` slate-900 · `--card`, `--popover` white · `--primary` brand-500 / white · `--secondary` brand-100 / brand-700 (7.89:1) · `--muted` slate-100 / slate-600 (6.92:1) · `--accent` brand-50 / brand-700 (8.60:1) · `--destructive` red-700 (6.47:1 both ways) · `--border` slate-200 · `--input` slate-300 · `--ring` brand-500 · `--chart-1…5` brand-500, accent-500, brand-700, accent-700, brand-300 · `--sidebar` white with brand-500 primary.

**The accent clash.** shadcn's `accent` is the subtle hover surface (`bg-accent`, `text-accent-foreground`, brand-50 / brand-700). The website's teal scale is `accent-50…950` (`bg-accent-500`). Both resolve and neither replaces the other: reach for `accent-<step>` when you mean teal.

## Type scale

| Style | Face, weight | Size / line | Notes | Source |
|---|---|---|---|---|
| Display | Red Hat Display 800 | 36/40, tight | Login, empty states; may carry the gradient | `ui.tsx.txt` Display, scaled down (app: a tool, not marketing) |
| H1 page title | Red Hat Display 700 | 30/36, tight | `PageHeader` | `ui.tsx.txt` |
| H2 section | Red Hat Display 700 | 24/32 | | app |
| H3 module card | Red Hat Display 700 | 18/28 | `ModuleCard` title | app |
| H4 group | Red Hat Display 600 | 16/24 | Defect class, table group | app |
| Body | Outfit 400 | 16/24, slate-900 | | `layout.tsx.txt` |
| Small / secondary | Outfit 400 | 14/20, slate-600 | Never lighter than slate-600 | BUILD_SPEC 2.1 |
| Label | Outfit 500 | 14/20 | Above the field | `contact-form.tsx` |
| Eyebrow | Outfit 700 | 12, uppercase, 0.2em, brand-600 | Gradient dash for short labels | `ui.tsx.txt` Eyebrow |
| Data | Outfit with `tabular-nums` | 14 desktop, 16 iPad | Right aligned | app |

## Status colours

Results are never colour alone: each has an icon (shape) and words. Pass is green, never the brand teal. Warn and hold share amber by design and differ in label, icon and tint. Ratios measured (rounded down):

| Status | Label · icon | Text | Tint | Border | Solid / text | Text on tint | on white | on mist | Solid |
|---|---|---|---|---|---|---|---|---|---|
| `pass` | Passed · check | `#166534` | `#f0fdf4` | `#86efac` | `#15803d` / white | 6.81 | 7.13 | 6.73 | 5.01 |
| `fail` | Failed · cross | `#b91c1c` | `#fef2f2` | `#fca5a5` | `#b91c1c` / white | 5.91 | 6.47 | 6.11 | 6.47 |
| `warn` | Warning · triangle | `#92400e` | `#fffbeb` | `#fcd34d` | `#fbbf24` / `#451a03` | 6.83 | 7.09 | 6.69 | 8.97 |
| `hold` | On hold · pause | `#78350f` | `#fef3c7` | `#f59e0b` | `#f59e0b` / `#451a03` | 8.14 | 9.07 | 8.57 | 6.97 |
| `info` | Info · i | slate-700 | slate-100 | slate-300 | slate-600 / white | 9.45 | 10.35 | 9.78 | 7.58 |
| `not_done` | Not done · dashed ring | slate-600 | slate-50 | slate-400, dashed | slate-500 / white | 7.24 | 7.58 | 7.16 | 4.76 |

Utilities: `text-pass`, `bg-pass-tint`, `border-pass-border`, `bg-pass-solid text-pass-solid-foreground` (and so on; `not-done` in class names). Toasts use the same tokens.

## Density (by pointer, not width)

- `touch:` = `(pointer: coarse)` (iPad), `fine:` = `(pointer: fine)` (mouse or trackpad). Layout switches at 1280 px (`xl`): below it a top tab bar and full-width grid; from 1280 px a left sidebar, wider grid, photos alongside. Check 820×1180, 1180×820 and 1440×900.
- iPad: every control at least 44×44 px (buttons, steppers, chips, tabs, menu items, grid rows; checkbox, radio and switch grow to 24–28 px with a 44 px hit area). Field text 16 px so iOS never zooms on focus (Input and Textarea are 14 px only under `fine:`).
- Desktop: compact controls (32–36 px) and 32–36 px table rows.
- To resize a control, override both: `h-12 touch:h-14`.

## Motion

Only state transitions: 150 ms `ease-out-expo` is the default for every `transition-*` utility. Menus and dialogs fade/zoom in 100 ms. No hover lifts, no scale on hover, no sliding gradients, no scroll reveals, no smooth scrolling. `prefers-reduced-motion` reduces all animation and transition to near zero. Data entry never waits on an animation.

## Components

| Component | Rules | Source |
|---|---|---|
| Button | Pill. Primary solid brand-500 / white, hover brand-600, a 1 px press; no lift, scale or gradient. Outline: white with slate-300 edge. Focus: brand-500 border and 3 px brand-500/50 ring. Links brand-600 (brand-500 is 4.43:1 on mist) | `ui.tsx.txt` (shape); fill app |
| Field | White, slate-300 border, label above, error text below in fail red. Read-only fields sit on slate-100: computed values, never typed (BUILD_SPEC 6.2 rule 2) | `contact-form.tsx` |
| Card / ModuleCard | White, slate-200 edge, soft shadow (`shadow-sm`), xl radius, no hover lift. ModuleCard: template-wording title, StatusPill, body, inspector comment, "Take photo" (rear camera) and "Add from library" | `ui.tsx.txt` Card |
| StatusPill, ResultChip | Icon + words; ResultChip is a 20 px disc with a glyph and a screen-reader label, for module tabs. Not done stays an empty dashed ring | app |
| SaveStatus | Saved (neutral), Saving (brand), Offline (will sync) (warn amber); pending uploads as a brand count badge | app (BUILD_SPEC 8) |
| Stepper | − value +, hold to repeat, Arrow/Page/Home/End keys, value announced; minus stays focusable but aria-disabled at 0 | app |
| DefectChip(Group) | Tap adds one, attached minus removes one, live total. Unmapped one-off labels: dashed amber edge and a flag | app |
| NumericCell, MeasurementGrid | `inputmode="decimal"`, numbers only: "2 42" is rejected, listed under the grid with a link, and stored as nothing. Enter goes down the column (then to the next column), arrows move between cells, a pasted column fills down. Footer: Median/Average (Not done until data), Spec., P/F (Not done until the column is complete; judged at the displayed precision). Sticky header and footer, visible 2 px focus ring | app (BUILD_SPEC 6.2, 8) |
| PhotoTile | Waiting / uploading with progress, uploaded, flagged (needs conversion), selected, include-in-report (admin) | app (BUILD_SPEC 8.1) |
| ProgressTracker | Progress in brand (done, in progress, not started); the module in view carries the gradient; results stay in status colours | app |
| PageHeader | Eyebrow with gradient dash, Red Hat Display title, actions | `ui.tsx.txt` Eyebrow, SectionHeading |
| Logo | Horizontal (headers, 32 px), lockup (login), mark (compact); height-driven; true colours | `logo.tsx.txt`, `brand/` |
| Icons | `app/icon.png`, `apple-icon.png` (white, 12% padding), `favicon.ico` (16–256), `public/icons/icon-192/512` and `icon-maskable-512` (shield inside the 80% safe zone) | app, from `stericare-mark.png` |

## Do / Don't

- **Do** pair every status colour with its icon and words. **Don't** use teal (or any brand colour) to mean "passed".
- **Do** use brand-600 for links and text accents on mist. **Don't** put brand-500 or accent-600 text on mist or tints.
- **Do** show computed values read-only on grey. **Don't** let a total, median or limit be typed.
- **Do** keep the gradient to the logo, login, one accent word in a large title and the active progress step. **Don't** put body text, buttons or tables on it.
- **Do** design for 44 px on iPad and 16 px field text. **Don't** shrink a touch target to fit a row.
- **Do** keep transitions at 150 ms ease-out-expo. **Don't** add hover lifts, scale, parallax or scroll animation.
- **Do** keep secondary text at slate-600 or darker. **Don't** add a dark mode (the `dark:` variant is inert on purpose).
