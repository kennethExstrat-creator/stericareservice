# Example-report fixtures

`tests/fixtures/examples/` holds the two filled example reports as anonymised, typed data, and
`docs/examples/expected-results.md` as data. They are the inputs and the answers for the Phase 2
acceptance test (BUILD_SPEC 12): both example reports are entered and every result matches the
expected results, including the corrected values and the validation errors.

The originals are client data and stay in `docs/examples/`, which git ignores (BUILD_SPEC rule 7).
Nothing in the fixtures identifies the client, the manufacturer or the order.

## Files

| File | Holds |
|---|---|
| `types.ts` | One type per report section, and the conventions below |
| `std-eg.ts` | `STD_EG_EXAMPLE`: the EN 455 style report, size M only |
| `safedon-eg.ts` | `SAFEDON_EG_EXAMPLE`: the ASTM D6319 style, client-branded report, sizes XS to L |
| `expected.ts` | `STD_EG_EXPECTED`, `SAFEDON_EG_EXPECTED`: every row of the expected results, the validation errors and warnings, the rejected inputs, and the corrections that clear the errors |
| `helpers.ts` | `dimensionColumn`, `cartonList`, `intendedValue`, `spreadsheetValue`, `safedonDefectsPerBox`, `SECTION_MODULE` |
| `index.ts` | Everything above, for `import ... from "@/tests/fixtures/examples"` |
| `leak-scan.ts` | The scanner behind the leak test: names and codes as word sequences, dates by calendar day |
| `*.test.ts` | The proof that the transcription and the expected data are right (below) |

## What the fixtures hold

The fixtures follow the printed reports section by section, in print order, not the module
schemas. An adapter maps each section into its module's data once the schemas exist;
`SECTION_MODULE` names the module each section feeds. Conventions:

- **Numbers as printed.** Every reading, count, percentage, quantity and sample size is the
  printed value. Units: mm, g, N, MPa; percentages are numbers in % (88, not 0.88).
- **Text cells.** A numeric cell the inspector typed as text is a `TextCell`: `raw` is exactly
  what the cell shows ("2 42"), `intended` is the corrected value, `note` says what went wrong.
- **Printed results.** Fields named `printed*` are the report's own computed and result cells,
  verbatim (runs of spaces collapsed), wrong ones included. The app computes these itself; they
  record what the original report said.
- **Per size.** Each section lists only the sizes it filled in. What the report printed for sizes
  that were not ordered (pre-filled limits, `#VALUE!`, "Passed") is in `unorderedSizes`.
- **Labels.** Row labels are verbatim, `[sic]` spellings included, each with its canonical code
  from `supabase/seed.sql` (defects) or BUILD_SPEC 11 (labelling checks).

| | STD_EG | SAFEDON_EG |
|---|---|---|
| Sizes ordered | M (2,900 cases) | XS 60, S 850, M 560, L 60 cases |
| Packing | 200 per inner box, 10 per case | 125 per plastic pack, 16 per case |
| Samples | 50 cases, 500 gloves, 13 for dimensions and force, 13 dispensing boxes | 80 / 200 / 200 / 80 gloves, 13 for dimensions, 5 / 8 / 8 / 5 packs |
| Dimensions | 13 gloves x length, width, finger, palm, cuff; median | 13 gloves x length, width, finger, palm; average |
| Physical | Force at break median | Tensile and elongation averages |
| Weight | Average of 13 | One value per size |
| Dispensing | Box, layering %, dispensing %, stickiness code | Six Safedon defect counts per box |

The reports do not print some inputs, so the fixtures cannot hold them:

- STD_EG force at break: only the median (6.537 N); the 13 readings are in the lab report.
- STD_EG weight: only the average of 13 gloves (2.90 g), not the weights.
- Signatures: images, recorded as `signed: true`.
- SAFEDON_EG thickness: rounded to 2 decimals in print (see "Printed precision").

## Anonymisation

