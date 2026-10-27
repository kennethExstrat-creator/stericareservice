# The report

The app renders the pre-shipment inspection report itself, in SteriCare's design (Kenneth, 27 October 2026: the new
design, "inside the report, there are charts and infographics, try to use the data to those charts in the report
too"), and the browser's print dialog saves it as a PDF. The AI report service (BUILD_SPEC 9.1) stays an option beside
it. This page is how the report is built, how to add a section, and the rules its data follows.

## Architecture

```
inspection ──▶ export (lib/export, ExportSchema) ──▶ buildReportModel (lib/report/model.ts) ──▶ ReportDocument (components/report)
```

- **The export** is the input: every module's data, computed values, labels in the template's wording, results,
  photos with signed links, the conclusion, and the Report page's options (`report`). Nothing else is read.
- **The model** (`lib/report/model.ts`, pure and client-safe) turns it into what the pages draw: the chrome every page
  shares, the Summary (page 1), one slot per later section, and the plan of pages in print order.
- **The components** (`components/report`, pure markup, no hooks, no new libraries) draw the model: the page frame
  with its chrome, page 1, the "coming next" pages, and the primitives the sections use.
- **Two places render it, from the same model and components:**
  - the print route, `/inspections/[id]/report/print`: the real export, built on the server from what is saved
    (`buildInspectionExport`, the export's access rule), every page at its true size;
  - the capture screen's Report page: the screen's own copy of the inspection as it stands, mid-edit and offline too,
    assembled by the export's own pure assembly (`lib/report/live-export.ts`), the pages zoomed to the preview's width.
    The options and every entry show at once.

## The options

`lib/schemas/report-options.ts` holds them, saved per inspection in `data.report` through the autosave. They follow the
report's design, not the capture steps (Kenneth: "make the setting of report match the the report design"):

| Group | Options |
|---|---|
| General | `template` (`standard_preshipment`), `pageSize` (`a4`, `letter`), `title` (blank: "Pre-Shipment Inspection Report"), `showClient`, `footerNote` |
| `summary` (page 1, always in) | `orderMix`, `inspectionSummary`, `resultsByCheck` |
| `sections.orderSampling` | `include`; blocks `gloveInformation`, `packingConfiguration`, `orderLotsSampling`, `finishedGoodsSampling` |
| `sections.dimensions` | `include`; blocks `gloveLength`, `palmWidth`, `medianResults`, `weightPerGlove` |
| `sections.measurements` | `include` (no blocks) |
| `sections.forceAtBreak` | `include`; blocks `laboratoryDetails`, `maximumLoad`, `specimenReadings`, `laboratorySummary` |
| `sections.holesVisual` | `include`; blocks `defectsAgainstLimit`, `pinholesByLocation`, `visualCritical`, `defectPhotos`, `visualMajorMinor` |
| `sections.packing` | `include`; blocks `averageLayeringDispensing`, `perBoxResults`, `agedGloves`, `stickinessGrades` |
| `sections.labellingConclusion` | `include`; blocks `dispenserCartonBox`, `resultsMatrix`, `inspectorSignature`, `remark` (the conclusion card always shows) |
| `photos` | `groups.samplingPackaging`, `groups.packingVisualAgeing`, `groups.watertightLaboratory`; `perGroup` (4, 8 or 12; 8) |

- Every switch is on by default; an option saved before it existed reads as its default, switch by switch.
- `REPORT_SECTIONS` names each section's title, its modules and its blocks; `REPORT_PHOTO_GROUPS` each photo record's
  modules. `blockOn(options, section, block)` reads a block's switch by keys the type system checks.
- A section none of whose modules the inspection includes (switched off for it, or not in its template) is greyed on
  the Report page with "Not in this inspection" and left out (`reportSectionsAvailable`). The export carries each
  section's `include` already resolved, so `report.sections.<key>.include` is what the report shows.
- Options saved in the first shape (the morning of 27 October 2026: a switch per capture step) are read into this one
  (`withFirstShape` in `lib/inspections/capture/report.ts`): a step switched off switches off the blocks its page held.

## The model

`buildReportModel(doc)` returns a `ReportModel`:

- `paper`: `{ size, orientation, label, width, height }` in millimetres (`paperOf(size, orientation)`).
- `chrome`: the letterhead (`STERICARE_LETTERHEAD`, SteriCare's own details), the title, the PO for the band (its
  bracketed reference left out), the inspection day, the client while Show Client is on, the product, the footer
  note, `draft` (every page carries a Draft tag until the inspection is approved), the status and the reference.
  `reportPageChrome(chrome)` turns it into the frame's `PageChrome`.
- `sizes`: the template's sizes, as it shows them: what a size is coloured by (`sizeTone`).
- `summary`: the kicker (the template's report title), the product's name, the conclusion (the template's word, its
  date, and the verdict worked out from the checks: "All 9 checks passed for every size on the order: S, M, L and XL."),
  the details (the header's labels; "Not stated" where blank; a field the template switches off is left out), the
  order mix (each ordered size's cases and share, the shares adding up to 100%, the totals), the Inspection Summary
  (the formatted document, drawn as the app draws it), Results by Check (`lib/report/checks.ts`), and where the
  Inspection Summary prints (`summaryPlacement`: on page 1, or on a page of its own when page 1 cannot hold it).
- `sections`: one optional, typed slot per section (`orderSampling`, `dimensions`, `measurements`, `forceAtBreak`,
  `holesVisual`, `packing`, `labellingConclusion`, `photos`), filled by its builder.
- `plan`: every entry in print order: `{ kind: "summary" }`, then each section the report shows
  (`ReportSectionPlanEntry`: its number from 02 without gaps, kicker, title, the blocks switched on, its modules, page
  count, built), then the photo records (`ReportPhotosPlanEntry`: each record's photos chosen). `pageCount` is the sum.

A section's title is the design's, or the test it shows where the inspection has another: Physical Properties for
tensile, Glove Dispensing for the Safedon dispensing check.

Section 07's slot holds the packing check's content, or, for a template with the Safedon dispensing check and no
packing check, Glove Dispensing's (`kind: "safedon"`, `lib/report/sections/glove-dispensing.ts`), laid out in TG35
page 7's style: each size's defect rate against the template's maximum, the per-box results, and the defects by type
beside the template's definitions of them. It follows the section's chart and Per-Box Results switches; its defects
table prints whatever Aged Gloves and Stickiness Grades (the packing check's) say. The aged gloves' ageing, 70 °C for
7 days (TG35 page 7, EN 455-2), is stated from one constant (`AGEING_CONDITION`, `lib/report/format.ts`): under
"Aged Gloves" in the chart, in the aged gloves' table heading and in their photo record's note.

Results by Check has a row per check the inspection judged: each test module with a result (a module that only
records, "info", has none), Visual Inspection once per defect class, the packing check's aged sample on a row of its
own. The order, the sampling plan and the box/carton numbers are records, listed only when they hold a failure or a
warning. Each row names the check by its short name, its criterion from the module's config and its result from the
computed values; the status is the module's own.

## The primitives

In `components/report`, each with a test (`report.test.tsx`); the arithmetic in `lib/report/geometry.ts`.

| Primitive | Props |
|---|---|
| `ReportDocument` | `{ model }` for the report, or `{ paper, chrome, pages: { key, body }[] }` for any document on the same frame |
| `ReportPage` | `{ paper, chrome: PageChrome, number?, total?, children }`: true size, the chrome, `break-after: page` |
| `SectionHeading` | `{ kicker, title, lead?, aside?, cover? }`: "— SECTION 02", the title, the lead in grey |
| `BlockHeading` | `{ title, aside? }`: a block's heading with its totals or key at the right |
| `StatusChip` | `{ status, label?, size?: "sm" \| "md" }`: Passed, Failed, Warning, On Hold, Not Done in the status colours |
| `StatusTick` | `{ status, size? (mm), label? }`: a solid disc with the status's glyph |
| `InfoCard` | `{ title?, aside?, tone?: "plain" \| "soft", children }` |
| `KeyValueGrid` | `{ items: { label, value, wide?, muted? }[], columns?: 1–4 }` |
| `ReportTable` | `{ columns: { key, label, align?, numeric?, width?, strong?, muted? }[], rows: { key, cells, emphasis? }[], groups?, totals?, zebra?, dense?, caption? }` |
| `StackedBar` / `StackedLegend` | `{ segments: { key, label, value, tone? }[], height?, label }` / `{ segments, detail(segment, i) }` |
| `DotPlot` | `{ rows: { key, label, values, median?, aside? }[], axis, limit?: { value, side? }, step?, format?, label }` |
| `RangeBand` | `{ rows: { key, label, band?: { from, to }, range?: { min, max }, median?, aside? }[], axis, format?, label }` |
| `HBars` | `{ rows: { key, label, value, display? }[], axis: { min, max }, minimum?, label }` |
| `GroupedHBars` | `{ rows: { key, label, sublabel?, values, aside?, tag?, separated? }[], series: { key, label, tone }[], axis, minimums?, format?, label }` |
| `StripPlot` | `{ rows: { key, label, sublabel?, marks, total, numbers? }[], label }`: marks along 1 to N |
| `TrackBar` | `{ found, accept, reject?, limitText? }`: "2 found · accept ≤ 10", the track ending at the reject number |
| `TickMatrix` | `{ columns, rows: { key, label, cells: (Status \| null)[] }[], heading?, caption? }` |
| `PhotoGrid` | `{ photos: { id, url, caption?, alt? }[], columns?: 2–5, aspect?, lead?, strongCaptions? }` |
| `SizeChip` | `{ size, label?, templateSizes? }`: a size in its own blue |
| Chart parts | `AxisTicks`, `GridLines`, `LimitLine`, `AsideLines`, `ChartKey`, `along(value, axis)` |
| Theme | `TYPE` (the type scale in points), `PAPER_CLASS`, `PAGE_GUTTER`, `contentWidth(paper)`, `sizeTone(size, templateSizes)` (S light blue, M blue, L dark blue, XL navy; other sizes by their place), `sequenceFor(count)` |
| Geometry | `position`, `niceAxis`, `niceStep`, `ticksBetween`, `stackDots`, `stackHeight`, `median`, `bandEdges(spec, axis)`, `trackGeometry` |
| Readers and words | `lib/report/read.ts` (`rec`, `num`, `text`, `at`, `moduleOf`, `labelOf`, `orderedSizes`, `sizeLabel`) and `lib/report/format.ts` (`longDate`, `weekdayDate`, `andList`, `counted`, `rangeText`, `sharesOf`, `aqlText`) |

The look: Outfit throughout (the design's titles too), the SteriCare blues and teal from the website's tokens, slate
greys, rounded cards, sizes in points and millimetres. Results use the app's status colours and words, never the brand.

## Adding a section

The two registries keep a section's work in its own files:

1. `lib/report/sections/<key>.ts`: `export const <key> = defineSection({ key: "<key>", build(doc, entry) })`. `entry`
   is the section's plan entry: the blocks switched on, the modules the inspection includes, its number and title.
   Return the slot's content with its `pageCount`, or null to print "coming next". Read the export through
   `lib/report/read.ts`; import only types from `../model`.
2. Widen the section's content type in `lib/report/model.ts` (`DimensionsSection = ReportSectionContent & { … }`).
3. Add the builder to `SECTION_BUILDERS` in `lib/report/sections/index.ts` (one line).
4. `components/report/sections/<key>.tsx`: `export const <key>Pages = defineSectionPages({ key: "<key>", Pages })`,
   `Pages({ model, entry, content })` returning one body per page (`content.pageCount` of them). Draw with the
   primitives; head the first page with `SectionHeading kicker={entry.kicker} title={entry.title}`; draw only the
   blocks in `entry.blocks`.
5. Add it to `SECTION_PAGES` in `components/report/sections/index.tsx` (one line).
6. Test the builder with both fixtures (`lib/report/__fixtures__/exports.ts`: STD_EG, one size, no client; SAFEDON_EG,
   four sizes, Client A) and the pages with `renderToStaticMarkup`.

The plan orders the sections (REPORT_SECTIONS, then the photo records) and numbers the pages across the report; the
document frames each body. The photo records are one slot (`photos`) whose entry holds each record's photos, already
chosen: the photos marked In Report, or every photo while none is, by their modules' group, at most Photos per Group, a
flagged original left out.

## Printing

- **Download PDF** on the Report page opens `/inspections/[id]/report/print?print=1` in a new tab: a plain click opens
  the tab at once and sends it on once what is waiting is saved, so the PDF has the latest options. The print dialog
  opens by itself once the fonts and photos have loaded; choose Save as PDF there. The print bar's Print / Save as PDF
  opens it again; Back returns to the Report page. The page's title names the PDF: "INS-2026-0001 Pre-Shipment
  Inspection Report".
- **Who:** the export's rule, checked on the server: the inspection's inspector or an admin. Anyone else gets the same
  404 as for no inspection; the Report page greys Download PDF for a lead inspector reading a team member's inspection.
- **The print rules** (`print-styles.tsx`, in the print page only): `@page { size: <width>mm <height>mm; margin: 0 }`,
  so each page is one sheet; nothing but the pages on paper (the app shell, the bar and the toasts are hidden; the
  elements around the pages give up their boxes); tints print as drawn (`print-color-adjust: exact`).
- **Page 1's room:** the Summary is one fixed page; the Inspection Summary is the part that grows, so its height is
  estimated from its lines (`SUMMARY_ROOM`); when page 1 cannot hold it with the rest it prints on a page of its own.

## The frame for other documents

The sampling plan sent to a manufacturer (A4 landscape) is drawn on the same frame: `paperOf("a4", "landscape")`, a
`PageChrome` of its own (`bandTitle: "Sampling Plan"`, `bandAside: "PO … · Inspection <date>"`, `draft: false`,
`footerLeft: "Prepared for <manufacturer> · PO …"`, `footerRight: "Computer-generated document. No signature
required."`, `numbered: false`), and `<ReportDocument paper={…} chrome={…} pages={[…]} />`. On a landscape page the
letterhead's address sits on the company's line. `ReportTable`, `InfoCard`, `KeyValueGrid`, `SizeChip` and `sizeTone`
serve it as they serve the report.

## Data rules

- **The template's words:** labels, titles and size names come from the export (the template's wording, in Title
  Case); the app's own words only where the template has none.
- **Nothing invented:** a blank value reads "Not stated"; a result is the module's own (the AI never changes one);
  a check that only records has no row.
- **Never client data:** the design's example is a client's real report. Its names, PO, lot and carton numbers stay
  out of code, tests, fixtures and docs; tests use the placeholder fixtures (docs/FIXTURES.md).
