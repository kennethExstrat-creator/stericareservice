// How SteriCare's inspectors fill in their paper inspection form (docs/AI.md,
// "The paper form"): pen and paper on the factory floor, then photographed or
// scanned and uploaded. Told to the AI with every document it reads, with the
// shortforms an admin keeps in Admin > Defects > Shortforms. Source Documents also
// tell it how a laboratory test report is read (LAB_REPORT_GUIDE): its
// results go into tensile and force at break, and the report itself is
// linked to those steps (docs/AI.md, "Source Documents"). Box # and carton #
// are one number, a box/carton number (Kenneth, 13 October 2026): the guide
// says so, and says to copy one as written, sampled or not. Each one a
// document gives for a size also goes into that size's list of sampled
// cartons while the list is empty (Kenneth, 14 October 2026: "if box and
// carton is the same thing, why the AI wont auto fill the carton number?").
// A dimension table's Spec row sets the inspection's spec per size and
// column, NA included, where it differs from the template's (Kenneth, 26
// October 2026: "the specification should be adjustable, manually or AI
// auto, read the document uploaded and adjust"); a P/F set by hand never
// comes from a document.
// Weight is one value per size, the average a dimension sheet prints
// (WEIGHT_GUIDE; Kenneth, 26 October 2026), and the sampling plan has no
// gloves for weight. The form's Sampling Plan gives the inner boxes sampled
// in all, which is innerUnits; a count per case, written elsewhere, is
// innerUnitsPerCase, as the data schema's descriptions say (Kenneth, 27
// October 2026).
// A packing row marked as an aged sample is the size's aged sample, never
// one of its boxes (Kenneth, 26 October 2026: read as a ninth box with no
// box/carton number, it left the whole packing check incomplete).
// Both readers also take Excel and CSV files, as text (SPREADSHEET_NOTE;
// lib/ai/document-file.ts; Kenneth, 26 October 2026).
import type { GlossaryEntry } from "@/lib/schemas/ai-settings";

/** How an Excel or CSV file reaches the reader (lib/spreadsheets/read.ts): one sentence in each reader's prompt. */
export const SPREADSHEET_NOTE =
  'An Excel or CSV file comes as text: a CSV as it is, a workbook sheet by sheet, each sheet as CSV under a line "Sheet: <name>", with the values as Excel shows them.';

