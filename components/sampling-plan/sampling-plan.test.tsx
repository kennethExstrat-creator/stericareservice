// The sampling plan's page as server-rendered markup (Kenneth, 27 October
// 2026: the design he sent), from the placeholder fixture: A4 landscape with
// the report's chrome (no page number, no Draft tag), the heading, The Sample
// at a Glance, the Order, the details card, Sampling Plan by Size and the
// code letters' note.
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { STERICARE_LETTERHEAD } from "@/lib/report/letterhead";
import { makePlanExport, planData } from "@/lib/sampling-plan/__fixtures__/export";
import { buildSamplingPlanModel, type SamplingPlanModel } from "@/lib/sampling-plan/model";
import { columnShares, countText, NO_COUNT, SamplingPlanDocument } from "./index";

function modelOf(modules: Record<string, unknown> = {}): SamplingPlanModel {
  const model = buildSamplingPlanModel(makePlanExport(modules));
  if (!model) throw new Error("The fixture has a sampling plan.");
  return model;
}

/** The text of some markup, tags dropped and spaces collapsed. */
const text = (html: string) =>
  html
    .replace(/<[^>]+>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/** One table row's cells as text, by its data-row key. */
function rowText(html: string, key: string): string {
  const row = new RegExp(`<tr data-row="${key}"[^>]*>([\\s\\S]*?)</tr>`).exec(html)?.[1] ?? "";
  return Array.from(row.matchAll(/<(?:th|td)[^>]*>([\s\S]*?)<\/(?:th|td)>/g), (cell) => text(cell[1]))
    .join(" | ")
    .trim();
}

/** The by-size table's markup. */
const planTable = (html: string) => /<table data-slot="sampling-plan-table"[\s\S]*?<\/table>/.exec(html)?.[0] ?? "";

describe("the sampling plan's page", () => {
  const html = renderToStaticMarkup(<SamplingPlanDocument model={modelOf()} />);

  it("is one A4 landscape page at its true size, printed as drawn", () => {
    expect(html.match(/<section data-sampling-plan-page/g)).toHaveLength(1);
    expect(html).toMatch(/<div data-sampling-plan="true" data-page-size="a4" data-orientation="landscape"/);
    const page = /<section data-sampling-plan-page="true" aria-label="Sampling Plan" class="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(page).toContain("w-[297mm] h-[210mm]");
    expect(page).toContain("[print-color-adjust:exact]");
  });

  it("wears the report's chrome: the blue-to-teal bar, the logo, the letterhead on one line, the band and the footer", () => {
    expect(html).toMatch(/data-slot="sampling-plan-top-bar"[^>]*><span class="w-\[70%\] bg-brand-600"><\/span><span class="flex-1 bg-accent-500">/);
    expect(html).toContain(`src="${STERICARE_LETTERHEAD.logo.src}"`);
    const letterhead = /<address data-slot="sampling-plan-letterhead"[^>]*>([\s\S]*?)<\/address>/.exec(html)?.[1] ?? "";
    expect(Array.from(letterhead.matchAll(/<p>([\s\S]*?)<\/p>/g), (line) => text(line[1]))).toEqual([
      "SteriCare Sdn. Bhd. (719431-T) · 45A, Jalan Puteri 5/10, Bandar Puteri, 47100 Puchong, Selangor, Malaysia",
      "+60-3-8061 7213 · enquiry@stericare.com.my · www.stericare.com.my",
    ]);
    expect(html).toMatch(/data-slot="sampling-plan-band-title" class="[^"]*uppercase[^"]*">Sampling Plan</);
    expect(html).toMatch(/data-slot="sampling-plan-band-aside"[^>]*>PO-0001 · Inspection 11 April 2025</);
    const footer = text(/<footer data-slot="sampling-plan-footer"[\s\S]*?<\/footer>/.exec(html)?.[0] ?? "");
    expect(footer).toBe("Prepared for Manufacturer A · Factory A1 · PO-0001 Computer-generated document. No signature required.");
    // No page number and no Draft tag: it goes to the factory before the inspection.
    expect(html).not.toMatch(/Page 1 of|Draft/);
  });

  it("heads the left column with the product type, the product and the ask", () => {
    const heading = /<header data-slot="sampling-plan-heading"[\s\S]*?<\/header>/.exec(html)?.[0] ?? "";
    expect(text(heading)).toBe("Nitrile Examination Gloves Brand A PC-A01 Blue Nitrile Please have these samples ready for SteriCare's pre-shipment inspection.");
    expect(heading).toMatch(/<h2[^>]*>Brand A PC-A01 Blue Nitrile<\/h2>/);
    expect(heading).toContain("bg-accent-500");
  });

  it("gives The Sample at a Glance in big numbers, the gloves sampled last in a teal box", () => {
    const glance = /<ul data-slot="sampling-plan-glance">([\s\S]*?)<\/ul>/.exec(html)?.[1] ?? "";
    expect(text(html)).toContain("The Sample at a Glance");
    expect(Array.from(glance.matchAll(/<li data-glance="([^"]+)"[^>]*>([\s\S]*?)<\/li>/g), (line) => `${line[1]}: ${text(line[2])}`)).toEqual([
      "cases: 62 cases to pull",
      "innerUnits: 67 inner boxes taken",
      "glovesDrawn: 746 gloves drawn, 21 put back",
      "gloves: 725 gloves sampled",
    ]);
    expect(glance).toMatch(/<li data-glance="gloves" data-highlight="true" class="[^"]*border-accent-200 bg-accent-50/);
  });

  it("lists the Order: the gloves per case, each size's chip, lots, cases and gloves, and the totals", () => {
    const order = text(/<table data-slot="report-table"[\s\S]*?<\/table>/.exec(html)?.[0] ?? "");
    expect(text(html)).toContain("Order 1,000 gloves per case");
    expect(order).toBe(
      [
        "The order by size Size Lot no. Cases Gloves",
        "S LOT-S01 120 120,000",
        "M LOT-M01, LOT-M02 400 400,000",
        "L LOT-L01 100 100,000",
        "XL LOT-XL01 30 30,000",
        "Total 650 650,000",
      ].join(" "),
    );
  });

  it("names the client, the PO, the manufacturer and the inspection day in the details card", () => {
    const details = text(/<dl data-slot="report-key-values"[\s\S]*?<\/dl>/.exec(html)?.[0] ?? "");
    expect(details).toBe("Client Client A PO / SO Number PO-0001 (SO-0001) Manufacturer Manufacturer A · Factory A1 Inspection Date 11 April 2025");
  });

  it("draws Sampling Plan by Size: the chips and Total over the columns, the groups, each row's counts and totals", () => {
    const table = planTable(html);
    expect(text(html)).toContain("Sampling Plan by Size");
    expect(Array.from(table.matchAll(/data-size-head="([^"]+)"/g), (head) => head[1])).toEqual(["S", "M", "L", "XL"]);
    expect(table).toMatch(/data-slot="report-size-chip" data-size="XL" class="[^"]*bg-brand-900/);
    expect(table).toMatch(/<th scope="col" class="[^"]*bg-brand-50[^"]*">Total<\/th>/);
    expect(Array.from(table.matchAll(/<th scope="rowgroup"[^>]*>([^<]*)<\/th>/g), (group) => group[1])).toEqual(["Sampling Quantity", "For Each Test"]);
    expect(rowText(table, "cases")).toBe("Cases to pull | 16 | 25 | 16 | 5 | 62");
    expect(rowText(table, "innerUnitsPerCase")).toBe("Inner boxes per case | 1 | 1 | 1 | 2 |");
    expect(rowText(table, "innerUnits")).toBe("Inner boxes taken | 16 | 25 | 16 | 10 | 67");
    expect(rowText(table, "glovesPerInnerBox")).toBe("Gloves per inner box | 13 | 8 | 13 | 13 |");
    expect(rowText(table, "glovesDrawn")).toBe("Gloves drawn | 208 | 200 | 208 | 130 | 746");
    expect(rowText(table, "putBack")).toBe("Put back | −8 | 0 | −8 | −5 | −21");
    expect(rowText(table, "gloves")).toBe("Gloves sampled | 200 | 200 | 200 | 125 | 725");
    expect(rowText(table, "glovesWatertightVisual")).toBe("Watertight & visual gloves | 200 | 200 | 200 | 125 | 725");
    expect(rowText(table, "glovesDimensions")).toBe("Dimension gloves | 13 | 13 | 13 | 8 | 47");
    expect(rowText(table, "innerUnitsDispensing")).toBe("Packaging & dispensing inner boxes | 8 | 8 | 8 | 5 | 29");
    // Switched off on the Sampling Plan: no row.
    expect(table).not.toContain("Force at break");
  });

  it("tints the gloves sampled teal, bolds the counts that stand apart, and greys the unit a test counts", () => {
    const table = planTable(html);
    expect(table).toMatch(/<tr data-row="gloves" data-highlight="true" class="border-b-\[0\.35mm\] border-accent-200 bg-accent-50">/);
    expect(/<tr data-row="gloves"[\s\S]*?<\/tr>/.exec(table)?.[0]).toMatch(/<td class="[^"]*font-bold text-accent-700">200</);
    const odd = Array.from(table.matchAll(/<tr data-row="([^"]+)"[\s\S]*?<\/tr>/g)).flatMap((row) =>
      Array.from(row[0].matchAll(/<td data-odd="true" class="([^"]*)">([^<]*)</g), (cell) => `${row[1]} ${cell[2]} ${cell[1].includes("font-bold")}`),
    );
    expect(odd).toEqual(["innerUnitsPerCase 2 true", "glovesPerInnerBox 8 true"]);
    expect(table).toContain('Watertight &amp; visual<span class="font-normal text-slate-500"> gloves</span>');
  });

  it("closes with the code letters the samples follow, a reduced one said so", () => {
    expect(text(/<p data-slot="sampling-plan-note"[\s\S]*?<\/p>/.exec(html)?.[0] ?? "")).toBe(
      "Sample sizes follow ISO 2859-1 single sampling, code letters L, L (reduced from M), L and K for sizes S, M, L and XL.",
    );
  });

  it("prints a count not entered yet as a dash, and has no Total column for one size", () => {
    const data = planData();
    const partial = renderToStaticMarkup(
      <SamplingPlanDocument model={modelOf({ sampling_plan: { ...data, sizes: { ...data.sizes, M: { ...data.sizes.M, glovesDimensions: null } } } })} />,
    );
    expect(rowText(partial, "glovesDimensions")).toBe(`Dimension gloves | 13 | ${NO_COUNT} | 13 | 8 | 34`);
    const one = renderToStaticMarkup(
      <SamplingPlanDocument model={modelOf({ order_lots: { sizes: { M: { qtyCases: 400, lotNumbers: ["LOT-M01"], packingSite: null } } } })} />,
    );
    expect(rowText(one, "cases")).toBe("Cases to pull | 25");
    expect(planTable(one)).not.toContain("Total");
    expect(planTable(html)).toContain(">Total</th>");
  });
});

describe("countText and columnShares", () => {
  it("prints counts with separators, Put Back with a minus sign, a blank as a dash", () => {
    expect(countText(1234)).toBe("1,234");
    expect(countText(8, true)).toBe("−8");
    expect(countText(0, true)).toBe("0");
    expect(countText(null)).toBe(NO_COUNT);
  });

  it("gives the sizes the design's widths up to five, closing up the labels beyond, the labels taking the rest", () => {
    const four = columnShares(4, true);
    expect(four.label).toBeCloseTo(34, 1);
    expect(four.size).toBeCloseTo(13.775, 3);
    expect(four.total).toBe(10.9);
    expect(columnShares(5, true).label).toBeCloseTo(34, 1);
    expect(columnShares(8, true).label).toBeCloseTo(22, 1);
    // One size, no Total: the size as wide as with four, the labels the rest.
    expect(columnShares(1, false)).toEqual({ label: 86.2, size: 13.8, total: 0 });
    for (const count of [1, 2, 3, 4, 5, 6, 8]) {
      const shares = columnShares(count, count > 1);
      expect(shares.label + shares.size * count + shares.total).toBeCloseTo(100, 6);
    }
  });
});
