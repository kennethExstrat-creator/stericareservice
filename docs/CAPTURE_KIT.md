# Capture kit

Shared building blocks for every module's `Capture.tsx` (`docs/MODULES.md` section 10), so all sixteen modules look and behave the same and the look is tuned in one place. Capture renders the module body only; the screen wraps it in `ModuleCard`. Import components from `@/components/qc` and text helpers from `@/lib/format`. Check here before writing a control of your own.

## Which component for what

| Need | Use | Instead of |
|---|---|---|
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
- **Sizes:** only `context.sizes`, in that order (6.2 rule 4). Tabs on iPad (below 1280 px). On desktop use `wide="all"` where sizes read better side by side (counts, short per-size blocks); keep tabs where a size fills the width (dimension grids, 13-row packing tables).
- **R and L sit under the size:** sub-columns of each size in `CounterTable` (`hands`), switched by `HandToggle` when they do not fit.
- **Totals and accept chips are always visible:** `CounterTable`'s footer sticks to the bottom of the iPad screen while the table is in view, and each size tab carries its result. Pass calc's results (`evaluation.result.perSize`) to `SizeTabs` and as each column's `status`; the table's own live decision (total vs Ac) only fills in until calc has run.
- **Wording comes from the template:** `title` and `labels` from props, never typed into the code (6.2 rule 11). Every kit label prop takes the template's words.
- **Read-only:** pass `readOnly` through. Steppers become numbers, pickers and fields become text. Size tabs and the hand toggle still work: they only change the view.
- **No sideways scrolling inside a size panel on iPad.** A horizontal scroll container takes the swipe that turns the size, even when its content fits (checked in Chromium). Make per-size content fit 820 px; where a wide table must scroll on desktop use `overflow-clip xl:overflow-x-auto`, as `CounterTable` does with `activeColumn`.
- **The capture screen sets** `--capture-sticky-top` (height of its own sticky bars, so the size bar sticks under them), `--capture-sticky-bottom` (anything stuck at the bottom), and a matching `scroll-padding-top` so a field reached with Enter or Tab never hides under a bar.
- **Density:** 44 px targets and 16 px text on iPad come from the `touch:` variant inside each component. Do not shrink them to fit a row.

## Counts per size, with an optional hand split (watertight, visual)

```tsx
import { CounterTable, HandToggle, handsOf, SizeTabs, type CounterColumn, type HandView } from "@/components/qc";
import { formatSize } from "@/lib/format";
import { HANDS, isHandSplit, samplingFor } from "@/modules/_framework";

const split = isHandSplit(definition, config);
const [size, setSize] = useState(context.sizes[0] ?? "");
const [hand, setHand] = useState<HandView>("both");
const columns: CounterColumn[] = context.sizes.map((s) => ({
  key: s,
  label: formatSize(s, { sizes: context.templateSizes }),
  name: formatSize(s, { sizes: context.templateSizes, prefix: true }), // "Size M" in stepper names
  n: samplingFor(context, s).watertightVisual,
  limits: evaluation?.computed.limits?.[s] ?? null, // from lib/aql in calc
  status: evaluation?.result.perSize?.[s]?.status,
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
    rows={config.locations.map((key) => ({ key, label: labels[key] }))}
    columns={columns}
    activeColumn={size}
    hands={split ? HANDS : undefined}
    visibleHands={handsOf(hand)}
    getCount={({ row, column, hand }) => (hand ? data.sizes[column]?.[hand]?.holes[row] : data.sizes[column]?.holes[row])}
    onCountChange={(cell, count) => onChange(setCount(data, cell, count))}
    labels={{ rowHeader: labels.locations, inspected: labels.tested, limits: labels.limit, total: labels.total, result: labels.result }}
    onAddRow={config.allowOther ? (label) => onChange(addOneOff(data, label)) : undefined}
    onCellFocus={({ column, hand, row }) => onFocusChange?.({ size: column, hand, defect: row })}
    cellIssuePath={({ column, hand, row }) => ["sizes", column, ...(hand ? [hand] : []), "holes", row]}
    readOnly={readOnly}
  />
</SizeTabs>
```

- One `CounterTable` per defect class, each in a `ModuleSection` titled with the class ("Major Defects (AQL 2.5)"). Value columns have a fixed width, so stacked tables line up.
- Totals count every hand recorded, whichever is on screen. Columns can be boxes too (Safedon): `{ key: "253", label: "Box 253", name: "box 253" }`, with `summaryRows` for "1/125" and 0.008 (`formatRatio`, `formatRatioDecimal`).
- A one-off label is added unmapped (`unmapped: true`): the row shows a flag for the admin.

## Per-size rows with box numbers (dispensing, labelling)

