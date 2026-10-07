# SteriCare QC: design rules

The light SteriCare theme for the inspection app, derived from the website snapshot in `docs/design-reference/` (BUILD_SPEC 2.1). Tokens live in `app/globals.css`; `lib/design/tokens.ts` mirrors them as hex, and `lib/design/contrast.test.ts` fails if the two drift, if the copied website tokens change, if any status or text pair drops below 4.5:1, or if a component ships a focus ring, control edge or translucent text below its floor (it measures the colour that renders). See every rule live at `/design` (hidden in production unless `ENABLE_DESIGN_PAGE=true`).

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

**shadcn variables** (every component inherits them): `--background` mist · `--foreground` slate-900 · `--card`, `--popover` white · `--primary` brand-500 / white · `--secondary` brand-100 / brand-700 (7.89:1) · `--muted` slate-100 / slate-600 (6.92:1) · `--accent` brand-50 / brand-700 (8.60:1) · `--destructive` red-700 (6.47:1 both ways) · `--border` slate-200 · `--input` slate-300 (text-field edges) · `--control` slate-500 (checkbox, radio and switch edges, 4.76:1 on white; app) · `--ring` brand-500, always opaque · `--chart-1…5` brand-500, accent-500, brand-700, accent-700, brand-300 · `--sidebar` white with brand-500 primary.

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
| `hold` | On Hold · pause | `#78350f` | `#fef3c7` | `#f59e0b` | `#f59e0b` / `#451a03` | 8.14 | 9.07 | 8.57 | 6.97 |
| `info` | Info · i | slate-700 | slate-100 | slate-300 | slate-600 / white | 9.45 | 10.35 | 9.78 | 7.58 |
| `not_done` | Not Done · dashed ring | slate-600 | slate-50 | slate-400, dashed | slate-500 / white | 7.24 | 7.58 | 7.16 | 4.76 |

Utilities: `text-pass`, `bg-pass-tint`, `border-pass-border`, `bg-pass-solid text-pass-solid-foreground` (and so on; `not-done` in class names). Toasts use the same tokens.

