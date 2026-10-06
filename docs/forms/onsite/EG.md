# Form: EG (examination gloves)

- Template: `STD_EG`
- Source: `Onsite inspection format - EG.docx` (author KK Ngan, last modified Sep 2026)
- Layout reference: `EG.pdf` (A4 portrait; 2 pages in Word, the PDF render may run to 3)
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
| Sampling Plan > Sampling Quantity | Case | number |
| Sampling Plan > Sampling Quantity | Inner | number |
| Sampling Plan > Sampling Quantity | Gloves | number |
| Sampling Plan | # Gloves for WTT & Visual | number |
| Sampling Plan | # Gloves dimension | number |
| Sampling Plan | # Gloves for FAB | number |
| Sampling Plan | # inner for dispensing test | number |

Rows: 5 blank size rows, then a `Total:` row summing every column except Glove Size.

Difference from SG: here "Sampling Quantity" (Case / Inner / Gloves) is separate from "# Gloves for WTT & Visual". SG puts the WTT and visual gloves inside Sampling Quantity and adds Pouches.

## 4. Watertight Inspection

- `Size` header row: 5 size columns. No R/L split.
- `Defect` label on the left, then 6 blank rows. Each row: defect name (handwritten) and a count per size.
- `Total:` row: one total per size.

## 5. Visual Inspection

One shared `Size` header row (5 sizes), then:

- `Major defect`: 7 blank defect rows, then `Total Major`.
- `Minor defect`: 5 blank defect rows, then `Total Minor`.

## 6. Dispensing Result

| Column | Input | Notes |
|---|---|---|
| Size | size | |
| No. | number | Running row number. System: auto. |
| Box Number | text | |
| Layering (%) | number, % | |
| Dispensing (%) | number, % | |
| Stickiness | text | System: select (none, slight, severe) plus note |
| Others: | text | |

Rows: 51 blank rows. One row per box tested.

## Not on this form

- No results tables for dimensions or FAB. The samples are planned in section 3 only.
- No AQL, accept/reject, overall result or remarks field.