```tsx
<SizeTabs sizes={context.sizes} value={size} onValueChange={setSize} results={evaluation?.result.perSize}>
  {(s) => (
    <>
      <EnterGroup className="overflow-clip rounded-lg border border-border bg-card">
        <table>{/* one row per box */}
          <BoxPicker variant="cell" label={`${labels.box}, item ${i + 1}`} sizeLabel={`size ${s}`}
            value={row.box} cartons={cartonsFor(context, s)} used={rows.map((r) => r.box)}
            onValueChange={(box) => setRow(s, i, { box })} onFocus={() => onFocusChange?.({ size: s, box: row.box ?? undefined })}
            issuePath={["sizes", s, "boxes", i, "box"]} readOnly={readOnly} />
          <PercentField variant="cell" group="layering" id={`layering-${s}-${i}`} label={`${labels.layering}, item ${i + 1}`}
            value={row.layering} onValueChange={(layering) => setRow(s, i, { layering })}
            onInvalidChange={(entry) => setRejected(`layering-${s}-${i}`, entry)} readOnly={readOnly} />
        </table>
      </EnterGroup>
      <EntryProblems problems={/* rejected entries whose cell is still null, with inputId for the link */} />
      <RequirementList caption={`${title}, size ${s}`} labels={{ value: labels.average, spec: labels.spec, result: labels.result }}
        items={[{ key: "layering", label: labels.layering, value: evaluation?.computed.layering?.[s] ?? null, unit: "%", decimals: 0, spec: { kind: "min", min: config.minLayering } }]} />
    </>
  )}
</SizeTabs>
```

- `BoxPicker` offers `context.cartons[size]` ascending, with search (type the digits and Enter on desktop, tap on iPad), marks boxes picked in other rows (still pickable: one carton holds many inner boxes), and shows a stored box that is not in the list as an error until replaced. With no carton list yet it takes a typed box number and does not flag it (MODULES.md section 7). Store the number, never an index.
- `group="layering"` makes Enter walk down that column and a pasted column fill down it; without `group`, fields in one `EnterGroup` form one run in reading order.

## Single values

```tsx
<EnterGroup className="grid gap-4 sm:grid-cols-2">
  <NumberField label={labels.tensile} unit="MPa" decimals={2} min={0} value={data.sizes[s]?.tensile ?? null}
    onValueChange={(tensile) => onChange(set(s, { tensile }))} hint={labels.tensileHint}
    error={findIssue(evaluation?.issues, ["sizes", s, "tensile"])?.message} issuePath={["sizes", s, "tensile"]}
    readOnly={readOnly} />
  <PercentField label={labels.elongation} max={2000} value={...} onValueChange={...} />
</EnterGroup>
<SpecValue label={labels.average} value={6.537} decimals={3} unit="N" spec={{ kind: "min", min: 6 }} />
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
    if (path[0] === "sizes" && typeof path[1] === "string") setSize(path[1]);
    if (path[2] === "R" || path[2] === "L") setHand(path[2]);
  },
});
return <div ref={root}>...</div>;
```

Mark the control that holds each value with the path an issue would carry: `issuePath` on `BoxPicker`, `NumberField`, `ModuleSection` and `RequirementList` items, `cellIssuePath` on `CounterTable`, or `{...issuePathProps(path)}` on anything else. The hook switches size or hand first, then scrolls to the closest marked control (the exact path, else its nearest parent) and focuses it.

## Photo tags (`onFocusChange`)

Report what is in focus whenever it changes: the size from `SizeTabs`, the hand from `HandToggle`, `{ size, hand, defect }` from `CounterTable`'s `onCellFocus`, `{ size, box }` from `BoxPicker`'s `onFocus`, and the size from `NumberField`'s `onFocus`.

## Text: `lib/format`

| Helper | Gives |
|---|---|
| `formatSpec(spec, { unit, decimals })` | `≥ 240`, `80 ± 10`, `≤ 5%`, `≥ 14.00 MPa`, `0.05 – 0.10`, `NA` |
| `formatNumber(v, { decimals, maxDecimals, grouping, unit, empty })` | `2.90 g`, `0.48`, `5,800,000`; rounded like Excel's ROUND |
| `formatCount`, `formatPercent`, `toPercent` | `5,800,000`, `88%` (value already in percent), 0.0048 to 0.48 |
| `formatRate(defects, inspected)` | `3 / 625 (0.48%)`, `11 / 1000 (1.1%)` |
| `formatRatio(1, 125)`, `formatRatioDecimal(1, 125)`, `ratio` | `1/125`, `0.008` (per box) |
| `formatLimits({ ac, re }, { style, accept, reject })` | `Ac 3 / Re 4`, `Accept 3 / Reject 4`, `Acc. = 0 / Rej. = 1` |
| `formatSize(size, { sizes, prefix })`, `formatSizeList`, `formatHand`, `formatSizeHand` | `M`, `Medium`, `Size 7.0`, `Size M, right hand` |

Show computed numbers with `Figure` (tabular figures, unit in secondary text, a dash read as "No value" when missing).

## Behaviour at a glance

| Component | Keyboard | Touch | Notes |
|---|---|---|---|
| `SizeTabs` | Arrow keys, Home, End (automatic activation, wraps) | Swipe the panel left or right (64 px, mostly horizontal; never from the field being edited) | A half-typed value is stored for its own size before the panel changes |
| `HandToggle` | Arrow keys (radio group) | Tap | `handsOf(view)` gives the hands to show |
| `CounterTable` | Stepper keys: arrows, Page, Home, End | Tap and hold to repeat | Live total and chip; sticky totals on iPad |
| `BoxPicker` | Type digits, arrows, Enter, Escape | Tap a box; keyboard stays down | List capped to the space on screen |
| `NumberField` | Enter, Shift+Enter, Escape restores | Decimal keypad | Paste a column to fill down the group |

The kit was checked in a browser at 820 x 1180 and 1180 x 820 with touch and at 1440 x 900: swipes, arrow keys, stepper taps, paste, Enter runs, issue links and the box picker, with 44 px targets, 16 px text on touch and no sideways page scroll.
