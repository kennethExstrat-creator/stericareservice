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

Every result pill says these labels, Passed, Failed or On Hold (a module's own words for its checks aside, such as Accept and Reject on an AQL table; BUILD_SPEC 4.2 rule 3): a module's or a size's verdict, and the inspection's overall result, suggested or final, on capture (the Conclusion section's suggested result and the submit dialog included), the review, the inspections list and the AI panel. The template's conclusion words (PASSED, FAILED and HOLD unless the template words them otherwise, BUILD_SPEC 6.2 rule 11) appear only where the inspector picks the conclusion, as on the paper report: the Conclusion section's choices and that section's own text, its summary line ("Conclusion: PASSED. Suggested Result: PASSED (warnings: Sampling Plan).") and its warning when the final result differs from the suggestion. Never the short forms Pass, Fail or Hold. Under a pill, say why, not the result again: "Failed: …", "Not done: …", "Warnings: …" naming the sections, and nothing for a clean pass (`suggestionReasons` in `lib/validation/suggested-result.ts`). The Conclusion section names a reason's section when there is one and counts two or more ("Not done: 9 sections."), with Show All for their names; the submit dialog and the review name every section. The Conclusion section and the submit dialog name them by their short names ("Failed: Carton Numbers. Warnings: Weight."), the review in the template's wording (Step Names, below). Those lines are sentences, so they stay in sentence case beside the Title Case pill: Not Done, then "Not done: Visual Inspection." (Capitalisation, below).

## Density (by pointer, not width)

- `touch:` = `(any-pointer: coarse)`: any touchscreen, an iPad also with a keyboard and trackpad attached. `fine:` = no touchscreen (mouse or trackpad only). Layout switches at 1280 px on devices with no touchscreen (`xl`, redefined in app/globals.css): below it, and on every touch screen whatever its width, a top tab bar and full-width grid; from 1280 px without a touchscreen a left sidebar, wider grid, photos alongside. Check 820×1180, 1180×820, 1366×1024 (touch: 12.9 and 13 inch iPads) and 1440×900.
- iPad: every control at least 44×44 px (buttons, steppers, chips, tabs, menu items, grid rows, the grid's error list; checkbox, radio and switch grow to 24–28 px with a 44 px hit area). Field text 16 px so iOS never zooms on focus (Input and Textarea are 14 px only under `fine:`).
- A hit area drawn as an invisible `::after` is placed from inside the control's border, so count the border: a 24 px checkbox with a 1 px edge needs `touch:after:-inset-[11px]` (22 + 2 × 11), not `-inset-2.5` (42 px). Checkbox and radio 24 px, switch 48 × 28 px (`-inset-y-[9px]`), a field's button 36 px (`-inset-[5px]`); `components/ui/touch-hit-areas.test.tsx` works each one out.
- Desktop: compact controls (28–36 px; a counter stepper is 30 px with 28 px buttons) and table rows of about 36–44 px, with room around a stepper (12 October 2026).
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
| Rich text field (`RichTextEditor`) | A field's white frame and slate-300 edge, the toolbar across its top (a hairline under it), sticking under the screen's bars while the text scrolls. Toolbar controls are toggles: 32 px with a mouse, 44 px on any touchscreen (icons 16 / 20 px), their groups split by short slate-200 hairlines (20 px, 16 px between groups), in one row wherever the card is wide enough (every checked size from iPad portrait up); on a narrower card the groups wrap whole and the hairline before a group that starts a row is clipped, so no line ends or starts a row; pressed in secondary (brand-100 / brand-700); with nothing to undo or redo greyed to slate-400 but focusable. The writing area is sized for reading (Kenneth, 12 October 2026: the summary goes into the report): 16 px text on every device on relaxed lines (26 px), 16 / 12 px of padding (20 / 16 px on touch), at least 320 px tall on a landscape screen and 260 px on a portrait one, growing with the text. Menus are popovers holding one choice, rows 32 / 44 px with a check on the current one; sizes shown at their size, colours with a dot. Palette: sizes 0.875, 1.25 and 1.5 em; text colours grey (slate-600), blue (brand-600), teal (accent-700), purple `#6d28d9`, red `#b91c1c`, orange `#9a3412`, green `#166534`, each at least 5.25:1 on white and slate-100 and 4.71:1 on every highlight (yellow `#fef08a`, green `#bbf7d0`, blue `#dbeafe`, pink `#fce7f3`; teal on blue is the weakest pair), measured in `lib/rich-text/index.test.ts`. Red, orange and green text is the author's emphasis, never a result: results keep their pills and icons. Read-only, the text sits in the grey read-only field, the writing area's size and type. In the Conclusion it is its own row across the card at every width, under a hairline, headed by its label in the H4 group style (18 px on touch) in a row a button tall, with room at its right end for a button (Steri-AI Summary) | app (Kenneth, 12 October 2026) |
| Checkbox, radio, switch | Edge `--control` (slate-500): nothing else marks these controls or their state, so they hold 3:1 where a text field's slate-300 edge (1.48:1) would not. Unchecked switch: white track, slate-500 edge and thumb; checked: brand-500 with a white thumb | app (WCAG 1.4.11) |
| Tabs | Inactive labels slate-600 (`muted-foreground`, 6.92:1 on the slate-100 list), never a translucent foreground; active slate-900 on white | app (BUILD_SPEC 2.1) |
| Card / ModuleCard | White, slate-200 edge, soft shadow (`shadow-sm`), xl radius, no hover lift. ModuleCard: template-wording title, StatusPill, body, inspector comment, "Take Photo" (rear camera) and "Add From Library" | `ui.tsx.txt` Card |
| StatusPill, ResultChip | Icon + words; ResultChip is a 20 px disc with a glyph and a screen-reader label, for module tabs; the disc is positioned so the label never escapes a scrolling tab bar. Not Done stays an empty dashed ring | app |
| SaveStatus | Saved (neutral), Saving (brand), Offline (Will Sync) (warn amber), Not Saved (fail red, cloud-alert icon) when saving needs the inspector: a conflict, a refused save, no copy kept on the device; the notice under the screen's header says what happened and what to do. Pending uploads as a brand count badge. Pill and badge 16 px on touch | app (BUILD_SPEC 8) |
| Stepper | − value +, hold to repeat, Arrow/Page/Home/End keys, value announced; minus stays focusable but aria-disabled at 0 (greyed, not faded); a disabled stepper (an approved inspection) leaves the tab order | app |
| DefectChip(Group) | Tap adds one, attached minus removes one, live total. Unmapped one-off labels: dashed amber edge and a flag | app |
| NumericCell, MeasurementGrid | `inputmode="decimal"`, numbers only: "2 42" is rejected and stored as nothing. The rejection is announced with the cell's name (focus has already moved on) and listed under the grid as a full-width row button back to the cell (44 px on iPad). Enter goes down the column (then to the next column), arrows move between cells, a pasted column fills down; values a paste could not place are listed under the grid (or the field, or across the foot of a field's table) in amber, as pasted, until Dismiss or the next paste. Footer: Median/Average (Not Done until data), Spec., P/F (Not Done until the column is complete; judged at the displayed precision). Sticky header and footer, visible 2 px focus ring | app (BUILD_SPEC 6.2, 8) |
| PhotoTile | Waiting / uploading with progress, uploaded, flagged (needs conversion), upload stopped (fail red, cloud-alert icon, no progress bar; the card under it says what to do), selected, include-in-report (admin). The image stays 4:3 whatever the photo's shape | app (BUILD_SPEC 8.1) |
| ProgressTracker | Progress in brand (done, in progress, not started); the module in view carries the gradient; results stay in status colours. The list can hold a run of steps in a group that collapses under its header (a button with `aria-expanded`: title, "3 of 12 done", the worst result, a chevron), its rows a little in. Capture's sidebar (12 October 2026, Kenneth): Source Documents and the Conclusion always show, the steps between them sit in Inspection Steps, collapsed at first, open whenever the step in view is one of them, else as the inspector last left it (kept per user on the device). A row's label may be a short name (Step Names, below): its `title` attribute names the step in full, on the bar's name too, and each row carries `data-step` (its step's key) | app |
| PageHeader | Eyebrow with gradient dash, Red Hat Display title, actions | `ui.tsx.txt` Eyebrow, SectionHeading |
| Logo | Horizontal (headers, 32 px), lockup (login), mark (compact); height-driven; true colours | `logo.tsx.txt`, `brand/` |
| Icons | `app/icon.png`, `apple-icon.png` (white, 12% padding), `favicon.ico` (16–256), `public/icons/icon-192/512` and `icon-maskable-512` (shield inside the 80% safe zone) | app, from `stericare-mark.png` |

## Capitalisation

Kenneth's rule (8 October 2026): "all the labels should be capital letter for all first letter". Labels are in Title Case; sentences keep sentence case.

**Title Case** for the labels and short names the app itself writes:

- form field labels and legends, with their note: "Product Name (Optional)", "Inspector Comment", "Map To";
- table column headers, those only a screen reader hears included: "Inspector in Charge", "Used By", "Last Signed In";
- titles of pages (and of the browser tab), eyebrows, cards, sections, sheets and dialogs, also when phrased as a question: "New Inspection", "Your Team", "Before You Submit", "Leave This Page?", "Submit INS-2026-0001 for Review?". A notice or an alert has a title too ("Read Only", "Keep This Page Open", "The Last Request Failed"); the text under it is its body, a sentence;
- empty-state titles: "No Inspections Yet", "No Clients Match “PPE”", "The Clients Could Not Be Loaded";
- tab names, navigation and menu items: "Custom Modules", "Sign Out", "Change Name";
- button and link texts that name an action: "Start From Previous", "Submit for Review", "Go to Inspections", "Add From Library". An icon button's name is its text: "Clear Search", "Show Password";
- status pills, badges and chips: Passed, Failed, Warning, On Hold, Info, Not Done, "Not Attached", "In Report", "Chosen by an Admin";
- the clients' words that templates take from the paper forms, in the app and in the report (Kenneth, 8 October 2026: "Yes, use the readjusted wording format. Report should change to readjusted format too"): module titles, field labels, captions and the rows a template lists (defects, hole locations, labelling checks), in `lib/coverage`, the seed templates and the module defaults: "Packing Configuration", "# Glove per Inner Box", "Total # Carton", "Thin Area Between Fingers (Crotch)". The forms' own wording stays verbatim in `lib/coverage/sources.ts` and the coverage matrix of `docs/DATA_DICTIONARY.md`, and `sameWording` (`lib/coverage/wording.ts`) holds every template label to it, its capitals aside.

How a label is written:

- Every word starts with a capital letter, except these small words in the middle of a label: a, an, the, and, but, or, nor, of, in, on, at, to, by, for, per, via, vs, as. So "Date of Inspection", "Gloves per Case", "Inspector in Charge", "Use 500 for Every Class".
- The first and the last word always start with a capital, a small word included: "Used In", "Map To", "Shown As", "Base Moved On".
- A particle that belongs to its verb keeps its capital: "Sign In", "Switch Off", "Switch Back On", "Stay Signed In" (but "Back to Sign In", where "to" is no particle).
- The first word after a colon or an opening bracket starts with a capital: "Reopened: Changes Needed", "No: Keeps Its Own Value", "Not Tagged (Tag Them Later)", "Accent: Logo Teal (The Brand, Never a Result)".
- Each part of a hyphenated word starts with a capital: "Sign-In", "Set-Up", "One-Off Label".

Eyebrows and the sidebar's section headings are set in capitals by CSS; their text is still written in Title Case, which is what a screen reader reads.

**Unchanged:**

- Sentences: descriptions, hints, placeholders ("Choose the client"), help text, errors, toasts, notices and alert bodies, empty-state text under the title, confirmations, and the text `aria-describedby` points to. A notice whose only line is a sentence ending in a full stop stays one ("Your session has ended. Sign in again."). A sentence that quotes a label quotes it as shown: "Sign out, then choose “Forgot Password?”.", "Choose Agree, Disagree or Fixed.", "Start one with New Inspection."
- Codes and abbreviations (PO, SO, AQL, INS-2026-0001, ID, STD_EG), units (mm, g, N, %, pcs, pairs) and the names of people, clients, manufacturers, products and templates.
- What a template words as a sentence: the stickiness legend ("A mix of non sticky to lightly sticky") and the definitions shown under the Safedon dispensing defects. The template's conclusion words stay in capitals, as the reports print them (PASSED, FAILED, HOLD). A label the app builds around a template's words changes only its own words: "Weight (g), Size M", "Other : Description (Size M, Right Hand)".

An accessible name (`aria-label`) that repeats a visible label follows it (WCAG 2.5.3, see Do / Don't): a link that reads Open in Template Editor is named "Open in Template Editor: SAFEDON_EG v2", the photo card's Edit button "Edit tags and caption: …". A name only a screen reader hears that repeats no visible label, such as a region's "Sections and progress" or a table's caption, is no label and keeps its words.

Tests hold labels to the rule with `lowerCaseWords(label)` in `lib/design/capitalisation.ts`, which names the words that break it and leaves units as they are ("Weight (g)"); every label in `lib/coverage` is held to it (`lib/coverage/wording.test.ts`); code that writes a label from a key (the template editor's config forms, the review's history) decides each small word with `staysLowerCase` from the same file.

## Step Names

Kenneth (12 October 2026): "this menu is crowded, simplify the section name". A step's title is the client's form wording, with weight's glove count filled in (`shownTitle`); in a menu or a message the step goes by its short name.

- **Full title:** the step's card heading on the capture screen, a switched-off step's too; everything the client reads: the review page, the export, the Steri-AI Report and Second Opinion, and Steri-AI's reading of source forms; the template editor and the New Inspection page. The modules' own messages keep it too, since the review and the export print them: the Conclusion's summary line and its warning when the final result differs from the suggestion.
- **Short name:** everywhere else the capture screen and the photo screens name a step: sidebar rows (Switched Off included), iPad tabs, the progress bar's name, Previous / Next, Pending rows, the Switch Off dialog and the switched-off notice, the switch toasts and refusals, the autosave pill's problem line, a form-failure notice ("The form for Weight did not load."), the reasons under the suggested result in the Conclusion section (its line and Show All) and in the submit dialog, which word them alike ("Failed: Carton Numbers. Warnings: Weight."; Status colours, above), photo tags and captions, the tag picker, the photos page's groups and file lists.
- **Hover:** the native `title` attribute names the step in full on sidebar rows, switched-off rows, tabs, the progress bar's name and Previous / Next. The iPad has no hover: the open step's card heading shows the full title.
- **Which name:** a module's short name is the same in every template, whatever its title says; a template that names a step its own way keeps its words, matched by that title (STD_SG: Shipment, PO Info, Packing Mode). A custom module's is listed in code (Dispensing Notes), else it is its own title without a trailing note in brackets ("Site Notes (Optional)" is Site Notes). A heading changed in the template editor shows on the card; the menus keep the step's short name.
- **Limits:** one to three words, in Title Case, at most 21 characters: one line of a sidebar step (144 px of 14 px Outfit semibold), never cut. A custom step's long title wraps to two lines in the sidebar, its full title on hover.
- **Code:** `lib/templates/short-titles.ts` holds the names and `shortTitleFor` / `customShortTitle`; capture's sections and pages carry `title` and `shortTitle` (`lib/inspections/capture/sections.ts`); module code asks `moduleShortTitle(context, key)` (`modules/_framework`; the Conclusion's reasons), and the submit dialog `submitReasons` (`lib/inspections/capture/suggestion.ts`). Code, not template data: every template version has them, with nothing published.

The seed menus, in screen order:

- STD_EG: Source Documents, Manufacturer, Glove Information, Order, Sampling Plan, Carton Numbers, Dimension, Force at Break, Weight, Watertight Test, Visual Inspection, Packing Check, Labeling, Conclusion.
- SAFEDON_EG: Source Documents, Manufacturer, Glove Information, Order, Sampling Plan, Carton Numbers, Dimension, Physical Properties, Weight, Watertight Test, Visual Inspection, Dispensing, Dispensing Notes, Labeling, Conclusion.
- STD_SG: Source Documents, Shipment, PO Info, Sampling Plan, Watertight Test, Visual Inspection, Dimension, Dye Leak Test, Conclusion.

Packing Configuration (Packing Mode in STD_SG) sits on the Order's (PO Info's) page and Glove Type on Glove Information's (Shipment's in STD_SG), so their names show in Pending, photo tags and their own dialogs.

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
- **Do** name a step by its short name in menus, Pending, dialogs and toasts (Step Names). **Don't** shorten its card heading or anything the review, the export or the Steri-AI Report shows.
- **Do** write labels in Title Case and sentences in sentence case (Capitalisation): the pill says Not Done, the line under it "Not done: Visual Inspection."; a label ends on a capital ("Used In"). **Don't** capitalise a description or a toast, and don't keep a form's printed case: "# glove per inner box" on the form is "# Glove per Inner Box" in the app and the report.
- **Do** start a control's accessible name with the words it shows, so a speech user can say what they see (WCAG 2.5.3): `aria-label="Open in Template Editor: SAFEDON_EG v2"`, or the visible text plus `sr-only` detail and no `aria-label`. **Don't** name it in other words ("Open SAFEDON_EG v2 in the Template Editor" on a link that reads "Open in Template Editor").