| Item | In the fixtures |
|---|---|
| Manufacturer, factory, address | Manufacturer A, Factory A1, Address A (STD_EG); Manufacturer B, Address B (SAFEDON_EG) |
| Client (SAFEDON_EG logo) | Client A |
| PO and the reference in brackets | PO-0001 (SO-0001); PO-0002 (REF-0002) |
| Product name, brand, product code | Brand A PC-A01 Blue Nitrile; Brand B Nitrile PF Examination Gloves |
| Product code in the STD_EG file name | PC-A02: one character off the report's code, as in the original |
| Lots | LOT-A01; LOT-B01 to LOT-B04 |
| Packing sites | Manufacturer B (the manufacturer itself) and Packer C |
| Inspector | Inspector A |
| STD_EG glove colour | Blue: the printed shade name repeated the product name |
| Dates | Fictional, see below |
| Carton and box numbers | Placeholders, see below |

Kept as printed: every measurement, count, percentage, quantity, sample size, spec and limit,
the glove texture and length text, the row labels and the report's results.

**Carton and box numbers** are identifiers too. Each distinct number became a placeholder:

- Equality and membership are kept. The carton entered twice is one placeholder twice; a box
  number equal to a listed carton number has that carton's placeholder; the STD_EG box 2336
  equals none. Box and carton numbers are one number, a box/carton number (BUILD_SPEC 6.2 rule 7;
  Kenneth, 13 October 2026): the app suggests the size's sampled numbers for a box and warns
  about one that is none of them, so the placeholders keep exactly which boxes are sampled
  cartons. Every SAFEDON_EG dispensing box is one of its size's sampled cartons.
- Within a size the order is kept: a rising list still rises, and the SAFEDON_EG size S carton
  that broke the rising run still does.
- Every placeholder lies between 1 and its size's order quantity, so the range rule (6.2 rule 6)
  behaves as it would on the original. No placeholder is used in two sizes, and none equals an
  original carton number of the same report.
- The STD_EG box 2336 is one digit off the listed carton 2236, as the original box was.
- The placeholders were drawn at random under these rules, and the mapping is not in the repo.
  Grid positions and box rows are unchanged, so the mapping can be rebuilt from the PDF by
  position.

**Dates** are fictional and keep each report's order: made, inspected, concluded, expires. Each
is written in the report's own format, so the formats stay mixed as in the original:

| | STD_EG | SAFEDON_EG |
|---|---|---|
| Inspection | Friday, April 11, 2025 | Wednesday, February 19, 2025 |
| Manufacturing | 4/1/2025 (month first: 1 April) | Feb-25 (month and year only) |
| Expiry | 3/1/2030 | Jan-30 |
| Conclusion | 12/04/2025 (day first) | 2/19/2025 |

## Leak guard

`anonymisation.test.ts` scans every file in `tests/fixtures/examples/` and this document, file
names included, for client data from the PDFs. A leak fails `npm run test`. Two deny lists feed
it:

- **Committed, runs everywhere.** `DENY_HASHES` holds salted SHA-256 hashes of the multi-word
  company names and the factory address lines. A hash of a number, a date or a short code is
  reversed by trying every possible value, so this list holds only names that cannot be enumerated
  and are plain text elsewhere in the repo already (`supabase/seed.sql`, BUILD_SPEC 11): their
  hashes give nothing away. Numbers, short codes, single words, people and dates never enter the
  repo, not even hashed.
- **Git-ignored, runs next to the PDFs.** `docs/examples/deny-list.txt` holds everything
  identifying in plain text: companies, factory, client, packing sites, brand, product names and
  codes, PO, SO and client references, lots, addresses and postcodes, the inspector and the real
  dates. The test reads it where it exists, or from `STERICARE_EXAMPLES_DIR`, and is skipped
  elsewhere, like the expected-results comparison. It also checks that every committed hash is on
  this list and that each committed entry has two or more words and ten or more letters.

**Matching.** Names, codes and numbers match as word sequences: case, punctuation, spacing,
camelCase, letter-digit boundaries, accents and digit separators do not hide a match, so a code
`XY12` is found as "xy12", "XY-12" or glued to a word as in "XY12Blue". Dates match by calendar
day or month, not by spelling. A `date: YYYY-MM-DD` line finds that day written:

