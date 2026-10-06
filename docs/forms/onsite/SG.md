# Form: SG (sterile surgical gloves)

- Template: `STD_SG`
- Source: `Onsite inspection format - SG.docx` (author KK Ngan, last modified Nov 2025)
- Layout reference: `SG.pdf` (A4 portrait, 2 pages)
- Labels below are verbatim from the form. Blank rows on the paper are for handwritten entries.

## 1. Purchase Order / Shipment Information

| Label | Input | Notes |
|---|---|---|
| Manufacturer Name | text | |
| Purchase/Sales Order No. | text | |
| Product Name | text | |
| Lot Number | text | Double-height box: room for several lots |
| Mfg / Exp Date | text | One box for both dates. System splits into mfg date and exp date. |
| Glove Type | text | |
| Packing Mode | text | |

## 2. Inspected by (box beside section 1)

| Label | Input | Notes |
|---|---|---|
| Name | text | System: logged-in inspector |
| Date | date | System: inspection date |
| (unlabelled tall box) | blank | Likely signature or remarks. System: submit by the logged-in inspector, plus remarks. |

## 3. PO Info / Sampling Plan

Two header rows. Columns in order:

| Group | Column | Input |
|---|---|---|
| PO Info | Glove Size | size |
| PO Info | Qty (case) | number |
| Sampling Plan > Sampling Quantity (WTT & Visual) | Case | number |
| Sampling Plan > Sampling Quantity (WTT & Visual) | Inner Box | number |
| Sampling Plan > Sampling Quantity (WTT & Visual) | Pouches | number |
| Sampling Plan > Sampling Quantity (WTT & Visual) | # gloves | number |
| Sampling Plan | # Gloves dimension | number |
| Sampling Plan | # Gloves (FAB) | number |
| Sampling Plan | # pouches (dye leak test) | number |

Rows: 8 blank size rows, then a `Total:` row summing every column except Glove Size.

## 4. Watertight Inspection

- `Size` header row: 8 size columns, each split into `R` and `L`.
- `Defect` label on the left, then 7 blank rows. Each row: defect name (handwritten) and a count per size per hand.
- `Total WTT` row: one total per size (spans R and L).

## 5. Visual Inspection

Two sub-tables, each with its own `Size` header row (8 sizes, each split `R` / `L`):

- `Major defect`: 7 blank defect rows, then `Total Major` (one total per size, spans R and L).
- `Minor defect`: 6 blank defect rows, then `Total Minor` (one total per size, spans R and L).

## Not on this form

- No results tables for dimensions, FAB or dye leak. The samples are planned in section 3 only.
- No AQL, accept/reject, overall result or remarks field.
