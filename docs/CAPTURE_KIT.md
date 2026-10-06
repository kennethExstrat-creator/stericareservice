# Capture kit

Shared building blocks for every module's `Capture.tsx` (`docs/MODULES.md` section 10), so all sixteen modules look and behave the same and the look is tuned in one place. Capture renders the module body only; the screen wraps it in `ModuleCard`. Import components from `@/components/qc` and text helpers from `@/lib/format`. Check here before writing a control of your own.

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
| Right / left hand (`handSplit`) | `HandToggle` in SizeTabs' `actions` | two copies of the UI |
| Counts: defects, hole locations, labelling checks, Safedon per-box defects | `CounterTable` (or `DefectChipGroup`, chips without a table) | typed counts (BUILD_SPEC 8: no typing for counts) |
| A column of readings per glove (dimensions, force at break, weight x 13) | `MeasurementGrid` | rows of fields |
| One measured or entered number (tensile average, qty, indicative weight) | `NumberField`, `PercentField`, in an `EnterGroup` | `<input type="number">` |
| A box or carton number (dispensing, labelling) | `BoxPicker` | a number field (6.2 rule 7) |
| A computed value against its spec, with the verdict | `RequirementList`; `SpecValue` inline; `Figure` for a bare number | hand-built text |
| A part of the module body (a defect class, a level) | `ModuleSection` | your own heading and spacing |
| Entries rejected in your own table of fields | `EntryProblems` | a custom error list |
| A link from the issue list to the field | `useIssueFocus` with `issuePathProps` / `issuePath` / `cellIssuePath` | scrolling by hand |
| Text for specs, rates, limits, sizes, numbers | `lib/format` | template strings |

## Layout conventions

