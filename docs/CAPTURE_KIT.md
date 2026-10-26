# Capture kit

Shared building blocks for every module's `Capture.tsx` (`docs/MODULES.md` section 10), so all sixteen modules look and behave the same and the look is tuned in one place. Capture renders the module body only; the screen wraps it in `ModuleCard`. Import components from `@/components/qc` and text helpers from `@/lib/format`. Check here before writing a control of your own.

## Changed on 13 October 2026 (box/carton numbers, linked again)

Kenneth: "box# and carton# is the same thing", then "yes link again" (BUILD_SPEC 6.2 rule 7, reversing 12 October). A Capture with box numbers passes two more props and words them "Box/Carton #"; nothing else changes:

1. **`BoxNumberField` suggests the size's sampled numbers.** Pass `cartons={cartonsFor(context, size)}` and `used` (every row's number in the list, its own included). It is still a NumberField on the numeric keypad: Enter walks its group, a pasted column fills down, refused text stays with its reason. Once a digit is typed, the sampled numbers holding the typed digits show under the field, ascending (a Radix popover, so a table's clipping frame never cuts it), those other rows hold marked "Used" (or "Used ×2") and still offered. A tap (or a click with a mouse or trackpad) fills one in and the focus stays, so the iPad keypad stays up; on desktop the down and up arrows choose one (Page Up and Page Down jump to the ends) and Enter fills it in and walks on, as after typing. The list is drawn outside the page (a portal), so the capture screen's leaving rule spares a click in the list the focused field controls (`click-leaves-field.ts`): it no longer stores the digits typed so far over the number clicked (fixed 14 October 2026). The down arrow also opens the whole list with nothing typed. Nothing waits for the list: Enter with no suggestion chosen stores what was typed, Escape drops the edit as before, and a pointer resting on the list never changes what Enter stores. The input is a combobox (`aria-expanded`, `aria-controls` while the list shows, `aria-activedescendant`); 32 px rows with a mouse, 44 px on any touchscreen. With no sampled list for the size, it is a plain number field, as before.
2. **calc warns, never refuses.** `boxNotSampledIssue(context, size, box, path)` from the framework gives the warning for a number the size's list does not hold ("Box/Carton #2336 is not in M's sampled box/carton numbers.", code `box_not_in_carton_list`), or null: no number, no list, or a listed one. Pass a box field its issue split by level, `error` for an error and `warning` for a warning (amber), and list it under the table with the others, each a link. The same number in several rows is no issue.
3. **Wording.** `lib/format` has `BOX_CARTON_LABEL` ("Box/Carton #"), `boxCartonNumber(n)` ("Box/Carton #1003", for sentences, names and photo tags) and `countBoxCartonNumbers(n)` ("12 box/carton numbers"). `tagLine` says "Box/Carton #253" for a photo's box.
4. **`BoxPicker` is gone.** Its list logic lives on in `box-options.ts` (`boxOptions`, `pickedElsewhere`) behind the suggestions: a box/carton number is typed, the list only helps, and no field makes the inspector go through a picker.
5. **`NumberField`** takes `onDraftChange` (the text being typed, null when the edit ends) and `inputProps` (the combobox attributes) for fields built on it, and **`NumericCell`** drops the text being typed when a value is handed to it (`FILL_EVENT`: a pasted column, a suggestion picked), so leaving the field never commits that text over it.

## Changed on 12 October 2026 (formatted text)

Nothing breaks, and no Capture has to change (Kenneth: "a paragraph field for inspector to write inspection summary, with all the writing tools"). You get:

1. **`RichTextEditor`**, a paragraph field with formatting, first used by the conclusion's Inspection Summary. Import it by its path, `@/components/qc/rich-text-editor`, never through the kit's index, so its editor (Tiptap, on ProseMirror) stays in the chunk of the Capture that uses it; no `next/dynamic` either, so the chunk the capture screen preloads holds it and it works offline. Its toolbar has 13 controls: Undo, Redo, Font Size (Small, Normal, Large, Extra Large), Bold, Italic, Underline, Strikethrough, Font Colour (Default, Grey, Blue, Teal, Purple, Red, Orange, Green), Highlight (No Highlight, Yellow, Green, Blue, Pink), Bulleted List, Numbered List, Align (Left, Centre, Right, Justify) and Clear Formatting. Props: `value` (the stored `RichTextDoc`, or null), `onChange(doc)` with the canonical document (`toRichTextDoc`; null when the text is cleared), which you write with `update`; `labelledBy` (your label's id), `readOnly`, `busy` and `ref` (item 3), `issuePath`, `className`. Store it with `RichTextDocSchema` (docs/MODULES.md section 5): a strict JSON document with its sizes, colours, highlights and alignments as tokens, never HTML; at most 5,000 characters and 500 paragraphs, which the editor enforces, so a save is never refused. The writing area is sized for reading: 16 px text on every device on relaxed lines, paragraphs and lists 0.75 em apart and list items 0.25 em, as `RichTextView` spaces them (Kenneth, 12 October 2026), roomy padding, at least 320 px tall on a landscape screen and 260 px on a portrait one, growing with the text; give the field the row's whole width. Opening a saved document never saves it; data replaced from outside (a merge) replaces the text, and the editor's own changes coming back late never do. Read-only (a submitted inspection, the moment saving starts, a conflict) it is a grey box like a read-only textarea, the writing area's size, with no editor at all.
2. **`RichTextView`** from `@/components/qc`: a stored document as React elements with classes from the shared maps (no editor, no `dangerouslySetInnerHTML`, no inline styles, no hooks), so a Server Component renders it, as the review's summary card does.
3. **A document put in from outside, as one undo step** (Steri-AI's draft of the Inspection Summary). Writing it with `update` makes the editor take it as data replaced from outside: the text changes off the undo history, so the toolbar's Undo cannot take it back. Put it in through the editor's ref instead (`RichTextEditorHandle`, with `RichTextInsertMode` and `RichTextInsertResult`, all types from `@/components/qc/rich-text-editor`):

   ```tsx
   const summaryEditor = useRef<RichTextEditorHandle>(null);
   <RichTextEditor ref={summaryEditor} busy={writing} readOnly={readOnly} … />
   const result = summaryEditor.current?.insertDocument(draft, "replace") ?? { applied: false };
   ```

   - `insertDocument(doc: RichTextDoc | null, mode: "replace" | "below"): RichTextInsertResult` makes one step of the editor's own history. The toolbar's Undo and ⌘/Ctrl+Z take it back, Redo puts it back, and typing just before or just after it stays a step of its own: the history is closed on both sides, so it never merges inside the history's 500 ms grouping. It fires `onChange` with the canonical document, as typing does, so autosave runs.
   - It never focuses the text or scrolls the page, so the iPad keyboard stays as it was. The caret ends after what went in, as after a paste, but the browser's selection moves only when the text already has the focus.
   - `replace` takes the whole text, and null clears the field. `below` goes after the text (the field spaces its paragraphs itself), taking over any empty paragraphs at its end. Into an empty field it is the same as replace. The blank line counts as a paragraph, not a character, so a draft fits below when `richTextLength(value) + richTextLength(draft) <= RICH_TEXT_MAX_CHARACTERS`.
   - The limits hold as for a paste. The document is normalised first (`toRichTextDoc`: anything off the allow-list goes). Then the end of what goes in is cut to the room the kept text leaves (5,000 characters with 1 per line break, 500 paragraphs, never half an emoji), and the text already there is never cut.
   - `{ applied: false }` means nothing changed: there is no editor (read-only, or the moment before it starts), or `below` has nothing to add or no room left.
   - `{ applied: true, cut, before, after }`: `cut` when the end did not fit. `before` and `after` are the field's canonical documents (null when empty) just before and after the change. `after` is what `onChange` was given; hash its `richTextPlain` for a "Drafted by" mark. To undo the change yourself, keep `before` and call `insertDocument(before, "replace")`, which is one undo step too. When the field already held the document, `before` equals `after` and nothing is recorded.
   - **`busy`**: while something writes into the field, pass `busy`, not `readOnly`. The text stays on screen in its white frame but cannot be changed. Every toolbar control greys out but stays focusable (aria-disabled, menus do not open), and the text is aria-busy and aria-readonly. The editor and its history stay, so the result goes in as one undo step when it comes; `insertDocument` works while busy. If the focus is still in the text when busy starts, it leaves, so the iPad keyboard goes down once; ending busy focuses nothing. `readOnly` swaps the editor for the grey box, drops its history, and the handle then applies nothing.

## Changed on 12 October 2026 (steppers with room)

Nothing breaks, and no Capture has to change (Kenneth: the number adding buttons "feel very crowded"). You get:

1. **A slimmer Stepper.** Each − and + is the whole target, 28 px (44 px on touch), its fill a 24 px circle inside it (36 px on touch), and the pill adds no padding of its own: 30 px tall and 94 px wide on desktop, 46 px and 130 px on touch (38 × 110 and 50 × 138 before). Every Stepper has this size, CountField's and labelling's No. inspected included, so a stepper set over a count column matches the ones in it. Keys, hold to repeat, a swipe that counts nothing and what is spoken work as before.
2. **CounterTable gives each stepper room**: 6 px above and below on desktop, 8 px on touch, so the steppers of a column no longer touch each other or the row lines. Rows are 43 px on desktop (41 before) and stay 63 px on touch. The count columns keep their widths, so stacked tables (Critical, Major, Minor) still line up, and the header and totals still stick.

## Changed on 12 October 2026 (tables that use the width)

Nothing breaks, and no Capture has to change (Kenneth: tables "leaving a lot of space", titles "displaced"). You get:

1. **CounterTable fills its frame.** The label column takes the width the value columns leave, so "Total Number of “Critical Defects” Found" stays on one line; each value column keeps a fixed width, so stacked tables still line up. With one value column on screen (a size at a time) it is as wide as an Accept / Reject limit on one line ("Accept 21 / Reject 22"), unless the table's frame is under 28rem (labelling's two levels side by side from 1280 px); columns side by side keep a stepper's width. A control set over the count column, as labelling's Record button, measures it the same way (`@container`, 11rem, 13rem on touch, 8rem in a frame under 28rem).
2. **MeasurementGrid takes `flow`** for one measure: its rows sit in up to three groups side by side (force at break's 13 gloves: 1 to 5, 6 to 10, 11 to 13), every row the height of the others, the footer across the foot. Enter, the arrows, Tab and a paste still go 1, 2, 3 …. The groups are tables named "No. 1 to 5" and so on inside a group named by `caption`; the footer is a table named by `caption` whose rows read "Average 2.90", as the unflowed footer's do.

## Changed on 8 October 2026 (packing on the order's page)

Nothing breaks, and no Capture has to change. You get:

1. **A page can show two modules.** Packing configuration sits right below the order, on the order's tab and sidebar row (`lib/inspections/capture/sections.ts` `SHOWN_WITH`; `docs/MODULES.md` section 10), so the order's Total # Gloves fills in as the packing is typed. Each module keeps its own frame, result, comment, photos and Pending row. Keep everything your Capture does inside its root, as the kit already does: `useIssueFocus(focusPath, { root })`, an `EnterGroup` of its own, ids from `useId`.
2. **Frames carry their module's key.** Each section frame has `data-section-key`; a page of two frames is a `data-slot="capture-page"` panel (a page of one keeps its frame as the panel, inside a wrapper with no box, so a page that gains or loses packing when it is switched on or off on another device keeps the order's frame as it is, mid-typing included); each section tab lists its page's modules in `data-sections`; a form still loading is `data-slot="body-skeleton"`, a module's photos still loading `data-slot="photos-loading"`. Issue links, `?module=` and a reload's landing name a module and open its page, waiting for the page's forms and photos (and, on opening, for saving to start) before they scroll to the module below, so its title or field stays put where the browser has no scroll anchoring. Specs scope by these attributes (e2e/README.md), never by a frame alone.
3. **Names apart on a page of two.** Each frame's Inspector Comment, its Photos region and Switch Off are read out with the module's title (sr-only, "Inspector Comment, Order"), and so are a form's Try Again (it did not show) and Clear This Section or Remove the Values That Cannot Be Read; the iPad's Take Photo and Add From Library say which module the photos go to, as Choose Photos did. The notices about the inspection's photos, those waiting on this device and the uploaded ones that could not be loaded, show once a page, in its first frame.

## Changed on 7 October 2026 (final audit)

Nothing breaks, and no Capture has to change. You get:

1. **Refused entries outlive their field.** The capture screen gives each section a `RefusedEntryStore` (`components/qc/refused-entries.ts`, through `RefusedEntryStoreContext`). A `NumberField` or `PercentField` with an `issuePath`, and a `MeasurementGrid` with `cellIssuePath`, keep what they refuse ("2 42" and its reason) there, by the field's issue path, instead of in their own state. So the red field or cell and its message come back after a size switch (SizeTabs shows one size's panel at a time), a section switch and a reload, until a number lands at that path, however it gets there. A field whose kept entry comes back tells your module again through `onInvalidChange`, so a list of your own (`EntryProblems`) has it after a reload too; a grid lists its cells under itself, as before. The screen keeps the entries on the device beside the local copy of the data, never in the data (docs/OFFLINE.md, "Refused entries"), lists them in the Pending panel first in their section's row ("Length, No. 3: “2 42” to retype") and lets them all go once the inspection is submitted. Without a store (read-only, a second tab, outside the capture screen) or without a path, a field keeps its entry while it is on screen, as before: give your fields their issue paths.
2. **CounterTable reports a cell for photo tags when it is pressed and whenever its count changes**, not only when it takes focus. Safari and Chrome on the iPad never focus a tapped button, so a tap on + left the next photo without its size and defect. A swipe to the next size or a scroll that starts on a stepper is no press. `onCellFocus` may now come more often, with the same cell: keep it cheap.
3. **CounterTable's label column keeps a minimum width** (Layout conventions, Compact tables): drop any minimum of your own on its first cells.

## Changed on 7 October 2026 (hand-offs between the packages)

Nothing breaks, and no Capture has to change. You get:

1. **A paste that does not fit says so on screen.** The values past the last cell or field of the run (and, for a one-column `group`, the values from other spreadsheet columns) are listed as pasted, with their count, in amber, until the inspector dismisses the notice (the focus goes back where the paste was made) or pastes again. `MeasurementGrid` shows it across its foot; `NumberField` under the field pasted into; a `NumberField` cell, or a field in a named `group` (a table's column or row, as a custom table draws its cells), hands it to its `EnterGroup`, which shows it across the group's foot (after your table, inside your frame). The live region still says it in short. A value your module keeps past the grid's last row (force at break keeps readings past the gloves tested, and reports them itself) is not listed: the grid compares the overflow with the `values` you hand it, once, as the paste lands, so store the paste in the same event (`update` in `onCellsChange` does). Clearing the kept values later never lists them as lost. Modules that handle a paste of their own can show the same notice with `PasteNotice`.
2. **`PhotoTile` has a `failed` state**: "Upload Stopped" in fail red, no progress bar. Its image stays 4:3 for a portrait photo too.
3. **`PhotoTags.level`**: labelling's packaging level in the template's words ("Carton Box"); `tagLine` puts it after the box and before the item, as the capture screen's tag line has them.

## Changed on 7 October 2026 (review fixes)

Nothing breaks. If your Capture shows a lab report or certificate, or words one class's limit apart, change these:

1. **`AttachmentStatus` takes calc's `state`**: `"attached"`, `"none"` or `"missing"` as calc reads it (`moduleFileState(context, …)` for a module's one file, `heldFileState(context, id)` for a file kept per entry), with calc's message about the file as `warning`. `attached` is deprecated: `attached={data.labReport !== null}` read Attached for a file deleted since while calc warned that it was missing. A missing file (deleted, or still uploading from another device) never reads Attached and says so in amber, even before calc's message arrives. The line has no frame: it sits in the module's section beside `ModuleFileSlot`, which attaches the file, and with `issuePath` it takes an issue link's focus itself, as a notice does.
2. **A class worded apart in a limit row is keyed class first**: `criticalAccept` and `criticalReject` (STD_EG prints the critical row "Acc. = 0 / Rej. = 1"), as the dictionary keys class wording (`criticalTotal`). `lib/coverage` refuses dotted keys, so a template seeded from it never holds `critical.accept`. Fall back to the word every class shares, as visual's `limitWord` does.

Without code changes you also get: `SaveStatus` at 16 px on touch, its pill and upload badge alike, "Not Saved" included; a limit row that wraps after the slash ("Accept 10 /" over "Reject 11") and never starts a line with it, read in one piece by screen readers (`formatLimitParts` in `lib/format` gives the halves); a one-off row taken off while the "Other Defect" form is open, or in a table without that button, leaves the focus on the first count of the row taking its place (else the row before, else the table), never on the page.

## Changed on 7 October 2026 (integration)

Nothing breaks: every change adds to the kit, and what was there still works. To drop the workarounds the kit made you write, change these in your Capture:

1. **MeasurementGrid writes with `onCellsChange`** (section "A column of readings"): it hands over only the cells a change touched, `{ row, measure, value }[]`, a paste in one call. Write them with `update`. `onValuesChange` (whole columns built from what the grid rendered) is deprecated: drop the diff against the rendered columns that kept a second change in one event.
2. **MeasurementGrid takes `readOnly`, `cellIssuePath` and `onCellFocus`**: drop the disabled fieldset (it took the readings out of the Tab order and away from issue links) and the code that stamped paths on the grid's inputs after render.
3. **MeasurementGrid's footer can be calc's**: pass `summary: { statistic, outcome, count }` per measure from your `computed`. Then a reading calc refuses (0 N, a negative) never shows a median or a verdict calc does not give. Word the verdict row with `labels.pass`, `fail` and `na` (SAFEDON_EG's "A" and "Rej."), and refuse what calc refuses at the cell with `min: 0, minExclusive: true` ("Must be more than 0.").
4. **Drop `SMALL_PILL_TOUCH`**: `StatusPill` reads 16 px on touch at both sizes by itself. The constant stays in `status-pill.tsx`, deprecated, so a deep import still compiles.
5. **CounterTable's limit row takes the template's words**: `labels.limitAccept` and `labels.limitReject` ("Accept 0 / Reject 1", "Acc. = 0 / Rej. = 1"); "Ac" and "Re" are only the fallback. `labels.accept` and `reject` stay the chip's words.
6. **calc's warnings on a field go in `warning`** on NumberField (and the new DateField and CountField), not in `hint` as amber spans: amber lines with the warning icon, an amber edge, the field described by them.
7. **A message with no control of its own** (readings past the plan, a deviation, a plan too large) is marked with `issueNoticeProps(path)`, so an issue link lands on the message, not on a button inside it or the size's panel.
8. **One-off rows can come off**: mark them `removable` and pass `onRemoveRow`; the remove button shows while the row counts nothing.
9. **Per-size blocks beside a CounterTable** (the gloves tested above the table) use `SizeBlock` and `SideBySideText` (or `useSizeTabsLayout()`), not classes against SizeTabs' `data-side-by-side` attribute.

New in the kit: `CountField` (a tapped count that can be not entered yet), `DateField`, `AttachmentStatus` (a lab report or certificate), `ColumnSwitcher` (Previous and Next for one column at a time), `CounterColumn.heading`, `SaveStatus` state `error` ("Not Saved"), `PhotoTags.item`, and from `@/components/qc` also `createDataUpdater` and `batchDataChanges` (tests of a module's writes) and `useMediaQuery` with `WIDE_QUERY` and `COARSE_QUERY`. In `lib/format`: `fillCaption`, `formatCodeLetters` and `plainLabel`.

Without code changes you also get: a grid label column as wide as its longest caption, so "Passed / Failed" stays on one line; small pills, grid footers and legends at 16 px on touch; BoxPicker reporting focus when its list opens (Safari never focuses a tapped button, so iPad photo tags missed the box; BoxPicker was removed on 13 October 2026); issue links preferring a notice to a container marked with the same path; long limit wording that wraps instead of widening its column; `formatRate` with thousands separators ("11 / 1,000 (1.1%)", as the expected results write it).

## Changed on 6 October 2026 (review fixes)

If you started from the first version of this page, change these in your Capture:

1. **Write through `useDataUpdater`** (next section). `const update = useDataUpdater(data, onChange)`, then `update((current) => ...)` in every kit callback. Building `next` from `data` (`onChange(set(data, ...))`) kept only the last value of a pasted column.
2. **A CounterTable column's `status` is that table's own result**: the size's result where the module has one table (watertight), the class's result for the size where it has one per class (visual). Never `evaluation.result.perSize` on a class table. With limits the chip is the live decision from the total, and calc's status only overrides it with `not_done`.
3. **`decide` and `columnStatus` are no longer exported** from `@/components/qc`: accept and reject are calc's job, with `lib/aql`.
4. **Labels through `labelFor`** (`docs/MODULES.md` section 6), as the examples now do.
5. **Issue-link `reveal` switches only to an ordered size**: `context.sizes.includes(path[1])`.

Without code changes you also get: SizeTabs corrects a size that is not ordered; `wide="all"` keeps the tabs where the sizes do not fit side by side; a CounterTable given `activeColumn` follows SizeTabs and its header rows stick; "Right" and "Left" as words; 16 px kit text on iPad; `formatNumber` without binary noise; size swipes over a MeasurementGrid that fits its width; a swipe that starts on a stepper never counts, however slow (a held button stops repeating once the finger slides); an issue link that works when clicked twice.

## Writing data: `useDataUpdater`

`onChange(next)` replaces the module's whole data (CaptureProps). Kit callbacks run with the `data` of the last render, and some events change several values at once: a pasted column fills a run of fields, a blur commits a value while the size turns. Each change built from `data` would overwrite the one before it. `update(change)` applies the change to the latest value instead, including changes the screen has not rendered yet, and a paste reaches `onChange` once with every value.

```tsx
import { useDataUpdater } from "@/components/qc";

const update = useDataUpdater(data, onChange);

function setBox(current: DispensingData, size: string, index: number, patch: Partial<BoxRow>): DispensingData {
  const entry = current.sizes[size] ?? emptySizeEntry();
  const boxes = [...entry.boxes];
  boxes[index] = { ...boxes[index], ...patch };
  // Spread current.sizes: sizes no longer ordered keep their data (6.2 rule 4).
  return { ...current, sizes: { ...current.sizes, [size]: { ...entry, boxes } } };
}

<PercentField onValueChange={(layering) => update((current) => setBox(current, s, i, { layering }))} ... />
```

- Every change goes through `update`: values, counts, box picks, one-off rows, "copy from size M". Never call `onChange` yourself.
- Start from `current`, never from `data`, and return a new object without changing `current`.
- Several changes for one action (copy a size's values) go in one `update`.

## Which component for what

| Need | Use | Instead of |
|---|---|---|
| Change the module's data | `useDataUpdater` | `onChange(set(data, ...))` |
| Pick the size (per-size modules) | `SizeTabs`; `SizeStatusStrip` in summaries | your own tabs or a select |
| A size's own block beside a table that follows the tabs | `SizeBlock`, `SideBySideText`; `useSizeTabsLayout()` for anything else | classes against `data-side-by-side` |
| Right / left hand (`handSplit`) | `HandToggle` in SizeTabs' `actions` | two copies of the UI |
| Counts: defects, hole locations, labelling checks, Safedon per-box defects | `CounterTable` (or `DefectChipGroup`, chips without a table) | typed counts (BUILD_SPEC 8: no typing for counts) |
| One column at a time on the iPad layout (Safedon's boxes) | `ColumnSwitcher` beside a CounterTable given `activeColumn` | your own Previous / Next |
| One count that may be not entered yet (pouches tested, pouches failed) | `CountField` | a Stepper that shows 0 before anything is entered |
| A column of readings per glove (dimensions, force at break, weight x 13) | `MeasurementGrid` | rows of fields, a static table for read-only |
| One measured or entered number (tensile average, qty, indicative weight) | `NumberField`, `PercentField`, in an `EnterGroup` | `<input type="number">` |
| A date (6.2 rule 3) | `DateField` | `<Input type="date">` with your own label and messages |
| A box/carton number (dispensing, labelling) | `BoxNumberField` with `cartons={cartonsFor(context, size)}` and `used`: typed on the numeric keypad, the size's sampled numbers suggested (6.2 rule 7) | a picker the inspector must go through, a plain `NumberField`, a check that refuses a number not sampled |
| A computed value against its spec, with the verdict | `RequirementList`; `SpecValue` inline; `Figure` for a bare number | hand-built text |
| Whether a lab report or certificate is attached | `AttachmentStatus` with calc's state, the screen's file slot (`ModuleFileSlot`) as its children | your own copy per module |
| A part of the module body (a defect class, a level) | `ModuleSection` | your own heading and spacing |
| Entries rejected in your own table of fields | `EntryProblems` | a custom error list |
| Refused text kept through a size or section switch and a reload | `issuePath` on NumberField, `cellIssuePath` on MeasurementGrid (the screen's `RefusedEntryStore`) | refused entries in your own state |
| A link from the issue list to the field | `useIssueFocus` with `issuePathProps` / `issuePath` / `cellIssuePath`; `issueNoticeProps` on a message | scrolling by hand |
| calc's message about a field | `error` (red) and `warning` (amber) on NumberField, DateField, CountField | amber spans in `hint` |
| Text for specs, rates, limits, sizes, numbers, captions | `lib/format` | template strings |
| A paragraph with formatting (bold, a size, a colour, lists) | `RichTextEditor`, imported by its path (`@/components/qc/rich-text-editor`), data in `RichTextDocSchema`; `RichTextView` to show it read-only | a contenteditable of your own, HTML in the data, `dangerouslySetInnerHTML` |
| Text written for the inspector into a `RichTextEditor` (Steri-AI's draft) | the editor's ref, `insertDocument(doc, "replace" \| "below")`, and `busy` while it is being written | `update` with the document (no undo step), `readOnly` while writing (drops the editor and its history) |

## Layout conventions

- **Order of the body:** `SizeTabs` first (sticky), then `ModuleSection`s inside it. Keep content inside SizeTabs so the size bar stays stuck over it.
- **Sizes:** only `context.sizes`, in that order (6.2 rule 4). Tabs on iPad: below 1280 px, and on every touch screen whatever its width (`xl` needs a mouse or trackpad too, so a 1366 px iPad Pro gets the iPad layout; docs/DESIGN.md, Density). On desktop use `wide="all"` where sizes read better side by side (counts, short per-size blocks): SizeTabs shows them side by side only while they fit, and keeps its tabs otherwise (a CounterTable reports the width it needs, so a hand split or many sizes stay on tabs). Keep `wide="tabs"` where a size fills the width (dimension grids, 13-row packing tables).
- **The size on screen:** SizeTabs shows `value` when it is ordered, else the first ordered size, and calls `onValueChange` with that size, so a state that went stale (a size taken out of the order, `useState(context.sizes[0] ?? "")` before sizes exist) corrects itself. A CounterTable given `activeColumn` in SizeTabs' panel (SizeTabs' children as a node, as in the counts example, not a per-size function) shows the size the tabs show, in the same layout. So do `SizeBlock` (a size's own block beside the table: its gloves tested, its "Other :" description) and `SideBySideText` (", size XS" in a label, shown only where the sizes sit side by side, always read out); `useSizeTabsLayout()` gives `{ size, sideBySide }` for anything else. HandToggle likewise reports "R" for a "both" it does not offer.
- **R and L sit under the size:** sub-columns of each size in `CounterTable` (`hands`), headed "Right" and "Left" (size L sits in the same bar, so never a bare "L"), switched by `HandToggle` (Right, Left, Both).
- **Totals and accept chips are always visible:** a CounterTable given `activeColumn` in SizeTabs' panel never scrolls sideways, so its header rows stick below the size bar and its totals row to the bottom of the screen while the table is in view, on iPad and desktop. Each size tab carries its result: pass calc's per-size results (`evaluation.result.perSize`) to `SizeTabs` and `SizeStatusStrip`. A CounterTable column's `status` is that table's own result (see the Changed list); with `limits` the chip and the spoken total follow the tap at once.
- **Tables use the width:** no table stops short of its frame and leaves the rest empty. CounterTable fills its frame: the label column takes what the fixed value columns leave (a stepper's width side by side, a one-line Accept / Reject limit's where one column shows), so stacked tables (defect classes) line up. The label column keeps at least 14 rem (16 rem from 1280 px), so a table wider than its frame (Safedon's boxes side by side) scrolls sideways with its labels readable instead of squeezing them; a table of one value column (labelling's, two levels side by side from 1280 px) lets its labels wrap to fit there instead. Do not add a minimum of your own. A long column of one value (weight's 13 gloves) flows into groups side by side (`MeasurementGrid`'s `flow`); a table of your own sizes its short columns to their contents, keeps each heading on one line and lines it up with its cells (the same padding, numbers right, text left), and gives a free-text column a share, not all that is left (dispensing's Others:).
- **Wording comes from the template:** `title` and `labels` from props, read with `labelFor(labels, ...)`, never typed into the code (6.2 rule 11). Every kit label prop takes the template's words.
- **Read-only:** pass `readOnly` through. Steppers become numbers, pickers and fields become text. A MeasurementGrid's readings stay readonly inputs on grey: Tab, the arrows and issue links still reach them, and typing and pastes are refused quietly. Size tabs and the hand toggle still work: they only change the view. Never wrap kit controls in a disabled fieldset: disabled controls leave the Tab order and refuse an issue link's focus.
- **No sideways scrolling inside a size panel on iPad.** A horizontal scroll container takes the swipe that turns the size, even when its content fits. Make per-size content fit 820 px. MeasurementGrid leaves sideways moves to the swipe while it fits its width; one that must scroll sideways keeps them, and the swipe then works outside it. A CounterTable with box columns (not following SizeTabs) scrolls sideways when the boxes do not fit: about three fit an iPad in portrait.
- **Not alone on the page:** a module may share its page with another (packing configuration below the order). Nothing in a Capture reaches outside its root: issue links, Enter, pastes and ids stay within it (the kit's own components do). A module shown below another (`SHOWN_WITH`) has no sticky size bar: it would stick over the frame above.
- **The capture screen sets** `--capture-sticky-top` (height of its own sticky bars, so the size bar sticks under them), `--capture-sticky-bottom` (anything stuck at the bottom), and a matching `scroll-padding-top` so a field reached with Enter or Tab never hides under a bar. SizeTabs sets `--size-tabs-bar` (its bar's height) for headers that stick below it.
- **Density:** 44 px targets and 16 px text on iPad come from the `touch:` variant inside each component, StatusPill's two sizes and SaveStatus included (a small pill is compact only with a mouse). Small print (a row's hint, a unit, "9 of 13") is 14 px on iPad. Do not shrink them to fit a row.

## Counts per size, with an optional hand split (watertight)

```tsx
import {
  CounterTable, HandToggle, handsOf, NumberField, SideBySideText, SizeBlock, SizeTabs, useDataUpdater,
  type CounterColumn, type HandView,
} from "@/components/qc";
import { formatSize } from "@/lib/format";
import { HANDS, isHandSplit, labelFor, samplingFor } from "@/modules/_framework";

const update = useDataUpdater(data, onChange);
const split = isHandSplit(definition, config);
const [size, setSize] = useState(context.sizes[0] ?? ""); // SizeTabs corrects it once sizes are ordered
const [hand, setHand] = useState<HandView>("both");
const columns: CounterColumn[] = context.sizes.map((s) => ({
  key: s,
  label: formatSize(s, { sizes: context.templateSizes }),
  name: formatSize(s, { sizes: context.templateSizes, prefix: true }), // "Size M" in stepper names
  n: samplingFor(context, s).watertightVisual,
  limits: evaluation?.computed.limits?.[s] ?? null, // from lib/aql in calc
  status: evaluation?.result.perSize?.[s]?.status, // one table per size: the size's result is the table's
}));

<SizeTabs
  sizes={context.sizes}
  templateSizes={context.templateSizes}
  value={size}
  onValueChange={(next) => { setSize(next); onFocusChange?.({ size: next }); }}
  results={evaluation?.result.perSize}
  wide="all"
  actions={split && <HandToggle value={hand} onValueChange={setHand} allowBoth />}
>
  {context.sizes.map((s) => (
    // Shown for the size on the tabs, and for every size where they sit side by side.
    <SizeBlock key={s} size={s} className="relative space-y-2">
      <NumberField label={<span>{labelFor(labels, "tested")}<SideBySideText>, size {s}</SideBySideText></span>} ... />
    </SizeBlock>
  ))}
  <CounterTable
    caption={title}
    rows={[
      ...config.locations.map((key) => ({ key, label: labelFor(labels, key) })),
      ...oneOffs.map((label) => ({ key: oneOffRowKey(label), label, unmapped: true, removable: true })),
    ]}
    columns={columns}
    activeColumn={size}
    hands={split ? HANDS : undefined}
    visibleHands={handsOf(hand)}
    getCount={({ row, column, hand }) => (hand ? data.sizes[column]?.[hand]?.holes[row] : data.sizes[column]?.holes[row])}
    onCountChange={(cell, count) => update((current) => setCount(current, cell, count))}
    labels={{
      rowHeader: labelFor(labels, "locations"),
      inspected: labelFor(labels, "tested"),
      limits: labelFor(labels, "defectLimit"),
      limitAccept: labelFor(labels, "accept"), // "Accept 3 / Reject 4"; without them "Ac 3 / Re 4"
      limitReject: labelFor(labels, "reject"),
      total: labelFor(labels, "total"),
      result: labelFor(labels, "result"),
    }}
    onAddRow={config.allowOther ? (label) => update((current) => addOneOff(current, label)) : undefined}
    onRemoveRow={readOnly ? undefined : (key) => update((current) => removeOneOff(current, key))}
    onCellFocus={({ column, hand, row }) => onFocusChange?.({ size: column, hand, defect: row })}
    cellIssuePath={({ column, hand, row }) => ["sizes", column, ...(hand ? [hand] : []), "holes", row]}
    readOnly={readOnly}
  />
</SizeTabs>
```

- `getCount` reads `data` (what is on screen); only writes go through `update`.
- Totals count every hand recorded, whichever is on screen. Columns can be boxes too (Safedon): `{ key: "253", label: "253", name: "Box/Carton #253" }`, with `summaryRows` for "1/125" and 0.008 (`formatRatio`, `formatRatioDecimal`). A column's `heading` (a control for its box/carton number, say) replaces its label in the heading cell; `label` and `name` still name it. Where the table shows one box at a time on the iPad layout, put a `ColumnSwitcher` beside it: Previous and Next with "Box/Carton #253 · 2 / 5", hidden where every column sits side by side.
- A one-off label is added unmapped (`unmapped: true`): the row shows a flag for the admin. Mark it `removable` too, with `onRemoveRow`: while it counts nothing in any column and hand, a remove button takes it off (one added by mistake), the table says so and keeps the focus on its "Other Defect" button; while that button's form is open, or where the table offers none, on the first count of the row taking the removed one's place (the row before, for the last row; the table, for its only row). Take it off only where it counts nothing, so no tapped count is lost.
- The limit row reads the template's words, `limitAccept` and `limitReject`. Where they do not fit the column it wraps after the slash, "Accept 10 /" over "Reject 11" (`formatLimitParts`), never before it; screen readers read the line in one piece. A class worded apart (STD_EG prints the critical limit "Acc. = 0 / Rej. = 1") reads them keyed class first, `criticalAccept` and `criticalReject`, as the dictionary keys class wording, else the word every class shares (visual's `limitWord`).

## One table per defect class (visual)

One `CounterTable` per class, each in a `ModuleSection` titled with the class ("Major Defects (AQL 2.5)"). Each table's chip is that class's result, not the size's:

```tsx
{classes.map((group) => (
  <ModuleSection key={group.key} title={labelFor(labels, group.key)} status={classResult(evaluation, size, group.key)}>
    <CounterTable
      caption={labelFor(labels, group.key)}
      rows={group.defects.map((code) => ({ key: code, label: labelFor(labels, group.key, code) }))} // minor.bead_defective, then bead_defective
      columns={context.sizes.map((s) => ({
        key: s,
        label: formatSize(s, { sizes: context.templateSizes }),
        name: formatSize(s, { sizes: context.templateSizes, prefix: true }),
        n: samplingFor(context, s).watertightVisual,
        limits: classLimits(evaluation, s, group.key), // calc's Ac/Re for this class (lib/aql)
        status: classResult(evaluation, s, group.key), // calc's result for this class and size, from your `computed`
      }))}
      activeColumn={size}
      ...
    />
  </ModuleSection>
))}
```

`classResult` and `classLimits` read your own `computed` shape. Leave `status` out if calc has no per-class result: the table then decides from `limits` alone. The size's worst result (`evaluation.result.perSize`) goes on the size tabs only.

## Per-size rows with box numbers (dispensing, labelling)

```tsx
<SizeTabs sizes={context.sizes} value={size} onValueChange={setSize} results={evaluation?.result.perSize}>
  {(s) => (
    <>
      <EnterGroup className="overflow-clip rounded-lg border border-border bg-card">
        <table>{/* one row per box */}
          <BoxNumberField variant="cell" group="box" id={`box-${s}-${i}`}
            label={`${labelFor(labels, "box")}, item ${i + 1}`} value={row.box}
            cartons={cartonsFor(context, s)} used={rows.map((r) => r.box)}
            onValueChange={(box) => update((current) => setBox(current, s, i, { box }))}
            onInvalidChange={(entry) => setRejected(`box-${s}-${i}`, entry)}
            error={boxIssue?.level === "error" ? boxIssue.message : null}
            warning={boxIssue?.level === "warning" ? boxIssue.message : null}
            onFocus={() => onFocusChange?.({ size: s, box: row.box ?? undefined })}
            issuePath={["sizes", s, "boxes", i, "box"]} readOnly={readOnly} />
          <PercentField variant="cell" group="layering" id={`layering-${s}-${i}`}
            label={`${labelFor(labels, "layering")}, item ${i + 1}`} value={row.layering}
            onValueChange={(layering) => update((current) => setBox(current, s, i, { layering }))}
            onInvalidChange={(entry) => setRejected(`layering-${s}-${i}`, entry)}
            issuePath={["sizes", s, "boxes", i, "layering"]} readOnly={readOnly} />
        </table>
      </EnterGroup>
      <EntryProblems problems={/* rejected entries whose cell is still null, with inputId for the link */} />
      <RequirementList caption={`${title}, size ${s}`}
        labels={{ value: labelFor(labels, "average"), spec: labelFor(labels, "spec"), result: labelFor(labels, "result") }}
        items={[{ key: "layering", label: labelFor(labels, "layering"), value: evaluation?.computed.layering?.[s] ?? null,
          unit: "%", decimals: 0, spec: { kind: "min", min: config.minLayering } }]} />
    </>
  )}
</SizeTabs>
```

- `BoxNumberField` is a NumberField for a box/carton number: a whole number from 1 on the numeric keypad (`inputMode="numeric"`), Enter walking its `group` and a pasted column filling down it, refused text listed with `EntryProblems` as any cell's. With `cartons` (the size's sampled numbers, `cartonsFor(context, size)`) it suggests those holding the digits typed, ascending, the ones in `used` by other rows marked; a tap, or the arrows and Enter, fills one in, and typing never waits for the list (6.2 rule 7; Kenneth, 13 October 2026: box # and carton # are one number). A number the list does not hold is stored as typed and calc warns about it (`boxNotSampledIssue`): pass `boxIssue` (`findIssue` on the field's path) as `error` or `warning` by its level, and list it under the table with a link.
- `group="layering"` makes Enter walk down that column and a pasted column fill down it. A named group is one column: a block copied from a spreadsheet fills it from its first column, and the field says the other columns were left out. Without `group`, fields in one `EnterGroup` form one run in reading order, and a block fills it row by row. Values past the run's last field are listed on screen as not stored, across the foot of the `EnterGroup` for cells and for fields in a named `group`, under the field otherwise.
- A paste is one change: each field judges its own value (its `min`, `max`, `integer`), rejected text stays on screen with its reason, and `update` hands the module one `onChange` with every value.
- With `issuePath`, the screen's `RefusedEntryStore` keeps a rejected entry through a size switch, a section switch and a reload, and the field calls `onInvalidChange` with it again when it comes back: `setRejected`, and your `EntryProblems` list, hear of it after a reload too.
- `label` may be an element; plain text is better in a table cell (it becomes the cell's name directly).

## A column of readings (dimensions, weight, force at break)

```tsx
<SizeTabs sizes={context.sizes} value={size} onValueChange={setSize} results={evaluation?.result.perSize}>
  {(s) => (
    <MeasurementGrid
      caption={sizeHeading}
      rows={rowsFor(context, s, config)} // the sampling plan's n, else the template's
      measures={config.measures.map((measure) => ({
        key: measure,
        label: labelFor(labels, measure),
        unit: "mm",
        decimals: config.decimals[measure],
        spec: specFor(config, s, measure),
        min: 0,
        minExclusive: true, // calc refuses 0 mm: so does the cell ("Must be more than 0.")
        summary: summaryOf(evaluation?.computed, s, measure), // { statistic, outcome, count } from your computed
      }))}
      values={columnsOf(data, s)}
      onCellsChange={(changes) => update((current) => withReadings(current, s, changes))}
      statistic={config.statistic}
      labels={{ row: labelFor(labels, "rowNo"), statistic: labelFor(labels, "statistic"), spec: labelFor(labels, "specRow"),
        result: labelFor(labels, "measureResult"), pass: labelFor(labels, "pass"), fail: labelFor(labels, "fail") }}
      cellIssuePath={({ row, measure }) => ["sizes", s, "gloves", row, measure]}
      readOnly={readOnly}
    />
  )}
</SizeTabs>
```

- `onCellsChange` hands over only the cells a change touched, `{ row, measure, value }[]`: one for a typed reading, every pasted cell for a paste, in one call. Write them onto `current`; never rebuild columns from `values`, which may be a render behind. Keep readings past the grid's rows (the plan may grow again).
- With `cellIssuePath`, refused readings are kept in the screen's `RefusedEntryStore`, by each cell's path: a size switch, a section switch or a reload brings the red cells and their list under the grid back, until a number lands in the cell. Without it the grid keeps them while it is on screen.
- `summary` puts calc's figures in the footer: the statistic (printed at `decimals`), "9 of 13" while `count` is short of the rows, and the verdict. Without it the grid summarises its own cells, which disagrees with calc wherever calc refuses a stored reading (a 0 saved another way). A measure without a spec to judge by shows `labels.na`.
- The label column is as wide as the longest footer caption ("Passed / Failed" stays on one line), up to 16 rem.
- `flow` (one measure only): the rows in up to three groups side by side, each a few rows tall with its own headings and a narrow glove-number column, and the footer's three rows side by side across the foot (a caption stays on one line; its figure goes under it where the room runs out). For a long column of readings that would run down one side of a wide screen: weight's and force at break's.
- Read-only, the readings stay readonly inputs on grey: Tab, the arrows and Enter move through them, issue links land on them, typing and pastes are refused without a word.
- A reading with no cell (past the plan's n) has its message marked with `issueNoticeProps(issue.path)`, so the issue link lands on the message, beside the button that removes those readings.
- A paste longer than the grid lists, under it, the values that did not fit and were not stored. Readings you keep past the last row (handed back in `values`, as force at break keeps a paste's overflow) are yours to report: the grid leaves them out of its list. It judges once, in its first render after the paste, so hand them back in the same event (write with `update` in `onCellsChange`); taking them away later (force at break's Clear) never adds them to the list.
- `onCellFocus({ row, measure })` reports the cell that took the focus. Photo tags need only the size: tag it when the focus enters the grid, not on every move between its cells.

## Single values

```tsx
<EnterGroup className="grid gap-4 sm:grid-cols-2">
  <NumberField label={labelFor(labels, "tensile")} unit="MPa" decimals={2} min={0} value={data.sizes[s]?.tensile ?? null}
    onValueChange={(tensile) => update((current) => setSizeEntry(current, s, { tensile }))} hint={labelFor(labels, "tensileHint")}
    error={findIssue(evaluation?.issues, ["sizes", s, "tensile"])?.message} issuePath={["sizes", s, "tensile"]}
    readOnly={readOnly} />
  <PercentField label={labelFor(labels, "elongation")} max={2000} value={...} onValueChange={...} />
</EnterGroup>
<SpecValue label={labelFor(labels, "average")} value={6.537} decimals={3} unit="N" spec={{ kind: "min", min: 6 }} />
```

- Numbers only: "2 42", text, out-of-range and (with `integer`) decimals are rejected; the stored value becomes `null` and the text stays on screen with its reason. With `issuePath` it stays through a size or section switch and a reload (the screen's `RefusedEntryStore`), and `onInvalidChange` hears of it again when the field comes back. Enter moves on; Shift+Enter moves back; the iPad keyboard shows Next inside a group. `minExclusive` refuses `min` itself, for a value that must be more than it (a weight more than 0 g).
- `error` shows calc's error for a stored value in red; `warning` (one message or several) shows calc's warnings in amber, one line each with the warning icon, an amber edge, and the field described by them: a sample below the plan, a packing count that does not match. `findIssue(issues, path)` picks the issue pointing at that field, errors first.
- A value is judged at the precision it is shown (`decimals`), as MeasurementGrid does: 13.996 at two decimals is 14.00 and meets ≥ 14.00. Missing is Not Done, never Passed; a spec of NA shows no verdict.
- A date is a `DateField` (6.2 rule 3): the browser's own picker, four-digit years, `"YYYY-MM-DD"` or null, with `error`, `warning` and `issuePath` as NumberField has; other attributes (`onKeyDown`, `enterKeyHint`) pass to the input.
- A tapped count that may be not entered yet is a `CountField`: one button sets the start (`startLabel` "13 as Planned", or `onStart` for an edit of your own such as "No Leaks"), then a Stepper and a clear button back to not entered, so not entered never reads as 0 (6.2 rule 5).
- A lab report or certificate shows as `AttachmentStatus` with calc's state for the file the module keeps, with `ModuleFileSlot` as its children since 12 October 2026 (the file Steri-AI linked from Source Documents, or "No lab report detected by Steri-AI."; nothing is attached by hand), as calc reads it: `moduleFileState(context, { moduleKey, kind, fileId: data.labReport })` for a module's one file, `heldFileState(context, id)` for a file kept per entry (MODULES.md section 10.1). It reads attached (by name when the screen knows it), not attached, or missing: kept, but not among the inspection's files (deleted, or still uploading from another device), never Attached. Pass calc's message about it as `warning` (amber); a missing file without one still says so. A `required` file not attached reads Not Done and says why. The line has no frame: it sits in the module's section beside the screen's file slot (`ModuleFileSlot`), which attaches the file. With no control of its own, it takes an issue link's focus itself.

## Issue links (`focusPath`)

```tsx
const root = useRef<HTMLDivElement>(null);
useIssueFocus(focusPath, {
  root,
  reveal: (path) => {
    // size_not_ordered and size_duplicate issues point at sizes that are not on screen: stay put.
    if (path[0] === "sizes" && typeof path[1] === "string" && context.sizes.includes(path[1])) setSize(path[1]);
    const pathHand = path[2];
    if (pathHand === "R" || pathHand === "L") setHand((view) => (view === "both" ? view : pathHand));
  },
});
return <div ref={root}>...</div>;
```

Mark the control that holds each value with the path an issue would carry: `issuePath` on `NumberField` (`BoxNumberField` too, its warning about a number not sampled included), `DateField`, `CountField`, `ModuleSection`, `AttachmentStatus` and `RequirementList` items, `cellIssuePath` on `CounterTable` and `MeasurementGrid`, or `{...issuePathProps(path)}` on anything else. The hook switches size or hand first, then scrolls to the closest marked element (the exact path, else its nearest parent) and focuses it: a control itself, a container's first control.

A message with no control of its own (readings past the plan, a deviation from the indicative weight, a sampling plan too large) is marked with `{...issueNoticeProps(path)}` and given a visible focus style (`outline-none focus-ring`): it takes the focus itself (tabIndex -1, out of the Tab order), so a screen reader reads it and Tab goes on to its button. `AttachmentStatus` marks itself this way when given an `issuePath`. Where a notice and a container (the size's panel) carry the same path, the link lands on the notice.

It runs once for each new `focusPath` array, so pass the prop straight through. A path made with `revealOnlyPath(path)` only calls `reveal` (size, hand, box) and focuses nothing: the capture screen uses it to land on the last field after a reload without bringing up the iPad's keyboard. The capture screen sets a new array for every click on an issue (`setFocusPath([...issue.path])`) and keeps it in state: a second click on the same issue then works, and a re-render does nothing.

## Photo tags (`onFocusChange`)

Report what is in focus whenever it changes: the size from `SizeTabs`, the hand from `HandToggle`, `{ size, hand, defect }` from `CounterTable`'s `onCellFocus` (a cell reports itself when it takes focus, when it is pressed, and on every change of its count, a held button or a key: Safari and Chrome on the iPad never focus a tapped button), `{ size, box }` from a box/carton number field's `onFocus` (a tapped input takes the focus, on the iPad too; a suggestion picked reports the box through the module's `onValueChange`), and the size from `NumberField`'s `onFocus` and MeasurementGrid's `onCellFocus`. `CaptureFocus.level` is labelling's packaging level (`"inner"` or `"carton"`) and `item` an entry of a module's own list (a document, a loading stage); the photos taken then carry them, and the screen words them in the template's words in `PhotoTags.level`, `item` and `tagLine`. A module whose focus is a choice of its own (loading's stage picker, documents' rows) says once, beside the choice, what new photos are tagged with, never inside a row that would grow under the finger.

## Text: `lib/format`

| Helper | Gives |
|---|---|
| `formatSpec(spec, { unit, decimals })` | `≥ 240`, `80 ± 10`, `≤ 5%`, `≥ 14.00 MPa`, `0.05 – 0.10`, `NA` |
| `formatNumber(v, { decimals, maxDecimals, grouping, unit, empty })` | `2.90 g`, `0.48`, `5,800,000`; rounded like Excel's ROUND; without decimals no binary noise (0.1 + 0.2 is `0.3`) |
| `formatCount`, `formatPercent`, `toPercent` | `5,800,000`, `88%` (value already in percent), 0.0048 to 0.48 |
| `formatRate(defects, inspected, { grouping })` | `3 / 625 (0.48%)`, `11 / 1,000 (1.1%)` (counts grouped as every count the app prints; `grouping: false` gives the report's `11 / 1000`) |
| `formatRatio(1, 125)`, `formatRatioDecimal(1, 125)`, `ratio` | `1/125`, `0.008` (per box) |
| `formatLimits({ ac, re }, { style, accept, reject })`, `formatLimitParts` | `Ac 3 / Re 4`; with the template's words `Accept 3 / Reject 4`, `Acc. = 0 / Rej. = 1` (blank words fall back to the style's); the parts are the halves a narrow cell wraps between, `Accept 3 /` and `Reject 4` |
| `formatSize(size, { sizes, prefix })`, `formatSizeList`, `formatHand`, `formatSizeHand` | `M`, `Medium`, `Size 7.0`, `Size M, Right Hand` |
| `fillCaption(caption, values)`, `formatCodeLetters(letters, { empty })`, `plainLabel(label)` | `{codeLetters}` filled in; `J & L`, `C, D & E`; `Layering %` as `Layering` |

Show computed numbers with `Figure` (tabular figures, unit in secondary text, a dash read as "No value" when missing), with the template's `decimals` where the report fixes them.

`lib/format` is for display. Calc stays with `lib/stats` and `lib/aql` (MODULES.md section 1); `formatSpec` and `formatCount` print the same text as lib/stats' `formatSpec` and lib/aql's `formatCount`, so an auto-import of either is harmless, and only `lib/format`'s take a unit, decimals or a missing value. The caption helpers are the copies watertight, visual, labeling and both dispensing modules keep in their own folders; they are pure (lib/stats and lib/aql only), ready for calc once MODULES.md section 1 lists `@/lib/format`.

## Behaviour at a glance

| Component | Keyboard | Touch | Notes |
|---|---|---|---|
| `SizeTabs` | Arrow keys, Home, End (automatic activation, wraps) | Swipe the panel left or right (64 px, mostly horizontal; never from the field being edited) | A half-typed value is stored for its own size before the panel changes |
| `HandToggle` | Arrow keys (radio group) | Tap | `handsOf(view)` gives the hands to show |
| `CounterTable` | Stepper keys: arrows, Page, Home, End | Tap and hold to repeat; a finger that slides away (a swipe) counts nothing | Live total and chip; each tap is spoken with the new total and the chip's verdict; sticky header and totals; taking a one-off row off keeps the focus in the table; a cell reports itself for photo tags on focus, on a press and on every count change |
| `BoxNumberField` | Type digits; Down and Up choose a suggestion, Page Up and Page Down the ends, Enter fills it in and walks on; Enter with none chosen stores what was typed; Escape drops the edit | Numeric keypad; tap a suggestion, the keypad stays up | The size's sampled numbers holding the digits typed, ascending, those in other rows marked Used; a click (mouse, trackpad) picks one too; 44 px rows on touch; a list capped to the space on screen; no list, no suggestions |
| `NumberField` | Enter, Shift+Enter, Escape restores | Decimal keypad; the numeric keypad with `inputMode="numeric"` (`BoxNumberField`) | Paste a column to fill down the group, as one change; what did not fit is listed under the field (or the group's table) until Dismiss; with `issuePath` a refused entry outlives the field |
| `MeasurementGrid` | Enter down the column, then the next; arrows; Escape restores | Decimal keypad; swipe turns the size while the grid fits | Paste a column or block from the focused cell, as one `onCellsChange`; what did not fit is listed under the grid until Dismiss; read-only keeps the keys and refuses edits; with `cellIssuePath` refused cells outlive the grid |
| `ColumnSwitcher` | Previous and Next stay focusable at the ends (aria-disabled) | 44 px buttons | Says "Box/Carton #253 · 2 / 5" as it changes; hidden on the desktop layout (`xl`) |
| `CountField` | Stepper keys; start and clear hand focus to each other | Tap and hold to repeat | Not entered until the start button is pressed |
| `RichTextEditor` | The toolbar is one Tab stop (arrow keys inside); ⌘/Ctrl+B, I, U; Shift+⌘/Ctrl+S, H, 8, 7, L, E, R, J; ⌘/Ctrl+Z, Shift+⌘/Ctrl+Z; ⌘/Ctrl+\ clears formatting; Shift+Enter a line break; "- " and "1. " start lists; Tab leaves the text (lists are one level) | 44 px controls; a press never takes the focus, so the keyboard stays up; a menu opened by a finger leaves the focus in the text; iPadOS's B, I, U menu works | The toolbar's groups are split by hairlines, in one row where it fits, never a line at a row's end; it sticks under the screen's bars and the caret is kept clear of it and of the keyboard; a counter from 4,500 characters (amber at 5,000); pasted fonts, sizes, colours and highlights are dropped, bold, italic, underline, lists and alignment kept; Word's bullets paste as plain lines; a document put in through the ref (`insertDocument`) is one undo step that moves neither the focus nor the page; `busy` locks the text and the toolbar and keeps the history |

The kit was checked in a browser at 820 x 1180 and 1180 x 820 with touch and at 1440 x 900, on a harness that follows CaptureProps (the screen replaces data on `onChange`, modules write through `useDataUpdater`): a pasted column stored in one change, a two-column block into one column, the spoken verdict at the Ac/Re boundary with calc lagging, class tables beside a failing class, stale and unordered sizes, a repeated issue link, the hand split on desktop, sticky headers, swipes on panels, steppers and a measurement grid, the box picker, 44 px targets, 16 px text on touch and no sideways page scroll. On 7 October the modules that use the kit were checked the same way: a read-only grid reached by an issue link and walked with the arrows while typing and a paste changed nothing; a typed reading and a pasted column each landing as one change, calc's median and verdict in the footer, 0 refused at the cell; issue links landing on a reading's cell, on the warning for readings past the plan and on the weight deviation note; "Passed / Failed" on one line; a one-off row taken off with the focus kept; Next held at the last Safedon box; the limit row in the template's words; amber warnings on fields; 16 px pills on touch. The review fixes were checked the same way: a one-off row taken off with the add form open (its draft kept), in a table without one and as a table's only row, the focus landing on the next row's count, the row before and the table; limit rows wrapping after the slash in a 160 px and a 128 px column; SaveStatus at 16 px on touch; an issue link landing on a missing file's line. The pure rules (paste plans, the one-change paste, a paste into a read-only cell, the size fallback, the chip and what is spoken, where an issue link lands, where the focus goes when a row comes off, the box list reporting focus as it opens, the column switcher's ends, the exclusive minimum, formatting) have unit tests in `components/qc` and `lib/format`.

Element screenshots taller than the viewport make Playwright drop its touch emulation (`pointer: coarse` stops matching), so a check of touch sizes shoots in a viewport as tall as the page.