- in numbers with one separator used throughout: year first (2031-02-03, 2031/2/3, 2031.02.03,
  2031_02_03, 2031 02 03), or day and month either way round before the year (03/02/2031,
  2/3/2031, 03.02.2031, 03-02-31);
- compact, as YYYYMMDD, DDMMYYYY or MMDDYYYY;
- with the month as a name or abbreviation, in any order, with or without a weekday, an ordinal
  ("3rd") or "of";

and finds its month written alone ("February 2031", "Feb-31", "Feb '31", "2031-02", "02/2031",
"203102"). A `date: YYYY-MM` line finds that month written alone and any day in it. Not caught: a
date without a year, a weekday on its own, spaces around the separators ("3 / 2 / 2031") and a
spreadsheet serial number. Carton numbers are too short to scan for, and are anonymous by
construction.

**Adding an entry.** The git-ignored list takes one entry per line; a line starting with `#` is a
comment:

```text
# Manufacturers
<company name>
<short code>
# Dates
date: <YYYY-MM-DD>
date: <YYYY-MM>
```

Add anything identifying there. Add a committed hash only for a name that cannot be enumerated
and is already plain text in the repo, and keep it on the git-ignored list too. Never commit the
plain text.

```bash
node --no-warnings -e "import('./tests/fixtures/examples/leak-scan.ts').then((m) => console.log(m.denyHash(process.argv[1])))" "Name to deny"
```

## Errors kept on purpose

The app must reject or correct exactly these, so the fixtures keep them as the inspector
entered them.

**STD_EG**

| Where | The report | The app | Fixture |
|---|---|---|---|
| Carton list, size M | Carton 525 twice (row 2 column 10, row 3 column 1 on the report; No. 20 and No. 21 in the app): 50 entries, 49 unique | Error, submit blocked: "Box/Carton #525 is entered twice (No. 20, No. 21)." | `cartons.M.rows` |
| Packing check item 12 | Box 2336, in no carton list, accepted (likely 2236) | Stored as typed; a warning, never an error: "Box/Carton #2336 is not in M's sampled box/carton numbers." | `dispensingPacking.perSize.M.boxes` |
| Watertight | Limit 10 / 11; title says code letter K, L & M | n 500 is code N: 14 / 15 | `watertight.perSize.M.printedLimit` |
| Visual major | Limit 14 / 15 | 21 / 22 | `visual.major.perSize.M.printedLimit` |
| Visual minor | 21 / 22 | 21 / 22 by the arrow from code N up to M | `visual.minor.perSize.M.printedLimit` |
| Weight | 2.90 g, remark "Info" | Warning: 17% below the indicative 3.5 g | `weight.M` |
| Sizes XS, S, L, XL | "Passed", `#VALUE!` and `#DIV/0!` with no data | No tables, no results | `unorderedSizes` |
| Thickness specs NA | "Passed" | "na" (`lib/stats`) | `dimensions.perSize.M.printedResult` |
| Inspector | Not recorded anywhere | Recorded automatically | no `inspectedBy` |
| Product code | One code in the file name, another in the report | One value, entered once | `header.productCodeElsewhere` |
| Result labels | Critical result "Visual Minor"; carton result "Inner Box" | Labelled correctly | `printedResultLabel` |

Box 2336 (packing check item 12) is in no carton list. Box # and carton # are one number
(BUILD_SPEC 6.2 rule 7; Kenneth, 13 October 2026, "yes link again"), so the app warns about it:
the warning goes into the export, never blocks submit and leaves the packing check passed. From
12 to 13 October 2026 the app took box numbers as the inspector's own and said nothing; before
12 October it called the box an error.

**SAFEDON_EG**

