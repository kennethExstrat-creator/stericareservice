// How SteriCare's inspectors fill in their paper inspection form (docs/AI.md,
// "The paper form"): pen and paper on the factory floor, then photographed or
// scanned and uploaded. Told to the AI with every document it reads, with the
// shortforms an admin keeps in Admin > AI Settings. Source Documents also
// tell it how a laboratory test report is read (LAB_REPORT_GUIDE): its
// results go into tensile and force at break, and the report itself is
// linked to those steps (docs/AI.md, "Source Documents").
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";

export const PAPER_FORM_GUIDE = `How SteriCare inspectors fill in their paper inspection form:
- One form per purchase order and lot, usually one size per form. Its parts: "Purchase Order / Shipment Information" (manufacturer, PO with the SO in brackets, product name, lot number, mfg and expiry date, glove type, packing mode); "Inspected by" (initials, date, signature); "PO Info" (glove size, quantity in cases); "Sampling Plan" (cases, inner boxes and gloves sampled; gloves for watertight (WTT) and visual; gloves for dimension; gloves for force at break (FAB); inner boxes for the dispensing test); "Watertight Inspection" and "Visual Inspection" (defects by size, major and minor); then "Dispensing Result" on a page of its own (by size: box number, layering %, dispensing %, stickiness code, others).
- Counts are often tally marks: each stroke | is one (|||| is 4). "2+1" means 2 and 1 more: 3. Add them up.
- "x/500" by a total is x defects found in 500 gloves inspected. When a total disagrees with its rows, trust the rows and say so in the summary.
- "50x10" in the gloves column is 50 inner boxes of 10 gloves: 500 gloves.
- The inspection date is day/month/year (9/10/2026 is 9 October 2026); manufacturing and expiry dates are often year/month/day (2026/09/23).
- Every inspector writes defects their own way: shortforms, misspellings, local words. Work out what each entry means from its wording, the part of the form it is in (watertight: where the hole is; visual: what the defect is; the Major or Minor part: its class) and glove QC knowledge. The shortforms listed below are what some inspectors write: a help, not a rule.
- Then record each in the standard list: under the template's own defect or hole location code (the lists in the module settings) when one means the same thing. When none does, put it under "unmapped" with a short standard English name (the SteriCare defect library's name when it has one), never the raw shortform, so an admin can map it. Never count it under a code that means something else.
- Leave out the inspector's initials and signature: the app records the inspector.
- Forms photographed together are separate forms, one per PO and lot: never add up or merge the results of forms with different POs or lots, even for the same size.`;

/**
 * How a laboratory test report is read on Source Documents: its results go
 * into the steps that keep a lab report, as any document's values do, and
 * the report itself is filed there (the answer's attachTo).
 */
export const LAB_REPORT_GUIDE = `How to read a laboratory test report (tensile strength and elongation, force at break):
- A lab report belongs to this inspection unless it names a PO other than this inspection's, or a lot or batch number that is none of this inspection's lot numbers: leave that one out. Compare each only where the current data holds it (the header's PO, the order's lot numbers); a report that names none of them, or that cannot be compared yet, belongs here.
- Do both: file the report in "attachTo" where it belongs, and read its results into that module's fields, as for any document.
- Tensile ("tensile"): per size, the average tensile strength in MPa (N/mm²) and the average elongation at break in % (536, not 5.36), as the report prints them. When it gives results before and after ageing, take those before ageing, unless the module's title or settings say aged. Leave a value out when the report prints only individual readings.
- Force at break ("force_at_break"): per size, each glove's force at break in N, in the report's order, as that size's "values". Never a median, average or minimum in their place.
- Each result goes under the size the report names, as the size values given; a report for one size fills only that size. Leave out sizes this inspection does not offer.`;

/** The shortforms as the AI reads them; unconfirmed ones are marked as guesses. */
export function glossaryText(glossary: readonly GlossaryEntry[]): string {
  if (glossary.length === 0) return "";
  const lines = glossary.map(
    (entry) => `- ${entry.short}: ${entry.meaning}${entry.confirmed ? "" : " (a guess, not confirmed by an inspector yet)"}`,
  );
  return `Shortforms some inspectors write (examples, not a standard):\n${lines.join("\n")}`;
}
