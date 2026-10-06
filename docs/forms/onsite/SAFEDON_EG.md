# Form: Safedon EG (examination gloves, manufacturer Safedon)

- Template: `SAFEDON_EG` (extends `STD_EG`)
- Source: `Onsite inspection format - Safedon EG.docx` (author KK Ngan, created Sep 2026 as a copy of EG)
- Layout reference: `SAFEDON_EG.pdf`. The dispensing sheet is on the last page.
- The finished report version is `../reports/SAFEDON_EG.md`; it is the primary source.
- Labels below are verbatim from the form.

## Sections 1 to 5: same as EG

Identical to `EG.md` sections 1 to 5, field for field, with one label change:

- Section 1 title reads `Purchase Order / Shipment Information (Safedon)`.

## Section 6: Glove Dispensing Inspection (replaces EG "Dispensing Result")

In the Word file this sheet is a pasted picture, not a table, so it cannot be filled in on screen today. The system turns it into a real grid.

Title: `Glove Dispensing Inspection`. The page holds 3 identical blocks, one per size. Each block, top to bottom:

| Row | Input | Notes |
|---|---|---|
| Size | text, one per block | |
| Box # | 13 box columns, box number written at the top of each | System: 13 by default, inspector can add more |

Then 6 defect rows under the group label `Safedon Packing Defects`. Each row is a count per box.

| Defect | Definition as printed | Definition to show in the app |
|---|---|---|
| No cuff | Cuff should ideallly be at least 2 cm out | Cuff should ideally be at least 2 cm out |
| Finger out | Only cuff but no finger should be out first | Only the cuff, not a finger, should come out first |
| Multiple gloves out | Only one glove should be out at one time | Only one glove should come out at a time |
| Glove stuck | Glove ould not be dispensed or very difficult to dispense | Glove could not be dispensed or was very difficult to dispense |
| Sticky glove | Two or more gloves out at the same time caused by gloves sticking together | Two or more gloves out at once because they stick together |
| Faulty cuff | Deformed or out of shaped cuff which causes dispensing problem | Deformed or misshapen cuff causing a dispensing problem |

Then:

| Row | Input | Notes |
|---|---|---|
| Total | Three unlabelled lines: two rows of 13 per-box cells, then one full-width cell | From the filled report: line 1 = defects / gloves per pack per box (e.g. `1/125`), line 2 = defect rate per box (e.g. `0.008`), line 3 = size total `defects / gloves (rate %)`. All computed. |
| Specification / Requirement | free text, per block | |
| Conclusion | free text, per block | |

## Mapping to the core

- Each defect row maps to `dispensing.issues.<code>`: `no_cuff`, `finger_out`, `multiple_out`, `stuck`, `sticky`, `faulty_cuff`.
- Boxes tested = number of box columns with a box number. Boxes failed = boxes with any defect count above zero.
- Size result: total defects / (boxes x gloves per pack) against the spec (`≤ 5%` in the example).
- Specification / Requirement and Conclusion stay in `custom` and go into the export.
