// The prompt lab's answers (12 October 2026), all on one draft inspection
// with one size (M), nine sections not done, PASSED against a suggested
// HOLD, no remark and no photo: a stress test, not a typical summary. The
// client, manufacturer, product, PO, SO and lot are placeholders (BUILD_SPEC
// rule 7). The final contract: blocks of plain strings with **bold**.
import type { SummaryAnswer } from "../summary-doc";

/** Claude Opus 5.5, prompt v4, Standard, Paragraph and Findings List (the lab's fifth call). */
export const LAB_OPUS_PARAGRAPH_LIST: SummaryAnswer = {
  "blocks": [
    {
      "type": "paragraph",
      "items": [
        "The inspection of [Product] under PO / SO Number [PO] ([SO]) concluded **PASSED**. The suggested result was HOLD, as nine sections were not done."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "The inspection covered size M only, with 2,900 cartons under Lot Number [Lot]; the total number of gloves is not known, as the gloves per case were not recorded. The inspection followed EN 455, with Single Sampling Code Letter N, AQL 1.5 for the watertight test and AQL 0.0, 2.5 and 4.0 for critical, major and minor visual defects, on a sample of 500 gloves."
      ]
    },
    {
      "type": "bullet_list",
      "items": [
        "**Glove Information** and **Packing Configuration** were not done: Indicative Weight, gloves per inner box, inners per case and gloves per case are missing.",
        "**Sampling Plan** was not done, as the lot size is unknown; **Finished Goods Sampling Information (Carton Number)** was not done, with 0 of 50 carton numbers recorded.",
        "**Dimension**, **Force at Break in Newton** and **Weight (g) - Average of 12 Gloves per Size** were not done, with 0 of 12, 0 of 13 and 0 of 12 readings recorded.",
        "**Visual Inspection** was not done: major defects were recorded at 8 in 500 (Skin Visual 3, Flow Mark 2, Non-Removable Dirt 1, Oil Stain 1, Big Lumps (>2mm) 1) against accept 21, reject 22; critical and minor defects were not done.",
        "**Packaging Labeling Inspection** was not done for the Dispenser Box and Carton Box.",
        "Freedom From Holes by Watertight Test passed with 6 holes in 500 gloves (Between Fingers (Crotch) 3, Palm 2, Finger 1) against accept 14, reject 15.",
        "Glove Packing Check passed: Layering 89.4% (min. 70%), Dispensing 91.4% (min. 80%), Stickiness A."
      ]
    }
  ],
  "notes": [
    "The conclusion PASSED differs from the suggested result HOLD and no remark gives the reason.",
    "Nine sections are still not done, including the Sampling Plan, Dimension, Force at Break and Weight.",
    "No photos are attached to the inspection."
  ]
};

/** Claude Sonnet 5.5, prompt v3, Detailed, Headed Sections, with the closing sentence written in (the lab's fourth call). */
export const LAB_SONNET_HEADED: SummaryAnswer = {
  "blocks": [
    {
      "type": "paragraph",
      "items": [
        "**Result:** The inspector concluded **PASSED**."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Result Differs From Suggestion:** The suggested result was **HOLD**, as Glove Information, Packing Configuration, Sampling Plan, Finished Goods Sampling Information (Carton Number), Dimension, Force at Break in Newton, Weight (g) - Average of 12 Gloves per Size, Visual Inspection and Packaging Labeling Inspection were not done."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Issues:** **Glove Information** was not done; the indicative weight is missing. **Packing Configuration** was not done; the number of gloves per inner box, inners per case and gloves per case are missing. **Sampling Plan** was not done, as the lot size is unknown for size M. **Finished Goods Sampling Information (Carton Number)** was not done, with 0 of 50 carton numbers recorded for size M. **Dimension** was not done for size M, with 0 of 12 readings for Length, Width, Finger Thickness, Palm Thickness and Cuff Thickness. **Force at Break** was not done, with 0 of 13 readings for size M. **Weight** was not done, with 0 of 12 gloves weighed for size M. **Visual Inspection** was not done: Critical Defects and Minor Defects were not done, and only Major Defects were recorded. **Packaging Labeling Inspection** was not done; the Dispenser Box and Carton Box were not recorded for size M."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Order Overview:** The inspection covered [Product] (product code [Product Code]), purchase order [PO] ([SO]), size M only, with 2,900 cartons. The number of gloves per case was not available. The lot number is [Lot]. The manufacturer is [Manufacturer], [Factory]. The inspection took place on 9 October 2026."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Sampling Plan:** The inspection followed EN 455 with single sampling code letter N, an AQL of 1.5 for holes, and AQLs of 0.0, 2.5 and 4.0 for critical, major and minor defects, with a sample of 500 gloves."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Test Results:** The Freedom From Holes by Watertight Test passed for size M, with 6 in 500 against a limit of accept 14, reject 15. The Glove Packing Check passed for size M, with Layering at 89.4% (minimum 70%), Dispensing at 91.4% (minimum 80%) and Stickiness A passed."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Defects Found:** The watertight test found 6 holes: 3 between the fingers (crotch), 2 in the palm and 1 in a finger. Visual Inspection found 8 major defects in 500 gloves against a limit of accept 21, reject 22: Non-Removable Dirt 1, Oil Stain 1, Big Lumps (>2mm) 1, Flow Mark 2 and Skin Visual 3."
      ]
    },
    {
      "type": "paragraph",
      "items": [
        "**Next Step:** The conclusion of PASSED stands as recorded, although several sections were not done. This summary reflects the goods sampled at the time and place of inspection."
      ]
    }
  ],
  "notes": [
    "The conclusion is PASSED, but the suggested result is HOLD and no remark is recorded; please add the reason before signing.",
    "Nine sections are not done, and the inspection is still a draft.",
    "The report shows a Defect Limit of 14 / 15 for holes; please confirm the figures before signing."
  ]
};

/**
 * The lab's third call, Claude Opus 5.5 on the first contract, as a string:
 * valid JSON and a normal stop, but the paragraph breaks off just where the
 * bold PASSED should have started.
 */
export const LAB_CALL_3: SummaryAnswer = {
  "blocks": [
    {
      "type": "paragraph",
      "items": [
        "The inspection of [Product], PO / SO Number [PO] ([SO]), size M, 2,900 cartons, concluded"
      ]
    }
  ],
  "notes": []
};

/** The facts of that inspection the lab's answers name, placeholders included, for the figures check. */
export const LAB_INSPECTION_FACTS = [
  "size M, Total # Carton 2,900, Lot Number [Lot]",
  "Carton Number: 0 / 50; Dimension 0 / 12; Force at Break 0 / 13; Weight (g) - Average of 12 Gloves per Size 0 / 12",
  "Watertight: 6 / 500 (Between Fingers (Crotch) 3, Palm 2, Finger 1), Defect Limit 14 / 15, Single Sampling Code Letter N, AQL 1.5",
  "Visual: Major Defects 8 / 500 (Skin Visual 3, Flow Mark 2, Non-Removable Dirt 1, Oil Stain 1, Big Lumps (>2mm) 1), Defect Limit 21 / 22; AQL 0.0, 2.5, 4.0",
  "Glove Packing Check: Layering 89.4% (min. 70%), Dispensing 91.4% (min. 80%), Stickiness A",
  "Inspection Date 2026-10-09",
].join("\n");
