# Report: Safedon EG (nitrile examination gloves, ASTM D6319 style)

- Template: `SAFEDON_EG`
- Source: filled Excel report "Hartalega - 2466264 Poly 05I-24 Sum - Glacier Zero Safedon Nitrile" (4 pages, May 2024). Example PDF: `docs/examples/2024-05-22_SAFEDON_EG_example.pdf`
- Page 1 carries the Polyco Healthline logo: a client-branded report. Safedon is the product line.
- Standard profile: ASTM D6319 (average statistics, tensile strength and elongation from lab reports)
- Labels below are verbatim, including the original spelling. `[sic]` marks a typo to fix in the app. The app and the AI report write these words in Title Case (Kenneth, 8 October 2026: docs/DESIGN.md, Capitalisation): "# glove per plastic pack" here is "# Glove per Plastic Pack" there. Module keys refer to BUILD_SPEC section 6.

## Page 1

Title: `Preshipment Inspection` / `Safedon Nitrile PF Exam Gloves`, client logo top left.

**Manufacturer Information** (module `header`)

| Label | Input |
|---|---|
| Manufacturer / Supplier | text |
| Supplier Factory Address / Location | text |
| PO Number | text, e.g. `2466264 (Poly 05I/24)` |
| Product Name (Brand & code) | text |
| Inspection date | date |
| Manufacturing date | date |
| Expiry date | date |
| Inspected by | text |

**Glove Information** (module `glove_info`): same four fields as STD_EG: `Glove surface texture`, `Indicative weight (size M)`, `Glove colour`, `Glove length`.

**Order table** (module `order_lots`): `Size` | `Qty (cases)` | `Lot Number` | `Packing Site` (e.g. Hartalega, Adasmed). Then `Total # carton`, `Total # gloves`.

**Packing configuration** (module `packing_config`): `# glove per plastic pack`, `# packs per case`, `# gloves per case`.

**Sampling Plan** (module `sampling_plan`), one row per size:

| Column | Sub-columns |
|---|---|
| Glove Size | |
| Order Qty (case) | |
| Sampling Quantity | Case, Inner pack, Gloves |
| # gloves for watertight & Visual | |
| # gloves for dimension | |
| # gloves for Tensile | |
| # inner packs for packaing [sic] & dispensing inspection | |

**Finished Goods Sampling Information (carton number)** (module `carton_sampling`): same grid as STD_EG.

## Page 2

Header: `Preshipment Report (PO# <PO>: <product>)`

**Dimension - Size <XS..L>** (module `dimensions`), one table per ordered size:

- Columns: `No.` (1 to 13) | `Length` | `Width` | `Finger Thickness` | `Palm Thickness` | `Weight (g)`
- Weight is one value per size (merged cell), not per glove (module `weight`, n = 1)
- Rows: 13 gloves, then `Average`, `Spec.`, `A / Rej.`
- Spec in the example: Length `≥ 230`; Width XS `76 ± 4`, S `86 ± 4`, M `98 ± 4`, L `107 ± 4`; Finger Thickness `0.18 ± 0.04`; Palm Thickness `0.14 ± 0.04`; Weight `NA`

**Physical Properties average (Refer to attached lab. reports)** (module `tensile`), per size:

| Row | Spec |
|---|---|
| Tensile Strength (Average) (MPa) | `Spec. (ASTM D6319)` `≥ 14.00` |
| Elongation at break, average (%) | `Spec. (ASTM D6319)` `≥ 500%` |
| Passed / Failed | |

## Page 3

**Glove Dispensing Inspection (Sampling code letter C & D)** (module `dispensing_safedon`). Same rows as the onsite form (`docs/forms/onsite/SAFEDON_EG.md`). What the filled report adds:

- Two sizes share one block row: 13 box columns split across them (e.g. XS boxes 1 to 5, S boxes 6 to 13). The app shows one block per size.
- Box numbers are carton numbers from page 1.
- The three `Total` lines are:
  1. per box: defects / gloves per pack, written `1/125`
  2. per box: defect rate as a decimal, e.g. `0.008`
  3. per size: `defects / gloves inspected (rate %)`, e.g. `3 / 625 (0.48 %)`
- `Specification / Requirement`: `≤ 5%` per size. `Conclusion`: Passed / Failed per size.

## Page 4

**Freedom from Holes by watertight test (Sampling code letter J & L; AQL=1.5)** (module `watertight`), columns per size:

- `No. of sample tested`, `Defect Limit` Accept / Reject
- `Holes`: `Between fingers`, `Palm`, `Cuff`, `Finger`, `Glove burst`, `Other :`
- `Total number of defects found`, `Freedom from holes (Passed / Failed)`

**Visual Inspection (Sampling code letter J & L)** (module `visual`):

| Class | Defects (verbatim) |
|---|---|
| Critical Defects (AQL 0.0), Accept 0 / Reject 1 | Embeded [sic] Insects; Embeded [sic] metal debris |
| Major Defects (AQL 2.5) | Thin ring between fingers (crotch); Thin area between fingers (crotch); Thin batch [sic: patch] / area (body); Thin spot; Non-removable dirt; Stain; Powder mark; Bead blister |
| Minor Defects (AQL 4.0) | Small dirt / stain; Sticky pleats (< 5mm); Lumps (<2mm); Thin bead; Thin bead / small beading defect |

The critical section's result line is mislabelled `Disposition - Visual Minor` [sic].

**Packaging Labeling Inspection** (module `labeling`):

| Level | No. inspected | Limit | Checks |
|---|---|---|---|
| Inner Boxes/Packs | 3 | Acc. = 0 / Rej. = 1 | Wrong / No lot number; Wrong / No mfg. date; Wrong / No expiry date; Wrong artwork print |
| Carton Boxes | 1 | Acc. = 0 / Rej. = 1 | Wrong / No lot number; Wrong / No mfg. date; Wrong / No expiry date; Wrong artwork print; No carton number |

**Conclusion** (module `conclusion`): `Conclusion`, `Remark`, `Inspected by`, `Date`, signature.

## Differences from STD_EG

| Item | STD_EG | SAFEDON_EG |
|---|---|---|
| Header extras | Client Name, Factory glove code | Inspected by, client logo |
| Order table | no packing site | Packing Site per lot |
| Inner unit | inner box | plastic pack |
| Dimension statistic | Median | Average |
| Dimension columns | Cuff Thickness | Weight (one per size) |
| Physical test | Force at break (N), EN 455 | Tensile (MPa) and elongation (%), ASTM D6319 |
| Weight | average of 13 per size | one value per size |
| Watertight rows | no Glove burst | Glove burst |
| Dispensing | layering %, dispensing %, stickiness code | Safedon 6-defect grid, ≤ 5% |
| Labelling checks | no expiry date check | expiry date checked |
| Defect lists | see above | see above (same defects, different labels) |
