# Report: Standard EG (nitrile examination gloves, EN 455 style)

- Template: `STD_EG`
- Source: filled Excel report "TG40 Sum - 2467581 - Handsafe HN91 Blue Nitrile" (4 pages, Jul 2024). Example PDF: `docs/examples/2024-07-12_STD_EG_example.pdf`
- Standard profile: EN 455 (median statistics, force at break in N)
- Labels below are verbatim, including the original spelling. `[sic]` marks a typo to fix in the app. Module keys refer to BUILD_SPEC section 6.

## Page 1

Title: `Preshipment Inspection` / `Nitrile Disposable Examination Gloves`

**Manufacturer Information** (module `header`)

| Label | Input |
|---|---|
| Manufacturer / Supplier | text |
| Supplier Factory Address / Location | text |
| PO / SO Number | text, e.g. `2467581 (5400027457)` |
| Product Name (Brand, code & description) | text |
| Client Name | text |
| Inspection date | date |
| Manufacturing date | date |
| Expiry date | date |
| Factrory [sic] glove code | text |

No "Inspected by" field anywhere in this format; the report is signed (image) on page 4. The app always records the inspector.

**Glove Information** (module `glove_info`)

| Label | Input |
|---|---|
| Glove surface texture | text, e.g. Finger-textured |
| Indicative weight (size M) | number, g |
| Glove colour | text |
| Glove length | text, e.g. 240 mm minimum |

**Order table** (module `order_lots`): `Size` (XS, S, M, L, XL) | `Qty (cases)` | `Lot Number`. Then `Total # carton` (sum of Qty) and `Total # gloves`.

**Packing configuration** (module `packing_config`): `# glove per inner box`, `# inners per case`, `# gloves per case`.

**Sampling Plan** (module `sampling_plan`), one row per size:

| Column | Sub-columns |
|---|---|
| Glove Size | |
| Order Qty (case) | |
| Sampling Quantity | Case, Inner Box, Gloves |
| # gloves for watertight & Visual | |
| # gloves for dimension | |
| # gloves for FAB | |
| # inner box for packaing [sic] & dispensing inspection | |

**Finished Goods Sampling Information (carton number)** (module `carton_sampling`): one grid per size (XS to XL), 10 columns x 5 rows = up to 50 carton numbers, plus `Sampling Quantity`.

## Page 2

Header: `Pre-shipment Inspection : <PO> <product>`

**Dimension - Size <XS..XL>** (module `dimensions`), one table per size:

- Columns: `No.` (1 to 13) | `Length` | `Width` | `Finger Thickness` | `Palm Thickness` | `Cuff Thickness`
- Rows: 13 gloves, then `Median`, `Spec.`, `P/F *`
- Spec in the example: Length `≥ 240`; Width XS `≤ 80`, S `80 ± 10`, M `95 ± 10`, L `110 ± 10`, XL `≥ 110`; thickness `NA`
- Legend: `* P = Passed F = Failed`

**Force At Break in Newton (Refer to attached where applicable)** (module `force_at_break`): per size `Median`, `Spec.` (`≥ 6 N`), `Passed / Failed`.

**Weight (g) - average of 13 gloves per size** (module `weight`): per size `Average`, `Remark` (`Info`).

## Page 3

**Freedom from Holes by watertight test (Single sampling code letter ..., AQL 1.5)** (module `watertight`), columns per size:

- `No. of sample tested`
- `Defect Limit`: Accept / Reject
- `Pin hole`: `Between fingers (crotch)`, `Palm`, `Finger`, `Cuff`, `Other :`
- `Total number of defects found` (written `1/500`)
- `Freedom from holes (Passed / Failed)`

**Visual Inspection (Single Sampling code letter ...)** (module `visual`), columns per size, each class with `No. of sample inspected`, limits, defect rows, total and disposition:

| Class | Defects (verbatim) |
|---|---|
| Critical Defects (AQL 0.0), limit `Acc. = 0` / `Rej. = 1` | Embeded [sic] Insects; Embeded [sic] metal debris |
| Major Defects (AQL 2.5) | Thin area between fingers (crotch); Ring-shaped thin area (crotch); Thin area on glove body; Thin spot on glove body; Non-removable dirt; Oil stain; Residue material / foreign matter; Defective bead; Big Lumps (>2mm) |
| Minor Defects (AQL 4.0) | Small dirt / stain; Sticky pleats (< 5mm); Lumps (<2mm); Poor beading; Rolled bead; Defective beads |

The critical section's result line is mislabelled `Disposition - Visual Minor` [sic]. The app labels it Critical.

## Page 4

**Glove Packing Check (Sampling code letter D & E) : min. 70% layering & 80% dispensing** (module `dispensing_packing`), one block per size:

- Columns: `Item` | `Box #` | `Layering %` | `Dispensing %` | `Stickiness **`
- Rows: 13 boxes (5 in the XL block), then `Average`, `Passed / Failed`
- `**Glove stickiness Code`:
  - `A` = Non sticky (Passed)
  - `B` = A mix of non sticky to lightly sticky (Passed)
  - `B1` = A mix of non sticky to light sickiness [sic] at the bead (Passed)
  - `C` = Lightly sticky but dispensable (Passed)
  - `D` = Too sticky & affect dispensing (Failed)

**Packaging Labeling Inspection** (module `labeling`), columns per size:

| Level | No. inspected | Limit | Checks |
|---|---|---|---|
| Dispenser Box | 3 | Accept 0 / Reject 1 | Wrong / No lot number; Wrong / No mfg. date; Wrong artwork print |
| Carton Box | 1 | Accept 0 / Reject 1 | Wrong / No lot number; Wrong / No mfg. date; Wrong artwork print; No carton number printed |

Each level ends with `Total number of defects found` and a disposition. The carton disposition is mislabelled `Inner Box` [sic].

**Conclusion** (module `conclusion`): `Conclusion` (PASSED / FAILED), `Remark`, `Date`, signature.