export const PAPER_FORM_GUIDE = `How SteriCare inspectors fill in their paper inspection form:
- One form per purchase order and lot, usually one size per form. Its parts: "Purchase Order / Shipment Information" (manufacturer, PO with the SO in brackets, product name, lot number, mfg and expiry date, glove type, packing mode); "Inspected by" (initials, date, signature); "PO Info" (glove size, quantity in cases); "Sampling Plan" (cases, inner boxes and gloves sampled, the inner boxes in all, not per case; gloves for watertight (WTT) and visual; gloves for dimension; gloves for force at break (FAB); inner boxes for the dispensing test); "Watertight Inspection" and "Visual Inspection" (defects by size, major and minor); then "Dispensing Result" on a page of its own (by size: box/carton number, layering %, dispensing %, stickiness code, others).
- A box number and a carton number are the same number, a box/carton number: the boxes of the dispensing and labelling tests are the size's sampled cartons (the Finished Goods Sampling Information). Copy each box/carton number as written, even one that is not among the sampled ones: never change it to a sampled number; the app warns about it.
- So each box/carton number a document gives for a size's boxes (a dispensing or packing result, the labelling boxes, a list of the sampled cartons, a carton's label) also goes into carton_sampling's cartonNumbers for that size, besides its own test's field: in the order the document lists them, each number once (the list never repeats a number, though a test may use one carton twice), as written. Give the document's whole list for each size even when that size's list already holds numbers: the app fills an empty list, and takes a fuller list only when it holds every number already there (a carton sheet completing the dispensing page's boxes), never mixing in another order's. Never pad the list to the cases sampled, never add a number the documents do not state, and leave out a packing list's carton numbering (the shipment's cartons, not the sample).
- An aged sample is not a box: a dispensing or packing row marked as one (a remark such as "Aged sample" or "aged" in Others, usually with no box/carton number) goes into that size's agedSample in dispensing_packing (its layering %, dispensing %, stickiness code, and the remark as its note), never into its boxes. Each size has at most one aged sample.
- Each test has its own count in the sampling plan: never copy one test's count into another's. Never fill the sampling plan's glovesWeight: the app has no gloves-for-weight row (the weight step records one average per size).
- A dimension table prints a "Spec." row for each size: each column's spec as printed, such as ≥240, ≤80, 80±10, 230-250 or NA (no spec). Put it into dimensions' specOverrides for that size and column, in the schema's spec shape (NA is {"kind": "na"}), only where it differs from that size's spec in the module settings and the current data has none. A spec comes only from a Spec row, never from the readings or a result. Never write dimensions' manualResults: only the inspector sets a P/F, on screen.
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
 * the report itself is filed there (the answer's attachTo). Every report is
 * filed, and its results come for every size it reports, entered or not, so
 * each is linked with its sizes (Kenneth, 26 October 2026: one report per
 * size). A report naming several sizes for one set of results gives those
 * results to each of them (Kenneth, 29 October 2026: "one report consist
 * all FAB but steri AI read but did not fill in": a Matang force at break
 * report, Line / Size "SMALL, MEDIUM, LARGE, XLARGE", 13 readings).
 */
export const LAB_REPORT_GUIDE = `How to read a laboratory test report (tensile strength and elongation, force at break):
- A lab report belongs to this inspection unless it names a PO other than this inspection's, or a lot or batch number that is none of this inspection's lot numbers: leave that one out. Compare each only where the current data holds it (the header's PO, the order's lot numbers); a report that names none of them, or that cannot be compared yet, belongs here.
- Do both: file the report in "attachTo" where it belongs, and read its results into that module's fields, as for any document. File it even when the step already has another size's report: each report is linked with the sizes it gives results for.
- Tensile ("tensile"): per size, the average tensile strength in MPa (N/mm²) and the average elongation at break in % (536, not 5.36), as the report prints them. When it gives results before and after ageing, take those before ageing, unless the module's title or settings say aged. Leave a value out when the report prints only individual readings.
- Force at break ("force_at_break"): per size, each glove's force at break in N, in the report's order, as that size's "values". Never a median, average or minimum in their place.
- Each result goes under the size the report names, as the size values given; a report for one size fills only that size. A report that names several sizes for one set of results (its Line / Size or Size field lists them, e.g. "SMALL, MEDIUM, LARGE, XLARGE", and no size stands beside the results) tested them together: give those same results under each size it names. Leave out sizes this inspection does not offer.
- Give the results of every size the report holds, also where the current data already holds them: the app keeps what is entered, and links the report with the sizes it gives results for.`;

/**
 * How the weight step is read (Kenneth, 26 October 2026: "this page should
 * only record average weight of each size, which already in the dimension
 * document"): one value per size, the average weight the document prints.
 */
export const WEIGHT_GUIDE = `How to read the glove weight ("weight"):
- Per size, one value: the size's average weight in g as a document prints it, usually the "Weight (g)" row or column of a dimension sheet (S 3.2, M 3.4, L 3.8), as that size's "values": [3.4]. The weight's spec (often NA) and its P/F or remark ("Info only") are not data: leave them out.
- Never work the average out yourself: a document that lists each glove's weight without the size's average gives nothing for weight.`;

const GUESS = " A guess, not confirmed by an inspector yet.";

/** A meaning as one sentence on one line (the panel's box takes line breaks): a full stop only when it has none. */
function sentence(text: string): string {
  const line = text.replace(/\s+/g, " ").trim();
  return /[.!?]$/.test(line) ? line : `${line}.`;
}

/**
 * The shortforms as Steri-AI reads them: the defects with the library codes
 * each counts under, then the other words inspectors write. `library`
 * names the codes (the active defect codes); a code it lacks is given
 * without a name. Unconfirmed meanings are marked as guesses.
 */
export function glossaryText(glossary: readonly GlossaryEntry[], library?: readonly { code: string; name: string }[]): string {
  const names = new Map(library?.map((entry) => [entry.code, entry.name]));
  const named = (code: string) => (names.has(code) ? `${code} (${names.get(code)})` : code);
  const line = (entry: GlossaryEntry, codes = "") =>
    `- ${entry.short}: ${sentence(entry.meaning)}${codes}${entry.confirmed ? "" : GUESS}`;

  const defects = glossary
    .filter((entry) => entry.kind === "defect")
    .map((entry) => {
      if (entry.codes.length === 0) return line(entry, " No code yet.");
      return line(entry, ` ${entry.codes.length === 1 ? "Code" : "Codes"}: ${entry.codes.map(named).join(", ")}.`);
    });
  const terms = glossary.filter((entry) => entry.kind === "term").map((entry) => line(entry));

  const blocks: string[] = [];
  if (defects.length > 0) {
    blocks.push(
      `Shortforms some inspectors write (examples, not a standard). A defect's codes are SteriCare defect library codes: count it under that code when the template lists it, else put it under "unmapped" with the code's library name.\n${defects.join("\n")}`,
    );
  }
  if (terms.length > 0) blocks.push(`Other words inspectors write (not defects):\n${terms.join("\n")}`);
  return blocks.join("\n\n");
}