| Where | The report | The app | Fixture |
|---|---|---|---|
| Watertight XS total | "Jan-80", the date 1 January 1980 (most likely "1/80" typed and stored as a date) | Computes 1 / 80 | `watertight.perSize.XS.printedTotal` |
| Dimensions, size S | Five cells typed with a space: "0 .18" twice, "0 .11", "0 .12", "2 42". The average skipped them: 243.5 / 86.69 / 0.1748 / 0.1197 | Refuses the text; with the corrected values 243.38 / 86.69 / 0.1756 / 0.1190 | `TextCell`s; `rejectedInputs` |
| Dispensing XS rates | 0.8% under box 18 (no defect), 0.0% under box 33 (2 defects) | Rate per box from its counts | `printedRatePerBox` |
| Dispensing L total | 7 / 625 (1.12%) for no defects | 0 / 625 | `printedSizeTotal` |
| Sampling | 80 and 200 gloves, below inspection level I | Warning when level I is set | `SAFEDON_EG_EXPECTED.warnings` |
| Result labels | Critical result "Visual Minor"; "Thin batch [sic] / area (body)" | Labelled correctly | `printedResultLabel`, `rows` |

## Printed precision

The SAFEDON_EG report prints thickness readings rounded to 2 decimals, but the 4-decimal
thickness averages in the expected results come from the unrounded readings in the source
workbook (M palm prints 0.11 for all 13 gloves, yet its expected average is 0.1117). The print
cannot reproduce them:

| Size | Finger: expected / from the print | Palm: expected / from the print |
|---|---|---|
| XS | 0.1755 / 0.1769 | 0.1203 / 0.1208 |
| S | 0.1756 / 0.1754 | 0.1190 / 0.1208 |
| M | 0.1740 / 0.1738 | 0.1117 / 0.1100 |
| L | 0.1742 / 0.1746 | 0.1191 / 0.1200 |

Length and width are whole millimetres and reproduce exactly. For thickness the tests prove what
the print allows: each printed reading is within 0.005 of the true one, so the averages differ by
at most 0.005; at the report's 2 decimals both agree; and the averages of the printed readings
are pinned. `expected.ts` carries both figures: `average` (the expected results) and
`averageOfPrintedReadings` (what the app computes from these fixtures, or from an inspector
typing the PDF). The fixtures do not invent unrounded readings.

To compare exactly, the workbook's unrounded thickness readings are needed. With them, replace
the thickness values in `safedon-eg.ts` and set `averageOfPrintedReadings` to the values in
`average`: the tests then hold the fixtures to the expected 4-decimal averages.

## How the acceptance tests use them

1. An adapter per template maps each section into module data (`SECTION_MODULE`). Numbers go in
   as numbers. A `TextCell` is first typed as `raw`, which the cell must refuse (6.2 rule 1),
   then as `intended`.
2. The data is entered on the iPad viewports (Playwright, see `e2e/README.md`) or passed to the
   modules' calculations directly.
3. Each module result is compared with `expected.ts`: values, code letters, limits and status
   per size. Dimension thickness averages compare with `averageOfPrintedReadings`. For STD_EG
   size M, `carton_sampling` is "fail" (`cartonList.status`: it fails on validation errors,
   BUILD_SPEC 6.1) and `dispensing_packing` is "pass" (`dispensing.M.status`: averages and
   stickiness codes). The stray box is a validation error that blocks submit
   (`dispensingBox.validation`), not a `dispensing_packing` result.
4. STD_EG shows exactly the two errors in `errors` and cannot be submitted. Applying
   `corrections` clears them; the suggested result is then pass.
5. The warnings in `warnings` appear and go into the export; the SAFEDON_EG sampling warnings
   only when the template sets inspection level I.
6. The STD_EG force at break and weight modules need values the report does not print: any 13
   readings with median 6.537 N, and weights averaging 2.9 g (or the module's single-value mode).
7. `printed*` fields and `unorderedSizes` describe the old report. Compare the app with them only
   to show where it now differs.

## How the fixtures were checked

Each page was read at high zoom, and every transcribed cell (about 400) was then compared with the
PDF's text layer by a one-off script, run outside the repo because the PDFs cannot be in it. The
tests recompute everything the report or the expected results state from the fixtures with
`lib/stats`:
order totals, packing, sample counts across pages, carton list counts, medians and averages,
force, weight deviation, dispensing averages and rates, hole and defect totals, limits, and each
deliberate error at its exact position. `expected.test.ts` also compares the expected data with
`docs/examples/expected-results.md` row by row where that file exists (on Kenneth's machine; set
`STERICARE_EXAMPLES_DIR` to a copy of `docs/examples` to run it elsewhere).