Every result pill says these labels, Passed, Failed or On Hold (a module's own words for its checks aside, such as Accept and Reject on an AQL table; BUILD_SPEC 4.2 rule 3): a module's or a size's verdict, and the inspection's overall result, suggested or final, on capture (the Conclusion section's suggested result and the submit dialog included), the review, the inspections list and the AI panel. The template's conclusion words (PASSED, FAILED and HOLD unless the template words them otherwise, BUILD_SPEC 6.2 rule 11) appear only where the inspector picks the conclusion, as on the paper report: the Conclusion section's choices and that section's own text, its summary line ("Conclusion: PASSED. Suggested result: PASSED (warnings: Sampling Plan).") and its warning when the final result differs from the suggestion. Never the short forms Pass, Fail or Hold. Under a pill, say why, not the result again: "Failed: …", "Not done: …", "Warnings: …" with the sections in the template's wording, and nothing for a clean pass (`suggestionReasons` in `lib/validation/suggested-result.ts`). Those lines are sentences, so they stay in sentence case beside the Title Case pill: Not Done, then "Not done: Visual Inspection." (Capitalisation, below).

## Density (by pointer, not width)

- `touch:` = `(any-pointer: coarse)`: any touchscreen, an iPad also with a keyboard and trackpad attached. `fine:` = no touchscreen (mouse or trackpad only). Layout switches at 1280 px on devices with no touchscreen (`xl`, redefined in app/globals.css): below it, and on every touch screen whatever its width, a top tab bar and full-width grid; from 1280 px without a touchscreen a left sidebar, wider grid, photos alongside. Check 820×1180, 1180×820, 1366×1024 (touch: 12.9 and 13 inch iPads) and 1440×900.
- iPad: every control at least 44×44 px (buttons, steppers, chips, tabs, menu items, grid rows, the grid's error list; checkbox, radio and switch grow to 24–28 px with a 44 px hit area). Field text 16 px so iOS never zooms on focus (Input and Textarea are 14 px only under `fine:`).
- A hit area drawn as an invisible `::after` is placed from inside the control's border, so count the border: a 24 px checkbox with a 1 px edge needs `touch:after:-inset-[11px]` (22 + 2 × 11), not `-inset-2.5` (42 px). Checkbox and radio 24 px, switch 48 × 28 px (`-inset-y-[9px]`), a field's button 36 px (`-inset-[5px]`); `components/ui/touch-hit-areas.test.tsx` works each one out.
- Desktop: compact controls (32–36 px) and 32–36 px table rows.
- To resize a control, override both: `h-12 touch:h-14`.

## Motion

Only state transitions: 150 ms `ease-out-expo` is the default for every `transition-*` utility. Menus and dialogs fade/zoom in 100 ms. No hover lifts, no scale on hover, no sliding gradients, no scroll reveals, no smooth scrolling. `prefers-reduced-motion` reduces all animation and transition to near zero. Data entry never waits on an animation.

## Focus

Keyboard focus is an opaque 2 px brand-500 outline on `:focus-visible`, never a translucent halo: brand-500 at 50% composites to about 2:1 (WCAG 1.4.11 needs 3:1). Two utilities in `app/globals.css`, nothing else:

- `focus-ring`: 2 px clear of the control, so it is read against the ground (4.69:1 on white, 4.43:1 on mist), never against the control's own fill. Buttons, checkbox, radio, switch, the stepper's value, progress segments, tab panels.
- `focus-ring-inset`: just inside the edge, where an outer ring would be clipped by a scroller or crowd a neighbour. Fields, grid cells, tabs, stepper buttons, defect chips, list rows, the grid's error list. At least 4:1 on every fill it sits on (brand-100 is the lowest).

An outline, not a box-shadow ring, also survives forced-colours mode. A control that greys out at a limit drops its fill instead of fading, because opacity would fade the ring too. The contrast test fails on any `focus-visible:ring-*` or translucent ring in a component.

Focus is never hidden under a sticky bar (WCAG 2.4.11). The page's scroll padding (`app/globals.css`) makes room for the shell's top bar (below 1280 px and on every touchscreen) and the template editor's tab bar, plus 1rem, so Tab, Shift+Tab and in-page links bring a control into view below the bars with its ring; from 1280 px without a touchscreen the 1rem alone keeps the ring off the window's edge. (1rem, not 0.5rem: WebKit lines a focused text field up by its text, about 12 px inside its edge.) While focus is inside a bar the padding stops above that bar, so the bar's own controls never scroll the page. The capture screen measures its bars and sets the padding itself (`use-sticky-offsets.ts`).

- **Do** add a new bar that sticks over the page to those rules, or set the page's padding while it shows, as capture does. Use scroll padding on the page, not `scroll-margin` on each control: WebKit, which runs Safari and Chrome on the iPad, brings a focused text field into view by the page's padding only.
- **Don't** give an anchor target a `scroll-mt` that counts the top bar again (`scroll-mt-[calc(var(--shell-top)+1rem)]`): the padding already clears the bar and leaves the 1rem, so such a target needs no margin of its own.

## Components

| Component | Rules | Source |
|---|---|---|
| Button | Pill. Primary solid brand-500 / white, hover brand-600, a 1 px press; no lift, scale or gradient. Outline: white with slate-300 edge. Focus: `focus-ring`. Links brand-600 (brand-500 is 4.43:1 on mist) | `ui.tsx.txt` (shape); fill app |
| Field | White, slate-300 border, label above, error text below in fail red. Focus: brand-500 border under `focus-ring-inset`. Read-only fields sit on slate-100: computed values, never typed (BUILD_SPEC 6.2 rule 2) | `contact-form.tsx` |
| Checkbox, radio, switch | Edge `--control` (slate-500): nothing else marks these controls or their state, so they hold 3:1 where a text field's slate-300 edge (1.48:1) would not. Unchecked switch: white track, slate-500 edge and thumb; checked: brand-500 with a white thumb | app (WCAG 1.4.11) |
| Tabs | Inactive labels slate-600 (`muted-foreground`, 6.92:1 on the slate-100 list), never a translucent foreground; active slate-900 on white | app (BUILD_SPEC 2.1) |
| Card / ModuleCard | White, slate-200 edge, soft shadow (`shadow-sm`), xl radius, no hover lift. ModuleCard: template-wording title, StatusPill, body, inspector comment, "Take Photo" (rear camera) and "Add From Library" | `ui.tsx.txt` Card |
| StatusPill, ResultChip | Icon + words; ResultChip is a 20 px disc with a glyph and a screen-reader label, for module tabs; the disc is positioned so the label never escapes a scrolling tab bar. Not Done stays an empty dashed ring | app |
| SaveStatus | Saved (neutral), Saving (brand), Offline (Will Sync) (warn amber), Not Saved (fail red, cloud-alert icon) when saving needs the inspector: a conflict, a refused save, no copy kept on the device; the notice under the screen's header says what happened and what to do. Pending uploads as a brand count badge. Pill and badge 16 px on touch | app (BUILD_SPEC 8) |
| Stepper | − value +, hold to repeat, Arrow/Page/Home/End keys, value announced; minus stays focusable but aria-disabled at 0 (greyed, not faded); a disabled stepper (an approved inspection) leaves the tab order | app |
| DefectChip(Group) | Tap adds one, attached minus removes one, live total. Unmapped one-off labels: dashed amber edge and a flag | app |
| NumericCell, MeasurementGrid | `inputmode="decimal"`, numbers only: "2 42" is rejected and stored as nothing. The rejection is announced with the cell's name (focus has already moved on) and listed under the grid as a full-width row button back to the cell (44 px on iPad). Enter goes down the column (then to the next column), arrows move between cells, a pasted column fills down; values a paste could not place are listed under the grid (or the field, or across the foot of a field's table) in amber, as pasted, until Dismiss or the next paste. Footer: Median/Average (Not Done until data), Spec., P/F (Not Done until the column is complete; judged at the displayed precision). Sticky header and footer, visible 2 px focus ring | app (BUILD_SPEC 6.2, 8) |
| PhotoTile | Waiting / uploading with progress, uploaded, flagged (needs conversion), upload stopped (fail red, cloud-alert icon, no progress bar; the card under it says what to do), selected, include-in-report (admin). The image stays 4:3 whatever the photo's shape | app (BUILD_SPEC 8.1) |
| ProgressTracker | Progress in brand (done, in progress, not started); the module in view carries the gradient; results stay in status colours | app |
| PageHeader | Eyebrow with gradient dash, Red Hat Display title, actions | `ui.tsx.txt` Eyebrow, SectionHeading |
| Logo | Horizontal (headers, 32 px), lockup (login), mark (compact); height-driven; true colours | `logo.tsx.txt`, `brand/` |
| Icons | `app/icon.png`, `apple-icon.png` (white, 12% padding), `favicon.ico` (16–256), `public/icons/icon-192/512` and `icon-maskable-512` (shield inside the 80% safe zone) | app, from `stericare-mark.png` |

## Capitalisation

Kenneth's rule (8 October 2026): labels start every word with a capital letter. Sentences keep sentence case.

**Title Case** for the labels and short names the app writes itself:

- form field labels and legends, with their note: "Product Name (Optional)";
- table column headers;
- titles of pages (and of the browser tab), eyebrows, cards, sections, sheets and dialogs: "New Inspection", "Sign Out Now?";
- tab names, navigation and menu items: "Sign Out";
- button and link texts that name an action: "Start From Previous", "Submit for Review", "Go to Inspections";
- status pills, badges and chips: Passed, Failed, Warning, On Hold, Info, Not Done.

Every word starts with a capital letter, except these small words when they are not the first word: a, an, the, and, but, or, nor, of, in, on, at, to, by, for, per, via, vs, as. So "Product Type", "Date of Inspection", "Gloves per Case", "Inspector in Charge", "Not Done", "On Hold". Each part of a hyphenated word starts with a capital: "Follow-Up", "Sign-In Emails". A small word that belongs to its verb keeps its capital ("Sign In", "Stay Signed In", but "Back to Sign In"). Eyebrows and the sidebar's section headings are set in capitals by CSS; their text is still written in Title Case, which is what a screen reader reads.

**Stays as written:**

- Sentences: descriptions, hints, placeholders ("Choose the client"), help text, errors, toasts, notices, empty-state text, confirmations and the text `aria-describedby` points to. A sentence that quotes a label quotes it as shown: "Sign out, then choose “Forgot Password?”."
- Codes and abbreviations (PO, SO, AQL, INS-2026-0001, ID), units (mm, g, N, %, pcs, pairs) and the names of people, clients, manufacturers, products and templates.
- The clients' words that templates take from the paper forms and reports: module titles, field labels and captions defined in templates (`lib/templates/definitions/seed-bundle.json`), listed verbatim in `lib/coverage/fields.ts` and the coverage matrix of `docs/DATA_DICTIONARY.md` ("Total # carton", "# glove per inner box", "Packing configuration"), and the template's conclusion words (PASSED, FAILED, HOLD). They stay as printed until Kenneth decides.

An accessible name that repeats a visible label follows it (WCAG 2.5.3, see Do / Don't): a link that reads Open in Template Editor is named "Open in Template Editor: SAFEDON_EG v2". Tests hold labels to the rule with `lowerCaseWords(label)` in `lib/design/capitalisation.ts`, which names the words that break it.

## Do / Don't

- **Do** pair every status colour with its icon and words. **Don't** use teal (or any brand colour) to mean "passed".
- **Do** use brand-600 for links and text accents on mist. **Don't** put brand-500 or accent-600 text on mist or tints.
- **Do** show computed values read-only on grey. **Don't** let a total, median or limit be typed.
- **Do** keep the gradient to the logo, login, one accent word in a large title and the active progress step. **Don't** put body text, buttons or tables on it.
- **Do** design for 44 px on iPad and 16 px field text. **Don't** shrink a touch target to fit a row.
- **Do** keep transitions at 150 ms ease-out-expo. **Don't** add hover lifts, scale, parallax or scroll animation.
- **Do** use `focus-ring` or `focus-ring-inset` for keyboard focus. **Don't** use shadcn's `focus-visible:ring-ring/50` halo, or translucent text such as `text-foreground/60`: both render lighter than the token the test measures.
- **Do** make a component that holds `sr-only` text `relative`. **Don't** leave that text unanchored: in a horizontally scrolling tab bar or table it escapes the scroller and widens the page at iPad widths.
- **Do** keep secondary text at slate-600 or darker. **Don't** add a dark mode (the `dark:` variant is inert on purpose).
- **Do** write labels in Title Case and sentences in sentence case (Capitalisation): the pill says Not Done, the line under it "Not done: Visual Inspection." **Don't** capitalise a description, a toast or the clients' printed words ("# glove per inner box" stays as printed).
- **Do** start a control's accessible name with the words it shows, so a speech user can say what they see (WCAG 2.5.3): `aria-label="Open in Template Editor: SAFEDON_EG v2"`, or the visible text plus `sr-only` detail and no `aria-label`. **Don't** name it in other words ("Open SAFEDON_EG v2 in the Template Editor" on a link that reads "Open in Template Editor").