- **Order of the body:** `SizeTabs` first (sticky), then `ModuleSection`s inside it. Keep content inside SizeTabs so the size bar stays stuck over it.
- **Sizes:** only `context.sizes`, in that order (6.2 rule 4). Tabs on iPad (below 1280 px). On desktop use `wide="all"` where sizes read better side by side (counts, short per-size blocks): SizeTabs shows them side by side only while they fit, and keeps its tabs otherwise (a CounterTable reports the width it needs, so a hand split or many sizes stay on tabs). Keep `wide="tabs"` where a size fills the width (dimension grids, 13-row packing tables).
- **The size on screen:** SizeTabs shows `value` when it is ordered, else the first ordered size, and calls `onValueChange` with that size, so a state that went stale (a size taken out of the order, `useState(context.sizes[0] ?? "")` before sizes exist) corrects itself. A CounterTable given `activeColumn` in SizeTabs' panel (SizeTabs' children as a node, as in the counts example, not a per-size function) shows the size the tabs show, in the same layout. HandToggle likewise reports "R" for a "both" it does not offer.
- **R and L sit under the size:** sub-columns of each size in `CounterTable` (`hands`), headed "Right" and "Left" (size L sits in the same bar, so never a bare "L"), switched by `HandToggle` (Right, Left, Both).
- **Totals and accept chips are always visible:** a CounterTable given `activeColumn` in SizeTabs' panel never scrolls sideways, so its header rows stick below the size bar and its totals row to the bottom of the screen while the table is in view, on iPad and desktop. Each size tab carries its result: pass calc's per-size results (`evaluation.result.perSize`) to `SizeTabs` and `SizeStatusStrip`. A CounterTable column's `status` is that table's own result (see the Changed list); with `limits` the chip and the spoken total follow the tap at once.
- **Compact tables:** CounterTable's label column is 16 rem and each value column fixed, so a label sits next to its steppers and stacked tables (defect classes) line up; the table is only as wide as its columns.
- **Wording comes from the template:** `title` and `labels` from props, read with `labelFor(labels, ...)`, never typed into the code (6.2 rule 11). Every kit label prop takes the template's words.
- **Read-only:** pass `readOnly` through. Steppers become numbers, pickers and fields become text. Size tabs and the hand toggle still work: they only change the view.
- **No sideways scrolling inside a size panel on iPad.** A horizontal scroll container takes the swipe that turns the size, even when its content fits. Make per-size content fit 820 px. MeasurementGrid leaves sideways moves to the swipe while it fits its width; one that must scroll sideways keeps them, and the swipe then works outside it. A CounterTable with box columns (not following SizeTabs) scrolls sideways when the boxes do not fit: about three fit an iPad in portrait.
- **The capture screen sets** `--capture-sticky-top` (height of its own sticky bars, so the size bar sticks under them), `--capture-sticky-bottom` (anything stuck at the bottom), and a matching `scroll-padding-top` so a field reached with Enter or Tab never hides under a bar. SizeTabs sets `--size-tabs-bar` (its bar's height) for headers that stick below it.
- **Density:** 44 px targets and 16 px text on iPad come from the `touch:` variant inside each component. Do not shrink them to fit a row.

## Counts per size, with an optional hand split (watertight)

```tsx
import { CounterTable, HandToggle, handsOf, SizeTabs, useDataUpdater, type CounterColumn, type HandView } from "@/components/qc";
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
  <CounterTable
    caption={title}
    rows={config.locations.map((key) => ({ key, label: labelFor(labels, key) }))}
    columns={columns}
    activeColumn={size}
    hands={split ? HANDS : undefined}
    visibleHands={handsOf(hand)}
    getCount={({ row, column, hand }) => (hand ? data.sizes[column]?.[hand]?.holes[row] : data.sizes[column]?.holes[row])}
    onCountChange={(cell, count) => update((current) => setCount(current, cell, count))}
    labels={{
      rowHeader: labelFor(labels, "locations"),
      inspected: labelFor(labels, "tested"),
      limits: labelFor(labels, "limit"),
      total: labelFor(labels, "total"),
      result: labelFor(labels, "result"),
    }}
    onAddRow={config.allowOther ? (label) => update((current) => addOneOff(current, label)) : undefined}
    onCellFocus={({ column, hand, row }) => onFocusChange?.({ size: column, hand, defect: row })}
    cellIssuePath={({ column, hand, row }) => ["sizes", column, ...(hand ? [hand] : []), "holes", row]}
    readOnly={readOnly}
  />
</SizeTabs>
```

- `getCount` reads `data` (what is on screen); only writes go through `update`.
- Totals count every hand recorded, whichever is on screen. Columns can be boxes too (Safedon): `{ key: "253", label: "Box 253", name: "box 253" }`, with `summaryRows` for "1/125" and 0.008 (`formatRatio`, `formatRatioDecimal`).
- A one-off label is added unmapped (`unmapped: true`): the row shows a flag for the admin.

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
          <BoxPicker variant="cell" label={`${labelFor(labels, "box")}, item ${i + 1}`} sizeLabel={`size ${s}`}
            value={row.box} cartons={cartonsFor(context, s)} used={rows.map((r) => r.box)}
            onValueChange={(box) => update((current) => setBox(current, s, i, { box }))}
            onFocus={() => onFocusChange?.({ size: s, box: row.box ?? undefined })}
            issuePath={["sizes", s, "boxes", i, "box"]} readOnly={readOnly} />
          <PercentField variant="cell" group="layering" id={`layering-${s}-${i}`}
            label={`${labelFor(labels, "layering")}, item ${i + 1}`} value={row.layering}
            onValueChange={(layering) => update((current) => setBox(current, s, i, { layering }))}
            onInvalidChange={(entry) => setRejected(`layering-${s}-${i}`, entry)} readOnly={readOnly} />
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

- `BoxPicker` offers `context.cartons[size]` ascending, with search (type the digits and Enter on desktop, tap on iPad), marks boxes picked in other rows (still pickable: one carton holds many inner boxes), and shows a stored box that is not in the list as an error until replaced. With no carton list yet it takes a typed box number and does not flag it (MODULES.md section 7). Store the number, never an index.
- `group="layering"` makes Enter walk down that column and a pasted column fill down it. A named group is one column: a block copied from a spreadsheet fills it from its first column, and the field says the other columns were left out. Without `group`, fields in one `EnterGroup` form one run in reading order, and a block fills it row by row.
- A paste is one change: each field judges its own value (its `min`, `max`, `integer`), rejected text stays on screen with its reason, and `update` hands the module one `onChange` with every value.
- `label` may be an element; plain text is better in a table cell (it becomes the cell's name directly).

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

- Numbers only: "2 42", text, out-of-range and (with `integer`) decimals are rejected; the stored value becomes `null` and the text stays on screen with its reason. Enter moves on; Shift+Enter moves back; the iPad keyboard shows Next inside a group.
- `error` shows calc's message for a stored value (out of spec, more than 10% from the indicative weight); `findIssue(issues, path)` picks the issue pointing at that field, errors first.
- A value is judged at the precision it is shown (`decimals`), as MeasurementGrid does: 13.996 at two decimals is 14.00 and meets ≥ 14.00. Missing is Not done, never Passed; a spec of NA shows no verdict.

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

Mark the control that holds each value with the path an issue would carry: `issuePath` on `BoxPicker`, `NumberField`, `ModuleSection` and `RequirementList` items, `cellIssuePath` on `CounterTable`, or `{...issuePathProps(path)}` on anything else. The hook switches size or hand first, then scrolls to the closest marked control (the exact path, else its nearest parent) and focuses it.

It runs once for each new `focusPath` array, so pass the prop straight through. The capture screen sets a new array for every click on an issue (`setFocusPath([...issue.path])`) and keeps it in state: a second click on the same issue then works, and a re-render does nothing.

## Photo tags (`onFocusChange`)

Report what is in focus whenever it changes: the size from `SizeTabs`, the hand from `HandToggle`, `{ size, hand, defect }` from `CounterTable`'s `onCellFocus`, `{ size, box }` from `BoxPicker`'s `onFocus`, and the size from `NumberField`'s `onFocus`.

## Text: `lib/format`

| Helper | Gives |
|---|---|
| `formatSpec(spec, { unit, decimals })` | `≥ 240`, `80 ± 10`, `≤ 5%`, `≥ 14.00 MPa`, `0.05 – 0.10`, `NA` |
| `formatNumber(v, { decimals, maxDecimals, grouping, unit, empty })` | `2.90 g`, `0.48`, `5,800,000`; rounded like Excel's ROUND; without decimals no binary noise (0.1 + 0.2 is `0.3`) |
| `formatCount`, `formatPercent`, `toPercent` | `5,800,000`, `88%` (value already in percent), 0.0048 to 0.48 |
| `formatRate(defects, inspected)` | `3 / 625 (0.48%)`, `11 / 1000 (1.1%)` |
| `formatRatio(1, 125)`, `formatRatioDecimal(1, 125)`, `ratio` | `1/125`, `0.008` (per box) |
| `formatLimits({ ac, re }, { style, accept, reject })` | `Ac 3 / Re 4`, `Accept 3 / Reject 4`, `Acc. = 0 / Rej. = 1` |
| `formatSize(size, { sizes, prefix })`, `formatSizeList`, `formatHand`, `formatSizeHand` | `M`, `Medium`, `Size 7.0`, `Size M, right hand` |

Show computed numbers with `Figure` (tabular figures, unit in secondary text, a dash read as "No value" when missing), with the template's `decimals` where the report fixes them.

`lib/format` is for display. Calc stays with `lib/stats` and `lib/aql` (MODULES.md section 1); `formatSpec` and `formatCount` print the same text as lib/stats' `formatSpec` and lib/aql's `formatCount`, so an auto-import of either is harmless, and only `lib/format`'s take a unit, decimals or a missing value.

## Behaviour at a glance

| Component | Keyboard | Touch | Notes |
|---|---|---|---|
| `SizeTabs` | Arrow keys, Home, End (automatic activation, wraps) | Swipe the panel left or right (64 px, mostly horizontal; never from the field being edited) | A half-typed value is stored for its own size before the panel changes |
| `HandToggle` | Arrow keys (radio group) | Tap | `handsOf(view)` gives the hands to show |
| `CounterTable` | Stepper keys: arrows, Page, Home, End | Tap and hold to repeat; a finger that slides away (a swipe) counts nothing | Live total and chip; each tap is spoken with the new total and the chip's verdict; sticky header and totals |
| `BoxPicker` | Type digits, arrows, Enter, Escape | Tap a box; keyboard stays down | List capped to the space on screen |
| `NumberField` | Enter, Shift+Enter, Escape restores | Decimal keypad | Paste a column to fill down the group, as one change |

The kit was checked in a browser at 820 x 1180 and 1180 x 820 with touch and at 1440 x 900, on a harness that follows CaptureProps (the screen replaces data on `onChange`, modules write through `useDataUpdater`): a pasted column stored in one change, a two-column block into one column, the spoken verdict at the Ac/Re boundary with calc lagging, class tables beside a failing class, stale and unordered sizes, a repeated issue link, the hand split on desktop, sticky headers, swipes on panels, steppers and a measurement grid, the box picker, 44 px targets, 16 px text on touch and no sideways page scroll. The pure rules (paste plans, the one-change paste, the size fallback, the chip and what is spoken, formatting) have unit tests in `components/qc` and `lib/format`.
